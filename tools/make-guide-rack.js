/* Builds the 3D wiring guide's rack from an AYK front-view DXF:
 *   assets/guide/<name>.json   recognised parts (mm), module grid and the
 *                              front linework (for drawing on the 3D faces)
 *
 * Parts are recognised exactly like the app does it (js/cad.js): one taught
 * box per part type, refined, then every copy is found. Labels follow the
 * AYK rule: MSM1 left to right, SSC1 / ACDP1 = the one closest to the MSM.
 *
 * The S10195 drawing (A2045701 Rack_Subassembly_2) is drawn at 1:50
 * (12 columns of 500 mm pattern = 123.4 drawing units), so --scale 50.
 *
 * Run from the repo root:
 *   node tools/make-guide-rack.js "<path>/A2045701 S10195 Rack_Subassembly_2.DXF" s10195 --scale 50
 *
 * From a SolidWorks STEP instead (real 3D, measured ports), after
 * tools/step-to-guide.py has written <name>.glb and <name>.parts.json:
 *   node tools/make-guide-rack.js --step assets/guide/s10195-r1.parts.json s10195-r1
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const C = new Function(fs.readFileSync(path.join(ROOT, 'js', 'cad.js'), 'utf8') +
  '\nreturn { cadParseDxf, cadFlatten, cadFeatures, cadFeatureIndex, cadTeachSignature, cadRefineSignature, cadFindMatches, cadRecognise, cadProposeNumbers };')();

const args = process.argv.slice(2);
if (args[0] === '--step') { require('./guide-rack-step.js')(args[1], args[2], C, ROOT); process.exit(0); }
const src = args[0], name = args[1] || 's10195';
const scale = args.indexOf('--scale') >= 0 ? parseFloat(args[args.indexOf('--scale') + 1]) : 1;
if (!src || !fs.existsSync(src)) { console.error('usage: node tools/make-guide-rack.js <front.dxf> <name> [--scale 50]'); process.exit(1); }

/* --- parse and bring to millimetres, origin at the drawing's bottom-left --- */
const flat = C.cadFlatten(C.cadParseDxf(fs.readFileSync(src, 'latin1')));
const B = flat.bounds;
const X = x => (x - B.minX) * scale, Y = y => (y - B.minY) * scale;
for (const p of flat.polylines) for (let i = 0; i < p.pts.length; i += 2) { p.pts[i] = X(p.pts[i]); p.pts[i + 1] = Y(p.pts[i + 1]); }
for (const c of flat.circles) { c.cx = X(c.cx); c.cy = Y(c.cy); c.r *= scale; }
const W = (B.maxX - B.minX) * scale, H = (B.maxY - B.minY) * scale;
const index = C.cadFeatureIndex(C.cadFeatures(flat), 20);

/* --- one example of each part on S10195 (mm after scaling) --- */
const TEACH = {
  s10195: [
    { kind: 'ssc', name: 'SSC', box: [603, 772, 1092, 1210], expect: 9 },
    { kind: 'msm', name: 'MSM', box: [4603, 1593, 5088, 1808], expect: 1 },
    { kind: 'acdp', name: 'ACDP', box: [2103, 333, 2588, 568], expect: 3 },
    { kind: 'jb', name: 'Junction box', box: [612, 2445, 1088, 2536], expect: 5 },
    { kind: 'module', name: 'Battery module', box: [85, 1603, 597, 1808], expect: null },
  ],
}[name];
if (!TEACH) { console.error('no teach boxes for ' + name); process.exit(1); }

const sigs = TEACH.map(t => {
  let sig = C.cadTeachSignature(index, { x0: t.box[0], y0: t.box[1], x1: t.box[2], y1: t.box[3] }, { kind: t.kind, name: t.name });
  sig = C.cadRefineSignature(index, sig, { tol: 0.5 });
  const n = C.cadFindMatches(index, sig, { tol: 0.5 }).length;
  console.log(t.kind, 'copies', n, 'features', sig.features.length);
  if (t.expect != null && n !== t.expect) console.warn(`  ! ${t.kind}: found ${n}, expected ${t.expect}`);
  return sig;
});
const comps = C.cadRecognise(index, sigs, { tol: 0.5 });

/* Parts whose outline differs from the taught copy (cut by a neighbour), placed
   by hand from the drawing. Marked `manual` in the output. */
const MANUAL = {
  s10195: [
    { kind: 'acdp', x0: 4603, y0: 1357, x1: 5088, y1: 1592 },   /* ACDP under the MSM */
    { kind: 'ssc', x0: 4603, y0: 982, x1: 5088, y1: 1355 },     /* SSC under that ACDP (strip at y 995) */
  ],
}[name] || [];
MANUAL.forEach(m => comps.push(Object.assign({ manual: true }, m)));
/* The top module row touches the junction boxes / fans, so it is not matched:
   repeat the row below one pitch (210 mm) up where the slot is free. */
comps.filter(c => c.kind === 'module').slice().forEach(c => {
  const up = { kind: 'module', manual: true, x0: c.x0, y0: c.y0 + 210, x1: c.x1, y1: c.y1 + 210 };
  if (up.y1 > H - 60) return;
  if (comps.some(o => o.x0 < up.x1 - 30 && o.x1 > up.x0 + 30 && o.y0 < up.y1 - 30 && o.y1 > up.y0 + 30)) return;
  comps.push(up);
});
const nums = C.cadProposeNumbers(comps);
const prefix = { ssc: 'SSC', acdp: 'ACDP', msm: 'MSM', jb: 'JB', module: 'M' };
const jbs = comps.filter(c => c.kind === 'jb').sort((a, b) => a.x0 - b.x0);
const mods = comps.filter(c => c.kind === 'module').sort((a, b) => a.x0 - b.x0 || b.y0 - a.y0);
const r1 = v => Math.round(v * 10) / 10;
const parts = comps.map(c => ({
  id: c.kind === 'jb' ? 'JB' + (jbs.indexOf(c) + 1) : c.kind === 'module' ? 'M' + (mods.indexOf(c) + 1) : prefix[c.kind] + nums.get(c),
  kind: c.kind, x0: r1(c.x0), y0: r1(c.y0), x1: r1(c.x1), y1: r1(c.y1), manual: c.manual ? true : undefined,
}));

/* --- rack columns: the 12 pattern columns, from module and SSC copies --- */
const colX = [...new Set(comps.filter(c => c.kind === 'module' || c.kind === 'ssc').map(c => Math.round(((c.x0 + c.x1) / 2) / 50) * 50))].sort((a, b) => a - b);

/* --- front linework, 0.5 mm grid, as integer arrays (x2) --- */
const q = v => Math.round(v * 2);
const lines = flat.polylines.map(p => { const a = new Array(p.pts.length); for (let i = 0; i < a.length; i++) a[i] = q(p.pts[i]); return a; });
const circles = flat.circles.map(c => [q(c.cx), q(c.cy), q(c.r)]);

const out = path.join(ROOT, 'assets', 'guide');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, name + '.json');
fs.writeFileSync(file, JSON.stringify({
  format: 'wireflow-guide-rack', version: 1, name: name.toUpperCase(),
  source: path.basename(src), scale: scale, units: 'mm', lineUnit: 0.5,
  width: r1(W), height: r1(H), columns: colX, parts: parts, lines: lines, circles: circles,
}));
const by = {}; parts.forEach(p => { by[p.kind] = (by[p.kind] || 0) + 1; });
console.log('written', path.relative(ROOT, file), (fs.statSync(file).size / 1e6).toFixed(1) + ' MB', JSON.stringify(by), 'columns', colX.length);
console.log(parts.filter(p => p.kind !== 'module').map(p => p.id + '@' + p.x0 + ',' + p.y0).join('  '));
