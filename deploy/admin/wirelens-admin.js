#!/usr/bin/env node
/* Wirelens admin service: lets admins add, remove and reset the users who can sign in to Wirelens.
 *
 * nginx protects the site with a password file (auth_basic + htpasswd). This small service edits that file.
 * It listens on 127.0.0.1 only; nginx forwards /wirelens/admin-api/ to it after the user has signed in and passes
 * the signed-in name in X-Remote-User. Only names listed as admins in the config may change users.
 * nginx reads the password file on every request, so changes apply at once (no reload).
 *
 *   node wirelens-admin.js [config.json]          (default config: C:/nginx/nginx-1.30.3/conf/wirelens-admin.json)
 *   config: { "htpasswd": "C:/nginx/nginx-1.30.3/conf/wirelens.htpasswd", "admins": ["you@company.com"], "port": 3010 }
 *
 * Dev only:  node wirelens-admin.js config.json --dev you@company.com --static <site folder>
 *   serves the site too and acts as if <you@company.com> had signed in (for testing the panel without nginx).
 *
 * No dependencies (Node 16+). Run under PM2 on the server: see deploy/SERVER.md.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---- Apache apr1 (MD5) password hash, the format nginx auth_basic reads on every platform ---- */
const ITOA = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function apr1(password, salt) {
  const pw = Buffer.from(String(password), 'utf8');
  salt = Buffer.from(String(salt || randomSalt()).slice(0, 8), 'utf8');
  const magic = Buffer.from('$apr1$');
  const md5 = (...parts) => { const h = crypto.createHash('md5'); parts.forEach(p => h.update(p)); return h.digest(); };
  let alt = md5(pw, salt, pw);
  const ctx = crypto.createHash('md5'); ctx.update(pw); ctx.update(magic); ctx.update(salt);
  for (let n = pw.length; n > 0; n -= 16) ctx.update(alt.subarray(0, Math.min(16, n)));
  for (let i = pw.length; i; i >>= 1) ctx.update(i & 1 ? Buffer.from([0]) : pw.subarray(0, 1));
  let fin = ctx.digest();
  for (let i = 0; i < 1000; i++) {
    const h = crypto.createHash('md5');
    h.update(i & 1 ? pw : fin);
    if (i % 3) h.update(salt);
    if (i % 7) h.update(pw);
    h.update(i & 1 ? fin : pw);
    fin = h.digest();
  }
  const to64 = (v, n) => { let s = ''; while (n-- > 0) { s += ITOA[v & 0x3f]; v >>= 6; } return s; };
  const f = fin;
  const out = to64((f[0] << 16) | (f[6] << 8) | f[12], 4) + to64((f[1] << 16) | (f[7] << 8) | f[13], 4) +
    to64((f[2] << 16) | (f[8] << 8) | f[14], 4) + to64((f[3] << 16) | (f[9] << 8) | f[15], 4) +
    to64((f[4] << 16) | (f[10] << 8) | f[5], 4) + to64(f[11], 2);
  return '$apr1$' + salt.toString('utf8') + '$' + out;
}
function randomSalt() { const b = crypto.randomBytes(8); let s = ''; for (const x of b) s += ITOA[x & 0x3f]; return s; }

/* ---- password file: "user:hash" lines; other lines (comments, blanks) are kept as they are ---- */
function readUsers(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return text.split(/\r?\n/).filter((l, i, a) => !(l === '' && i === a.length - 1)).map(l => {
    const i = l.indexOf(':');
    return (i > 0 && !l.startsWith('#')) ? { user: l.slice(0, i), hash: l.slice(i + 1) } : { raw: l };
  });
}
function writeUsers(file, lines) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, lines.map(l => l.raw !== undefined ? l.raw : l.user + ':' + l.hash).join('\n') + '\n', 'utf8');
  fs.renameSync(tmp, file);   /* atomic replace: nginx never reads a half-written file */
}

const EMAIL = /^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/;
function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) return 'The password must have at least 8 characters.';
  if (p.length > 128) return 'The password is too long (max 128 characters).';
  if (/[\r\n]/.test(p)) return 'The password cannot contain line breaks.';
  return null;
}

/* ---- the API (paths after /wirelens/admin-api/) ---- */
function makeHandler(cfg, opts) {
  opts = opts || {};
  const admins = new Set((cfg.admins || []).map(a => String(a).toLowerCase()));
  const log = opts.log || (m => console.log(new Date().toISOString() + ' ' + m));
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const body = req => new Promise((ok, bad) => {
    let s = ''; req.setEncoding('utf8');
    req.on('data', c => { s += c; if (s.length > 10000) { bad(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
  });
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/^\/(wirelens\/)?admin-api(?=\/)/, '').replace(/\/+$/, '') || '/';
    if (p === '/health') return send(res, 200, { ok: true });
    const me = String(opts.devUser || req.headers['x-remote-user'] || '').toLowerCase();
    if (!me) return send(res, 401, { error: 'Not signed in.' });
    const isAdmin = admins.has(me);
    if (req.method === 'GET' && p === '/me') return send(res, 200, { user: me, admin: isAdmin });
    if (req.method !== 'GET') {
      /* only our page can call this: a custom header forces a CORS preflight that other sites cannot pass */
      if (req.headers['x-requested-with'] !== 'wirelens') return send(res, 403, { error: 'Bad request origin.' });
    }
    let data = {};
    if (req.method === 'POST') { try { data = await body(req); } catch (e) { return send(res, 400, { error: 'Bad JSON.' }); } }
    const file = cfg.htpasswd;

    if (req.method === 'POST' && p === '/me/password') {
      const err = checkPassword(data.password); if (err) return send(res, 400, { error: err });
      const lines = readUsers(file), u = lines.find(l => l.user && l.user.toLowerCase() === me);
      if (!u) return send(res, 404, { error: 'Your user is not in the password file.' });
      u.hash = apr1(data.password); writeUsers(file, lines); log(`${me} changed own password`);
      return send(res, 200, { ok: true });
    }
    if (!isAdmin) return send(res, 403, { error: 'Admins only.' });

    if (req.method === 'GET' && p === '/users') {
      const users = readUsers(file).filter(l => l.user).map(l => ({ user: l.user, admin: admins.has(l.user.toLowerCase()) }));
      return send(res, 200, { users });
    }
    if (req.method === 'POST' && (p === '/users' || p === '/users/password' || p === '/users/remove')) {
      const user = String(data.user || '').trim().toLowerCase();
      if (!EMAIL.test(user)) return send(res, 400, { error: 'Enter a valid email address.' });
      const lines = readUsers(file), i = lines.findIndex(l => l.user && l.user.toLowerCase() === user);
      if (p === '/users') {
        if (i >= 0) return send(res, 409, { error: user + ' already has access. Use Reset password instead.' });
        const err = checkPassword(data.password); if (err) return send(res, 400, { error: err });
        lines.push({ user, hash: apr1(data.password) }); writeUsers(file, lines); log(`${me} added ${user}`);
        return send(res, 201, { ok: true });
      }
      if (i < 0) return send(res, 404, { error: user + ' is not a user.' });
      if (p === '/users/password') {
        const err = checkPassword(data.password); if (err) return send(res, 400, { error: err });
        lines[i].hash = apr1(data.password); writeUsers(file, lines); log(`${me} reset the password of ${user}`);
        return send(res, 200, { ok: true });
      }
      if (user === me || admins.has(user)) return send(res, 400, { error: 'Admins cannot be removed here (change the admin list in the config file).' });
      lines.splice(i, 1); writeUsers(file, lines); log(`${me} removed ${user}`);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found.' });
  };
}

/* dev only: serve the site from a folder next to the API */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.css': 'text/css' };
function staticFile(root, req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const base = path.resolve(root), f = path.resolve(base, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const cfgPath = args.find(a => !a.startsWith('--') && a !== flag('--dev') && a !== flag('--static')) || 'C:/nginx/nginx-1.30.3/conf/wirelens-admin.json';
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (!cfg.htpasswd || !Array.isArray(cfg.admins) || !cfg.admins.length) throw new Error(cfgPath + ': needs "htpasswd" and a non-empty "admins" list');
  const devUser = flag('--dev'), root = flag('--static');
  const api = makeHandler(cfg, { devUser });
  const port = Number(cfg.port || 3010);
  http.createServer((req, res) => {
    if (root && !/^\/(wirelens\/)?admin-api(\/|$)/.test(req.url)) return staticFile(root, req, res);
    api(req, res).catch(e => { console.error(e); res.writeHead(500); res.end('{"error":"Server error."}'); });
  }).listen(port, '127.0.0.1', () => console.log(`Wirelens admin on 127.0.0.1:${port} · users file ${cfg.htpasswd} · admins ${cfg.admins.join(', ')}${devUser ? ' · DEV user ' + devUser : ''}`));
}

module.exports = { apr1, readUsers, writeUsers, makeHandler, checkPassword };
