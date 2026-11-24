/* 3D wiring guide: technote rules, port layouts, cable list and channel router.
 *
 * Pure data + deterministic geometry (millimetres). No DOM, no three.js, so the
 * Node tests can load it with new Function(...) like the other modules.
 *
 * Sources (AYK technotes, rev 2.0 unless noted):
 *   TN0159 230VAC control power connection instructions-LC  (ACDP)
 *   TN0160 SSC rack wiring instructions-LC
 *   TN0162 String to Buss connection instructions-LC (rev 1.0)
 *   TN0163 MSM rack wiring instructions-LC
 *
 * Coordinates: x to the right as seen from the FRONT (same as the DXF),
 * y up, z = 0 at the front face of the modules, negative towards the rear.
 */
'use strict';

const GUIDE_TECHNOTES = {
  TN0159: '230VAC control power connection instructions',
  TN0160: 'SSC rack wiring instructions',
  TN0162: 'String to Buss connection instructions',
  TN0163: 'MSM rack wiring instructions',
};

/* Rack geometry not in a front-view drawing. v1 values, see GUIDE_ASSUMPTIONS. */
const GUIDE_GEOM = {
  moduleDepth: 735,     /* OrionAN family module depth (A-96AA), mm */
  rackDepth: 835,       /* rack depth excluding cable trunk */
  portOut: 20,          /* connector length behind a rear face */
  zFace: -735,          /* rear faces of modules, SSC, MSM, ACDP */
  zBracket: -790,       /* horizontal fixing brackets (rear) */
  zClamp: -805,         /* vertical cable clamps on the rear posts */
  bottomY: 55,          /* bottom panel height */
  postPitch: 500,       /* rack pattern (column spacing) */
  postX0: 100,          /* first post x */
  railY0: 128,          /* first rail y */
  railPitch: 210,       /* module row pitch */
  panelX: -12,          /* Signal Inter-Connection Panel: outer face of the left end */
  panelRiserX: 45,      /* vertical bracket beside the panel (inside the end) */
};

const GUIDE_ASSUMPTIONS = [
  'Drawing scale 1:50 (12 columns of 500 mm pattern); module family OrionAN (200 mm high, 735 mm deep).',
  'Rear side, brackets, clamps and bottom panel are generated from the technote rules: the DXF is a front view only.',
  'Signal Inter-Connection Panels: two on the left end (about 980–1345 and 1470–1835 mm), 2 × 5 holders each, read from the SolidWorks side view.',
  'ACDP feeds: each ACDP feeds its three closest SSCs (ACDP1 first). Junction boxes: two SSCs each, closest first.',
  'Rear port positions follow the technote panel drawings, not measured CAD.',
  'SSC numbering follows the AYK rule: SSC1 / ACDP1 is the one closest to the MSM.',
];

/* Connector types (technote pin definitions). */
const GUIDE_CONNECTORS = {
  'LP16-3': { name: 'LP16-3 plug (3-pin)', pins: 'L, N, G (earth)' },
  'LP16-4': { name: 'LP16-4 plug (4-pin)', pins: '1–4' },
  'LP16-4R': { name: 'LP16-4 plug (4-pin)', pins: 'Pins 1–2: remote E-stop, two-wire 10k/1k resistor network with NC E-stop button. Pins 3–4: fault output, 24 V optical relay.' },
  'RJ45': { name: '8-pin Ethernet (RJ45)', pins: '8-pin Ethernet' },
  'DC': { name: 'DC power plug', pins: 'Plug letter and colour must match the socket; align the two small key pins. Push the side button to unplug.' },
};

/* Cable categories (colours used in the 3D view and the list). */
const GUIDE_CATS = {
  acP: { label: 'AC power – primary', color: '#e5484d' },
  acB: { label: 'AC power – backup', color: '#2f80ed' },
  comm: { label: 'Communication', color: '#30a46c' },
  estop: { label: 'E-stop', color: '#f59e0b' },
  ext: { label: 'Customer connection', color: '#a855f7' },
  dc: { label: 'DC bus (front)', color: '#7c2d12' },
  hvil: { label: 'Ext-HVIL loop', color: '#14b8a6' },
  valve: { label: 'Master valve line', color: '#eab308' },
};

/* Port LABELS are the names printed on the hardware / technote panel figures
 * (TN0159 Fig. 2, TN0160 SSC rear panel, TN0163 MSM rear panel), character for
 * character: e.g. 'Ext-HVIL', 'RemotE', 'Ex.FanFB', 'SSC 1P', 'AC PowerIn B'.
 * Never reword them. Ids are internal only.
 * Rear port panels, u/v as fractions of the rear face SEEN FROM THE REAR
 * (u = 0 at the viewer's left), v = 0 at the top. From the technote figures. */
const GUIDE_REAR_PORTS = (function () {
  const msm = [];
  const rj = [0.07, 0.15, 0.23, 0.31, 0.39, 0.47], rd = [0.56, 0.645, 0.73, 0.815];
  const rows = [0.2, 0.4, 0.6, 0.82];
  [['Cloud', 'EMS', 'PCS', 'Spare'], ['SSC1P', 'SSC1B', 'SSC2P', 'SSC2B', 'SSC3P', 'SSC3B'],
    ['SSC4P', 'SSC4B', 'SSC5P', 'SSC5B', 'SSC6P', 'SSC6B'], ['SSC7P', 'SSC7B', 'SSC8P', 'SSC8B', 'SSC9P', 'SSC9B']]
    .forEach((row, r) => row.forEach((id, c) => msm.push({ id: id, label: id.replace(/^SSC(\d)([PB])$/, 'SSC $1$2'), u: rj[c], v: rows[r], conn: 'RJ45' })));
  msm.push({ id: 'Estop1', label: 'Estop1', u: rj[4], v: rows[0], conn: 'LP16-4' }, { id: 'Estop2', label: 'Estop2', u: rj[5], v: rows[0], conn: 'LP16-4' },
    { id: 'Estop3', label: 'Estop3', u: rd[0], v: 0.2, conn: 'LP16-4' }, { id: 'Estop4', label: 'Estop4', u: rd[0], v: 0.36, conn: 'LP16-4' },
    { id: 'Estop5', label: 'Estop5', u: rd[0], v: 0.52, conn: 'LP16-4' }, { id: 'Estop6', label: 'Estop6', u: rd[1], v: 0.52, conn: 'LP16-4' },
    { id: 'Estop7', label: 'Estop7', u: rd[2], v: 0.52, conn: 'LP16-4' }, { id: 'Estop8', label: 'Estop8', u: rd[3], v: 0.52, conn: 'LP16-4' },
    { id: 'Estop9', label: 'Estop9', u: rd[0], v: 0.68, conn: 'LP16-4' }, { id: 'DryContact', label: 'DryContact', u: rd[1], v: 0.68, conn: 'LP16-4' },
    { id: 'ExFanFB', label: 'Ex.FanFB', u: rd[2], v: 0.68, conn: 'LP16-4' }, { id: 'RemoteE', label: 'RemotE', u: rd[3], v: 0.68, conn: 'LP16-4R' },
    { id: 'PowerP', label: 'PowerP', u: rd[0], v: 0.85, conn: 'LP16-3' }, { id: 'PowerB', label: 'PowerB', u: rd[1], v: 0.85, conn: 'LP16-3' },
    { id: 'Valve1', label: 'Valve1', u: rd[2], v: 0.85, conn: 'LP16-7' }, { id: 'Valve2', label: 'Valve2', u: rd[3], v: 0.85, conn: 'LP16-7' });
  const ssc = ['PowerP', 'PowerB', 'CommP', 'CommB', 'ExtHVIL', 'CoolingFan', 'Estop'].map((id, i) => ({
    id: id, label: id.replace('ExtHVIL', 'Ext-HVIL').replace('CoolingFan', 'Cooling Fan'), u: 0.2 + i * 0.1, v: 0.84,
    conn: { PowerP: 'LP16-3', PowerB: 'LP16-3', CommP: 'RJ45', CommB: 'RJ45', Estop: 'LP16-4' }[id] || 'other' }));
  const acdp = ['SSC3B', 'SSC3P', 'SSC2B', 'SSC2P', 'SSC1B', 'SSC1P', 'MSMB', 'MSMP', 'ACInB', 'ACInP'].map((id, i) => ({
    id: id, label: id.replace(/^SSC(\d)([PB])$/, 'SSC$1 $2').replace(/^MSM([PB])$/, 'MSM $1').replace(/^ACIn([PB])$/, 'AC PowerIn $1'),
    u: 0.1 + i * 0.087, v: 0.42, conn: 'LP16-3' }));
  return { msm: msm, ssc: ssc, acdp: acdp };
})();

/* What a port is for when it carries no cable in this project. */
const GUIDE_PORT_NOTES = {
  'ssc.CommB': 'Backup communication port. Its use differs between TN0160 and TN0163; confirm with AYK for your project.',
  'ssc.ExtHVIL': 'Only used with a busbar at the top of the rack: 2-pin cable to the busbar power connectors (busbar HVIL). Otherwise a spare connector (TN0160).',
  'ssc.CoolingFan': 'Not covered by the customer wiring technotes.',
  'msm.Spare': 'Spare socket (TN0163).',
  'msm.DryContact': 'Not covered by the customer wiring technotes.',
  'msm.ExFanFB': 'Not covered by the customer wiring technotes.',
  'msm.Valve1': 'Fire-fighting master valve (not part of this electrical guide).',
  'msm.Valve2': 'Fire-fighting master valve (not part of this electrical guide).',
  'msm.SSCxB': 'Not wired: SSC1B does not need to connect with any wire (TN0163); the same applies to each SSC’s B port.',
};

/* Front connectors (measured on S10195, mm from the part's bottom-left). */
const GUIDE_FRONT_PORTS = {
  ssc: [['S', 127, 13], ['N', 173, 13], ['S+', 219, 13], ['B+', 265, 13], ['B-', 312, 13], ['S-', 358, 13]],
  jb: [['P1+', 133, 23], ['P1-', 203, 23], ['P2+', 273, 23], ['P2-', 343, 23]],
};

/* ---------- helpers ---------- */
/* Rack geometry: the defaults above, overridden by a rack built from 3D CAD
 * (rack.geom: posts, clamps, trays, panel side, slot routing). */
function guideGeom(rack) { return rack && rack.geom ? Object.assign({}, GUIDE_GEOM, rack.geom) : GUIDE_GEOM; }
function guidePart(rack, id) { return rack.parts.find(p => p.id === id) || null; }
function guideCx(p) { return (p.x0 + p.x1) / 2; }
function guideCy(p) { return (p.y0 + p.y1) / 2; }
function guideSorted(rack, kind) {
  return rack.parts.filter(p => p.kind === kind).sort((a, b) => parseInt(a.id.replace(/\D/g, ''), 10) - parseInt(b.id.replace(/\D/g, ''), 10));
}

/* Assigns SSCs to feeders (ACDPs, junction boxes) with at most `cap` each so
 * the total rack-path distance (|dx| + |dy|) is smallest. Exact branch and
 * bound; ties keep the earlier feeder, so the result is deterministic.
 * Returns Map sscId -> {feeder, slot (1-based, by SSC number within the feeder)}. */
function guideFeed(feeders, sscs, cap) {
  const d = sscs.map(s => feeders.map(f => Math.abs(guideCx(s) - guideCx(f)) + Math.abs(guideCy(s) - guideCy(f))));
  const n = sscs.length, used = feeders.map(() => 0), cur = new Array(n);
  const minRest = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) minRest[i] = minRest[i + 1] + Math.min(...d[i]);
  let best = Infinity, bestPick = null;
  (function walk(i, sum) {
    if (sum + minRest[i] >= best - 1e-9) return;
    if (i === n) { best = sum; bestPick = cur.slice(); return; }
    const order = feeders.map((_, k) => k).sort((a, b) => d[i][a] - d[i][b] || a - b);
    for (const k of order) {
      if (used[k] >= cap) continue;
      used[k]++; cur[i] = k; walk(i + 1, sum + d[i][k]); used[k]--;
    }
  })(0, 0);
  const out = new Map();
  if (!bestPick) return out;
  feeders.forEach((f, k) => {
    sscs.filter((s, i) => bestPick[i] === k)
      .sort((a, b) => parseInt(a.id.slice(3), 10) - parseInt(b.id.slice(3), 10))
      .forEach((s, i) => out.set(s.id, { feeder: f.id, slot: i + 1 }));
  });
  return out;
}

/** Port position (mm). ref = {dev, port}; rear ports sit just behind the rear face. */
function guidePortPos(rack, ref) {
  const p = guidePart(rack, ref.dev);
  if (!p) throw new Error('unknown device ' + ref.dev);
  if (p.ports && p.ports[ref.port]) return p.ports[ref.port].slice();   /* measured in 3D CAD */
  if (p.kind === 'jb' || (p.kind === 'ssc' && ref.front)) {
    const t = GUIDE_FRONT_PORTS[p.kind].find(f => f[0] === ref.port);
    if (!t) throw new Error('unknown front port ' + ref.dev + '.' + ref.port);
    return [p.x0 + t[1], p.y0 + t[2], 15];
  }
  const list = GUIDE_REAR_PORTS[p.kind];
  const t = list && list.find(q => q.id === ref.port);
  if (!t) throw new Error('unknown port ' + ref.dev + '.' + ref.port);
  /* seen from the rear the face is mirrored: u = 0 is the device's right end (x1) */
  const G = guideGeom(rack);
  return [p.x1 - t.u * (p.x1 - p.x0), p.y1 - t.v * (p.y1 - p.y0), (p.z0 != null ? p.z0 : G.zFace) - G.portOut];
}

/* Signal Inter-Connection Panel holders: lower panel = power (2 mm pad),
 * upper panel = communication (5 mm pad). */
/* Layout from the S10195 SolidWorks side view and Rack_Master config: two
 * panels on the left end, each with 2 rows of 5 inline-connector holders. */
const GUIDE_PANELS = [
  { kind: 'power', y0: 980, y1: 1345, rows: [1136, 1200], label: 'Signal Inter-Connection Panel · power' },
  { kind: 'comm', y0: 1470, y1: 1835, rows: [1627, 1690], label: 'Signal Inter-Connection Panel · communication' },
];
const GUIDE_PANEL_Z = { z0: -90, z1: -855, holders: [-142, -234, -327, -420, -512] };
function guideHolder(kind, i, rack, n) {
  const pad = kind === 'power' ? 2 : 5;
  if (rack && rack.holders && rack.holders.length) {    /* measured holders, used in order */
    const H = rack.holders;
    if (n < H.length) return Object.assign({}, H[n], { pad: pad });
    const last = H[H.length - 1], prev = H[H.length - 2] || last, k = n - H.length + 1;
    return { x: last.x, y: last.y, z: last.z + (last.z - prev.z) * k, pad: pad, extra: true };
  }
  const G = GUIDE_GEOM, P = GUIDE_PANELS.find(p => p.kind === kind);
  const col = i % 5, row = Math.floor(i / 5) % 2;
  return { x: G.panelX, y: P.rows[1 - row], z: GUIDE_PANEL_Z.holders[col], pad: kind === 'power' ? 2 : 5 };
}

/* ---------- cable list ---------- */
/**
 * Every cable of this rack, from the technotes. Deterministic order.
 * @return {Array<Object>} {id, cat, title, from, to, part, conn, supply, customer, tn, holder?, ext?}
 */
function guideCables(rack) {
  /* project racks carry their own cable list (from the project's cable specification) */
  if (rack.cables) return rack.cables.map(c => Object.assign({}, c));
  const sscs = guideSorted(rack, 'ssc'), acdps = guideSorted(rack, 'acdp'), msm = guideSorted(rack, 'msm')[0];
  const jbs = rack.parts.filter(p => p.kind === 'jb').sort((a, b) => a.x0 - b.x0);
  const acFeed = guideFeed(acdps, sscs, 3), jbFeed = guideFeed(jbs, sscs, 2);
  const out = [];
  const AYK_LP3 = 'AYK cable, 3-pin male plug both ends.';
  const lab = (dev, port) => { const p = guidePart(rack, dev); return p && p.labels && p.labels[port] ? ' (' + p.labels[port] + ')' : ''; };
  let hn = 0;
  for (const s of sscs) {
    const n = s.id.slice(3), f = acFeed.get(s.id);
    if (f) {
      out.push({ id: s.id + '-acP', cat: 'acP', title: s.id + ' PowerP ← ' + f.feeder + ' SSC' + f.slot + ' P',
        from: { dev: f.feeder, port: 'SSC' + f.slot + 'P' }, to: { dev: s.id, port: 'PowerP' }, part: 'Rack_SSC_Power_P', conn: 'LP16-3',
        supply: AYK_LP3, tn: ['TN0159', 'TN0160'] });
      out.push({ id: s.id + '-acB', cat: 'acB', title: s.id + ' PowerB ← ' + f.feeder + ' SSC' + f.slot + ' B',
        from: { dev: f.feeder, port: 'SSC' + f.slot + 'B' }, to: { dev: s.id, port: 'PowerB' }, part: 'Rack_SSC_Power_B', conn: 'LP16-3',
        supply: AYK_LP3, tn: ['TN0159', 'TN0160'] });
    }
    if (msm) {
      out.push({ id: s.id + '-comm', cat: 'comm', title: s.id + ' CommP ↔ MSM SSC ' + n + 'P',
        from: { dev: msm.id, port: 'SSC' + n + 'P' }, to: { dev: s.id, port: 'CommP' }, part: 'Rack_Comm_MSM_SSC', conn: 'RJ45',
        supply: 'AYK 8-pin Ethernet cable. The MSM’s SSC ' + n + 'B port is not wired.', tn: ['TN0160', 'TN0163'] });
      out.push({ id: s.id + '-estop', cat: 'estop', title: s.id + ' Estop ↔ MSM Estop' + n,
        from: { dev: msm.id, port: 'Estop' + n }, to: { dev: s.id, port: 'Estop' }, part: 'Rack_Estop_MSM_SSC', conn: 'LP16-4',
        supply: 'AYK cable, 4-pin male plug both ends.', tn: ['TN0160', 'TN0163'] });
    }
    const j = jbFeed.get(s.id);
    if (j) {
      ['+', '-'].forEach(pol => out.push({ id: s.id + '-dc' + (pol === '+' ? 'P' : 'N'), cat: 'dc', title: s.id + ' BUS' + (pol === '+' ? '+' : '−') + lab(s.id, 'B' + pol) + ' → ' + j.feeder + ' P' + j.slot + (pol === '+' ? '+' : '−') + lab(j.feeder, 'P' + j.slot + pol),
        from: { dev: s.id, port: 'B' + pol, front: true }, to: { dev: j.feeder, port: 'P' + j.slot + pol }, part: 'Power cable (plugs A–D)', conn: 'DC',
        supply: 'AYK power cables with Power Plug A/B/C/D. Without a junction box AYK supplies Bus Positive / Bus Negative and the customer makes the cables.',
        tn: ['TN0162'], front: true }));
    }
  }
  if (msm && acdps[0]) {
    out.push({ id: 'MSM-acP', cat: 'acP', title: 'MSM PowerP ← ' + acdps[0].id + ' MSM P', from: { dev: acdps[0].id, port: 'MSMP' }, to: { dev: msm.id, port: 'PowerP' },
      part: 'Rack_MSM_Power_P', conn: 'LP16-3', supply: AYK_LP3, tn: ['TN0159', 'TN0163'] });
    out.push({ id: 'MSM-acB', cat: 'acB', title: 'MSM PowerB ← ' + acdps[0].id + ' MSM B', from: { dev: acdps[0].id, port: 'MSMB' }, to: { dev: msm.id, port: 'PowerB' },
      part: 'Rack_MSM_Power_B', conn: 'LP16-3', supply: AYK_LP3, tn: ['TN0159', 'TN0163'] });
  }
  /* customer connections, all through the Signal Inter-Connection Panel */
  let pw = 0, cm = 0;
  for (const a of acdps) {
    for (const v of ['P', 'B']) {
      out.push({ id: a.id + '-in' + v, cat: 'ext', title: a.id + ' AC PowerIn ' + v + ' → customer 230 VAC', from: { dev: a.id, port: 'ACIn' + v },
        to: { ext: 'Customer 230 VAC supply (' + (v === 'P' ? 'primary' : 'backup') + ')' }, holder: guideHolder('power', pw++, rack, hn++),
        part: 'AYK supply cable: 3-pin connector to 3 open wires crimped into an inline connector', conn: 'LP16-3',
        supply: 'AYK supplies the cable and inline connector (on the Signal Inter-Connection Panel).',
        customer: 'Customer prepares the cable from the inline connector to the 220/230 VAC supply. Recommended 3 × 2.5 mm², OD 10 mm. Destination chosen by the customer.',
        tn: ['TN0159'] });
    }
  }
  if (msm) {
    [['Cloud', 'Internet'], ['EMS', 'Customer EMS'], ['PCS', 'Customer PCS']].forEach(([port, ext]) => out.push({
      id: 'MSM-' + port, cat: 'ext', title: 'MSM ' + port + ' → ' + ext, from: { dev: msm.id, port: port }, to: { ext: ext }, holder: guideHolder('comm', cm++, rack, hn++),
      part: 'AYK Ethernet plug', conn: 'RJ45', supply: 'AYK supplies an Ethernet plug.',
      customer: 'Customer supplies the LAN cable and makes the wiring.', tn: ['TN0163'] }));
    out.push({ id: 'MSM-RemoteE', cat: 'ext', title: 'MSM RemotE → remote E-stop', from: { dev: msm.id, port: 'RemoteE' }, to: { ext: 'Remote E-stop button' },
      holder: guideHolder('comm', cm++, rack, hn++), part: 'AYK 4-pin cable (LP16-4 plug + inline connector)', conn: 'LP16-4R',
      supply: 'AYK supplies a 4-pin cable. Without a remote E-stop, AYK supplies a 4-pin plug with a 1 kΩ resistor: plug it into RemotE.',
      customer: 'Customer wires the remote E-stop button (NC) to the inline connector.', tn: ['TN0163'] });
  }
  return out;
}

/* ---------- channel router ---------- */
function guidePosts(rack) {
  const G0 = guideGeom(rack);
  if (Array.isArray(G0.posts) && G0.posts.length) return G0.posts.slice();   /* explicit, for unevenly spaced posts (racks in a row with gaps) */
  const G = G0, n = Math.round((rack.width - G.postX0) / G.postPitch);
  const out = []; for (let k = 0; k <= n; k++) out.push(G.postX0 + k * G.postPitch); return out;
}
function guideRails(rack) {
  const G = guideGeom(rack), out = [];
  if (G.rails) return G.rails.slice();
  for (let y = G.railY0; y <= rack.height - 60; y += G.railPitch) out.push(y);
  return out;
}
function guideNearest(list, v) { return list.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), list[0]); }

/**
 * Route for one cable, as legs that follow the technote rules.
 * @return {Array<{rule:string, tn:string, pts:Array<[number,number,number]>, customer?:boolean}>}
 */
/* Inline connector in a panel holder (TN0160 Fig. 5): upright, axis vertical, flat on the panel. */
const GUIDE_INLINE = { half: 38, out: 16, below: 70 };   /* mm: half length, offset from the holder face, run below the holder */
/** Customer cable out of the top of an upright inline connector, then away from the panel. */
function guideCustomerOut(hx, h, side) {
  const up = h.y + GUIDE_INLINE.half + 45;
  return [[hx, h.y, h.z], [hx, up, h.z], [hx + side * 140, up + 30, h.z], [hx + side * 520, up - 20, h.z]];
}

function guideRoute(rack, cable, lane) {
  /* routes precomputed by a builder (e.g. two racks joined into one bank view) */
  if (cable.legs) return cable.legs.map(l => Object.assign({}, l, { pts: l.pts.map(p => p.slice()) }));
  const G = guideGeom(rack), side = G.panelSide || -1, posts = guidePosts(rack), rails = guideRails(rack);
  const l = lane || 0, ox = ((l % 5) - 2) * 9, oy = ((l % 5) - 2) * 9, oz = -(Math.floor(l / 5) % 4) * 8;
  const legs = [];
  const leg = (rule, tn, pts, extra) => {
    const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) > 0.5);
    if (clean.length >= 2) legs.push(Object.assign({ rule: rule, tn: tn, pts: clean }, extra || {}));
  };

  if (cable.front) { /* TN0162: DC at the front, SSC strip to junction box */
    const a = guidePortPos(rack, cable.from), b = guidePortPos(rack, cable.to);
    const jb = guidePart(rack, cable.to.dev), up = jb.y0 - 40 + oy * 0.5, zf = 70 + oz;
    leg('Lock out the power from the inverter first. Plug into the SSC socket with the same letter and colour; make sure the 2 small key pins line up.', 'TN0162',
      [a, [a[0], a[1], zf], [a[0], a[1] - 25, zf]]);
    const px = guideNearest(posts, a[0]) + ox * 0.6;
    leg('Run the cable up the front of the rack column to the junction box and tie it down.', 'TN0162',
      [[a[0], a[1] - 25, zf], [px, a[1] - 25, zf], [px, up, zf], [b[0], up, zf]]);
    leg('Plug into the junction-box socket with the same letter and colour. To unplug, push the side button.', 'TN0162',
      [[b[0], up, zf], [b[0], b[1], zf], b]);
    return legs;
  }

  if (!cable.from.dev && cable.holder) { /* cable that only passes the panel (e.g. a line from outside the rack) */
    const h = cable.holder, tn = cable.tn[cable.tn.length - 1];
    const hs = h.side || side, hx = h.x + hs * GUIDE_INLINE.out;
    leg('Snap the inline connector upright into its holder on the Signal Inter-Connection Panel' + (h.panel ? ' (Panel ' + h.panel + ', H' + h.n + ')' : '') + ': the AYK cable enters from below (TN0160 Fig. 5).', tn,
      [[hx, h.y - GUIDE_INLINE.below - 40, h.z], [hx, h.y, h.z]], { holder: true, side: hs });
    leg(cable.customer || 'Customer cable.', tn, guideCustomerOut(hx, h, hs), { customer: true });
    return legs;
  }

  const sidePosts = dev => [Math.max(...posts.filter(x => x <= dev.x0 + 30)), Math.min(...posts.filter(x => x >= dev.x1 - 30))];
  /* force: use this post (both ends share a post when they can) */
  const exitFrom = (ref, towardX, force) => {
    const dev = guidePart(rack, ref.dev), p = guidePortPos(rack, ref);
    const goLeft = (force != null ? force : towardX) < guideCx(dev);
    /* words: x < centre is 'left' seen from the front; racks whose documents name sides from the rear set geom.sideView = 'rear' */
    const L = (G.sideView === 'rear') !== goLeft, lw = L ? 'left' : 'right', Lw = L ? 'Left' : 'Right';
    const post = force != null ? force : sidePosts(dev)[goLeft ? 0 : 1];
    /* slot routing (3D CAD racks): the run behind a device stays in its own slot */
    const zb = (G.slotRouting && dev.z0 != null ? dev.z0 - 45 : G.zBracket) + oz, zc = G.zClamp + oz;
    if (dev.kind === 'msm' && G.slotRouting) {
      /* same loop as the SSC (TN0160 Fig. 1/2), which is also TN0163's service loop over the top of the MSM:
         up from the rear port, forward over the top to the front edge, across, back to the rear on the post side */
      const top = Math.min(dev.y1 + 30 + oy * 0.3, (dev.slotTop || 1e9) - 6), xa = p[0] + ox * 0.5;
      const xs = (goLeft ? dev.x0 + 25 : dev.x1 - 25) + ox * 0.5, zf = (dev.z1 != null ? dev.z1 : 0) - 70 + ox * 0.8;
      return { post: post, y: top, legs: [
        ['Connect to the MSM port, fix it in place and route the cable straight up to the top of the MSM.', 'TN0163', [p, [p[0], p[1], zb], [p[0], top, zb]]],
        ['Service loop: loop the cable over the top of the MSM, forward to the front edge, across the front and back to the rear on the ' + lw + ' side, so the MSM can be removed for maintenance. Fix it only at the loop-back point with the fixing clip; leave the sections before and after unfixed.', 'TN0163',
          [[p[0], top, zb], [xa, top, zb], [xa, top, zf], [xs, top, zf], [xs, top, zb]]],
        ['Fix the cable along the horizontal fixing bracket, on the flat face that faces the inside of the rack.', 'TN0163',
          [[xs, top, zb], [post + ox, top, zb], [post + ox, top, zc]]],
      ] };
    }
    if (dev.kind === 'msm') {
      const top = dev.y1 + 55 + oy * 0.4, s = goLeft ? 1 : -1, rail = guideNearest(rails.filter(r => r >= dev.y1 - 20), dev.y1 + 60);
      return { post: post, y: rail + oy, legs: [
        ['Connect to the MSM port and fix it in place.', 'TN0163', [p, [p[0], p[1], zb], [p[0], top, zb]]],
        ['Service loop: route the cable back and forth over the top of the MSM so it can be removed for maintenance. Fix it only at the loop-back point with the fixing clip; leave the sections before and after unfixed.', 'TN0163',
          [[p[0], top, zb], [p[0] + s * 140, top, zb], [p[0] + s * 140, top + 45, zb], [p[0] - s * 30, top + 45, zb], [p[0] - s * 30, rail + oy, zb]]],
        ['Fix the cable along the horizontal fixing bracket, on the flat face that faces the inside of the rack.', 'TN0163',
          [[p[0] - s * 30, rail + oy, zb], [post + ox, rail + oy, zb], [post + ox, rail + oy, zc]]],
      ] };
    }
    if (dev.kind === 'ssc') {
      const top = Math.min(dev.y1 + 30 + oy * 0.3, dev.slotTop ? dev.slotTop - 4 : 1e9), side = goLeft ? dev.x0 + 25 : dev.x1 - 25, grommet = dev.y0 + 80;
      /* TN0160 Fig. 1 / 2: up from the rear port, then a loop over the top of the SSC: forward to the front
         edge, across, and back to the rear on the side of the destination post (inner cables, inner loops) */
      const xa = p[0] + ox * 0.5, xs = side + ox * 0.5, zf = (dev.z1 != null ? dev.z1 : 0) - 70 + ox * 0.8;
      return { post: post, y: grommet, legs: [
        ['Route the cable from the rear SSC port straight up to the top of the SSC.', 'TN0160',
          [p, [p[0], p[1], zb], [p[0], top, zb]]],
        ['Loop it over the top of the SSC: forward along the top to the front edge, across the front, and back to the rear on the ' + lw + ' side. Fix it to the clips on the top brackets.', 'TN0160',
          [[p[0], top, zb], [xa, top, zb], [xa, top, zf], [xs, top, zf], [xs, top, zb]]],
        ['Route it back down along the fixing bracket on the ' + lw + ' side of the SSC, through the round cable-protection grommet, and tie it to the bracket.', 'TN0160',
          [[side + ox * 0.5, top, zb], [side + ox * 0.5, grommet, zb]]],
        [Lw + ' side: fix the cable to the ' + lw + '-side cable clamp. Keep it smooth: not sharply bent, pulled tight or touching other parts.', 'TN0160',
          [[side + ox * 0.5, grommet, zb], [post + ox, grommet, zb], [post + ox, grommet, zc]]],
      ] };
    }
    if (dev.kind === 'jb') {   /* junction box on top of the rack: down its rear to the rack post */
      const y = (dev.y0 - 40) + oy * 0.4;
      return { post: post, y: y, legs: [
        ['Plug into the junction-box socket and run the cable down the rear of the junction box to the rack post.', 'TN0160',
          [p, [p[0], p[1], zb], [p[0], y, zb], [post + ox, y, zb], [post + ox, y, zc]]],
      ] };
    }
    /* ACDP (TN0159): to the left or right side sheet metal, cable ties */
    const y = p[1] - 30 + oy * 0.4;
    return { post: post, y: y, legs: [
      ['Route the power cable from the ACDP port to the ' + lw + '-side sheet metal and fix it with cable ties.', 'TN0159',
        [p, [p[0], p[1], zb], [p[0], y, zb], [post + ox, y, zb], [post + ox, y, zc]]],
    ] };
  };
  const reverse = e => e.legs.slice().reverse().map(([r, t, pts]) => [r, t, pts.slice().reverse()]);
  const zc = G.zClamp + oz;

  if (cable.to.ext) { /* device -> bottom panel -> Signal Inter-Connection Panel -> customer */
    const h = cable.holder, hs = h.side || side;   /* racks with panels on both sides give the side per holder */
    const a = exitFrom(cable.from, hs * 1e9), by = G.bottomY + 12 + oy * 0.5, rx = (h.riserX != null ? h.riserX : G.panelRiserX) + ox * (G.slotRouting ? 0.2 : 0.5);
    /* TN0160 Fig. 5: inline connectors stand upright in their holders; each cable runs along the panel below the
       connector rows and turns up into the bottom of its connector; the customer cable leaves from the top */
    const hx = h.x + hs * GUIDE_INLINE.out, yl = h.y - GUIDE_INLINE.below - ((h.n || 0) % 2 ? 0 : 65) + oy * 0.3;
    a.legs.forEach(([r, t, pts]) => leg(r, t, pts));
    if (G.directPanel) {   /* panels beside the device column: along the post clamps straight to the panel */
      leg('Run along the vertical cable clamps on the rack post to the height of the panel.', 'TN0163',
        [[a.post + ox, a.y, zc], [a.post + ox, yl, zc]]);
      leg('Cross to the vertical bracket at the side of the panels and tie the bundle to it.', 'TN0160',
        [[a.post + ox, yl, zc], [rx, yl, zc]]);
    } else {
    leg('Run down the vertical cable clamps to the bottom panel.', cable.tn[0] === 'TN0159' ? 'TN0160' : 'TN0163',
      [[a.post + ox, a.y, zc], [a.post + ox, by, zc]]);
    leg('Route along the bottom panel and secure the cable with the fixing devices (they can be stacked in layers for more cables).', 'TN0163',
      [[a.post + ox, by, zc], [rx, by, zc]]);
    leg('Route upward from the bottom panel and tie the bundle to the vertical bracket at the side of the panels.', 'TN0160',
      [[rx, by, zc], [rx, yl, zc]]);
    }
    leg('Run the cable along the panel below the connector rows, turn it up into the bottom of the inline connector and snap the connector upright into its holder on the Signal Inter-Connection Panel' + (h.panel ? ' (Panel ' + h.panel + ', H' + h.n + (h.pn ? ', cable ' + h.pn : '') + ')' : '') + ' (' + h.pad + ' mm silicone pad: ' + (h.pad === 2 ? 'power' : 'communication') + ' connector).' +
      (h.extra ? ' The CAD panel has no free holder for this one: confirm its position with AYK.' : ''), cable.holderTn || cable.tn[0],
      [[rx, yl, zc], [hx, yl, zc], [hx, yl, h.z], [hx, h.y, h.z]], { holder: true, extra: h.extra || undefined, side: hs });
    const T = rack.trunk, up = h.y + GUIDE_INLINE.half + 45;
    leg(cable.customer || 'Customer cable.', cable.holderTn || cable.tn[0], T
      ? [[hx, h.y, h.z], [hx, up, h.z], [hx + hs * 25, up, h.z], [T.x, up, T.z], [T.x, T.y0 + 40, T.z], [T.x + hs * 260, T.y0 - 40, T.z + 160]]
      : guideCustomerOut(hx, h, hs), { customer: true });
    return legs;
  }

  /* device -> device inside this rack */
  const pa = guidePortPos(rack, cable.from), pb = guidePortPos(rack, cable.to);
  const a = exitFrom(cable.from, pb[0]);
  const b = exitFrom(cable.to, pa[0], sidePosts(guidePart(rack, cable.to.dev)).indexOf(a.post) >= 0 ? a.post : undefined);
  a.legs.forEach(([r, t, pts]) => leg(r, t, pts));
  if (a.post === b.post) {
    leg('Run along the vertical cable clamps on the rack post.', 'TN0160', [[a.post + ox, a.y, zc], [b.post + ox, b.y, zc]]);
  } else {
    const rail = guideNearest(rails, a.y) + oy;
    leg('Run along the vertical cable clamp to the horizontal fixing bracket.', 'TN0160', [[a.post + ox, a.y, zc], [a.post + ox, rail, zc]]);
    leg('Fix the cable along the horizontal fixing bracket (flat face towards the inside of the rack).', 'TN0163',
      [[a.post + ox, rail, zc], [a.post + ox, rail, G.zBracket + oz], [b.post + ox, rail, G.zBracket + oz], [b.post + ox, rail, zc]]);
    leg('Run along the vertical cable clamp to the destination.', 'TN0160', [[b.post + ox, rail, zc], [b.post + ox, b.y, zc]]);
  }
  /* destination end: same rules, walked towards the port */
  const dest = cable.to.dev;
  reverse(b).forEach(([r, t, pts], i, all) => leg('At ' + dest + ': ' + (i === all.length - 1 && /^Route the cable from the rear SSC port/.test(r)
    ? 'come down from the top of the SSC into its rear port.' : r.charAt(0).toLowerCase() + r.slice(1)), t, pts));
  return legs;
}

/** Lane per cable: cables sharing a start device get spread apart. */
function guideLanes(cables) {
  const n = {}, out = new Map();
  for (const c of cables) { const k = c.from.dev + (c.front ? 'f' : ''); n[k] = (n[k] || 0); out.set(c.id, n[k]++); }
  return out;
}

if (typeof module !== 'undefined') module.exports = { GUIDE_INLINE, guideCustomerOut, guideGeom, GUIDE_PANELS, GUIDE_PANEL_Z, GUIDE_TECHNOTES, GUIDE_GEOM, GUIDE_ASSUMPTIONS, GUIDE_CONNECTORS, GUIDE_CATS, GUIDE_REAR_PORTS, GUIDE_PORT_NOTES, GUIDE_FRONT_PORTS, guidePart, guidePortPos, guideHolder, guideCables, guideRoute, guideLanes, guidePosts, guideRails };
