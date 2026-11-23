---
name: wirelens
description: Build and extend Wirelens, the interactive 3D customer wiring guide for AYK battery racks (three.js page + technote routing rules). Use when adding a rack from a SolidWorks STEP or DXF, changing cable/routing rules from the AYK technotes, or fixing the 3D viewer.
---

# Wirelens: working knowledge

Project root: `G:\WiringTool\Wirelens` (copied from WireFlow's `wiring-guide.html`).
Run: `python -m http.server 8090 --bind 127.0.0.1` in the root, then open `http://127.0.0.1:8090/?rack=<id>`.
Test: `node tests/guide.test.js` (53 checks). Keep it green; add checks for every new rack.

## Conventions
- Pure front end, no build. Classic script `js/guide-data.js` (globals, `module.exports` for Node) loads before the ES module `js/guide3d.js`.
- three.js **0.160.0** via importmap from jsDelivr: OrbitControls, CSS2DRenderer, GLTFLoader.
- Engine code (guide-data.js) is deterministic, pure and in **mm**. The scene is in metres (`MM = 0.001`).
- English-only UI. Commit only when the user asks.
- Frame: x to the right **seen from the front**, y up, z = 0 at the module front faces, negative towards the rear. The AYK SolidWorks frame already matches this, so the GLB matrix is the identity.

## Technotes (in `technotes/`, all rev 02)
- TN0159 230 VAC control power (ACDP)
- TN0160 SSC rack wiring
- TN0162 string to bus (DC, front)
- TN0163 MSM rack wiring
- DWG2527 S10195 electrical connection diagram
- TN0164 fire fighting is **out of scope** (user decision)

## Port naming: preserve exactly (user requirement, 23 Nov 2026)
Port labels in the UI, cable titles, cards and tooltips must be the names **printed on the hardware / technote panel figures, character for character**. Never reword, add spaces or "fix" spelling. Internal ids (`ExtHVIL`, `RemoteE`, `ACInP`) are code only and never shown.
- **SSC** (TN0160 rear panel): `PowerP` `PowerB` `CommP` `CommB` `Ext-HVIL` `Cooling Fan` `Estop`
- **ACDP** (TN0159 Fig. 2): `SSC3 B` `SSC3 P` `SSC2 B` `SSC2 P` `SSC1 B` `SSC1 P` `MSM B` `MSM P` `AC PowerIn B` `AC PowerIn P`
- **MSM** (TN0163 rear panel): `Cloud` `EMS` `PCS` `Spare` `SSC 1P`…`SSC 9B` `Estop1`…`Estop9` `DryContact` `Ex.FanFB` `RemotE` `PowerP` `PowerB` `Valve1` `Valve2`
- Note: the technote body text says "RemoteE", "Power Primary" and "Comm P.", but the panel prints `RemotE`, `PowerP` and `CommP`. The printed panel wins.
- `tests/guide.test.js` checks every label against these lists. A new rack or device with other printed names needs the figure, and the list updated.
- Front DC: TN0162 names the plugs "Power Plug A/B/C/D". The DC port ids `B+`/`B-`/`P1+`… are ours. Show the plug letter as printed on the socket.

## Cable rules (`guideCables`, 66 cables for 9 SSC / 3 ACDP / 1 MSM / 5 JB)
- **AC P/B:** ACDP `SSCnP/B` → SSC PowerP/B. Each ACDP feeds 3 SSCs (exact least-distance branch-and-bound, cap 3). ACDP1 `MSMP/B` → MSM.
- **Comm:** MSM `SSCnP` → SSCn CommP (RJ45). MSM `SSCnB` is not wired. SSC CommB is shown unwired with a "confirm" note (TN0160 and TN0163 conflict).
- **E-stop:** MSM `Estopn` → SSCn Estop (LP16-4).
- **DC (front, TN0162):** SSC → junction box (cap 2 SSCs per JB, P1/P2). Plug letter and colour must match: SSC plug C ↔ JB plug C, D ↔ D. Lock out inverter power first.
- **Customer, via the Signal Inter-Connection Panel:**
  - Each ACDP AC PowerIn P/B: 2 mm pad, LP16-3.
  - MSM Cloud / EMS / PCS: 5 mm pad, RJ45.
  - MSM RemotE: LP16-4R, 10k/1k NC E-stop network. Without a remote E-stop, AYK supplies a 1 kΩ plug.
  - The customer cable is drawn dashed.
- **Numbering (AYK rule, `cadProposeNumbers`):** MSM1 left to right. SSC1 / ACDP1 = the one closest to MSM1. JBs left to right.

## Routing rules (`guideRoute`, legs = {rule, tn, pts, holder?, customer?})
- **MSM (TN0163):** service loop over the top, fixed only at the loop-back clip, then the horizontal fixing bracket.
- **SSC (TN0160):** up from the rear port, over the top, down the side bracket nearest the destination, through the grommet, to that side's clamp.
- **ACDP (TN0159):** to the left or right side sheet metal with cable ties.
- **Between devices:** vertical clamps on the posts. The two ends share a post when they can. Otherwise use the horizontal bracket or tray at the nearest rail. The destination end gets the same rules reversed, prefixed "At <dev>:".
- **To the customer:** down the clamps, along the bottom panel, up the riser beside the panel, into the holder, then the customer cable (down the cable trunk on 3D racks).
- **3D racks (`geom.slotRouting`):** runs behind a device use z = rear face − 45 and stay under `slotTop` (the part above). The modules plug into the rear cooling ducts, so there is no space behind them. Vertical runs at `zClamp` on the rear posts. Horizontal runs in the bottom or top rear tray (`geom.rails`).
- Lanes (`guideLanes`) offset parallel cables by ±9 mm.

## Rack data (`assets/guide/<id>.json`)
- Common fields: `{name, source, width, height, columns, parts:[{id,kind,x0,y0,x1,y1}], lines, circles}`.
- 3D racks add:
  - per part: `z0, z1, slotTop, ports{id:[x,y,z]}, labels{id:'plug C'}`
  - `geom` overriding `GUIDE_GEOM` (via `guideGeom(rack)`): postX0, postPitch, zClamp, zBracket, rails, bottomY, panelSide ±1, panelX, panelRiserX, slotRouting
  - `panels`, `holders` (used in order: power first, then comm; overflow → `extra:true`, orange ring, "confirm" note)
  - `trunk`
  - `model {url, matrix}`, `assumptions[]`
- `assets/guide/racks.json` feeds the header picker. The default rack is in `js/guide3d.js` (`RACK`).

## Adding a rack
1. **Preferred input: SolidWorks STEP (AP203/AP214), whole assembly in one file.** SolidWorks GLB export fails on big assemblies. Its export is also often newer than the local SW2021: error 8192 = future version.
2. `python tools/step-to-guide.py <file.STEP> <id>`
   - Needs `cascadio`, `trimesh`, `numpy`, `fast-simplification`. Run in a venv and use `python -I` on untrusted files.
   - It drops fasteners and gaskets, decimates to ≤500 faces per part, and merges into one mesh per layer: module, ssc, msm, acdp, jb, conn, conn_dc, estop, panel, trunk, duct, frame, misc. About 7 MB for S10195.
3. `node tools/make-guide-rack.js --step assets/guide/<id>.parts.json <id>`. It prints counts and warnings: fix any `!` lines.
4. Add the rack to `racks.json`, add tests, and check it in the browser (Rear, Front, Signal panel, MSM, Overview, plus one cable of each category).

Part numbers recognised (S10195; a new rack type may need new patterns in **both** tools):

| Part | Part numbers |
|---|---|
| Module | `A96AA` |
| SSC | `P0414-01` (body) + `P0684-02` (base) |
| SSC rear sockets | `P0595` LP16, `P0577` RJ45, `P0598` fan. 7 per SSC, read right→left from the front = TN0160 order: PowerP, PowerB, CommP, CommB, ExtHVIL, CoolingFan, Estop |
| SSC front plugs | `Power_Conncector_360_A/B/C/D` (C = BUS+, D = BUS−) |
| MSM | `P4138703` + `P41388` (top plate) |
| ACDP | `P4193201-a` (rear face only about 151 mm deep) |
| JB | `P4303702`, with front plugs `P4018902` = C and `P4019002` = D |
| Panel | `P4591901` |
| Holders | `P4302201` |
| Cable trunk | `P4278301` |
| Rear posts | `P4578001` |
| Trays | `P4473601` (bottom), `P4473501` (top) |

The demo project has 4 rack types. **All of them use the same SSC and MSM models** (user, 23 Nov 2026), so the SSC/MSM patterns and the SSC rear-socket mapping above apply to every rack. Only the layout, the ACDP/JB/panel parts and the counts can differ.

DXF fallback (front view only): `node tools/make-guide-rack.js <dxf> <id> --scale 50`. It needs TEACH boxes, and possibly MANUAL parts, per rack in that file.

## S10195 facts
- **Rack 1** (`s10195-r1`, STEP A2045601 Subassembly_1):
  - 12 columns of 500 mm, 108 modules, 9 SSCs, 3 ACDPs, **2 MSMs**, 5 JBs.
  - Panel on the **right** end from the front: y 1140–1458, 8 holders in 2 rows of 4.
- **Rack 2** (`s10195`, DXF A2045701 Subassembly_2): a different layout, 1 MSM. The panel side is assumed left.
- **Open points (left as drafted, user 23 Nov 2026):**
  - MSM2 is unwired.
  - 10 customer connections vs 8 holders (2 extras flagged).
  - The CAD MSM has 12 RJ45 + 10 round sockets, so MSM/ACDP ports use the technote figure.

## Viewer gotchas
- CSS2DRenderer sets a z-index on each label, so `#view` needs `z-index: 0` or the labels cover the info card.
- The CAD fades (`cadGhost`) while a cable is selected. The duct layer is always at 0.12 opacity.
- Use flat shading for the CAD (the GLB has no normals).
- `camera.setViewOffset` keeps the subject clear of the card.
- Must be served over http (it fetches JSON and GLB).

## Other rack families and confidential projects
`python -I tools/step-to-guide.py --profile <project>/step-profile.json --axes yzx --face-cap 300 --hull <STEP> <id> <out_dir>`
- `--profile <file.json>`: `{"drop": "<extra regex>", "layers": [[layer, [name regexes], "#colour"], ...]}` for racks whose part numbers differ.
  Keep a confidential project's profile in its git-ignored folder, never in `tools/`.
- `--axes`: when the STEP frame is not the guide frame. `yzx`: x = depth, y = along, z = up. `-zyx`: y = up, z = along, x = depth.
  The model is then shifted so x, y start at 0 and z = 0 at the module front faces.
- `--hull` (needs scipy): convex hull for parts still > 3x the face cap after decimation (connectors, fasteners): about 19 MB -> 8 MB.
- **Confidential projects live in `projects/<name>/` (git-ignored; the GitHub repo is public).** No project names, part numbers or
  banks in committed files. The viewer lists them through `projects/racks.local.json` [{id, label, url}] (git-ignored);
  the public picker only reads `assets/guide/racks.json`.
- Project racks can carry: `rack.cables` (explicit list, used as-is by `guideCables`), `cable.facts` [[label, value]] (card rows),
  `cable.holder` {x,y,z,pad,panel,n,pn,side?,riserX?}, `cable.holderTn` (technote cited on the holder/customer steps), `cable.group`
  (list heading), holder-only cables (no `from.dev`), `rack.technotes` (extra technote names), `part.portLabels` (printed names
  overriding the technote figure). Cable categories `hvil` and `valve`.
- `geom.sideView: 'rear'`: route texts name left/right as seen from the rear (geometry stays in the front-view frame).
  Per-holder `side` / `riserX` for racks with panels on both sides; `geom.directPanel` runs along the post straight to the panel.

## Other agents
`AGENTS.md` (root) is the shared guide for Cursor/Grok, ChatGPT/Codex and Gemini; `skills/wirelens/SKILL.md` is a copy of this file.
Keep both in sync after editing (`Copy-Item .claude/skills/wirelens/SKILL.md skills/wirelens/SKILL.md`).
