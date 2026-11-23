# AGENTS.md: working on Wirelens

Guide for any coding agent (Claude Code, Cursor/Grok, ChatGPT/Codex, Gemini, Copilot …).
Read this file first, then `skills/wirelens/SKILL.md` (full working knowledge).
If `projects/*/AGENTS.md` exists locally, read it too: it holds the confidential project notes.

## What this is
Wirelens is an interactive 3D customer wiring guide for AYK battery racks. The user picks a cable, it lights up,
and **Play route** walks it step by step along the AYK technote rules to its port, holder or panel.
Pure front end, no build step: `index.html` + `js/guide-data.js` (rules, router, pure, Node-testable) +
`js/guide3d.js` (three.js 0.160.0 scene, loaded from jsDelivr via importmap).

## Run and test
```powershell
python -m http.server 8090 --bind 127.0.0.1      # in the repo root; open http://127.0.0.1:8090/?rack=<id>
node tests/guide.test.js                           # must stay green (55+ checks)
```
Confidential project racks also have their own tests (see the project's AGENTS.md); run them before you finish.
The page must be served over http (it fetches JSON and GLB). After a change, hard-reload the browser.

## Hard rules (the owner insists on these)
1. **Port names exactly as printed** on the hardware / technote panel figures, character for character
   (`PowerP`, `Ext-HVIL`, `Cooling Fan`, `RemotE`, `SSC 1P`, `AC PowerIn B` …). Never reword, add spaces or "fix" spelling.
   Internal ids (`ExtHVIL`, `RemoteE`) are code only. The lists are in `skills/wirelens/SKILL.md`.
2. **Confidential project data never goes into git.** The GitHub repo is PUBLIC. Everything project-specific
   (drawings, STEP, rules, part numbers, bank lists, CAD output, project notes) lives in `projects/<name>/`,
   which is git-ignored, and the source folders (`*Cable and Rack Arrangement/`, `technotes/`, `*.dxf`, `*.STEP`) are ignored too.
   Before committing, scan the diff for project names and part numbers (e.g. `H6\d{6}`, `P4\d{6}`) that are not S10195 demo data.
3. **Commit or push only when the owner asks.** Pushing goes to both remotes: `origin` (company Gitea) and `github`.
   End commit messages with a line naming the agent that made them.
4. **Engine code is generic.** `js/` and `tools/` must not hard-code a project: project data comes in through the rack
   JSON (`rack.cables`, `geom`, `portLabels` …) or a profile file passed on the command line.
5. English-only UI. Keep tests green; add tests for every new rack or rule.
6. Technote TN0164 (fire fighting) is out of scope.

## Layout
```
index.html, js/guide-data.js, js/guide3d.js, js/cad.js   the app
assets/guide/            published racks: <id>.json, <id>.glb, racks.json (picker list)
tools/step-to-guide.py   SolidWorks STEP -> <id>.glb + <id>.parts.json (cascadio, trimesh, fast-simplification, scipy)
tools/make-guide-rack.js rack JSON from a DXF, or from parts.json with --step (S10195 family)
tests/guide.test.js      engine tests
skills/wirelens/         agent skill files (copy of .claude/skills/wirelens): read SKILL.md
projects/                LOCAL ONLY, git-ignored: confidential projects (rules, builders, CAD, tests, notes)
projects/racks.local.json  local picker entries {id, label, url} for confidential racks
docs/wiring-guide-3d.md  routing rules, assumptions
.github/workflows/pages.yml  tests + GitHub Pages deploy;  .gitea/workflows/deploy.yml  company IIS deploy
```

## Frame and units
Engine data is in **mm**; the three.js scene is in metres (`MM = 0.001`).
x to the right **seen from the front**, y up, z = 0 at the module front faces, negative towards the rear.
STEP files in another frame are rotated by `step-to-guide.py --axes` (`yzx`, `-zyx`).

## Rack JSON features an agent will meet
`parts[{id,kind,x0..z1,ports,labels,portLabels,portConn,portFront,slotTop}]`, `geom` (posts, clamps, trays, panel side,
`slotRouting`, `directPanel`, `sideView:'rear'`), `panels`, `holders`, `model` or `models[]`, `composite`,
`labelModules`, `cables[]` (explicit list with `facts`, `holder{panel,n,pn,side,riserX}`, `holderTn`, `group`,
precomputed `legs[{rule,tn,pts,holder,customer,tag,holderAt}]`), `technotes`, `assumptions`. Details: SKILL.md.

## Workflow that worked
1. Plan first, step by step, and confirm open questions with the owner (they answer quickly).
2. Read the source drawing / technote yourself (pypdf / pymupdf / ezdxf in a scratch venv; run untrusted files with `python -I`).
3. Change the generic engine only when needed; put project facts in the project folder.
4. Rebuild, run every test suite, then check in the browser (rear, front, simplified, one cable per category).
5. Write what you learned into the project README / AGENTS.md so the next agent can continue.
