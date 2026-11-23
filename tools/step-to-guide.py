"""Builds the 3D wiring guide's CAD layer from a SolidWorks STEP export.

  assets/guide/<name>.glb         the rack, fasteners dropped, meshes decimated and
                                  merged per layer (module, ssc, msm, frame, duct ...)
  assets/guide/<name>.parts.json  measured devices, connectors, panel holders and
                                  posts (mm) for tools/make-guide-rack.js --step

Frame: the STEP's own (SolidWorks) frame, which for the AYK rack subassemblies is
already the guide frame: x to the right seen from the front, y up, z = 0 at the
front face of the modules, negative towards the rear. GLB units are metres.

Needs Python 3.10+ with:  pip install cascadio trimesh numpy fast-simplification
Run from the repo root:
  python tools/step-to-guide.py "<path>/A2045601 S10195 Rack_Subassembly_1.STEP" s10195-r1
then:
  node tools/make-guide-rack.js --step assets/guide/s10195-r1.parts.json s10195-r1
"""
import json
import os
import re
import sys
import tempfile

import numpy as np
import trimesh

try:
    import fast_simplification
except ImportError:  # decimation is optional
    fast_simplification = None

DROP = re.compile(r'^F\d{4}|PEM|Rivet|Nut_|_Nut|Screw|Button_Head|Socket_Head|Seal_Gasket|Spacer|P4057601|P0678|P4067801', re.I)

# layer -> (name patterns, colour). First match wins; the rest goes to "misc".
LAYERS = [
    ('module', [r'A96AA'], '#8c97a8'),
    ('conn_dc', [r'Power_Conncector'], '#d9622b'),
    ('estop', [r'Estop'], '#d23a3a'),
    ('conn', [r'P0595', r'P0577', r'P0598', r'P4267901', r'LP-16'], '#20252d'),
    ('ssc', [r'P0414', r'P0684', r'P0208', r'P0194', r'P0196'], '#3d5a80'),
    ('msm', [r'P4138703', r'P41388', r'P4161301', r'^000_', r'P4019601'], '#2c3e66'),
    ('acdp', [r'P4193201', r'P4195801'], '#4b5d73'),
    ('jb', [r'P4303702', r'P4303802'], '#5b6b7f'),
    ('panel', [r'P4591901', r'P4302201'], '#8b5cf6'),
    ('trunk', [r'Cable_Trunk', r'Cable_Support'], '#2f3642'),
    ('duct', [r'Cooling_Duct', r'_Duct', r'Duct_', r'P4396401', r'P4473501', r'P4473601', r'P4239'], '#39424f'),
    ('frame', [r'Rack Vertical', r'P4578001', r'Rack_Bottom', r'Top Cover', r'P4578101', r'P4329601', r'P4249604'], '#56606e'),
]
FACE_CAP = 500           # decimate any single part above this many faces


def layer_of(name):
    for layer, pats, _ in LAYERS:
        if any(re.search(p, name) for p in pats):
            return layer
    return 'misc'


def base_name(g):
    return re.sub(r'(_\d+)+$', '', g)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, name = sys.argv[1], sys.argv[2]
    out_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'guide')
    os.makedirs(out_dir, exist_ok=True)

    import cascadio
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, 'raw.glb')
        cascadio.step_to_glb(src, raw, tol_linear=1.0, tol_angular=0.5)
        sc = trimesh.load(raw, force='scene')

    items = []          # (geom name, layer, mesh in world metres)
    for node in sc.graph.nodes_geometry:
        T, g = sc.graph[node]
        m = sc.geometry[g]
        if not isinstance(m, trimesh.Trimesh) or len(m.faces) == 0:
            continue
        w = trimesh.Trimesh(m.vertices, m.faces, process=False)
        w.apply_transform(T)
        w.merge_vertices()
        items.append((g, layer_of(g), w))

    # ---------- measured parts (mm) ----------
    def bb(m):
        lo, hi = m.bounds * 1000.0
        return [round(float(v), 1) for v in (*lo, *hi)]

    found = []
    for g, layer, m in items:
        b = bb(m)
        found.append({'name': base_name(g), 'layer': layer, 'box': b})
    with open(os.path.join(out_dir, name + '.parts.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'format': 'wireflow-step-parts', 'version': 1, 'source': os.path.basename(src), 'units': 'mm',
            'bounds': [round(float(v) * 1000, 1) for v in sc.bounds.flatten()],
            'items': [x for x in found if not DROP.search(x['name'])],
        }, f, ensure_ascii=False)

    # ---------- display mesh ----------
    per = {}
    kept = faces_in = 0
    for g, layer, m in items:
        if DROP.search(g):
            continue
        faces_in += len(m.faces)
        if len(m.faces) > FACE_CAP and fast_simplification is not None:
            try:
                v, f = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32),
                                                    target_reduction=1.0 - FACE_CAP / len(m.faces))
                if len(f):
                    m = trimesh.Trimesh(v, f, process=False)
            except Exception as e:  # keep the full mesh
                print('  decimation skipped for', g, e)
        per.setdefault(layer, []).append(m)
        kept += 1

    out = trimesh.Scene()
    colours = {l: c for l, _, c in LAYERS}
    colours['misc'] = '#7b8594'
    faces_out = 0
    for layer, meshes in per.items():
        mesh = trimesh.util.concatenate(meshes)
        mesh.remove_unreferenced_vertices()
        c = colours[layer].lstrip('#')
        rgba = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [1.0]
        mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=layer, baseColorFactor=rgba, metallicFactor=0.3, roughnessFactor=0.6))
        out.add_geometry(mesh, node_name=layer, geom_name=layer)
        faces_out += len(mesh.faces)
        print(f'  {layer:8s} {len(meshes):4d} parts {len(mesh.faces):7d} faces')
    glb = os.path.join(out_dir, name + '.glb')
    out.export(glb, include_normals=False)
    print(f'{kept} parts, faces {faces_in} -> {faces_out}, layers {sorted(per)}')
    print('written', glb, round(os.path.getsize(glb) / 1e6, 1), 'MB')


if __name__ == '__main__':
    main()
