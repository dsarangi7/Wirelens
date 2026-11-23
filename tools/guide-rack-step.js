/* Builds assets/guide/<name>.json from the measured parts that
 * tools/step-to-guide.py writes for a SolidWorks STEP of an AYK rack.
 *
 * Unlike the DXF route, everything here is measured in 3D: device boxes with
 * their rear faces, the rear SSC connectors, the front DC plugs (by letter),
 * the Signal Inter-Connection Panel and its connector holders, the posts, the
 * rear cable trays and the cable trunk at the panel end.
 *
 * Called by: node tools/make-guide-rack.js --step <parts.json> <name>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const r1 = v => Math.round(v * 10) / 10;
const cx = b => (b[0] + b[3]) / 2, cy = b => (b[1] + b[4]) / 2, cz = b => (b[2] + b[5]) / 2;
const inX = (b, p, m) => cx(b) >= p.x0 - (m || 0) && cx(b) <= p.x1 + (m || 0);

/* SSC rear connectors, seen from the REAR left to right (= front x descending),
   in the order of the TN0160 rear-panel figure. */
const SSC_REAR = ['PowerP', 'PowerB', 'CommP', 'CommB', 'ExtHVIL', 'CoolingFan', 'Estop'];

module.exports = function buildFromStep(src, name, C, ROOT) {
  if (!src || !fs.existsSync(src) || !name) { console.error('usage: node tools/make-guide-rack.js --step <parts.json> <name>'); process.exit(1); }
  const J = JSON.parse(fs.readFileSync(src, 'utf8'));
  const items = J.items;
  const all = re => items.filter(i => re.test(i.name));
  const one = re => { const l = all(re); if (!l.length) throw new Error('missing ' + re); return l; };
  const toPart = (kind, b) => ({ kind, x0: b[0], y0: b[1], x1: b[3], y1: b[4], z0: b[2], z1: b[5] });

  /* ---- devices ---- */
  const comps = [];
  for (const m of one(/A96AA/)) comps.push(toPart('module', m.box));
  for (const s of one(/^P0414-01/)) {           /* SSC body + its base (P0684) below it */
    const p = toPart('ssc', s.box);
    const base = all(/^P0684/).find(b => inX(b.box, p) && b.box[4] <= p.y0 + 20 && b.box[4] >= p.y0 - 120);
    if (base) p.y0 = Math.min(p.y0, base.box[1]);
    comps.push(p);
  }
  for (const s of one(/^P4138703/)) {           /* MSM body + top plate */
    const p = toPart('msm', s.box);
    const top = all(/^P41388/).find(b => inX(b.box, p) && Math.abs(b.box[1] - p.y1) < 30);
    if (top) p.y1 = Math.max(p.y1, top.box[4]);
    comps.push(p);
  }
  for (const s of one(/^P4193201-a/)) comps.push(toPart('acdp', s.box));
  for (const s of one(/^P4303702/)) comps.push(toPart('jb', s.box));

  /* ---- numbering: the AYK rule, same code as the app ---- */
  const nums = C.cadProposeNumbers(comps);
  const prefix = { ssc: 'SSC', acdp: 'ACDP', msm: 'MSM', jb: 'JB', module: 'M' };
  const jbs = comps.filter(c => c.kind === 'jb').sort((a, b) => a.x0 - b.x0);
  const mods = comps.filter(c => c.kind === 'module').sort((a, b) => a.x0 - b.x0 || b.y0 - a.y0);
  comps.forEach(c => { c.id = c.kind === 'jb' ? 'JB' + (jbs.indexOf(c) + 1) : c.kind === 'module' ? 'M' + (mods.indexOf(c) + 1) : prefix[c.kind] + nums.get(c); });

  /* free height above each device inside its column (for over-the-top routing) */
  for (const c of comps) if (c.kind !== 'module') {
    const above = comps.filter(o => o !== c && o.x0 < c.x1 - 20 && o.x1 > c.x0 + 20 && o.y0 >= c.y1 - 5).map(o => o.y0);
    c.slotTop = above.length ? Math.min(...above) : null;
  }

  /* ---- measured ports ---- */
  const warn = [];
  const rearConns = all(/^P0595-01_simplify|^P0577-01_Simplify|^P0598-01/);
  for (const s of comps.filter(c => c.kind === 'ssc')) {
    const l = rearConns.filter(b => inX(b.box, s) && cy(b.box) > s.y0 && cy(b.box) < s.y0 + 120 && b.box[2] < s.z0 + 30).sort((a, b) => cx(b.box) - cx(a.box));
    if (l.length !== SSC_REAR.length) { warn.push(s.id + ': ' + l.length + ' rear connectors'); continue; }
    const rj = l.map(b => /^P0577/.test(b.name));
    if (!(rj[2] && rj[3] && rj.filter(Boolean).length === 2) || !/^P0598/.test(l[5].name)) warn.push(s.id + ': rear connector types differ from TN0160');
    s.ports = {}; s.measured = SSC_REAR.slice();
    l.forEach((b, i) => { s.ports[SSC_REAR[i]] = [r1(cx(b.box)), r1(cy(b.box)), r1(s.z0 - 20)]; });
    /* front DC plugs, by letter (part names Power_Conncector_360_A..D) */
    const dc = all(/Power_Conncector_360_[ABCD]/).filter(b => inX(b.box, s) && cy(b.box) > s.y0 && cy(b.box) < s.y0 + 80 && b.box[5] > 0);
    const letter = b => b.name.match(/360_([ABCD])/)[1];
    s.labels = {};
    for (const b of dc) {
      const L = letter(b), id = L === 'C' ? 'B+' : L === 'D' ? 'B-' : L;
      s.ports[id] = [r1(cx(b.box)), r1(cy(b.box)), r1(b.box[5])];
      s.labels[id] = 'plug ' + L;
    }
    if (!s.ports['B+'] || !s.ports['B-']) warn.push(s.id + ': front plugs C/D not found');
  }
  for (const j of comps.filter(c => c.kind === 'jb')) {
    const dc = all(/^P40(18902|19002)/).filter(b => inX(b.box, j)).sort((a, b) => cx(a.box) - cx(b.box));
    if (dc.length !== 4) { warn.push(j.id + ': ' + dc.length + ' front plugs'); continue; }
    j.ports = {}; j.labels = {};
    ['P1+', 'P1-', 'P2+', 'P2-'].forEach((id, i) => {
      const b = dc[i], L = /18902/.test(b.name) ? 'C' : 'D';
      j.ports[id] = [r1(cx(b.box)), r1(cy(b.box)), r1(b.box[5])];
      j.labels[id] = 'plug ' + L;
      if (L !== (id.endsWith('+') ? 'C' : 'D')) warn.push(j.id + ' ' + id + ' is plug ' + L);
    });
  }

  /* ---- panel end: Signal Inter-Connection Panel, holders, trunk ---- */
  const plate = one(/P4591901/)[0].box;
  const holders = one(/^P4302201/).map(h => h.box)
    .sort((a, b) => cy(a) - cy(b) > 20 ? 1 : cy(b) - cy(a) > 20 ? -1 : cz(b) - cz(a))   /* lower row first, front first */
    .map(b => ({ x: r1(cx(b)), y: r1(cy(b)), z: r1(cz(b)) }));
  const W = Math.max(...all(/^Rack Vertical/).map(b => b.box[3]));
  const side = cx(plate) > W / 2 ? 1 : -1;
  const trunkB = all(/Cable_Trunk_06/).map(b => b.box).sort((a, b) => b[5] - a[5])[0];
  const rearPost = all(/^P4578001/).map(b => b.box).sort((a, b) => a[0] - b[0]);
  const botTray = all(/^P4473601/)[0].box, topTray = all(/^P4473501/)[0].box;
  const endGap = side > 0 ? Math.max(...comps.filter(c => c.kind === 'module').map(c => c.x1)) : Math.min(...comps.filter(c => c.kind === 'module').map(c => c.x0));

  const geom = {
    slotRouting: true,
    moduleDepth: r1(-Math.min(...comps.filter(c => c.kind === 'module').map(c => c.z0))),
    rackDepth: r1(-J.bounds[2]),
    postX0: r1(cx(rearPost[0])), postPitch: r1(cx(rearPost[1]) - cx(rearPost[0])),
    zClamp: r1(rearPost[0][5] + 15),                  /* clamps just in front of the rear posts */
    zBracket: r1(cz(botTray)),                        /* horizontal runs in the rear trays */
    rails: [r1(cy(botTray)), r1(cy(topTray))],
    bottomY: r1(cy(botTray) - 12),
    panelSide: side, panelX: r1(cx(plate) + side * 26),
    panelRiserX: r1(endGap + side * 6),
  };
  const rack = {
    format: 'wireflow-guide-rack', version: 1, name: name.toUpperCase(), from: 'step',
    source: J.source, scale: 1, units: 'mm', lineUnit: 0.5,
    width: r1(W), height: r1(J.bounds[4]),
    columns: [...new Set(comps.filter(c => c.kind === 'module').map(c => Math.round((c.x0 + c.x1) / 2)))].sort((a, b) => a - b),
    model: { url: 'assets/guide/' + name + '.glb', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    geom: geom,
    panels: [{ kind: 'signal', label: 'Signal Inter-Connection Panel', x: r1(cx(plate)), y0: plate[1], y1: plate[4], z0: plate[5], z1: plate[2] }],
    holders: holders,
    trunk: trunkB ? { x: r1(cx(trunkB)), z: r1(cz(trunkB)), y0: trunkB[1], y1: trunkB[4] } : null,
    assumptions: [
      'Geometry measured from the SolidWorks 3D model (STEP export of ' + J.source.replace(/\.(step|stp)$/i, '') + '): devices, rear faces, connectors, posts, trays, panel and holders.',
      'SSC rear connectors are the measured sockets, named in the TN0160 panel order (seen from the rear: Power P, Power B, Comm P, Comm B, Ext HVIL, Cooling Fan, E-stop).',
      'MSM and ACDP rear ports follow the technote panel figures (the CAD connectors there are not named).',
      'Front DC: SSC plug C / D go to the junction-box plug C / D (TN0162: same letter and colour).',
      'The panel has ' + holders.length + ' connector holders; customer connections beyond that are drawn on extra positions further along the panel.',
      'Two MSMs are in this rack: MSM1 is wired as in TN0163; the role of MSM2 is not in the customer technotes.',
      'ACDP feeds: each ACDP feeds its three closest SSCs (ACDP1 first). Junction boxes: two SSCs each, closest first.',
      'SSC / ACDP / MSM numbering follows the AYK rule: number 1 is the one closest to MSM1.',
    ],
    parts: comps.map(c => {
      const o = { id: c.id, kind: c.kind, x0: r1(c.x0), y0: r1(c.y0), x1: r1(c.x1), y1: r1(c.y1), z0: r1(c.z0), z1: r1(c.z1) };
      if (c.slotTop != null) o.slotTop = r1(c.slotTop);
      if (c.ports) o.ports = c.ports;
      if (c.labels) o.labels = c.labels;
      return o;
    }),
    lines: [], circles: [],
  };
  const out = path.join(ROOT, 'assets', 'guide', name + '.json');
  fs.writeFileSync(out, JSON.stringify(rack));
  const by = {}; rack.parts.forEach(p => { by[p.kind] = (by[p.kind] || 0) + 1; });
  console.log('written', path.relative(ROOT, out), (fs.statSync(out).size / 1e3).toFixed(0) + ' kB', JSON.stringify(by), 'holders', holders.length, 'panel side', side > 0 ? 'right (from the front)' : 'left');
  console.log(rack.parts.filter(p => p.kind !== 'module').map(p => p.id + '@' + p.x0 + ',' + p.y0 + (p.slotTop ? '^' + p.slotTop : '')).join('  '));
  console.log('geom', JSON.stringify(geom));
  warn.forEach(w => console.warn('  ! ' + w));
};
