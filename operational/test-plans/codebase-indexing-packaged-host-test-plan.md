# Codebase indexing packaged-host test plan

## Status and purpose

**2026-10-31: BLOCKED; runtime cases NOT RUN.** The
[append-only run log](../test-runs/codebase-indexing-packaged-host-log.md) records the actual
Windows live-input failure, successful package construction, provenance caveat, setup evidence,
and remote prerequisites. This plan is a future procedure, not evidence that it ran.
Do not execute acceptance as part of this documentation-only task.

Decision 18 requires an installed extension package on local Windows and Remote-WSL.
Both must demonstrate successful parsing, bounded parser failure/termination, explicit retry
without reload, and usable editor and unrelated-extension actions during hang and stop.
Automated simulations and extension-host shutdown do not substitute for these observations.

## Authority read for this plan

The full main spec/design, parse-worker design, test inventory, and ADRs 0001–0005 were
read before authoring. Architecture decision records (ADRs) preserve changes to the design;
the current design takes precedence over superseded ADR wording.

- Main spec, especially
  functional requirements 1–13 and packaged-host acceptance.
- Main design, Decisions
  5–6, 11a, 13–19 and the assumptions table. Decision 18 owns this plan and log.
- Parse-worker design,
  Decisions 10–11: real WASM-loop injection and physical worker exit.
- Test inventory,
  particularly T1–T9, T15, T23, and the repository-suite gate.
- ADR-0001:
  per-file progress, stopping and partial-stop reporting, provider cancellation.
- ADR-0002:
  shared stop promise includes physical worker exit; WASM hang and suite evidence.
- ADR-0003:
  open-file records and late-write grace; no cross-attempt wait.
- ADR-0004:
  fenced removal and defined grace clock.
- ADR-0005:
  completion invalidation must precede removal; supersedes ADR-0004's removal ordering.

These are local planning references; this operational plan makes no new design decision.

## Safety and authorization boundaries

1. Obtain a signed-in, interactive physical or remote console. If input reports a locked,
   disconnected, screensaver, or secure desktop, record BLOCKED and stop. Never bypass it.
2. Use only a disposable fixture, task-owned processes, isolated user-data and extension
   directories, and a dedicated test index. Do not edit the active workspace, copy its secrets,
   change its trust/settings, or reuse its live indexing collection.
3. Keep all fault injection process-local to separate test hosts. Never set persistent
   environment variables or inject a fault into the active editor.
4. Do not install a remote server/connector, change services, create a worktree/clone,
   commit, push, or edit protected implementation/output/settings paths under the current
   constraint. If resumption needs any such action, obtain separate approval first.
5. Close only independently identified task-owned windows/processes. Prefer graceful cleanup;
   never broadly terminate all editor processes or use forced termination as worker evidence.
6. Record concise command/output excerpts and artifact paths. Do not paste raw trees,
   screenshots, credentials, or full service responses into the log.

## Preconditions for a later authorized run

### Package and runtime identity

- Identify the exact VSIX, SHA256, size, checkout commit, and dirty state. A VSIX is the
  installable extension archive. Record packaging and installed-file comparison evidence.
- Verify backend, worker, WASM assets, locales, and webview correspond to the intended
  current source. The existing TEMP package has fresh backend bundles but a reused webview
  whose source correspondence is unproven. Hash identity alone does not close that gap.
- Do not use the stale bin package reported in the earlier attempt. The successful TEMP
  build is preparation evidence, not a fully proven PR-head package.
- Record OS, VS Code version/commit, and actual extension-host Node version per host.
  Builder Node and a main-process cache-directory version are not substitutes.
- Verify installation in the isolated profile, then verify Roo activation in the trusted
  fixture. A CLI listing alone does not prove activation or worker startup.

### Live input and data services

- Trust only the disposable fixture, using an interactive console and explicit operator
  authorization. Confirm the Roo view and indexing controls are reachable.
- Select a real approved embedding backend and credentials through the isolated test
  configuration. Verify a real embedding response only with authorization; do not use
  dummy inference or infer readiness from a model listing. Do not log credentials.
- Confirm the dedicated Qdrant target and collection ownership before any mutation.
  Port 6333 health 200 is readiness evidence only, not the real-store T23 result.
- Confirm an unrelated extension is available in the isolated host and name its test action.
  Do not assume a bundled editor command is an unrelated-extension action.

### Remote-WSL

- Verify an isolated Remote-WSL connector, compatible server, remote extensions location,
  trusted disposable Linux fixture, approved embedder reachability, and dedicated store.
- Prove that Roo runs in the remote extension host, not merely a local Windows window
  connected to a Linux folder. Record remote Node, package identity, and worker log location.
- The earlier AzureLinux3.0 discovery did not establish these prerequisites. Under the
  no-install constraint, stop BLOCKED if they are unavailable; do not silently install them.

## Enforced limits and evidence

| Check                     | Limit / required evidence                                                            |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Parse deadline            | 10 seconds from dispatch to the worker, not queue entry                              |
| Cancel/disable stop       | 2 seconds from the stop request; record physical exit, not only UI state             |
| Timeout/abort termination | Physical worker exit within the 2-second stop bound after termination begins         |
| Responsiveness            | An editor action and unrelated-extension action complete during hang and during stop |
| Uncertain-write grace     | 30 seconds; relevant to recovery/progress checks, not permission to extend stop      |

Capture timestamps for dispatch, fault entry where observable, user stop, timeout/failure,
physical worker exit, UI status, responsiveness actions, and retry. Record elapsed times
and timing resolution. If the short stop phase cannot be observed sufficiently, record the
responsiveness case as NOT RUN rather than claiming success from later interaction.

Required parse-client exit messages from parse-worker Decision 11:

```text
parse worker exited after <ms> ms
parse worker exit not observed within stop limit
```

The first message must be correlated to the tested worker and termination. The second,
or missing physical exit within the stop limit, fails that termination case. Closing the
window or an `Extension host with pid ... exited` line proves neither parse-worker exit
nor bounded cancellation. Keep abort containment distinct from a genuine Tree-sitter abort:
the injection exercises plumbing. The real WASM-loop fault is not a known Tree-sitter hang.

## Per-host execution matrix — future work only

Repeat on local Windows and Remote-WSL, with initial-scan and incremental watcher coverage
where applicable. For every row append actual actions, package/host identity, limits,
outputs, outcome, and artifact paths to the run log.

| Case                 | Fault environment                                | Required observations                                                                                               |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Normal parse         | Unset                                            | Supported source parses in installed worker; scan completes with current indexed content                            |
| Fatal abort          | `ROO_PARSE_WORKER_FAULT=abort`                   | Affected file and parser failure reported; scan fails once, no cascade or automatic restart; physical exit recorded |
| Timeout              | `ROO_PARSE_WORKER_FAULT=wasm-hang`               | Worker enters real WASM loop; 10-second dispatch deadline; scan fails; physical exit within stop bound              |
| User cancel          | `ROO_PARSE_WORKER_FAULT=wasm-hang`               | Cancel before deadline; Stopping then stopped/partial; physical exit within 2 seconds                               |
| Disable              | `ROO_PARSE_WORKER_FAULT=wasm-hang`               | Bounded stop; indexing remains disabled and later fixture file events do not restart it                             |
| Retry without reload | Same fault host, then suitable explicit recovery | New scan and worker start without editor reload; repeated fault remains bounded; no automatic retry loop            |
| Hang responsiveness  | Real WASM hang active                            | Named editor and unrelated-extension actions complete while the worker is hung                                      |
| Stop responsiveness  | Termination in progress                          | Both named actions complete during stop, with correlated timing evidence                                            |

### Session sequence and retry nuance

1. Launch the normal isolated host with the fault variable unset; prove successful parsing
   before interpreting fault results. Use the same verified package on both host types.
2. Launch separate task-owned hosts for abort, timeout, cancel, and disable. Set the fault
   variable before the relevant extension host starts. Confirm the remote process receives
   the intended variable; do not assume Windows environment propagation into WSL.
3. Use a disposable supported source file to dispatch a real packaged parse. Perform and
   timestamp the named editor and unrelated-extension actions during hang and stop.
4. Record failure status and file, bounded physical exit, absence of repeated notification,
   and no restart from subsequent fixture events until explicit recovery.
5. Explicitly retry in the same editor session. The worker reads its fault environment at
   startup; a replacement worker in that host can inherit the same fault and fail again.
   That bounded repeated failure plus a newly started scan/worker demonstrates retry without
   reload. Do not claim a successful fault-free retry by silently relaunching the host.
6. Demonstrate successful post-failure recovery without reload only if an approved,
   documented test mechanism can remove the fault for the replacement worker. Otherwise
   record that narrower recovery result as unverified, while retaining the bounded retry result.
7. Check completed-file progress and unfinished-file retry behavior. Failure must remain
   failure; stop must not become successful completion. Idle cancel leaves status/message
   unchanged. Keep provider cancellation and retry-integrity evidence separate from worker exit.
8. Record clean task-owned shutdown independently from worker termination. Preserve the log
   artifacts and append outcome; do not rewrite earlier BLOCKED entries.

## Wider acceptance gates

Decision 18 host evidence is necessary but not sufficient for overall acceptance.
Decision 19 also requires actual green results for all repository suites, including the
indexing regressions and the named gauge test. T15 must use a real WASM-loop worker;
T23 must use a real Qdrant instance, not mocks or a health endpoint.

The following are design-required future commands, **not commands executed by this task**:

```text
pnpm test
pnpm --filter @roo-code/cli test:integration
pnpm --filter @roo-code/vscode-e2e test:ci
```

Run only in a separately authorized testing session because build/test commands may write
protected outputs or require credentials. Record the actual target and output, both required
CI platform results, and any unrun prerequisite. Measure large-collection generation payload
index creation time as called out by the design assumptions; do not substitute an empty store.

## Verdict rules

- **PASS for a case:** all required live observations and correlated physical-exit/timing
  evidence exist for that host and exact package. No inferred success from setup or unit tests.
- **FAIL for a case:** an exercised behavior violates a required bound or result, including
  missing physical exit within the stop bound.
- **NOT RUN for a case:** execution did not reach that case. State the concrete reason.
- **BLOCKED overall:** any required case/host/suite is unrun, provenance is inadequate,
  or a prerequisite prevents meaningful execution. Do not rename a live-input blocker as
  package construction failure when packaging succeeded.

Every entry must separate direct command evidence, artifact reads, explicitly attributed
parent observations, and assumptions. An untested premise cannot approve acceptance.
The current attempt remains BLOCKED until new evidence closes the listed gaps.
