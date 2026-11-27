/* Tests for deploy/admin/wirelens-admin.js:  node tests/admin.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { apr1, makeHandler } = require('../deploy/admin/wirelens-admin.js');

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('PASS  ' + name); });

(async () => {
  await ok('apr1 matches openssl passwd -apr1', () => {
    assert.strictEqual(apr1('p@ss w0rd', 'abcdefgh'), '$apr1$abcdefgh$UkZoB0qp2g9KE9.krwnMP0');
    assert.strictEqual(apr1('Grüße-123', 'Zz9./xyQ'), '$apr1$Zz9./xyQ$9hKMjeu8FIi3P3ZV1ptl10'   /* openssl, UTF-8 bytes */);
    assert.strictEqual(apr1('x', 'a1'), '$apr1$a1$TZtaA/rDB3ci9bBKNO0Mp/');
    assert.match(apr1('random salt'), /^\$apr1\$[./0-9A-Za-z]{8}\$[./0-9A-Za-z]{22}$/);
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-admin-'));
  const file = path.join(dir, 'users.htpasswd');
  fs.writeFileSync(file, '# team\nboss@example.com:' + apr1('bosspass1') + '\nann@example.com:' + apr1('annpass11') + '\n');
  const server = http.createServer(makeHandler({ htpasswd: file, admins: ['Boss@example.com'] }, { log: () => {} }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (method, p, user, data, hdr) => new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '';
    const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Requested-With': 'wirelens' }, hdr || {});
    if (user) headers['X-Remote-User'] = user;
    const req = http.request({ host: '127.0.0.1', port, method, path: '/wirelens/admin-api' + p, headers }, res => {
      let s = ''; res.on('data', c => { s += c; }); res.on('end', () => resolve({ code: res.statusCode, json: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject); req.end(body);
  });
  const users = () => fs.readFileSync(file, 'utf8');
  const hashOf = u => (users().split('\n').find(l => l.startsWith(u + ':')) || '').slice(u.length + 1);

  await ok('health needs no login; everything else does', async () => {
    assert.strictEqual((await call('GET', '/health')).code, 200);
    assert.strictEqual((await call('GET', '/me')).code, 401);
  });
  await ok('/me tells admins from users (case-insensitive)', async () => {
    assert.deepStrictEqual((await call('GET', '/me', 'boss@example.com')).json, { user: 'boss@example.com', admin: true });
    assert.deepStrictEqual((await call('GET', '/me', 'ann@example.com')).json, { user: 'ann@example.com', admin: false });
  });
  await ok('non-admins cannot list or change users', async () => {
    assert.strictEqual((await call('GET', '/users', 'ann@example.com')).code, 403);
    assert.strictEqual((await call('POST', '/users', 'ann@example.com', { user: 'x@example.com', password: 'longenough' })).code, 403);
  });
  await ok('writes need the X-Requested-With header (blocks cross-site forms)', async () => {
    assert.strictEqual((await call('POST', '/users', 'boss@example.com', { user: 'x@example.com', password: 'longenough' }, { 'X-Requested-With': '' })).code, 403);
  });
  await ok('admin adds a user; the new hash checks out; comments kept', async () => {
    assert.strictEqual((await call('POST', '/users', 'boss@example.com', { user: ' New@Example.com ', password: 'newpass123' })).code, 201);
    const h = hashOf('new@example.com'); assert.ok(h, 'line written');
    assert.strictEqual(apr1('newpass123', h.split('$')[2]), h);
    assert.ok(users().startsWith('# team\n'));
    assert.strictEqual((await call('POST', '/users', 'boss@example.com', { user: 'new@example.com', password: 'newpass123' })).code, 409);
  });
  await ok('bad email / short password are refused', async () => {
    assert.strictEqual((await call('POST', '/users', 'boss@example.com', { user: 'not-an-email', password: 'longenough' })).code, 400);
    assert.strictEqual((await call('POST', '/users', 'boss@example.com', { user: 'y@example.com', password: 'short' })).code, 400);
  });
  await ok('admin resets a password', async () => {
    const before = hashOf('ann@example.com');
    assert.strictEqual((await call('POST', '/users/password', 'boss@example.com', { user: 'ann@example.com', password: 'another-pass' })).code, 200);
    const h = hashOf('ann@example.com'); assert.notStrictEqual(h, before);
    assert.strictEqual(apr1('another-pass', h.split('$')[2]), h);
  });
  await ok('admin removes a user, but not an admin', async () => {
    assert.strictEqual((await call('POST', '/users/remove', 'boss@example.com', { user: 'new@example.com' })).code, 200);
    assert.ok(!hashOf('new@example.com'));
    assert.strictEqual((await call('POST', '/users/remove', 'boss@example.com', { user: 'boss@example.com' })).code, 400);
  });
  await ok('anyone signed in can change their own password', async () => {
    assert.strictEqual((await call('POST', '/me/password', 'ann@example.com', { password: 'ann-new-pass' })).code, 200);
    const h = hashOf('ann@example.com'); assert.strictEqual(apr1('ann-new-pass', h.split('$')[2]), h);
  });
  await ok('list shows everyone with the admin flag', async () => {
    const r = await call('GET', '/users', 'boss@example.com');
    assert.deepStrictEqual(r.json.users, [{ user: 'boss@example.com', admin: true }, { user: 'ann@example.com', admin: false }]);
  });

  server.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nAdmin tests passed: ' + passed);
})().catch(e => { console.error('FAIL ', e); process.exit(1); });
