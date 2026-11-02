# Codebase indexing packaged-host acceptance log

## 2026-10-31 — BLOCKED: live input unavailable

**Decision 18 acceptance is BLOCKED, not PASS.** Package construction succeeded and the
isolated Windows installation was verified. The Windows UI attempt stopped before indexing
because injected input could not reach the desktop. Remote-WSL runtime was not attempted.
Every required packaged runtime case remains **NOT RUN** on both hosts.

Procedure: [packaged-host test plan](../test-plans/codebase-indexing-packaged-host-test-plan.md).
Append later attempts; do not overwrite this outcome.

### Evidence sources and boundaries

- **verified: parent UI Operator tool evidence**, supplied in the task handoff. The UI
  commands and observations below were performed by the parent, not rerun by this writer.
- **verified: read-only artifact inspection**, performed by this writer through PowerShell
  reads and Node hash comparisons. Session outputs retained as tool artifacts
  `cmd-1793412866031.txt`, `cmd-1793412873239.txt`, and `cmd-1793412893176.txt`.
- Builder task: `01a18fb3-444a-7515-9fd5-755b1b754d4f`.
  Setup task: `01a18fb7-31f9-719a-9828-67f647cecd57`.
- This documentation task ran no acceptance cases, service probes, installation, UI input,
  or build. It changed only this report and the linked plan. No commit, push, worktree,
  clone, implementation edit, or settings change was performed by this writer.

Evidence roots (TEMP is the process temporary directory):

```text
Build: %TEMP%/roo-dirty-vsix-F4aqrC
Host:  %TEMP%/roo-packaged-host-6633814049d4482f8b36250b82bfb436
```

The writer read the build retry log, verification summary/log, provenance, build helper,
verification helper, protected snapshots, setup evidence, installed hash records, extension
listing, handoff, and Windows main log. Helpers were inspected, not executed: they write
artifacts and were unsuitable for this read-only verification.

### Package identity and provenance

| Field                             | Recorded value                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Package                           | `roo-cline-3.53.6-dirty-8c38f1c5.vsix` under the build root                         |
| SHA256                            | `a06d84f239d4f04802da90a7c02aa3b0751bb07daaeed18f534005ea088a024f`                  |
| Bytes                             | 31136789                                                                            |
| Recorded checkout head            | `8c38f1c5a49da38c5ca3a87ce3b033a0b45c2a86`                                          |
| Recorded branch                   | `fix/issue-23-isolated-parse-worker`                                                |
| Checkout state                    | Dirty; not a clean-head reproducible package                                        |
| Builder Node / esbuild            | v22.23.1 / 0.25.9                                                                   |
| Windows VS Code                   | 1.144.0, commit `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`                          |
| Host Node evidence                | Main-process cache path contains v24.22.1; extension-host Node version not measured |
| Planned limits, not measured here | Parse 10 s; stop/physical exit 2 s; late-write grace 30 s                           |

**verified: PowerShell artifact reads** of `retry-1.log`, `verification.json`,
`verification.log`, and `provenance.json` under the build root:

```text
PACKAGE_EXIT=0
POSTPACKAGE_WORKSPACE_UNCHANGED=true
VERIFY_EXIT=0
"currentBuildInputsVerified": 3366,
"baselineSourceFilesVerified": 3074,
"webviewProvenanceLimit": "Existing build reused; hash and unchanged inputs do not prove original build correspondence."
```

The retained build evidence records fresh extension backend, parse-worker, and token-count
bundles built in TEMP using esbuild 0.25.9, without running the source build script.
The staged prepublish script was removed; repository manifest settings were not changed.
The existing webview build was reused. **Correspondence between that webview and current
source is NOT proven. Do not describe the whole VSIX as equal to current source or as a
fully verified PR-head acceptance package.**

The parent reported that the existing repository bin VSIX was stale and lacked the worker;
that package was not the selected artifact and was not independently inspected by this writer.
The earlier construction difficulty is not the final blocker: the fresh TEMP package succeeded.

**verified: writer read-only `node -e` SHA256/size comparison** of the selected VSIX:

```text
VSIX_SHA256=a06d84f239d4f04802da90a7c02aa3b0751bb07daaeed18f534005ea088a024f
VSIX_BYTES=31136789
```

### Isolated installation and service readiness

**verified: PowerShell reads** of host-root `handoff.json`,
`evidence/setup-evidence.json`, `evidence/installed-hashes.json`, and
`evidence/list-extensions.txt`. The installed hash records were counted, not regenerated:

```text
rooveterinaryinc.roo-cline@3.53.6
INSTALLED_FILES=1741
IDENTICAL_FILES=1740
"manifestDifference": "Installer added __metadata only; original manifest properties identical"
```

The only differing installed hash record is the manifest. The metadata-only explanation
comes from the setup artifact. Installation identity is not evidence that Roo activated
or that the parse worker ran.

The setup artifact records these earlier probes; this writer did not repeat them:

- Qdrant health GET on port 6333 returned 200. No collection was created by setup.
- Ollama model discovery on port 11434 failed with WebException.
- Port 4000 health/model GETs returned 200 and advertised `azure/test-embedding`.
  Backend authenticity and credential-free real embedding remain unverified. No embedding
  request was sent; model advertisement is not embedding success.
- AzureLinux3.0 was running under WSL2. The checked default user server directory was
  absent; root-directory inspection was denied. Setup found no verified safe isolated
  Remote-WSL launch under the no-install constraint. It did not copy the existing Windows
  connector into the isolated extensions directory, install a remote server, or launch remotely.

### Windows UI attempt — verified parent tool evidence

The parent used `C:/git/roo-vault/global-skills/automate-windows-ui/ui.cmd`.
Only the following command fragments and results are quoted; they are not writer reruns.

1. First process launch using the quoted executable failed with WinError 5.
2. A short-path launch exited 9 with bad option `--new-window`, attributed by the parent
   to inherited Electron node-mode. The next launch cleared the process environment variables
   ELECTRON_RUN_AS_NODE, VSCODE_IPC_HOOK_CLI, VSCODE_PORTABLE, and ROO_PARSE_WORKER_FAULT.
3. The next process launch used Code.exe with `--new-window`, isolated `--user-data-dir`
   and `--extensions-dir`, `--skip-welcome`, `--skip-release-notes`, and the disposable fixture.
   These were process-local launch changes, not active-profile settings edits.
4. `desktop windows --title fixture` returned count 1, title
   `fixture - Visual Studio Code`, PID 31520. Inspection at depth 5 showed only editor chrome;
   both elevation indicators were false. Windows Graphics Capture showed the fixture's
   notes and TypeScript sample, Restricted Mode, and no visible Roo activity icon.
   This did not establish Roo activation or a successful parse.
5. The parent attempted the trust command through live input:

```text
web keys --window 'fixture - Visual Studio Code' 'ctrl+shift+p, text:Manage Workspace Trust' --confirm
exit 1; ok false
```

Exact returned error:

> nothing was sent: no window owns the foreground, which is what a locked, disconnected, or screensaver desktop looks like. Injected input cannot reach an application in that state: it is delivered to the secure desktop, which this process cannot open. Sign in at the physical or remote console and retry.

No trust/input mutation occurred. The parent stopped rather than attempting a secure-desktop
bypass. The live-input failure is the immediate Windows blocker; Restricted Mode was not resolved.

### Cleanup and physical-exit distinction

**verified: parent tool evidence** — non-forced termination targeted only task-owned PID 31520:

```text
process kill 31520
SUCCESS: Sent termination signal to the process with PID 31520.
desktop windows --title fixture
count 0
```

**verified: writer PowerShell `Select-String` read** of
host-root `user-data/logs/20261030T191227/main.log`:

```text
2026-10-30 19:12:29.388 [info] AgentHostProcessManager: agent host started
2026-10-30 19:13:25.280 [info] Extension host with pid 41216 exited with code: 0, signal: unknown.
```

The second line is extension-host shutdown evidence, **NOT parse-worker physical-exit
or 2-second termination evidence**. Neither an agent-host start nor disappearance of the
window proves a parse worker started, hung, or exited.

### Runtime result matrix

| Required case                                                           | Local Windows | Remote-WSL |
| ----------------------------------------------------------------------- | ------------- | ---------- |
| Successful packaged parsing                                             | NOT RUN       | NOT RUN    |
| Fatal abort containment and failure reporting                           | NOT RUN       | NOT RUN    |
| Real WASM-loop hang, 10-second timeout                                  | NOT RUN       | NOT RUN    |
| User cancel during hang, stop and physical worker exit within 2 seconds | NOT RUN       | NOT RUN    |
| Disable during hang and no automatic restart                            | NOT RUN       | NOT RUN    |
| Physical worker exit timing for every termination                       | NOT RUN       | NOT RUN    |
| Explicit retry without editor reload                                    | NOT RUN       | NOT RUN    |
| Editor action and unrelated-extension action during hang                | NOT RUN       | NOT RUN    |
| Editor action and unrelated-extension action during stop                | NOT RUN       | NOT RUN    |

There are no measured parse/stop latencies or worker-exit lines from this attempt.
T15 real-worker tests, T23 real-Qdrant integration, the full repository suites, CLI integration,
editor end-to-end, and the gauge test were not run by this documentation task. No verdict
about their results elsewhere is made. A health check does not satisfy T23.
Large-collection generation-index creation time was not measured here.

### Read-only protected-file check

**verified: writer `node -e` fingerprint comparison** against build-root
`protected-verification-after.json`. The command read files and link targets, hashed bytes,
and compared the recorded JSON structure. It wrote nothing and was a separate hash check,
not execution of the builder's verification gate.

```text
PROTECTED_SCOPE_MATCH=true
PROTECTED_DRIFT_COUNT=0
```

The comparison covered `0`, all root names beginning `.roo`, `myplans`, `myscripts`, and
`src/dist`. Symlink targets were compared without following their contents. Environment
files and the prohibited plans alias were excluded. Thus this check does not certify
unchanged contents behind the vault symlinks.

A second read-only Node inventory used the original build inventory format from
`before.json` (file hashes/sizes and link targets; excluding dependency/cache directories
and environment files). Actual output:

```text
BUILD_DIST_CURRENT_SHA256=143fb53bb4efbd2cb6af1b02e30d45bbe05613e3f5236368b4bad31153b3ddf9
BUILD_DIST_BASELINE_SHA256=143fb53bb4efbd2cb6af1b02e30d45bbe05613e3f5236368b4bad31153b3ddf9
BUILD_DIST_UNCHANGED=true
```

No drift was found within those scopes. The separate protected-snapshot format yielded
`6e78bbee6a1b80753d3a819e3cbb3d3b1f8afab6bddeebf79cf0d16d330ddc94` for `src/dist`;
that is a different serialization, not conflicting file content.

### Disposition

**BLOCKED / NOT ACCEPTED.** Resume requires an interactive console, a trusted disposable
fixture, verified current webview packaging, an approved real embedder, and safe isolated
remote-host prerequisites. The linked plan defines separate fault-injection hosts and
required physical-exit evidence. No dummy inference, active-workspace edits, secure-desktop
bypass, or package-failure reclassification is authorized by this report.

### Final report-only verification

**verified: writer read-only `node -e` validation after both reports were created.** It
checked report line lengths and relative links, compared the build baseline's recorded
source hashes/link targets, listed additions with `git --no-optional-locks ls-files`, and
rechecked the protected snapshot's recorded entries. Actual output:

```text
BASELINE_SOURCE_DRIFT=[]
ADDITIONS_SINCE_BUILD_BASELINE=["operational/test-plans/codebase-indexing-packaged-host-test-plan.md","operational/test-runs/codebase-indexing-packaged-host-log.md"]
FINAL_PROTECTED_RECORDED_ENTRY_DRIFT=0
```

Both reports had zero overlong lines and zero broken relative links at that check.
Only the two authorized reports were additions relative to the retained build baseline;
no recorded baseline source or protected-entry drift was observed. Snapshot exclusions and
unfollowed symlink-content limits above still apply. This check is not acceptance execution.

## 2026-11-01 — Local Windows run: 7 PASS, 1 NOT RUN; overall still BLOCKED

Run under the user's decision "Approve it, but try the installed-extension check on this
Windows machine first". Scope: local Windows only. Remote-WSL was not attempted.
Tester task, with UI interaction delegated to ui-operator subtasks. All times are UTC.

**Local Windows: seven cases PASS and stop responsiveness is NOT RUN. No case FAILED.**
**Decision 18 remains BLOCKED / NOT ACCEPTED:** stop responsiveness and every Remote-WSL
case are still unrun.

### Evidence sources

- **verified: tester commands**: packaging, install, host launch, extension-host
  Chrome DevTools Protocol (CDP) probes, worker console capture, Qdrant reads and cleanup
  checks. Artifacts are under `%TEMP%/d18-win/`. Console captures:
  `console-normal.log`, `console-abort.log` and `console-hang.log`.
- **attributed: ui-operator observations**: UI clicks, keys and status texts. Subtasks:
  `01a198dd`, `01a198e9`, `01a198fe`, `01a19906`, `01a19908` and `01a1990e`.
  Each UI timestamp shows when the tool call was dispatched and when it completed. It does
  not give the exact moment of the keystroke. Status was sampled about every 2 s.
- **Worker log capture method**: VS Code relays extension-host `console.log` to the
  workbench renderer. The host launcher (`host.cjs`) attaches to it on
  `--remote-debugging-port` and records each line with a timestamp. A self-test line,
  `parse worker CAPTURE_SELFTEST`, was captured at 21:22:16.849Z. That confirmed the path
  before the abort run that produced the first worker-exit evidence below.
  An earlier attempt to replace `console.log` in the extension host captured nothing,
  because the host's own console wrapper stayed in place.

### Package identity and provenance

| Field           | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| VSIX            | `%TEMP%/d18-win/roo-d18-win.vsix`                                       |
| SHA256          | `D399FE4CEBD47DD9F783EFEC071CE5FE7DD4C5800EFF9156B6BEA4DC37E13491`      |
| Bytes           | 31027854 (1743 files)                                                   |
| Checkout        | `fix/issue-23-isolated-parse-worker` @ `8c38f1c5`, dirty: round-2 edits |
| Webview         | Rebuilt from the working tree; `index.js` mtime 2026-11-01T20:34:32Z    |
| Backend bundles | Rebuilt by `vsce package` prepublish; `parse-worker.js` mtime 20:35:08Z |
| VS Code         | 1.144.0, `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`                     |
| Ext-host Node   | v24.22.1, measured inside the extension host through CDP                |

Commands: `pnpm --filter @roo-code/vscode-webview build`, then
`cd src && npx vsce package --no-dependencies --out %TEMP%/d18-win/roo-d18-win.vsix`.
Both builds finished without errors. The package was a dirty working-tree build, not
a reproducible clean-head build. It closes the earlier gap: the webview now comes from
current source.

The archive was checked for these entries: `extension/dist/extension.js`,
`parse-worker.js`, `fault-loop.wasm`, `tree-sitter.wasm`, `tree-sitter-typescript.wasm`
and `webview-ui/build/assets/index.js`.

Install target: the isolated `%TEMP%/d18-win/extensions`.
`--list-extensions --show-versions` listed `rooveterinaryinc.roo-cline@3.53.6` and
`dotjoshjohnson.xml@2.5.1`. Activation was proven later by the Roo output channel and the UI.

### Preconditions

| Precondition                | Outcome | Evidence                                                                                                                                                   |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive desktop, input  | MET     | `query user`: session 2 Active, over RDP. A Ctrl+Shift+P to the fixture window was VERIFIED                                                                |
| Embedding backend           | MET     | Ollama on 11434 refused the connection. A real POST to `127.0.0.1:4000/v1/embeddings` returned 200 with a 3072-dim vector (`text-embedding-3-large`)       |
| Credentials                 | MET     | The local proxy needs no key. The placeholder `local-test` was typed into the isolated profile only. No secret was copied                                  |
| Dedicated Qdrant collection | MET     | Before the run there were 4 collections. Task hosts created the fixture collections `ws-aaa501dd5be1802c`, `ws-5e6734420313a64a` and `ws-b57722351f89d767` |
| Unrelated-extension action  | MET     | XML Tools `dotjoshjohnson.xml@2.5.1`, command "XML Tools: Minify XML" on `data.xml`                                                                        |

Setup notes:

- Roo settings were seeded by `roo-cline.autoImportSettingsPath` in the isolated profile's
  `settings.json`, pointing at `%TEMP%/d18-win/roo-import.json`. That file holds only
  local URLs and the placeholder key.
- The import skips secret keys. The embedder therefore stayed unconfigured until
  `local-test` was typed into the popover, so Start Indexing did nothing in the first
  attempts. That is existing import behaviour, not a defect of this PR.
- Workspace trust was disabled only through the isolated profile's settings and
  `--disable-workspace-trust`.

### Hosts

Each host was a separate task-owned `Code.exe` with its own `--user-data-dir` and fixture.
The shared isolated extensions directory was used throughout.
`ROO_PARSE_WORKER_FAULT` was set only in each launch environment and was read back inside
the extension host:

| Label  | Code.exe PID | Ext-host PID | Fault read back in host |
| ------ | -----------: | -----------: | ----------------------- |
| normal |        18072 |        33872 | `undefined`             |
| abort  |        43060 |        38580 | `abort`                 |
| hang   |        48796 |        50628 | `wasm-hang`             |

### Per-case results

Worker evidence lines are quoted from the renderer capture. Each line is printed with the
renderer's colour-format markers, which are omitted here.

The value in "exited after N ms" is measured inside `ParseWorkerClient` from `stop()`,
which starts termination, to the worker `exit` event. Limits: parse deadline 10 s from
dispatch; stop and physical exit within 2 s.

**1. Normal parse — PASS.** Host: normal.

- The fixture had 3 TypeScript files.
- Save started indexing. The status was "Indexing - Initializing services..." at about
  21:02:03Z, "Indexed" at 21:02:15.880Z, and finally "Indexed - File watcher started."
- **verified: Qdrant scroll** of `ws-aaa501dd5be1802c` showed `POINTS=7` and `DIM=3072`.
- Payloads held parsed blocks such as `src\sample1.ts L1-3 function add1(...)` and
  `src\sample1.ts L5-10 class Counter1`, and the same for `sample2` and `sample3`.

**2. Fatal abort — PASS.** Host: abort.

- Save was dispatched between 21:25:33.761Z and 21:25:37.176Z.
- Physical exit: `21:25:38.939Z parse worker exited after 4 ms`.
- Status, verbatim from the first abort host (PID 46516) at 21:10:19Z:
  "Error - Code indexing stopped while parsing ...\fixture-abort\src\sample1.ts
  (parser-abort). Fix the file and explicitly start indexing to retry, or disable
  indexing. This is not a model/provider error."
- The same Error text was seen on host 43060.
- There was no automatic restart: 62 s on PID 46516, and 20 s + 22 s + 32 s on PID 43060,
  sampled about every 2 s.
- No repeated notifications: no failure toasts were observed at all. The failure is shown
  as status text.

**3. Timeout (`wasm-hang`) — PASS.** Host: hang.

| Run     | Worker entered WASM loop | Worker exit line                               | Loop → exit |
| ------- | ------------------------ | ---------------------------------------------- | ----------- |
| Initial | 21:35:51.493Z            | `21:36:01.409Z parse worker exited after 4 ms` | 9.916 s     |
| Retry   | 21:37:37.602Z            | `21:37:47.557Z parse worker exited after 3 ms` | 9.955 s     |

- The worker entered the real WASM loop: `parse worker entering wasm fault loop`.
- Status: "Error - Code indexing stopped while parsing ...\fixture-hang\src\sample2.ts
  (parse-timeout). ..." It was first readable at 21:36:15Z.
- Loop entry to exit stayed under 10 s. Termination to exit took 3–4 ms.

**4. User cancel — PASS**, with one UI limitation.

- First attempt: the Stop keypress was not delivered. The run timed out instead
  (`21:42:18.173Z exited after 3 ms`, 9.946 s after loop entry). That run counts as
  timeout evidence only.
- Retry:
    - Loop entered at 21:43:12.750Z.
    - Stop focused and Enter pressed between 21:43:14.115Z and 21:43:18.891Z.
    - Exit: `21:43:18.070Z parse worker exited after 3 ms`. That is 5.320 s after loop
      entry, so cancel won before the deadline.
    - Final status: "Standby - Indexing stopped. Partial index data preserved."
- Limitation: no "Stopping" frame was captured. The stop took 3 ms; sampling was about 2 s.

**5. Disable — PASS.**

- Loop entered at 21:44:29.508Z.
- The checkbox was unchecked between 21:44:30.904Z and 21:44:34.275Z, while the status was
  still "Indexing". Save was activated between 21:44:36.317Z and 21:44:37.864Z.
- Exit: `21:44:37.825Z parse worker exited after 3 ms`, 8.317 s after loop entry and
  before the deadline.
- Final status: "Standby - Indexing stopped. Partial index data preserved." The checkbox
  stayed unchecked.
- No-restart check:
    - **verified:** At 21:46:48.130Z the tester appended to `sample1.ts` and created
      `sample4.ts`. No worker line followed in the next 25 s.
    - **attributed (ui-operator):** a 33 s UI idle showed no "Indexing".

**6. Retry without reload — PASS.** The bounded retry was proven; fault-free recovery was not.

- Abort host: an explicit Start Indexing was pressed between 21:27:53.549Z and
  21:27:57.228Z. A new worker started and exited: `21:27:58.115Z exited after 3 ms`.
  The second Error named `sample2.ts`.
- Hang host: an explicit Start started a new worker loop at 21:37:37.602Z, which ended in
  a bounded exit (see case 3).
- There was no editor reload and no automatic retry loop during the idle checks.
- **Not verified:** a fault-free recovery without reload. No approved mechanism removes the
  fault for a replacement worker, which matches plan step 6.

**7. Hang responsiveness — PASS** (within the stated limits).

- During the hang window from 21:37:37.602Z to 21:37:47.557Z, Ctrl+P opened `data.xml`
  in the editor.
- "XML Tools: Minify XML" was sent between 21:37:40.603Z and 21:37:43.654Z.
- At 21:37:44Z, `data.xml` was confirmed as one line with unsaved changes.
- XML Tools runs in the same extension host as Roo. The edit also proves the editor
  buffer was responsive.
- The first hang's `notes.md` open finished between 21:35:48.777Z and 21:35:52.148Z.
  That straddles loop entry, so it is not counted.

**8. Stop responsiveness — NOT RUN.** Each physical stop finished in 3–4 ms, so no editor
or unrelated-extension action could be placed inside a stop phase. As the plan requires,
nothing is claimed from later interaction.

### Defects

None found in the tested behaviour.

Observation, not required by the plan: parser failures appear only as popover status
text, not as a toast.

### Cleanup and boundaries

- All 6 task-owned `Code.exe` main PIDs were closed with a non-forced `taskkill /PID`:
  41936, 57632, 18072, 46516, 43060 and 48796.
- **verified:** afterwards, no `Code.exe` process command line contained `d18-win`.
- The user's active editor window was never targeted.
- The task's Qdrant fixture collections were left in place for inspection. The 4
  pre-existing collections were not modified.
- An accidental write: the first precheck command's quoting turned `=>` into a cmd
  redirection. That created a repository-root file `ERR` with probe output only and
  no secrets. The tester deleted it; `Test-Path` then returned `False`.
- Protected paths: `git status --short` over the protected set showed only the
  pre-existing untracked `0`. `git diff --stat HEAD -- .roo myplans myscripts` was empty.
  No commit, push, branch or worktree was created.
- `src/dist` and `src/webview-ui/build` were regenerated by the normal build.
