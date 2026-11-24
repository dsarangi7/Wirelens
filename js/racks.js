/* Wirelens rack navigation: home dashboard + collapsible rail in the viewer.
 * Rack lists: assets/guide/racks.json (published) + projects/racks.local.json (local only, git-ignored).
 * Entry: { id, label, url?, project?, group?, title?, desc? }. Without project/group the label is split at
 * its first " · " into project and title, group "Racks". Pure helpers are Node-testable (module.exports).
 */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  /* fill in project / group / title for one entry */
  function rackInfo(x) {
    const label = x.label || x.id, i = label.indexOf(' · ');
    const local = /·\s*local$/.test(label) || !!x.url;
    const bare = label.replace(/\s*·\s*local$/, '');
    return {
      id: x.id, url: x.url, local: local, label: label,
      project: x.project || (i > 0 ? label.slice(0, i) : 'Racks'),
      group: x.group || 'Racks',
      title: x.title || (i > 0 ? bare.slice(i + 3) : bare),
      desc: x.desc || '',
    };
  }

  /* [{project, groups:[{name, racks:[info]}]}], keeping the order of first appearance */
  function rackGroups(list, query) {
    const q = (query || '').trim().toLowerCase();
    const out = [];
    for (const raw of list) {
      const r = rackInfo(raw);
      if (q && ![r.project, r.group, r.title, r.desc, r.id].join(' ').toLowerCase().includes(q)) continue;
      let p = out.find(o => o.project === r.project); if (!p) out.push(p = { project: r.project, groups: [] });
      let g = p.groups.find(o => o.name === r.group); if (!g) p.groups.push(g = { name: r.group, racks: [] });
      g.racks.push(r);
    }
    return out;
  }

  async function rackList() {
    const get = async u => { try { const r = await fetch(u, { cache: 'no-cache' }); return r.ok ? await r.json() : []; } catch (e) { return []; } };
    return (await get('projects/racks.local.json')).concat(await get('assets/guide/racks.json'));   /* local projects first */
  }

  const href = id => '?rack=' + encodeURIComponent(id);
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; };

  /* ---- home dashboard ---- */
  function renderHome(el, list) {
    el.innerHTML = `<div class="home-in">
      <div class="home-head"><div><h2>Rack wiring guides</h2><p>Pick a rack or a bank to open its 3D wiring guide.</p></div>
      <input class="search" id="homeSearch" type="search" placeholder="Search racks (e.g. bank 14, Type B, service)" aria-label="Search racks"></div>
      <div id="homeBody"></div></div>`;
    const body = el.querySelector('#homeBody'), input = el.querySelector('#homeSearch');
    const draw = () => {
      const P = rackGroups(list, input.value);
      body.innerHTML = P.length ? P.map(p => `<section class="proj"><h3>${esc(p.project)} <span>${p.groups.reduce((n, g) => n + g.racks.length, 0)}</span></h3>
        ${p.groups.map(g => `<div class="pgroup"><h4>${esc(g.name)}</h4><div class="cards">${g.racks.map(r => `<a class="rcard" href="${href(r.id)}">
          <b>${esc(r.title)}</b>${r.desc ? `<small>${esc(r.desc)}</small>` : ''}${r.local ? '<em>local</em>' : ''}</a>`).join('')}</div></div>`).join('')}</section>`).join('')
        : '<p class="empty">No rack matches.</p>';
    };
    input.addEventListener('input', draw); draw(); input.focus();
  }

  /* ---- rail in the viewer ---- */
  function renderRail(el, list, current, onToggle) {
    const app = document.querySelector('.app');
    const setCollapsed = c => { app.classList.toggle('rail-min', c); store('wirelens.rail', c ? '1' : '0'); if (onToggle) onToggle(); };
    el.innerHTML = `<div class="rail-top"><a class="rail-home" href="./" title="All racks (home)">All racks</a>
      <button class="rail-btn" id="railBtn" aria-label="Collapse the rack list" title="Collapse / expand the rack list">«</button></div>
      <input class="search rail-search" id="railSearch" type="search" placeholder="Find a rack" aria-label="Find a rack"><nav id="railBody"></nav>`;
    const body = el.querySelector('#railBody'), input = el.querySelector('#railSearch');
    const draw = () => {
      body.innerHTML = rackGroups(list, input.value).map(p => `<details class="rproj" open><summary>${esc(p.project)}</summary>
        ${p.groups.map(g => `<div class="rgroup">${esc(g.name)}</div>${g.racks.map(r => `<a class="rlink${r.id === current ? ' on' : ''}" href="${href(r.id)}"${r.id === current ? ' aria-current="page"' : ''} title="${esc(r.label)}">${esc(r.title)}</a>`).join('')}`).join('')}
        </details>`).join('') || '<p class="empty">No rack matches.</p>';
    };
    input.addEventListener('input', draw); draw();
    el.querySelector('#railBtn').onclick = () => setCollapsed(!app.classList.contains('rail-min'));
    if (store('wirelens.rail') === '1') app.classList.add('rail-min');
  }

  const api = { rackInfo, rackGroups, rackList, renderHome, renderRail };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WirelensRacks = api;
})(typeof window !== 'undefined' ? window : globalThis);
