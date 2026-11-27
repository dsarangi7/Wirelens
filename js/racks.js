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

  /* ---- home page: project folders (right panel). A folder opens to its racks grouped by kind; the open folder is
   * in the URL hash (#project=<name>) so Back closes it. Searching looks through every project at once. ---- */
  const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
  const RACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 7.5h8M8 11h8M8 14.5h8M8 18h3"/></svg>';
  const rackCount = p => p.groups.reduce((n, g) => n + g.racks.length, 0);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function renderHome(el, list) {
    el.innerHTML = `<div class="hp-head"><div><h2>Projects</h2><p>Open a project, then pick a rack or bank.</p></div>
        <a class="btn mob-only" href="#tutorial">How to use ↓</a></div>
      <input class="search" id="homeSearch" type="search" placeholder="Search all racks (e.g. bank 14, Type B, service)" aria-label="Search all racks">
      <div id="homeBody"></div>`;
    const body = el.querySelector('#homeBody'), input = el.querySelector('#homeSearch');
    const all = rackGroups(list, '');
    const stats = document.getElementById('homeStats');
    if (stats) stats.innerHTML = `<div><b>${all.length}</b><span>${all.length === 1 ? 'Project' : 'Projects'}</span></div><div><b>${list.length}</b><span>Racks &amp; banks</span></div>`;
    const openName = () => { const m = /^#project=(.+)$/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };
    const row = r => `<a class="hrow" href="${href(r.id)}"><span class="r-ic">${RACK_ICON}</span><span class="r-t"><b>${esc(r.title)}</b>${r.desc ? `<small title="${esc(r.desc)}">${esc(r.desc)}</small>` : ''}</span><span class="chev">›</span></a>`;
    const go = name => {
      try { history.pushState(null, '', name ? '#project=' + encodeURIComponent(name) : location.pathname + location.search); } catch (e) { /* ignore */ }
      draw(); el.parentNode.scrollTop = 0;
    };
    const draw = () => {
      const q = input.value.trim();
      if (q) {
        const P = rackGroups(list, q), n = P.reduce((k, p) => k + rackCount(p), 0);
        body.innerHTML = n ? `<p class="hp-note">${plural(n, 'match')}</p>` + P.map(p => `<div class="hp-grp"><h4>${esc(p.project)}</h4>${p.groups.map(g => g.racks.map(row).join('')).join('')}</div>`).join('')
          : '<p class="empty">No rack matches.</p>';
        return;
      }
      const p = all.find(x => x.project === openName());
      if (p) {
        body.innerHTML = `<nav class="crumb" aria-label="Breadcrumb"><a href="./" data-up>‹ All projects</a><span>/</span><b>${esc(p.project)}</b></nav>` +
          p.groups.map(g => `<div class="hp-grp"><h4>${esc(g.name)}<span>${g.racks.length}</span></h4>${g.racks.map(row).join('')}</div>`).join('');
        body.querySelector('[data-up]').onclick = e => { e.preventDefault(); go(null); };
        return;
      }
      body.innerHTML = all.length ? `<div class="folders">${all.map(x => `<button class="folder" data-p="${esc(x.project)}"><span class="f-ic">${FOLDER_ICON}</span>
          <span class="f-t"><b>${esc(x.project)}</b><small>${plural(rackCount(x), 'rack')} · ${esc(x.groups.map(g => g.name).join(', '))}</small></span><span class="chev">›</span></button>`).join('')}</div>`
        : '<p class="empty">No projects yet.</p>';
      body.querySelectorAll('.folder').forEach(b => { b.onclick = () => go(b.dataset.p); });
    };
    input.addEventListener('input', draw);
    addEventListener('popstate', draw);
    draw();
    initTutorial(document);
    const tut = document.getElementById('tutorial');
    if (location.hash === '#tutorial' && tut) tut.scrollIntoView();
  }

  /* ---- home: scrolling tutorial (markup in index.html #tutorial) ----
   * The step that has crossed a line just under the pinned sketch
   * is "on": its data-screen / data-mode go onto the sketch #tm and its data-hl names light up the [data-z] parts. */
  const TUT_RACK = (() => {
    let m = '', ssc = '';
    for (let i = 0; i < 10; i++) m += `<rect x="76" y="${14 + i * 12.5}" width="62" height="10" rx="1.5" fill="#1a2744" stroke="#24365a" stroke-width=".6"/>`;
    for (let i = 0; i < 5; i++) ssc += `<rect x="143" y="${14 + i * 26}" width="21" height="22" rx="1.5" fill="#1d2b4a" stroke="#2f4470" stroke-width=".6"/><circle cx="164" cy="${22 + i * 26}" r="1.3" fill="#9aabc6"/>`;
    const sel = 'M54 60 C66 60 62 148 76 148';
    return `<svg viewBox="0 0 240 170" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g class="tr-rack">
      <polygon points="170,8 182,14 182,166 170,162" fill="#0b1222" stroke="#22314f" stroke-width=".6"/>
      <rect x="70" y="8" width="100" height="154" rx="3" fill="#0f182c" stroke="#2a3a5c"/>${m}${ssc}
      <rect x="76" y="141" width="62" height="15" rx="1.5" fill="#16243f" stroke="#2f4470" stroke-width=".6"/>
      <text x="107" y="151.5" fill="#9aabc6" font-size="6" text-anchor="middle" font-family="sans-serif">MSM</text>
      <rect x="36" y="42" width="18" height="58" rx="2" fill="#1b1430" stroke="#a855f7" stroke-width=".8"/>
      <path class="tr-c" stroke="#e5484d" d="M164 22 H176 V150 H138"/>
      <path class="tr-c" stroke="#2f80ed" d="M164 48 H180 V153 H138"/>
      <path class="tr-c" stroke="#f59e0b" d="M164 100 H185 V156 H138"/>
      <path class="tr-c" stroke="#30a46c" d="M143 24 C132 24 132 50 143 50 C132 50 132 76 143 76 C132 76 132 102 143 102 C132 102 132 128 143 128"/>
      <path class="tr-c tr-sel" stroke="#a855f7" d="${sel}"/>
      <path class="tr-spark" pathLength="100" d="${sel}"/>
      <circle class="tr-port" cx="54" cy="60" r="3.2"/></g></svg>`;
  })();
  function initTutorial(doc) {
    const tm = doc.getElementById('tm'), steps = Array.from(doc.querySelectorAll('.tstep'));
    if (!tm || !steps.length) return;
    tm.querySelectorAll('[data-rack]').forEach(el => { el.innerHTML = TUT_RACK; });
    const dots = doc.getElementById('tutDots'), count = doc.getElementById('tutN'), addr = doc.getElementById('tmAddr');
    const zones = Array.from(tm.querySelectorAll('[data-z]'));
    dots.innerHTML = steps.map((s, i) => `<button type="button" aria-label="Step ${i + 1}"></button>`).join('');
    Array.from(dots.children).forEach((d, i) => { d.onclick = () => steps[i].scrollIntoView({ block: 'center' }); });
    const ADDR = { home: 'wirelens/', viewer: 'wirelens/?rack=rack-2', share: 'wirelens/?rack=rack-2<b>#EMS-MSM1</b>' };
    let cur = -1;
    const set = i => {
      if (i === cur) return; cur = i;
      const s = steps[i], hl = (s.dataset.hl || '').split(/\s+/);
      steps.forEach((x, k) => x.classList.toggle('on', k === i));
      Array.from(dots.children).forEach((d, k) => d.classList.toggle('on', k === i));
      tm.dataset.screen = s.dataset.screen || 'viewer';
      tm.dataset.mode = s.dataset.mode || '';
      zones.forEach(z => z.classList.toggle('hl', hl.includes(z.dataset.z)));
      addr.innerHTML = ADDR[s.dataset.addr || (s.dataset.screen === 'home' ? 'home' : 'viewer')];
      count.textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
    };
    let queued = false;
    const pick = () => {
      queued = false;
      const vb = Math.max(0, doc.querySelector('.tut-vis').getBoundingClientRect().bottom);   /* steps scroll under the pinned sketch */
      const line = vb + (innerHeight - vb) * 0.45;
      let best = 0; steps.forEach((s, k) => { if (s.getBoundingClientRect().top < line) best = k; });
      set(best);
    };
    const later = () => { if (!queued) { queued = true; requestAnimationFrame(pick); } };
    addEventListener('scroll', later, { passive: true, capture: true });
    addEventListener('resize', later);
    pick();
  }

  /* ---- rail in the viewer ---- */
  function renderRail(el, list, current, onToggle) {
    const app = document.querySelector('.app');
    const setCollapsed = c => { app.classList.toggle('rail-min', c); store('wirelens.rail', c ? '1' : '0'); if (onToggle) onToggle(); };
    el.innerHTML = `<div class="rail-top"><a class="rail-home" href="./" title="All racks (home)">All racks</a>
      <a class="rail-btn rail-help" href="./#tutorial" title="How to use Wirelens" aria-label="How to use Wirelens">?</a>
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
