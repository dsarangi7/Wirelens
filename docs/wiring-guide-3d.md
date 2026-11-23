# 3D customer wiring guide (draft v2)

`wiring-guide.html` is an interactive 3D page for customers. They pick a cable
(or click a port or cable in the model), it lights up, and **Play route** walks
along it one technote step at a time. The camera follows each leg and the rule
and technote number are shown next to the model.

Open: `wiring-guide.html` (default rack `s10195-r1`; the header has a rack
picker fed by `assets/guide/racks.json`), or
`wiring-guide.html?rack=<name>#<cable-id>` to open straight on one cable
(e.g. `#SSC3-comm`). It must be served over http (it fetches the rack JSON).

## Racks

| Rack | Source | What is measured |
|---|---|---|
| `s10195-r1` (default) | SolidWorks STEP of `A2045601 S10195 Rack_Subassembly_1` | everything in 3D: devices and their rear faces, the SSC rear sockets, the front DC plugs (letters A–D), posts, rear trays, the Signal Inter-Connection Panel with its 8 holders, the cable trunk |
| `s10195` | front-view DXF of `A2045701 S10195 Rack_Subassembly_2` | front view only; the rear is generated from the technote rules |

The two are different racks of S10195 (different device layouts), not two
versions of one rack.

### 3D racks from a SolidWorks STEP

1. In SolidWorks: **File → Save As → STEP AP203/AP214**, one file for the whole
   assembly. (GLB export from SolidWorks is not needed, and it often fails on
   big assemblies.)
2. `python tools/step-to-guide.py "<file>.STEP" <name>` (needs
   `pip install cascadio trimesh numpy fast-simplification`). It writes
   `assets/guide/<name>.glb`, where fasteners and gaskets are dropped, parts are
   decimated, and the parts are merged into one mesh per layer (`module`, `ssc`, `msm`, `acdp`, `jb`,
   `conn`, `conn_dc`, `estop`, `panel`, `trunk`, `duct`, `frame`, `misc`). It
   also writes `assets/guide/<name>.parts.json` (the measured boxes).
3. `node tools/make-guide-rack.js --step assets/guide/<name>.parts.json <name>`
   writes the rack JSON (`tools/guide-rack-step.js`): AYK numbering, measured
   ports, `geom` (posts, clamp depth, tray heights, panel side), `panels`,
   `holders`, `trunk`, `model` (GLB URL and an identity matrix: the AYK
   SolidWorks frame already has x to the right from the front, y up, z = 0 at the
   module fronts).
4. Add the rack to `assets/guide/racks.json`.

Parts are recognised by AYK part number (e.g. `P0414-01` SSC, `P4138703` MSM,
`P4193201-a` ACDP, `P4303702` junction box, `P4302201` connector holder,
`P4591901` panel). A rack with other part numbers needs those patterns in both
tools.

In the viewer the CAD model fades while a cable is selected, so the whole route
shows through it. The rear cooling ducts are always see-through. **CAD model /
Simplified** switches to the box model.

## What it shows

- **The rack, from the AYK front-view DXF** (rack `s10195`). `tools/make-guide-rack.js`
  parses the drawing with `js/cad.js`, scales it to millimetres, and recognises
  the parts with the same teach/refine/find functions as the app. It writes
  `assets/guide/<name>.json`: parts, columns and the front linework, which is
  drawn on the front faces in 3D.
  - S10195 (`A2045701 S10195 Rack_Subassembly_2.DXF`, 1:50): 9 SSCs, 3 ACDPs,
    1 MSM, 5 junction boxes and 108 modules.
  - Hand-placed parts are marked `manual`: the SSC and ACDP under the MSM, and
    the top module row.
- **The rear side, generated from the technote rules:**
  - posts
  - horizontal fixing brackets at every module rail
  - vertical cable clamps on the posts
  - the bottom panel
  - the Signal Inter-Connection Panel: power holders (2 mm pad) and
    communication holders (5 mm pad)
  - rear port panels laid out like the technote figures
- **Every customer-relevant cable**, 66 on S10195 (`js/guide-data.js`):

| Cables | From → to | Technotes |
|---|---|---|
| AC power P / B | ACDP SSCn P/B → SSC Power P/B; ACDP1 MSM P/B → MSM | TN0159, TN0160, TN0163 |
| Communication | MSM SSC n P → SSC n Comm P (the B ports stay unwired) | TN0160, TN0163 |
| E-stop | MSM Estop n → SSC n Estop | TN0160, TN0163 |
| DC bus (front) | SSC B+ / B− → junction box P1/P2 ± | TN0162 |
| Customer | ACDP AC PowerIn P/B, MSM Cloud / EMS / PCS / RemotE → inline connector on the Signal Inter-Connection Panel → customer cable (dashed) | TN0159, TN0163 |

## Routing rules (`guideRoute`)

Each route is a list of legs; each leg carries its rule text and technote.

- **MSM** (TN0163): a service loop over the top of the MSM, fixed only at the
  loop-back clip. Then along the horizontal fixing bracket.
- **SSC** (TN0160): up from the rear port and over the top of the SSC. Then
  down the side bracket nearest the destination, through the grommet, to that
  side's cable clamp.
- **ACDP** (TN0159): to the left or right side sheet metal, with cable ties.
- **Between devices:** along the vertical clamps, then the horizontal bracket
  at the nearest rail, then the destination's rule in reverse ("At SSC5: …").
- **To the customer:** down the clamps, along the bottom panel, up the vertical
  bracket beside the Signal Inter-Connection Panel, and into the holder. The
  customer's cable leaves from there (on 3D racks, drawn down the cable trunk
  at the panel end).
- **3D racks (`geom.slotRouting`):** the run behind a device stays in its own
  slot, behind the device's rear face and under the part above (the modules
  plug into the rear cooling ducts, so there is no room behind them). Vertical
  runs are on the rear posts. Horizontal runs between posts are in the bottom or
  top rear tray. SSC and junction-box DC plugs are matched by letter (C ↔ C,
  D ↔ D).
- **DC** (TN0162): lock out the inverter power first, then match each plug's
  letter and colour, running up the front of the column.

## Assignments

- SSC1 / ACDP1 is the one closest to the MSM (`cadProposeNumbers`).
- ACDP → SSC (3 each) and junction box → SSC (2 each) are an exact
  least-total-distance assignment, so the result is the same on every run.

## Open points on rack 1 (also listed under "About this model")

- It has **two MSMs**. MSM1 is wired as in TN0163. MSM2's role is not in the
  customer technotes, so it has no cables.
- The CAD MSM has 12 RJ45 and 10 round sockets, fewer than the TN0163 figure,
  so MSM and ACDP rear ports are placed with the technote figure on the
  measured rear face.
- The panel has 8 holders, but 10 customer connections (6 AC + Cloud, EMS,
  PCS, RemotE). The last two are drawn further along the panel with an orange
  ring and a "confirm with AYK" note.

## Draft limits of the DXF rack (`s10195`)

- Rack depth, module depth (OrionAN, 735 mm) and the rear layout are assumed:
  the DXF is a front view only.
- The position of the Signal Inter-Connection Panel (left end, lower half) is
  assumed.
- Rear port positions follow the technote figures, not measured CAD.
- The use of the SSC's Comm B port differs between TN0160 and TN0163. It is
  shown unwired, with a note to confirm.
- Fire-fighting (TN0164) is out of scope.
- three.js 0.160.0 is loaded from jsDelivr, so the page needs internet access.

Tests: `node tests/guide.test.js` (53 checks: part counts, AYK numbering,
port uniqueness, technote rules per leg, deterministic routes. For rack 1:
measured socket order, plug letters matching, routes inside the rack and
inside their slots, holders and trunk).
