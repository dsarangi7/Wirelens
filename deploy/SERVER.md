# Wirelens on the production server

Site: **{{SERVER}}/wirelens/** · Folder on the server: **C:\apps\Wirelens** · Web server: the existing nginx
Package built: {{BUILT}}

How it fits together:

| What | Where it comes from | How it gets updated |
|---|---|---|
| Viewer code: `index.html`, `js\`, `assets\` | Gitea `{{GITEA}}` | `git pull` (Update-Wirelens.ps1) |
| Project data: `projects\` (racks list + rack models, **confidential**) | `Wirelens-data.zip` in this package | `Update-Wirelens.ps1 -DataZip ...` |
| nginx settings | `nginx-wirelens.conf` | once, at install |

`projects\` is not in git on purpose, so `git pull` never overwrites or deletes it.

## First install (once)

On the server, in PowerShell:

1. Install **Git for Windows** if `git --version` fails (https://git-scm.com/download/win).
2. Unzip this package to a work folder, for example `C:\apps\_wirelens-package`.
3. Get the code from Gitea (asks for your Gitea sign-in the first time):
   ```powershell
   git clone {{GITEA}} C:\apps\Wirelens
   ```
4. Add the project data and check everything:
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\apps\_wirelens-package\Update-Wirelens.ps1 -DataZip C:\apps\_wirelens-package\Wirelens-data.zip
   ```
   It ends with `OK: N project racks, code at ...`.
5. nginx: open the nginx folder (the one the `AYK_Nginx` task starts), edit `conf\nginx.conf`, and paste the
   contents of `nginx-wirelens.conf` **inside** the `server { ... }` block your other tools use. Then:
   ```powershell
   .\nginx.exe -t          # test the config
   .\nginx.exe -s reload   # apply it
   ```
6. Open **{{SERVER}}/wirelens/** in a browser. Check that the project racks show on the dashboard and one opens.
   Also check that **{{SERVER}}/wirelens/.git/config** gives 404 (git files must not be served).

## Updating

- **Code changed** (after a commit is pushed to Gitea):
  ```powershell
  powershell -ExecutionPolicy Bypass -File C:\apps\Wirelens\deploy\Update-Wirelens.ps1
  ```
- **Project data changed** (racks rebuilt or added): on the development PC run
  `.\deploy\Make-ServerPackage.ps1`, copy `dist\Wirelens-server-package.zip` to the server, unzip it, then:
  ```powershell
  powershell -ExecutionPolicy Bypass -File C:\apps\Wirelens\deploy\Update-Wirelens.ps1 -DataZip <unzipped folder>\Wirelens-data.zip
  ```

No nginx reload is needed for updates, and users don't need Ctrl+F5 (the site sends `Cache-Control: no-cache`).

## Notes

- Never edit files in `C:\apps\Wirelens` by hand on the server: `git pull` will then refuse to update.
- The project data is AYK-confidential: keep the site behind the same sign-in / network access as the other tools.
- Troubleshooting: 404 on everything → the `alias` path in nginx.conf is wrong (must end with `/`);
  racks show but a model does not load → check the `.glb` line in the `types` block; "Loading the rack…" hangs →
  run Update-Wirelens.ps1 without `-DataZip` and read its check output.
