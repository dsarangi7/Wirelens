/* 3D wiring guide: renders the rack from assets/guide/<rack>.json, the rear
 * channels from the technote rules and every cable from guide-data.js, and
 * plays a chosen cable's route step by step.
 * Depends on js/guide-data.js (classic script, loaded first) and three.js. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MM = 0.001;
const RACK = new URLSearchParams(location.search).get('rack') || 's10195-r1';
let G = GUIDE_GEOM, SIDE = -1;     /* rack geometry and panel end (-1 left, +1 right, seen from the front) */
const $ = id => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = { rack: null, cables: [], routes: new Map(), sel: null, step: 0, playing: false, cats: new Set(Object.keys(GUIDE_CATS)), query: '' };
const cableMeshes = new Map();   /* id -> [{mesh, leg}] */
const portMeshes = [];
const pickables = [];

/* ---------------- scene ---------------- */
const host = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0a1122);
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.position = 'absolute';
labels.domElement.style.inset = '0';
labels.domElement.style.pointerEvents = 'none';
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2238, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-3, 6, -4); scene.add(sun);
const sun2 = new THREE.DirectionalLight(0xffffff, 0.7); sun2.position.set(4, 3, 5); scene.add(sun2);

const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h); labels.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  /* keep the subject clear of the info card (desktop: card on the right) */
  const card = document.getElementById('card');
  const shift = card && !card.hidden && w > 820 ? Math.min(card.offsetWidth + 28, w * 0.45) / 2 : 0;
  if (shift) camera.setViewOffset(w, h, shift, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);

const v3 = (p) => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM);

/* ---------------- rack geometry ---------------- */
const MAT = {
  module: new THREE.MeshStandardMaterial({ color: 0x8f9bad, metalness: 0.2, roughness: 0.7 }),
  ssc: new THREE.MeshStandardMaterial({ color: 0x3d5a80, metalness: 0.25, roughness: 0.6 }),
  msm: new THREE.MeshStandardMaterial({ color: 0x2c3e66, metalness: 0.25, roughness: 0.6 }),
  acdp: new THREE.MeshStandardMaterial({ color: 0x4b5d73, metalness: 0.25, roughness: 0.6 }),
  jb: new THREE.MeshStandardMaterial({ color: 0x5b6b7f, metalness: 0.3, roughness: 0.6 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x4a5568, metalness: 0.6, roughness: 0.45 }),
  bracket: new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.7, roughness: 0.35 }),
  panel: new THREE.MeshStandardMaterial({ color: 0x7c6f8f, metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide }),
  holder: new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.6 }),
  conn: new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.5 }),
};
/* Simplified geometry (boxes from the DXF + generated rear hardware) lives in
 * `simple`; the real SolidWorks model, when the rack has one, in `cad`. */
const simple = new THREE.Group(); scene.add(simple);
const cad = new THREE.Group(); cad.visible = false; scene.add(cad);
const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); (parent || simple).add(m); return m; };

/* Loads rack.model ({url, matrix: 16 numbers, column-major, model units -> guide metres}). */
function loadCad(rack) {
  if (!rack.model) return Promise.resolve(false);
  const btn = document.getElementById('cadBtn');
  btn.hidden = false; btn.disabled = true; btn.textContent = 'CAD model: loading…';
  return new Promise(resolve => new GLTFLoader().load(rack.model.url, gltf => {
    const root = gltf.scene;
    root.matrixAutoUpdate = false;
    root.matrix.fromArray(rack.model.matrix);
    root.traverse(o => {
      if (!o.isMesh) return;
      /* one mesh per layer (module, ssc, msm, duct ...): flat shaded, the rear
         cooling ducts see-through so the rear channels stay visible */
      const layer = (o.name || (o.parent && o.parent.name) || '').replace(/_\d+$/, '');
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      const base = CAD_OPACITY[layer] != null ? CAD_OPACITY[layer] : 1;
      o.material = new THREE.MeshStandardMaterial({ color: src && src.color ? src.color : 0xb8c0cc, metalness: 0.3, roughness: 0.62,
        side: THREE.DoubleSide, flatShading: true, transparent: true, opacity: base, depthWrite: base > 0.5 });
      o.material.userData.base = base;
      cadMats.push(o.material);
    });
    cad.add(root);
    applyHighlight();
    btn.disabled = false;
    setCad(true);
    resolve(true);
  }, ev => { if (ev.total) btn.textContent = 'CAD model: ' + Math.round(ev.loaded / ev.total * 100) + '%'; },
  err => { btn.textContent = 'CAD model unavailable'; console.warn(err); resolve(false); }));
}
const CAD_OPACITY = { duct: 0.12, trunk: 0.5 };
const cadMats = [];
/* With a cable selected the CAD model fades so the whole route shows. */
function cadGhost(on) {
  for (const m of cadMats) {
    m.opacity = on ? Math.min(m.userData.base, 0.16) : m.userData.base;
    m.depthWrite = m.opacity > 0.5;
  }
}
function setCad(on) {
  cad.visible = on; simple.visible = !on;
  const btn = document.getElementById('cadBtn');
  btn.textContent = on ? 'CAD model' : 'Simplified';
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

function buildRack(rack) {
  const depth = G.moduleDepth;
  for (const p of rack.parts) {
    const w = (p.x1 - p.x0) - 12, h = (p.y1 - p.y0) - 8;
    const d = p.z0 != null ? -p.z0 : p.kind === 'jb' ? 300 : depth;
    const m = box(w * MM, h * MM, d * MM, MAT[p.kind] || MAT.module, (p.x0 + p.x1) / 2 * MM, (p.y0 + p.y1) / 2 * MM, -d / 2 * MM);
    m.userData = { type: 'part', part: p };
    if (p.kind !== 'module') {
      const tag = document.createElement('div'); tag.className = 'lbl'; tag.textContent = p.id;
      for (const side of [1, -1]) {
        const o = new CSS2DObject(tag.cloneNode(true));
        o.position.set((p.x0 + p.x1) / 2 * MM, (p.y1 + 10) * MM, side > 0 ? 0.03 : ((p.z0 != null ? p.z0 : -depth) - 30) * MM);
        o.userData.side = side; scene.add(o); sideLabels.push(o);
      }
    }
  }
  /* posts, front and rear */
  const posts = guidePosts(rack), H = rack.height;
  for (const x of posts) for (const z of [8, -G.rackDepth]) box(0.03, H * MM, 0.03, MAT.frame, x * MM, H / 2 * MM, z * MM);
  /* horizontal fixing brackets at every row rail (rear) */
  for (const y of guideRails(rack)) box(rack.width * MM, 0.012, 0.035, MAT.bracket, rack.width / 2 * MM, (y - 14) * MM, G.zBracket * MM);
  /* vertical cable clamps on the rear posts */
  for (const x of posts) for (const y of guideRails(rack)) box(0.04, 0.03, 0.02, MAT.bracket, x * MM, (y + 90) * MM, (G.zClamp - 22) * MM);
  /* bottom panel (rear) */
  box(rack.width * MM, 0.008, 0.11, MAT.bracket, rack.width / 2 * MM, (G.bottomY - 10) * MM, (G.zClamp + 10) * MM);
  /* Signal Inter-Connection Panel(s) on the panel end: measured (3D racks) or
     the two plates of the DXF rack. The plate is drawn in `simple` (the CAD
     model has its own); an invisible copy stays pickable in both views. */
  const panels = rack.panels || GUIDE_PANELS.map(p => Object.assign({ x: G.panelX, z0: GUIDE_PANEL_Z.z0, z1: GUIDE_PANEL_Z.z1 }, p));
  for (const { x, y0, y1, z0, z1, label } of panels) {
    const pw = Math.abs(z1 - z0), pc = (z0 + z1) / 2, geo = new THREE.PlaneGeometry(pw * MM, (y1 - y0) * MM);
    const place = m => { m.rotation.y = Math.PI / 2; m.position.set(x * MM, (y0 + y1) / 2 * MM, pc * MM); return m; };
    simple.add(place(new THREE.Mesh(geo, MAT.panel)));
    const pick = place(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })));
    pick.userData = { type: 'panel', label: label };
    scene.add(pick); pickables.push(pick);
    const t = document.createElement('div'); t.className = 'lbl panel'; t.textContent = label.replace('Signal Inter-Connection Panel', 'Signal panel');
    const o = new CSS2DObject(t); o.position.set((x + SIDE * 40) * MM, (y1 + 25) * MM, pc * MM); scene.add(o);
  }
  /* vertical bracket beside the panel */
  box(0.02, 1.85, 0.02, MAT.bracket, G.panelRiserX * MM, 0.93, (G.zClamp - 25) * MM);
  for (const h of rack.holders || []) box(0.035, 0.024, 0.052, MAT.holder, h.x * MM, h.y * MM, h.z * MM);
  /* front linework from the DXF */
  simple.add(frontLines(rack));
  /* rear port panels */
  for (const p of rack.parts) if (GUIDE_REAR_PORTS[p.kind]) rearPanel(p);
  /* front DC sockets (SSC strip and junction boxes) */
  for (const p of rack.parts) if (GUIDE_FRONT_PORTS[p.kind] && !p.labels) for (const f of GUIDE_FRONT_PORTS[p.kind]) {
    const pos = guidePortPos(rack, { dev: p.id, port: f[0], front: true });
    addPort(p, { id: f[0], label: f[0], conn: 'DC' }, pos, true);
  }
  /* measured front plugs (3D racks) */
  /* measured rear sockets of parts without a technote panel figure (e.g. junction boxes): printed names in p.portLabels */
  for (const p of rack.parts) if (!GUIDE_REAR_PORTS[p.kind] && p.ports && p.portLabels) for (const id of Object.keys(p.portLabels))
    addPort(p, { id: id, label: p.portLabels[id], conn: 'other' }, p.ports[id], false);
  for (const p of rack.parts) if (p.ports && p.labels) for (const id of Object.keys(p.labels))
    addPort(p, { id: id, label: id + ' · ' + p.labels[id], conn: 'DC' }, p.ports[id], true);
}

function frontLines(rack) {
  let n = 0;
  for (const a of rack.lines) n += a.length / 2 - 1;
  const seg = 24;
  n += rack.circles.length * seg;
  const pos = new Float32Array(n * 6);
  let k = 0;
  const u = rack.lineUnit * MM, z = 0.004;
  for (const a of rack.lines) for (let i = 0; i + 3 < a.length; i += 2) {
    pos[k++] = a[i] * u; pos[k++] = a[i + 1] * u; pos[k++] = z; pos[k++] = a[i + 2] * u; pos[k++] = a[i + 3] * u; pos[k++] = z;
  }
  for (const c of rack.circles) for (let s = 0; s < seg; s++) {
    const t0 = s / seg * Math.PI * 2, t1 = (s + 1) / seg * Math.PI * 2;
    pos[k++] = (c[0] + c[2] * Math.cos(t0)) * u; pos[k++] = (c[1] + c[2] * Math.sin(t0)) * u; pos[k++] = z;
    pos[k++] = (c[0] + c[2] * Math.cos(t1)) * u; pos[k++] = (c[1] + c[2] * Math.sin(t1)) * u; pos[k++] = z;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0.85 }));
}

/* Rear face drawn like the technote panel figures. */
function rearPanel(p) {
  const list = GUIDE_REAR_PORTS[p.kind];
  const wmm = p.x1 - p.x0 - 12, hmm = p.y1 - p.y0 - 8;
  const W = 1024, H = Math.round(W * hmm / wmm);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#d7dde5'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#3a4659'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
  g.fillStyle = '#1b2433'; g.font = `700 ${Math.round(W / 26)}px Inter, Segoe UI, sans-serif`; g.textAlign = 'left';
  g.fillText(p.id + ' (rear)', 18, Math.round(W / 22));
  const fs = Math.round(W / (p.kind === 'msm' ? 58 : 44));
  g.font = `600 ${fs}px Inter, Segoe UI, sans-serif`; g.textAlign = 'center';
  const named = list.map(q => Object.assign({}, q, { label: (p.portLabels && p.portLabels[q.id]) || q.label }));
  for (const t of named) {
    const x = t.u * W, y = t.v * H;
    g.fillStyle = '#1b2433'; g.fillText(t.label, x, y - fs * 1.9);
    g.fillStyle = '#2b3445';
    if (t.conn === 'RJ45') g.fillRect(x - fs * 1.2, y - fs * 1.2, fs * 2.4, fs * 2.4);
    else { g.beginPath(); g.arc(x, y, fs * 1.25, 0, Math.PI * 2); g.fill(); }
  }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(wmm * MM, hmm * MM), new THREE.MeshBasicMaterial({ map: tex }));
  plane.rotation.y = Math.PI;
  plane.position.set((p.x0 + p.x1) / 2 * MM, (p.y0 + p.y1) / 2 * MM, ((p.z0 != null ? p.z0 : G.zFace) - 1.5) * MM);
  simple.add(plane);
  for (const t of named) addPort(p, t, guidePortPos(state.rack, { dev: p.id, port: t.id }), false);
}

function addPort(part, t, pos, front) {
  const round = t.conn !== 'RJ45';
  const geo = round ? new THREE.CylinderGeometry(0.011, 0.011, 0.02, 20) : new THREE.BoxGeometry(0.018, 0.018, 0.02);
  if (round) geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: front ? 0xc2410c : 0x1f2937, roughness: 0.5, metalness: 0.3 }));
  m.position.copy(v3(pos)).add(new THREE.Vector3(0, 0, front ? -0.005 : 0.01));
  m.userData = { type: 'port', dev: part.id, kind: part.kind, port: t.id, label: t.label, conn: t.conn };
  scene.add(m); portMeshes.push(m); pickables.push(m);
}

/* ---------------- cables ---------------- */
function roundedCurve(pts, r) {
  const path = new THREE.CurvePath();
  const P = pts.map(v3);
  let start = P[0].clone();
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const ab = b.clone().sub(a), bc = c.clone().sub(b);
    const rr = Math.min(r, ab.length() / 2, bc.length() / 2);
    const p1 = b.clone().sub(ab.normalize().multiplyScalar(rr)), p2 = b.clone().add(bc.normalize().multiplyScalar(rr));
    if (start.distanceTo(p1) > 1e-5) path.add(new THREE.LineCurve3(start, p1));
    if (rr > 1e-5) path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
    start = p2;
  }
  path.add(new THREE.LineCurve3(start, P[P.length - 1].clone()));
  return path;
}
class SubCurve extends THREE.Curve {
  constructor(base, a, b) { super(); this.base = base; this.a = a; this.b = b; }
  getPoint(t, out = new THREE.Vector3()) { return out.copy(this.base.getPointAt(this.a + (this.b - this.a) * t)); }
}
function tube(curve, radius, mat) {
  const len = curve.getLength();
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(6, Math.ceil(len / 0.015)), radius, 8, false), mat);
}

function buildCables() {
  const lanes = guideLanes(state.cables);
  for (const c of state.cables) {
    const legs = guideRoute(state.rack, c, lanes.get(c.id));
    state.routes.set(c.id, legs);
    const color = new THREE.Color(GUIDE_CATS[c.cat].color);
    const radius = c.cat === 'dc' ? 0.007 : c.cat === 'comm' || c.cat === 'ext' ? 0.0035 : 0.0045;
    const list = [];
    legs.forEach((leg, i) => {
      const curve = roundedCurve(leg.pts, 0.03);
      const mat = new THREE.MeshStandardMaterial({ color: leg.customer ? 0xbfc7d5 : color, roughness: 0.45, metalness: 0.1, transparent: true, opacity: 1, emissive: color, emissiveIntensity: 0 });
      const grp = new THREE.Group();
      if (leg.customer) {           /* customer-made cable: dashed */
        const n = Math.max(4, Math.round(curve.getLength() / 0.04));
        for (let s = 0; s < n; s += 2) grp.add(tube(new SubCurve(curve, s / n, Math.min(1, (s + 1) / n)), radius * 1.4, mat));
        const tag = document.createElement('div'); tag.className = 'lbl panel'; tag.textContent = c.to.ext;
        const o = new CSS2DObject(tag); o.position.copy(v3(leg.pts[leg.pts.length - 1])); o.visible = false; grp.add(o); grp.userData.tag = o;
      } else grp.add(tube(curve, radius, mat));
      if (leg.holder) {             /* inline connector in its holder */
        const end = v3(leg.pts[leg.pts.length - 1]);
        const conn = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.075, 16), MAT.conn); conn.rotation.z = Math.PI / 2; conn.position.copy(end).add(new THREE.Vector3((leg.side || SIDE) * 0.03, 0, 0)); grp.add(conn);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.002, 6, 20), new THREE.MeshBasicMaterial({ color: leg.extra ? 0xf59e0b : 0x22c55e })); ring.rotation.y = Math.PI / 2; ring.position.copy(conn.position); grp.add(ring);
        if (!state.rack.holders) box(0.02, 0.03, 0.03, MAT.holder, end.x - 0.012, end.y - 0.022, end.z);
      }
      grp.traverse(o => { if (o.isMesh && o.material === mat) { o.userData = { type: 'cable', id: c.id, leg: i }; pickables.push(o); } });
      scene.add(grp);
      list.push({ grp, mat, curve, leg });
    });
    cableMeshes.set(c.id, list);
  }
}

/* ---------------- highlight + player ---------------- */
const spark = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
spark.visible = false; scene.add(spark);
const glow = new THREE.PointLight(0x9fd3ff, 0.25, 0.35); spark.add(glow);

function applyHighlight() {
  const sel = state.sel;
  cadGhost(!!sel);
  for (const c of state.cables) {
    const visible = state.cats.has(c.cat);
    cableMeshes.get(c.id).forEach((e, i) => {
      e.grp.visible = visible || (sel && sel.id === c.id);
      if (!sel) { e.mat.opacity = 1; e.mat.emissiveIntensity = 0; if (e.grp.userData.tag) e.grp.userData.tag.visible = false; return; }
      const mine = sel.id === c.id;
      const cur = mine && i === state.step, done = mine && i < state.step;
      e.mat.opacity = mine ? (cur || done ? 1 : 0.35) : 0.07;
      e.mat.depthWrite = e.mat.opacity > 0.5;
      e.mat.emissiveIntensity = cur ? 0.9 : done ? 0.25 : 0;
      if (e.grp.userData.tag) e.grp.userData.tag.visible = mine && i <= state.step;
    });
  }
  for (const m of portMeshes) {
    const on = sel && ((sel.from.dev === m.userData.dev && sel.from.port === m.userData.port) || (sel.to.dev === m.userData.dev && sel.to.port === m.userData.port));
    m.material.emissive = new THREE.Color(on ? 0xffd166 : 0x000000);
    m.material.emissiveIntensity = on ? 1.2 : 0;
  }
}

let sparkT = 0;
function selectCable(id, opts) {
  const c = state.cables.find(x => x.id === id);
  state.sel = c || null; state.step = 0; sparkT = 0;
  renderCard(); renderList(); applyHighlight();
  if (c && !(opts && opts.keepCamera)) focusLeg(0, true);
  if (c && !(opts && opts.noplay)) play(true);
  try { history.replaceState(null, '', '#' + (c ? c.id : '')); } catch (e) { /* ignore */ }
}
function setStep(i) {
  if (!state.sel) return;
  const legs = state.routes.get(state.sel.id);
  state.step = Math.max(0, Math.min(legs.length - 1, i)); sparkT = 0;
  applyHighlight(); renderCard(); focusLeg(state.step);
}
let playTimer = null;
function play(on) {
  state.playing = on; clearTimeout(playTimer);
  renderCard();
  if (!on || !state.sel) return;
  const tick = () => {
    const legs = state.routes.get(state.sel.id);
    if (state.step >= legs.length - 1) { state.playing = false; renderCard(); return; }
    setStep(state.step + 1); playTimer = setTimeout(tick, 2600);
  };
  playTimer = setTimeout(tick, 2600);
}

/* camera tween */
let tween = null;
function flyTo(pos, target, ms) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms: reduceMotion ? 1 : (ms || 900) };
}
function focusLeg(i, wide) {
  const legs = state.routes.get(state.sel.id);
  const b = new THREE.Box3();
  (wide ? legs : [legs[i]]).forEach(l => l.pts.forEach(p => b.expandByPoint(v3(p))));
  const c = b.getCenter(new THREE.Vector3()), size = Math.max(b.getSize(new THREE.Vector3()).length(), 0.5);
  const front = state.sel.front;
  const leg = legs[i];
  let dir = new THREE.Vector3(front ? 0.25 : -0.35, 0.35, front ? 1 : -1);
  if (leg && (leg.holder || leg.customer) && !wide) dir = new THREE.Vector3(SIDE, 0.3, -0.45);
  flyTo(c.clone().add(dir.normalize().multiplyScalar(size * 1.25 + 0.4)), c);
}
const VIEWS = {
  rear: r => [new THREE.Vector3(r.width / 2 * MM + 0.8, 1.6, -5.4), new THREE.Vector3(r.width / 2 * MM, 1.15, -0.4)],
  front: r => [new THREE.Vector3(r.width / 2 * MM - 0.6, 1.5, 5.6), new THREE.Vector3(r.width / 2 * MM, 1.2, 0)],
  panel: r => { const x = G.panelX * MM, y = (r.holders && r.holders.length ? r.holders[0].y : 1400) * MM;
    return [new THREE.Vector3(x + SIDE * 1.7, y + 0.15, -0.9), new THREE.Vector3(x, y, -0.4)]; },
  msm: r => { const m = r.parts.find(p => p.id === 'MSM1') || r.parts.find(p => p.kind === 'msm'); if (!m) return VIEWS.iso(r); return [new THREE.Vector3((m.x0 + m.x1) / 2 * MM - 0.4, (m.y1 + 150) * MM, -2.4), new THREE.Vector3((m.x0 + m.x1) / 2 * MM, (m.y0 + m.y1) / 2 * MM - 0.1, -0.75)]; },
  iso: r => [new THREE.Vector3(SIDE < 0 ? -1.6 : r.width * MM + 1.6, 2.9, -3.6), new THREE.Vector3(r.width / 2 * MM, 1.0, -0.4)],
};
function setView(name) {
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  const [p, t] = VIEWS[name](state.rack); flyTo(p, t, 1100);
}

/* ---------------- UI ---------------- */
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function groupKey(c) {
  if (c.group) return '1 ' + c.group;
  if (c.cat === 'ext') return '0 Customer connections · Signal Inter-Connection Panel';
  if (c.id.startsWith('MSM-')) return '1 MSM';
  const s = c.id.split('-')[0];
  return '2 ' + s.padStart(5, ' ');
}
function renderChips() {
  $('chips').innerHTML = Object.entries(GUIDE_CATS).map(([k, v]) =>
    `<button class="chip" data-cat="${k}" aria-pressed="${state.cats.has(k)}"><i style="background:${v.color}"></i>${esc(v.label)}</button>`).join('');
  $('chips').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const k = b.dataset.cat; state.cats.has(k) ? state.cats.delete(k) : state.cats.add(k);
    renderChips(); renderList(); applyHighlight();
  });
}
function renderList() {
  const q = state.query.trim().toLowerCase();
  const items = state.cables.filter(c => state.cats.has(c.cat) && (!q || (c.title + ' ' + c.part + ' ' + c.id + ' ' + (c.to.ext || '')).toLowerCase().includes(q)));
  const groups = {};
  items.forEach(c => (groups[groupKey(c)] = groups[groupKey(c)] || []).push(c));
  const keys = Object.keys(groups).sort();
  $('list').innerHTML = keys.length ? keys.map(k => `<div class="group"><h3>${esc(k.slice(2).trim())}</h3>` + groups[k].map(c =>
    `<button class="item${state.sel && state.sel.id === c.id ? ' sel' : ''}" data-id="${c.id}"><i style="background:${GUIDE_CATS[c.cat].color}"></i><span>${esc(c.title)}<small>${esc(c.part)}</small></span></button>`).join('') + '</div>').join('')
    : '<p style="color:var(--muted);padding:10px">No cable matches.</p>';
  $('list').querySelectorAll('.item').forEach(b => b.onclick = () => selectCable(b.dataset.id));
}
function endName(e) {
  if (e.ext) return e.ext;
  return e.dev + ' · ' + (portLabel(e.dev, e.port) || e.port);
}
function portLabel(dev, port) {
  const p = state.rack.parts.find(x => x.id === dev); if (!p) return port;
  if (p.portLabels && p.portLabels[port]) return p.portLabels[port];
  if (p.labels && p.labels[port]) return port + ' (' + p.labels[port] + ')';
  const t = (GUIDE_REAR_PORTS[p.kind] || []).find(x => x.id === port);
  return t ? t.label : port;
}
function renderCard() {
  const c = state.sel, card = $('card');
  if (!c) { card.hidden = true; resize(); return; }
  const wasHidden = card.hidden;
  const legs = state.routes.get(c.id), cat = GUIDE_CATS[c.cat], conn = GUIDE_CONNECTORS[c.conn] || {};
  card.hidden = false;
  card.innerHTML = `
    <span class="badge" style="color:${cat.color}">${esc(cat.label)}</span>
    <h2>${esc(c.title)}</h2>
    <div class="sub">${esc(endName(c.from))} → ${esc(endName(c.to))}</div>
    <dl class="kv">
      <dt>Cable</dt><dd>${esc(c.part)}</dd>
      <dt>Connector</dt><dd>${esc(conn.name || c.conn)}</dd>
      <dt>Pins</dt><dd>${esc(conn.pins || '–')}</dd>
      ${(c.facts || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
      <dt>AYK supplies</dt><dd>${esc(c.supply)}</dd>
      ${c.customer ? `<dt>Customer</dt><dd>${esc(c.customer)}</dd>` : ''}
      <dt>Technotes</dt><dd>${c.tn.map(t => esc(t + ' ' + (TECHNOTES[t] || ''))).join('<br>')}</dd>
    </dl>
    <div class="player">
      <button class="btn" id="prev" aria-label="Previous step">◀</button>
      <button class="btn${state.playing ? ' on' : ''}" id="playBtn">${state.playing ? 'Pause' : (state.step >= legs.length - 1 ? 'Replay' : 'Play route')}</button>
      <button class="btn" id="next" aria-label="Next step">▶</button>
      <span class="grow"></span>
      <span style="color:var(--muted);font-size:12px">Step ${state.step + 1} of ${legs.length}</span>
      <button class="btn" id="close" aria-label="Close">✕</button>
    </div>
    <ol class="steps">${legs.map((l, i) => `<li data-i="${i}" class="${i === state.step ? 'cur' : i < state.step ? 'done' : ''}${l.customer ? ' cust' : ''}">${esc(l.rule)}<span class="tn">${esc(l.tn)}</span></li>`).join('')}</ol>`;
  $('prev').onclick = () => { play(false); setStep(state.step - 1); };
  $('next').onclick = () => { play(false); setStep(state.step + 1); };
  $('playBtn').onclick = () => { if (state.playing) play(false); else { if (state.step >= legs.length - 1) setStep(0); play(true); } };
  $('close').onclick = () => { play(false); selectCable(null); };
  card.querySelectorAll('.steps li').forEach(li => li.onclick = () => { play(false); setStep(+li.dataset.i); });
  const cur = card.querySelector('.steps li.cur'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  if (wasHidden) resize();
}
function renderPortCard(u) {
  play(false); state.sel = null; applyHighlight(); renderList();
  const using = state.cables.filter(c => (c.from.dev === u.dev && c.from.port === u.port) || (c.to.dev === u.dev && c.to.port === u.port));
  const note = GUIDE_PORT_NOTES[u.kind + '.' + u.port] || (u.kind === 'msm' && /^SSC\dB$/.test(u.port) ? GUIDE_PORT_NOTES['msm.SSCxB'] : '');
  const conn = GUIDE_CONNECTORS[u.conn];
  const card = $('card'); card.hidden = false;
  card.innerHTML = `<span class="badge" style="color:var(--blue)">Port</span><h2>${esc(u.dev)} · ${esc(u.label)}</h2>
    <div class="sub">${esc(conn ? conn.name : u.conn)}</div>
    ${using.length ? '<p style="margin:0 0 6px">Cable on this port:</p>' + using.map(c => `<button class="item" data-id="${c.id}"><i style="background:${GUIDE_CATS[c.cat].color}"></i><span>${esc(c.title)}<small>${esc(c.part)}</small></span></button>`).join('')
      : `<p style="color:var(--muted)">${esc(note || 'No cable on this port in this rack.')}</p>`}
    <div class="player"><span class="grow"></span><button class="btn" id="close">✕</button></div>`;
  card.querySelectorAll('.item').forEach(b => b.onclick = () => selectCable(b.dataset.id));
  $('close').onclick = () => { card.hidden = true; resize(); };
  resize();
}

/* picking */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let downAt = null;
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(pickables, false).filter(h => {
    const u = h.object.userData;
    if (u.type !== 'cable') return h.object.visible;
    const c = state.cables.find(x => x.id === u.id);
    return state.cats.has(c.cat) && (!state.sel || state.sel.id === c.id || cableMeshes.get(c.id)[0].mat.opacity > 0.2);
  });
  return hits.length ? hits[0].object.userData : null;
}
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const u = pick(e);
  if (!u) return;
  if (u.type === 'cable') { if (!state.sel || state.sel.id !== u.id) selectCable(u.id, { keepCamera: true }); else { play(false); setStep(u.leg); } }
  else if (u.type === 'port') renderPortCard(u);
});
renderer.domElement.addEventListener('pointermove', e => {
  const tip = $('tip');
  if (e.buttons) { tip.style.display = 'none'; return; }
  const u = pick(e);
  if (!u) { tip.style.display = 'none'; renderer.domElement.style.cursor = ''; return; }
  const r = host.getBoundingClientRect();
  let text = '';
  if (u.type === 'port') text = `<b>${esc(u.dev)} · ${esc(u.label)}</b><br><span style="color:var(--muted)">${esc((GUIDE_CONNECTORS[u.conn] || {}).name || u.conn)}</span>`;
  else if (u.type === 'cable') { const c = state.cables.find(x => x.id === u.id); text = `<b>${esc(c.title)}</b><br><span style="color:var(--muted)">${esc(c.part)}</span>`; }
  else if (u.type === 'panel') text = `<b>${esc(u.label)}</b><br><span style="color:var(--muted)">Inline connectors snap into holders here</span>`;
  tip.innerHTML = text; tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 290) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px';
  renderer.domElement.style.cursor = u.type === 'panel' ? '' : 'pointer';
});

document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$('search').oninput = e => { state.query = e.target.value; renderList(); };
$('aboutBtn').onclick = () => { const a = $('about'); a.hidden = !a.hidden; $('aboutBtn').setAttribute('aria-expanded', String(!a.hidden)); };
addEventListener('keydown', e => {
  if (!state.sel || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') { play(false); setStep(state.step + 1); }
  if (e.key === 'ArrowLeft') { play(false); setStep(state.step - 1); }
  if (e.key === 'Escape') { play(false); selectCable(null); }
});

/* ---------------- loop ---------------- */
const sideLabels = [];
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();
  if (tween) {
    const k = Math.min(1, (performance.now() - tween.start) / tween.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (k >= 1) tween = null;
  }
  controls.update();
  const rearSide = camera.position.z < -0.4;
  for (const o of sideLabels) o.visible = (o.userData.side < 0) === rearSide;
  if (state.sel) {
    const e = cableMeshes.get(state.sel.id)[state.step];
    if (e) {
      sparkT = reduceMotion ? 1 : (sparkT + dt / Math.max(0.6, e.curve.getLength() * 1.4)) % 1;
      spark.position.copy(e.curve.getPointAt(sparkT)); spark.visible = true;
      e.mat.emissiveIntensity = 0.55 + 0.45 * Math.sin(performance.now() / 180);
    }
  } else spark.visible = false;
  renderer.render(scene, camera); labels.render(scene, camera);
}

/* rack picker: assets/guide/racks.json (published) + projects/racks.local.json
   (local only, git-ignored: confidential project racks, {id, label, url}) */
async function rackList() {
  const get = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : []; } catch (e) { return []; } };
  return (await get('assets/guide/racks.json')).concat(await get('projects/racks.local.json'));
}
let TECHNOTES = GUIDE_TECHNOTES;
async function rackPicker() {
  const sel = $('rackSel');
  try {
    const list = await rackList();
    sel.innerHTML = list.map(x => `<option value="${esc(x.id)}"${x.id === RACK ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
    sel.hidden = list.length < 2;
    sel.onchange = () => { location.search = '?rack=' + encodeURIComponent(sel.value); };
  } catch (e) { sel.hidden = true; }
}

/* ---------------- start ---------------- */
(async function start() {
  try {
    const entry = (await rackList()).find(x => x.id === RACK);
    const res = await fetch(entry && entry.url ? entry.url : 'assets/guide/' + encodeURIComponent(RACK) + '.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.rack = await res.json();
  } catch (err) {
    $('loading').textContent = 'Could not load the rack (' + err.message + '). Open it through a local web server (see README), not as a file.';
    return;
  }
  const r = state.rack;
  G = guideGeom(r); SIDE = G.panelSide || -1;
  TECHNOTES = Object.assign({}, GUIDE_TECHNOTES, r.technotes || {});
  $('title').textContent = 'Rack ' + r.name + ' · customer wiring guide';
  rackPicker();
  state.cables = guideCables(r);
  resize();
  buildRack(r);
  buildCables();
  $('cadBtn').onclick = () => setCad(!cad.visible);
  loadCad(r);
  renderChips(); renderList(); applyHighlight();
  const counts = {}; r.parts.forEach(p => { counts[p.kind] = (counts[p.kind] || 0) + 1; });
  $('about').innerHTML = `<b>Rack ${esc(r.name)}</b> from <i>${esc(r.source)}</i> (${r.from === 'step' ? 'SolidWorks 3D model' : 'front view, scale 1:' + r.scale}). ${counts.ssc || 0} SSCs, ${counts.acdp || 0} ACDPs, ${counts.msm || 0} MSM, ${counts.jb || 0} junction boxes, ${counts.module || 0} modules; ${state.cables.length} cables.
    Routes follow ${Object.keys(TECHNOTES).join(', ')}.<br><b>Draft assumptions</b><ul>${(r.assumptions || GUIDE_ASSUMPTIONS).map(a => '<li>' + esc(a) + '</li>').join('')}</ul>`;
  $('loading').remove();
  const [p, t] = VIEWS.rear(r); camera.position.copy(p); controls.target.copy(t);
  loop();
  const fromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && state.cables.some(c => c.id === id) && (!state.sel || state.sel.id !== id)) selectCable(id, { noplay: true });
  };
  fromHash();
  addEventListener('hashchange', fromHash);
})();
