/* WireFlow — 3D customer wiring guide tests (js/guide-data.js).
 * Uses the S10195 rack built by tools/make-guide-rack.js.
 * Run: node tests/guide.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const D = new Function(fs.readFileSync(path.join(ROOT, 'js', 'guide-data.js'), 'utf8') +
  '\nreturn { GUIDE_INLINE, GUIDE_TECHNOTES, GUIDE_GEOM, GUIDE_REAR_PORTS, GUIDE_CATS, GUIDE_CONNECTORS, guideGeom, guidePortPos, guideCables, guideRoute, guideLanes, guidePart };')();
const rack = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'guide', 's10195.json'), 'utf8'));

let passed = 0; const failed = [];
function ok(name, cond, info) { if (cond) passed++; else failed.push(name + (info ? '  [' + info + ']' : '')); console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info ? '  [' + info + ']' : '')); }

/* ---------- rack from the DXF ---------- */
const count = k => rack.parts.filter(p => p.kind === k).length;
ok('S10195: 9 SSCs, 3 ACDPs, 1 MSM, 5 junction boxes', count('ssc') === 9 && count('acdp') === 3 && count('msm') === 1 && count('jb') === 5);
ok('S10195: 108 modules = 9 SSCs x 12', count('module') === 108);
ok('S10195: 12 columns at 500 mm pattern', rack.columns.length === 12 && rack.columns.every((x, i) => i === 0 || x - rack.columns[i - 1] === 500));
ok('S10195: 1:50 drawing gives a 6.17 x 2.54 m rack', Math.abs(rack.width - 6169) < 5 && Math.abs(rack.height - 2536) < 5);
const ssc1 = D.guidePart(rack, 'SSC1'), msm = D.guidePart(rack, 'MSM1'), acdp1 = D.guidePart(rack, 'ACDP1');
const dist = (a, b) => Math.hypot((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2, (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
ok('SSC1 is the SSC closest to the MSM (AYK rule)', rack.parts.filter(p => p.kind === 'ssc').every(s => dist(s, msm) >= dist(ssc1, msm)));
ok('ACDP1 is the ACDP closest to the MSM (AYK rule)', rack.parts.filter(p => p.kind === 'acdp').every(s => dist(s, msm) >= dist(acdp1, msm)));
ok('hand-placed parts are marked', rack.parts.filter(p => p.manual).length === 14, String(rack.parts.filter(p => p.manual).length));
ok('no two device boxes overlap by more than 70 mm', (() => {
  const dev = rack.parts.filter(p => p.kind !== 'module');
  for (let i = 0; i < dev.length; i++) for (let j = i + 1; j < dev.length; j++) {
    const a = dev[i], b = dev[j], w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (w > 70 && h > 70) return false;
  }
  return true;
})());

/* ---------- cable list ---------- */
const cables = D.guideCables(rack);
const by = {}; cables.forEach(c => { by[c.cat] = (by[c.cat] || 0) + 1; });
ok('66 cables: 10+10 AC, 9 comm, 9 E-stop, 18 DC, 10 customer', cables.length === 66 && by.acP === 10 && by.acB === 10 && by.comm === 9 && by.estop === 9 && by.dc === 18 && by.ext === 10, JSON.stringify(by));
ok('cable ids are unique', new Set(cables.map(c => c.id)).size === cables.length);
ok('every cable end resolves to a port', cables.every(c => [c.from, c.to].every(e => e.ext || D.guidePortPos(rack, e).every(Number.isFinite))));
ok('every cable cites known technotes', cables.every(c => c.tn.length && c.tn.every(t => D.GUIDE_TECHNOTES[t])));
ok('every cable has a known category and connector', cables.every(c => D.GUIDE_CATS[c.cat] && D.GUIDE_CONNECTORS[c.conn]));
const ports = cables.flatMap(c => [c.from, c.to]).filter(e => !e.ext).map(e => e.dev + '.' + e.port);
ok('no port carries two cables', new Set(ports).size === ports.length);
ok('MSM SSC n P and Estop n go to SSC n (TN0163)', cables.filter(c => c.cat === 'comm' || c.cat === 'estop').every(c => {
  const n = c.to.dev.slice(3); return c.from.port === (c.cat === 'comm' ? 'SSC' + n + 'P' : 'Estop' + n);
}));
ok('MSM SSC n B ports stay unwired (TN0163)', !ports.some(p => /^MSM1\.SSC\dB$/.test(p)));
ok('SSC Comm P is used, Comm B is not', ports.filter(p => /\.CommP$/.test(p)).length === 9 && !ports.some(p => /\.CommB$/.test(p)));
const feeds = {}; cables.filter(c => c.cat === 'acP' && c.to.dev.startsWith('SSC')).forEach(c => { feeds[c.from.dev] = (feeds[c.from.dev] || 0) + 1; });
ok('each ACDP feeds exactly 3 SSCs (ACDP has SSC1-3 ports)', Object.values(feeds).length === 3 && Object.values(feeds).every(n => n === 3), JSON.stringify(feeds));
ok('P and B of one SSC come from the same ACDP slot', cables.filter(c => c.cat === 'acP' && c.to.dev.startsWith('SSC')).every(p => {
  const b = cables.find(c => c.id === p.to.dev + '-acB'); return b && b.from.dev === p.from.dev && b.from.port === p.from.port.replace(/P$/, 'B');
}));
ok('MSM Power P/B come from ACDP1 MSM P/B (TN0159)', ['P', 'B'].every(v => { const c = cables.find(x => x.id === 'MSM-ac' + v); return c && c.from.dev === 'ACDP1' && c.from.port === 'MSM' + v; }));
ok('ACDP feeds stay short: no SSC more than 3 columns from its ACDP', cables.filter(c => c.cat === 'acP' && c.to.dev.startsWith('SSC')).every(c => {
  const a = D.guidePart(rack, c.from.dev), s = D.guidePart(rack, c.to.dev); return Math.abs((a.x0 + a.x1) / 2 - (s.x0 + s.x1) / 2) <= 1550;
}));
const jbUse = {}; cables.filter(c => c.cat === 'dc').forEach(c => { jbUse[c.to.dev] = (jbUse[c.to.dev] || 0) + 1; });
ok('each junction box takes at most 2 SSCs (4 sockets)', Object.values(jbUse).every(n => n <= 4 && n % 2 === 0), JSON.stringify(jbUse));
ok('DC polarity: B+ to P n +, B- to P n -', cables.filter(c => c.cat === 'dc').every(c => c.from.port.slice(-1) === c.to.port.slice(-1)));
const ext = cables.filter(c => c.cat === 'ext');
ok('customer cables: 6 AC PowerIn (3 ACDPs x P/B) + Cloud, EMS, PCS, RemotE', ext.filter(c => /ACIn[PB]$/.test(c.from.port)).length === 6 && ['Cloud', 'EMS', 'PCS', 'RemoteE'].every(p => ext.some(c => c.from.port === p)));
ok('customer cables have distinct holders', new Set(ext.map(c => c.holder.y + ',' + c.holder.z)).size === ext.length);
ok('power holders use the 2 mm pad, communication the 5 mm pad', ext.every(c => c.holder.pad === (c.conn === 'LP16-3' ? 2 : 5)));

/* ---------- routes ---------- */
const lanes = D.guideLanes(cables);
const routes = new Map(cables.map(c => [c.id, D.guideRoute(rack, c, lanes.get(c.id))]));
ok('every route has legs with finite points', [...routes.values()].every(r => r.length >= 2 && r.every(l => l.pts.length >= 2 && l.pts.every(p => p.length === 3 && p.every(Number.isFinite)))));
ok('every leg has a rule and a technote', [...routes.values()].every(r => r.every(l => l.rule.length > 10 && D.GUIDE_TECHNOTES[l.tn])));
ok('legs join end to start', [...routes.values()].every(r => r.every((l, i) => i === 0 || Math.hypot(...l.pts[0].map((v, k) => v - r[i - 1].pts[r[i - 1].pts.length - 1][k])) < 1)));
ok('routes start at the from-port', cables.filter(c => !c.to.ext || true).every(c => {
  const p = D.guidePortPos(rack, c.from), q = routes.get(c.id)[0].pts[0]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1;
}));
ok('device-to-device routes end at the to-port', cables.filter(c => !c.to.ext).every(c => {
  const r = routes.get(c.id), p = D.guidePortPos(rack, c.to), q = r[r.length - 1].pts.slice(-1)[0]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1;
}));
const G = D.GUIDE_GEOM;
ok('rear routes stay behind the rear faces (except in the end bay at the signal panel and the TN0160 loop over the SSC top)', cables.filter(c => !c.front).every(c => routes.get(c.id).every(l => l.customer || /over the top of the SSC/.test(l.rule) || l.pts.every(p => p[0] < 85 || p[2] <= G.zFace - G.portOut + 0.5))));
ok('SSC exits loop over the top of the SSC (TN0160 Fig. 1/2): up at the rear, forward to the front edge, across, back to the rear', cables.filter(c => !c.front && /^SSC/.test(c.to.dev || '')).every(c => {
  const r = routes.get(c.id), loop = r.find(l => /over the top of the SSC/.test(l.rule));
  if (!loop) return false;
  const s = rack.parts.find(p => p.id === c.to.dev), P = loop.pts, zs = P.map(p => p[2]);
  const z0 = s.z0 != null ? s.z0 : G.zFace, z1 = s.z1 != null ? s.z1 : 0;
  return P.every(p => p[1] >= s.y1 - 1) && Math.max(...zs) > z0 + 0.6 * (z1 - z0) && Math.abs(P[0][2] - P[P.length - 1][2]) < 1;
}));
ok('MSM cables start with the service loop over the MSM (TN0163)', cables.filter(c => c.from.dev === 'MSM1').every(c => {
  const r = routes.get(c.id); return /Service loop/.test(r[1].rule) && r[1].pts.some(p => p[1] > msm.y1);
}));
ok('SSC cables pass over the top of the SSC (TN0160)', cables.filter(c => !c.front && (c.to.dev || '').startsWith('SSC')).every(c => {
  const s = D.guidePart(rack, c.to.dev); return routes.get(c.id).some(l => l.pts.some(p => p[1] > s.y1 && Math.abs(p[0] - (s.x0 + s.x1) / 2) < 260));
}));
ok('customer routes: bottom panel, riser, holder, then customer cable (TN0160/TN0163)', ext.every(c => {
  const r = routes.get(c.id), n = r.length;
  return r[n - 1].customer && r[n - 2].holder && /bottom panel/.test(r[n - 4].rule) && /vertical bracket/.test(r[n - 3].rule)
    && r[n - 4].pts.every(p => p[1] < G.bottomY + 40);
}));
ok('the holder leg ends on the Signal Inter-Connection Panel, rising into an upright inline connector from below (TN0160 Fig. 5)', ext.every(c => { const r = routes.get(c.id), l = r[r.length - 2], P = l.pts, e = P[P.length - 1], b = P[P.length - 2];
  return Math.abs(Math.abs(e[0] - G.panelX) - D.GUIDE_INLINE.out) < 0.5 && Math.abs(b[0] - e[0]) < 0.5 && Math.abs(b[2] - e[2]) < 0.5 && b[1] < e[1] - 20; }));
ok('customer cables leave the top of the inline connector', ext.every(c => { const P = routes.get(c.id).slice(-1)[0].pts; return P[1][1] > P[0][1] + 20 && Math.abs(P[1][0] - P[0][0]) < 0.5; }));
ok('ACDP cables go to the side sheet metal first (TN0159)', cables.filter(c => c.from.dev.startsWith('ACDP')).every(c => /side sheet metal/.test(routes.get(c.id)[0].rule)));
ok('DC routes start with the inverter lock-out (TN0162)', cables.filter(c => c.cat === 'dc').every(c => /Lock out the power from the inverter/.test(routes.get(c.id)[0].rule)));
ok('routes are deterministic', JSON.stringify(cables.map(c => D.guideRoute(rack, c, lanes.get(c.id)))) === JSON.stringify([...routes.values()]));

/* ---------- port labels = names printed on the panels (technote figures) ---------- */
const PRINTED = {
  ssc: ['PowerP', 'PowerB', 'CommP', 'CommB', 'Ext-HVIL', 'Cooling Fan', 'Estop'],                                  /* TN0160 SSC rear panel */
  acdp: ['SSC3 B', 'SSC3 P', 'SSC2 B', 'SSC2 P', 'SSC1 B', 'SSC1 P', 'MSM B', 'MSM P', 'AC PowerIn B', 'AC PowerIn P'], /* TN0159 Fig. 2 */
  msm: ['Cloud', 'EMS', 'PCS', 'Spare', 'Estop1', 'Estop2', 'Estop3', 'Estop4', 'Estop5', 'Estop6', 'Estop7', 'Estop8', 'Estop9',
    'DryContact', 'Ex.FanFB', 'RemotE', 'PowerP', 'PowerB', 'Valve1', 'Valve2'].concat([1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(n => ['SSC ' + n + 'P', 'SSC ' + n + 'B'])), /* TN0163 MSM rear panel */
};
ok('port labels are exactly the printed panel names (SSC, ACDP, MSM)', Object.keys(PRINTED).every(k => {
  const a = D.GUIDE_REAR_PORTS[k].map(t => t.label).sort(), b = PRINTED[k].slice().sort(); return a.length === b.length && a.every((x, i) => x === b[i]);
}));
ok('cable titles name ports by their printed labels', cables.filter(c => c.cat !== 'dc').every(c => [c.from, c.to].every(e => {
  if (e.ext) return true;
  const p = D.guidePart(rack, e.dev), t = D.GUIDE_REAR_PORTS[p.kind].find(x => x.id === e.port); return c.title.includes(t.label);
})));

/* ---------- rack 1 from the SolidWorks STEP (tools/step-to-guide.py + --step) ---------- */
const r1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'guide', 's10195-r1.json'), 'utf8'));
const n1 = k => r1.parts.filter(p => p.kind === k).length;
const G1 = D.guideGeom(r1);
ok('R1: 9 SSCs, 3 ACDPs, 2 MSMs, 5 junction boxes, 108 modules', n1('ssc') === 9 && n1('acdp') === 3 && n1('msm') === 2 && n1('jb') === 5 && n1('module') === 108);
ok('R1: CAD model and identity alignment', r1.model && /s10195-r1\.glb$/.test(r1.model.url) && r1.model.matrix.join() === '1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1'
  && fs.existsSync(path.join(ROOT, r1.model.url)));
ok('R1: every device has a rear face behind the front (z0 < 0)', r1.parts.every(p => p.z0 < -100 && p.z1 > -5));
const m1 = D.guidePart(r1, 'MSM1'), d1 = (a, b) => Math.hypot((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2, (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
ok('R1: SSC1 / ACDP1 closest to MSM1 (AYK rule)', ['ssc', 'acdp'].every(k => r1.parts.filter(p => p.kind === k).every(s => d1(s, m1) >= d1(D.guidePart(r1, k.toUpperCase() + '1'), m1))));
ok('R1: every SSC has the 7 measured rear sockets in TN0160 order (rear view, left to right)', r1.parts.filter(p => p.kind === 'ssc').every(s => {
  const ids = ['PowerP', 'PowerB', 'CommP', 'CommB', 'ExtHVIL', 'CoolingFan', 'Estop'];
  return ids.every(id => s.ports[id] && s.ports[id][2] < s.z0) && ids.every((id, i) => i === 0 || s.ports[id][0] < s.ports[ids[i - 1]][0]);
}));
ok('R1: front DC plugs C/D on every SSC and junction box', r1.parts.filter(p => p.kind === 'ssc' || p.kind === 'jb').every(p => Object.values(p.labels).filter(l => /plug [CD]/.test(l)).length >= 2));
const c1 = D.guideCables(r1), L1 = D.guideLanes(c1);
const by1 = {}; c1.forEach(c => { by1[c.cat] = (by1[c.cat] || 0) + 1; });
ok('R1: same 66 cables as the technotes give', c1.length === 66 && by1.dc === 18 && by1.ext === 10, JSON.stringify(by1));
ok('R1: DC plug letters match at both ends (TN0162)', c1.filter(c => c.cat === 'dc').every(c => D.guidePart(r1, c.from.dev).labels[c.from.port] === D.guidePart(r1, c.to.dev).labels[c.to.port]));
const R1 = new Map(c1.map(c => [c.id, D.guideRoute(r1, c, L1.get(c.id))]));
ok('R1: every route is continuous and ends at its port', c1.every(c => {
  const r = R1.get(c.id); if (!r.every((l, i) => i === 0 || Math.hypot(...l.pts[0].map((v, k) => v - r[i - 1].pts[r[i - 1].pts.length - 1][k])) < 1)) return false;
  if (c.to.ext) return true;
  const p = D.guidePortPos(r1, c.to), q = r[r.length - 1].pts.slice(-1)[0]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1;
}));
ok('R1: rear runs stay inside the rack (between the front and the rear trays)', c1.filter(c => !c.front).every(c => R1.get(c.id).every(l => l.customer || l.pts.every(p => p[2] < 0 && p[2] >= G1.zBracket - 40 && p[0] > -1 && p[0] < r1.width + 60))));
ok('R1: runs behind a device stay in its own slot (below the part above)', c1.filter(c => !c.front && !c.to.ext).every(c => {
  const r = R1.get(c.id), f = D.guidePart(r1, c.from.dev), t = D.guidePart(r1, c.to.dev);
  const under = (d, legs) => !d.slotTop || legs.every(l => l.pts.every(p => p[1] < d.slotTop));
  return under(f, r.slice(0, 1)) && under(t, r.filter(l => l.rule.startsWith('At ' + t.id + ':')));
}));
const ext1 = c1.filter(c => c.cat === 'ext');
ok('R1: customer cables go to the measured holders on the right-end panel', G1.panelSide === 1 && ext1.filter(c => !c.holder.extra).length === r1.holders.length
  && ext1.every(c => { const r = R1.get(c.id), l = r[r.length - 2]; return l.holder && Math.abs(Math.abs(l.pts[l.pts.length - 1][0] - r1.holders[0].x) - D.GUIDE_INLINE.out) < 0.5; }));
ok('R1: holders beyond the CAD ones are flagged for confirmation', ext1.filter(c => c.holder.extra).every(c => /confirm its position/.test(R1.get(c.id).slice(-2)[0].rule)));
ok('R1: customer cables leave down the cable trunk', ext1.every(c => R1.get(c.id).slice(-1)[0].pts.some(p => Math.abs(p[0] - r1.trunk.x) < 1 && p[1] < r1.trunk.y0 + 50)));

/* rack navigation (js/racks.js): home dashboard and rail grouping */
const NAV = require(path.join(__dirname, '..', 'js', 'racks.js'));
const pubList = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'guide', 'racks.json'), 'utf8'));
const navDemo = [{ id: 'a', label: 'X1 · Bank 1 · local', url: 'p/a.json' }, { id: 'b', label: 'Plain rack' },
  { id: 'c', label: 'X1 · Type B', project: 'X1', group: 'Battery racks', title: 'Type B', desc: '7 SSC' }, { id: 'd', label: 'X2 · rack', project: 'X2' }];
const nav = NAV.rackGroups(navDemo);
ok('racks: grouped by project in order of first appearance', nav.map(p => p.project).join() === 'X1,Racks,X2');
ok('racks: label without fields splits into project and title, "· local" dropped and flagged', (() => { const r = NAV.rackInfo(navDemo[0]); return r.project === 'X1' && r.title === 'Bank 1' && r.local && r.group === 'Racks'; })());
ok('racks: explicit project / group / title win', nav[0].groups.map(g => g.name).join() === 'Racks,Battery racks' && nav[0].groups[1].racks[0].title === 'Type B');
ok('racks: search matches title, group or description, case-insensitive', NAV.rackGroups(navDemo, 'ssc').length === 1 && NAV.rackGroups(navDemo, 'BATTERY')[0].groups[0].racks[0].id === 'c' && NAV.rackGroups(navDemo, 'zzz').length === 0);
ok('racks: every published rack has a project, group and title, and its JSON exists', pubList.every(x => x.project && x.group && x.title && fs.existsSync(path.join(__dirname, '..', 'assets', 'guide', x.id + '.json'))));

console.log('\n' + (failed.length ? 'FAILED ' + failed.length + ':\n  ' + failed.join('\n  ') : 'Guide tests passed: ' + passed));
process.exitCode = failed.length ? 1 : 0;
