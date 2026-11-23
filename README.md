# Wirelens

Interactive 3D wiring guide for AYK battery racks. Pick a cable and it lights up,
then **Play route** walks it step by step along the technote rules (TN0159, TN0160,
TN0162, TN0163) to the Signal Inter-Connection Panel.

Pure front end: no build step. three.js 0.160.0 loads from jsDelivr, so the page
needs internet access.

## Run

```powershell
cd G:\WiringTool\Wirelens; python -m http.server 8090 --bind 127.0.0.1
```

Then open http://127.0.0.1:8090/. Use `?rack=<id>` to pick a rack, and
`#<cable-id>` to open on one cable, e.g. `#SSC3-comm`.

## Structure

```
index.html              the page
js/guide-data.js        technote rules, ports, cable list, router (pure, Node-testable)
js/guide3d.js           three.js scene and interaction
js/cad.js               DXF reader, part recognition, AYK numbering (used by the tools)
assets/guide/           racks: <id>.json (+ <id>.glb CAD model) and racks.json (picker list)
tools/step-to-guide.py  SolidWorks STEP -> <id>.glb + <id>.parts.json
tools/make-guide-rack.js  rack JSON from a DXF, or from parts.json with --step
tests/guide.test.js     node tests/guide.test.js
technotes/              source PDFs (TN0164 fire fighting is out of scope)
docs/wiring-guide-3d.md routing rules, assumptions, open points
```

## Add a rack (STEP, preferred)

```powershell
python tools/step-to-guide.py "<rack>.STEP" <id>
node tools/make-guide-rack.js --step assets/guide/<id>.parts.json <id>
```

Then add `<id>` to `assets/guide/racks.json`. The Python tool needs
`pip install cascadio trimesh numpy fast-simplification`.
