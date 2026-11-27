/* Wirelens home page: "Users" tab for admins (add / remove people, reset passwords, change your own).
 * Talks to deploy/admin/wirelens-admin.js through nginx at admin-api/ (same sign-in as the site). When that service
 * is not there (local dev server, or not installed yet) /me fails and nothing is shown.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = async (method, p, data) => {
    const r = await fetch('admin-api' + p, {
      method, cache: 'no-store', credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'wirelens' },
      body: data ? JSON.stringify(data) : undefined,
    });
    let j = null; try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  };
  /* readable random password: no 0/O/1/l/I */
  const genPassword = () => {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', b = new Uint32Array(12);
    crypto.getRandomValues(b); let s = ''; b.forEach((x, i) => { s += a[x % a.length]; if (i === 3 || i === 7) s += '-'; }); return s;
  };
  const copy = (text, btn) => {
    const done = () => { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t; }, 1200); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => {});
    else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ } t.remove(); }
  };
  /* password field with Generate + Copy */
  const pwField = (id, label) => `<label class="ad-l" for="${id}">${label}</label>
    <div class="ad-pw"><input class="search" id="${id}" type="text" autocomplete="new-password" spellcheck="false" placeholder="At least 8 characters">
    <button type="button" class="btn" data-gen="${id}">Generate</button><button type="button" class="btn" data-copy="${id}">Copy</button></div>`;
  const wirePw = root => {
    root.querySelectorAll('[data-gen]').forEach(b => { b.onclick = () => { $(b.dataset.gen).value = genPassword(); }; });
    root.querySelectorAll('[data-copy]').forEach(b => { b.onclick = () => { const v = $(b.dataset.copy).value; if (v) copy(v, b); }; });
  };
  const say = (el, text, bad) => { el.textContent = text; el.className = 'ad-msg' + (bad ? ' bad' : ' good'); };

  async function init() {
    const side = document.querySelector('.h-side'), tabs = $('hsTabs'), box = $('adminMain');
    if (!side || !tabs || !box || new URLSearchParams(location.search).get('rack')) return;   /* home page only */
    let me;
    try { me = await api('GET', '/me'); } catch (e) { return; }   /* no admin service: stay hidden */
    const who = $('homeWho');
    if (who) { who.hidden = false; who.innerHTML = `Signed in as <b>${esc(me.user)}</b>${me.admin ? ' <span class="ad-badge">Admin</span>' : ''}`; }
    if (!me.admin) return;

    tabs.hidden = false;
    const show = t => {
      tabs.querySelectorAll('button').forEach(b => { const on = b.dataset.hs === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      $('homeMain').hidden = t !== 'projects'; box.hidden = t !== 'users';
      if (t === 'users') draw();
    };
    tabs.querySelectorAll('button').forEach(b => { b.onclick = () => show(b.dataset.hs); });

    box.innerHTML = `<div class="hp-head"><div><h2>Users</h2><p>People who can sign in to Wirelens. Changes apply at once.</p></div></div>
      <form class="ad-card" id="adAdd" autocomplete="off"><h3>Add a person</h3>
        <label class="ad-l" for="adEmail">Email (they sign in with it)</label><input class="search" id="adEmail" type="email" placeholder="name@aykenergy.com" required>
        ${pwField('adPass', 'Password')}
        <div class="ad-row"><button class="btn on" type="submit">Add</button><span class="ad-msg" id="adAddMsg" role="status"></span></div>
        <p class="ad-note">Send the email and password to the person yourself, in a separate message from the link.</p></form>
      <div class="ad-card"><h3>Who has access <span id="adCount"></span></h3><div id="adList"><p class="hp-note">Loading…</p></div></div>
      <form class="ad-card" id="adMine" autocomplete="off"><h3>My password</h3>
        ${pwField('adMyPass', 'New password')}
        <div class="ad-row"><button class="btn" type="submit">Change my password</button><span class="ad-msg" id="adMineMsg" role="status"></span></div>
        <p class="ad-note">Afterwards the browser asks you to sign in again with the new password.</p></form>`;
    wirePw(box);

    $('adAdd').onsubmit = async e => {
      e.preventDefault(); const msg = $('adAddMsg'), user = $('adEmail').value.trim(), password = $('adPass').value;
      try { await api('POST', '/users', { user, password }); say(msg, 'Added ' + user + '.'); $('adEmail').value = ''; $('adPass').value = ''; draw(); }
      catch (err) { say(msg, err.message, true); }
    };
    $('adMine').onsubmit = async e => {
      e.preventDefault(); const msg = $('adMineMsg');
      try { await api('POST', '/me/password', { password: $('adMyPass').value }); say(msg, 'Saved. Sign in again with the new password when the browser asks.'); $('adMyPass').value = ''; }
      catch (err) { say(msg, err.message, true); }
    };

    async function draw() {
      const list = $('adList');
      let users;
      try { users = (await api('GET', '/users')).users; } catch (e) { list.innerHTML = `<p class="ad-msg bad">${esc(e.message)}</p>`; return; }
      $('adCount').textContent = users.length;
      list.innerHTML = users.map((u, i) => `<div class="ad-user" data-i="${i}"><div class="ad-u"><span class="ad-av">${esc(u.user[0].toUpperCase())}</span>
          <span class="ad-name">${esc(u.user)}</span>${u.admin ? '<span class="ad-badge">Admin</span>' : ''}
          <span class="grow"></span>${u.user === me.user ? '<span class="hp-note">You</span>' : `<button class="btn" data-reset>Reset password</button>${u.admin ? '' : '<button class="btn ad-del" data-del>Remove</button>'}`}</div>
          <div class="ad-reset" hidden></div></div>`).join('');
      list.querySelectorAll('.ad-user').forEach(row => {
        const u = users[+row.dataset.i], panel = row.querySelector('.ad-reset');
        const reset = row.querySelector('[data-reset]'), del = row.querySelector('[data-del]');
        if (reset) reset.onclick = () => {
          if (!panel.hidden) { panel.hidden = true; return; }
          const id = 'adR' + row.dataset.i;
          panel.innerHTML = `${pwField(id, 'New password for ' + esc(u.user))}<div class="ad-row"><button class="btn on" type="button" data-save>Save</button><span class="ad-msg" role="status"></span></div>`;
          wirePw(panel); panel.hidden = false; $(id).value = genPassword();
          panel.querySelector('[data-save]').onclick = async () => {
            const m = panel.querySelector('.ad-msg');
            try { await api('POST', '/users/password', { user: u.user, password: $(id).value }); say(m, 'Saved. Send the new password to ' + u.user + '.'); }
            catch (err) { say(m, err.message, true); }
          };
        };
        if (del) del.onclick = async () => {
          if (!confirm('Remove ' + u.user + '? They will no longer be able to sign in.')) return;
          try { await api('POST', '/users/remove', { user: u.user }); draw(); } catch (err) { alert(err.message); }
        };
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
