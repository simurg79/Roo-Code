# Zoo Code import decision

Decision document. No code changes are proposed here; this records what to import, what to
defer, and what to leave alone.

## Situation

- Local `src/package.json` is 3.53.5. `origin/main` (RooCodeInc/Roo-Code) is 3.53.0.
- `git rev-list --left-right --count origin/main...HEAD` = 0 / 45. Local is 45 commits ahead
  and 0 behind, so nothing of substance is left to take from `origin`.
- RooCodeInc/Roo-Code is archived read-only since 2026-05-15. Its final release, v3.54.0, was
  almost entirely removals.
- Active development moved to Zoo Code (`Zoo-Code-Org/Zoo-Code`), continuing the same version
  line up to 3.76.0.

## Verification of "likely already local" items

Checked directly in the working tree:

| Item                                             | Status                        | Evidence                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-mode MCP server allowlist                    | Present                       | `allowedMcpServers` in [`packages/types/src/mode.ts`](../../packages/types/src/mode.ts), enforced in [`src/core/tools/mcpServerRestriction.ts`](../../src/core/tools/mcpServerRestriction.ts) and [`src/core/prompts/tools/filter-tools-for-mode.ts`](../../src/core/prompts/tools/filter-tools-for-mode.ts) |
| Workspace `rootResolution` setting               | Present                       | `roo-cline.workspace.rootResolution` in [`src/utils/path.ts`](../../src/utils/path.ts), tests in [`src/utils/__tests__/path.spec.ts`](../../src/utils/__tests__/path.spec.ts)                                                                                                                                |
| VS Code LM auto-condensing                       | Present, and locally extended | `getCondenseContextWindow()` in [`src/api/providers/vscode-lm.ts`](../../src/api/providers/vscode-lm.ts); `maxTokens: -1` and available-input denominator handling in [`src/core/context-management/index.ts`](../../src/core/context-management/index.ts)                                                   |
| `WorkspacePathResolver` symlink canonicalization | Not present as a named module | No `WorkspacePathResolver` anywhere. Symlink realpath handling exists only ad hoc in [`src/core/ignore/RooIgnoreController.ts`](../../src/core/ignore/RooIgnoreController.ts) and [`src/services/skills/SkillsManager.ts`](../../src/services/skills/SkillsManager.ts)                                       |

So three of the four are already local and must not be re-imported. Only the symlink
canonicalization work is genuinely missing, and the local ad hoc handling already covers the
two places that mattered.

## Correction to the assumed baseline

The briefing assumed the local tree sits on the de-Roo'd v3.54.0 removals. It does not.
`packages/cloud`, `packages/evals`, `packages/telemetry` and `apps/web-evals` are all still
present. Only `src/services/marketplace` and the webview marketplace UI are gone.

This changes the structural-divergence picture in our favour: Zoo commits that assume Cloud,
telemetry or evals exist will mostly apply, because those subsystems are still here. Only
marketplace-touching commits hit missing ground.

## Strategy

**Add Zoo Code as a read-only remote; import selectively; never realign wholesale.**

Add `zoo` as a fetch-only remote so Zoo history is available for `git log`, `git show`, and
targeted cherry-picks. Do not make it a merge target and do not set it as the upstream of any
local branch.

Why not realign wholesale:

- Sixteen releases of drift across four HIGH-conflict files that are exactly where this fork's
  value lives ([`src/core/webview/ClineProvider.ts`](../../src/core/webview/ClineProvider.ts),
  [`packages/types/src/message.ts`](../../packages/types/src/message.ts),
  [`webview-ui/src/components/chat/ChatRow.tsx`](../../webview-ui/src/components/chat/ChatRow.tsx),
  and the local delegation tests).
- A wholesale merge would force resolving the delegation rewrite, the `TaskRegistry` refactor,
  the provider-identifier migration, and the Roo-to-Zoo rebrand all at once, with no way to
  test any one of them in isolation.
- Selective import lets each area be judged on its own value against its own conflict cost.

Why a remote at all rather than copying patches by hand: cherry-picks keep authorship and
commit messages, and `git log zoo/main -- <path>` is the cheapest way to see whether a later
Zoo commit already fixed something we are about to import.

### Structural divergence and branding

- **Telemetry, Cloud, evals**: subsystems are present locally, so Zoo changes to them apply.
  But this fork has no use for them. Treat them as SKIP by policy, not by mechanics.
- **Marketplace**: removed locally. Any Zoo commit touching `src/services/marketplace` or the
  marketplace webview is SKIP. Do not reintroduce the subsystem to make a cherry-pick apply.
- **MDM / org enforcement**: SKIP. No org-policy requirement in a personal fork.
- **Zoo branding**: SKIP the rebrand commit. It is mechanical, touches locales, README and UI
  strings repo-wide, and would poison every future diff against Roo-era files for no
  functional gain. Accept that later Zoo commits carrying incidental Zoo strings will need
  those strings dropped during the cherry-pick.

## Classification

### IMPORT NOW

| Area                                                                                           | Rationale                                                                                                                                 | Value vs conflict cost     |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Terminal cold-start output loss fix (3.70.0); "next step before command finishes" fix (3.76.0) | Both are correctness bugs that silently corrupt tool results. Localized to the terminal layer.                                            | High value, low cost       |
| Multi-line quoted command parsing, `list_files` directory validation (3.60.0)                  | Small, self-contained tool-correctness fixes.                                                                                             | Moderate value, low cost   |
| Chat memory exhaustion on large transcripts (3.60.0)                                           | Affects long sessions, which this fork produces constantly. Touches `ChatRow.tsx`, so conflict is real but bounded.                       | High value, medium cost    |
| Settings `cachedState` synchronization fixes (3.72.0, 3.74.0)                                  | Directly supports the `cachedState` rule in [`AGENTS.md`](../../AGENTS.md); these are race-condition fixes we would otherwise rediscover. | High value, low cost       |
| Security dependency bumps: shell-quote, esbuild, vite, undici                                  | Pure dependency version changes with no code conflict.                                                                                    | High value, near-zero cost |
| Ollama tool-result handling and premature condensing fix (3.68.0)                              | Condensing correctness; adjacent to local VS Code LM condensing work but not overlapping.                                                 | Moderate value, low cost   |

### IMPORT LATER

| Area                                                                                                                                                             | Rationale                                                                                                                                                                                                            | Ordering                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Model and provider additions (Claude Sonnet 5 / Opus 5, GPT-5.5 / 5.6, Gemini 3.5 / 3.6 Flash, GLM-5.2, Grok 4.5, Kimi K3, MiniMax-M3, `xhigh` reasoning effort) | Genuinely useful but individually low urgency, and each is a small isolated table edit. Batch them.                                                                                                                  | Must come **before** the canonical provider-identifier migration, or the migration has to be re-applied to each new entry |
| Canonical provider-identifier migration (3.72.0–3.74.0, ~8 PRs)                                                                                                  | Cross-cutting rename across `packages/types`, `src/api` and webview. Worth doing once so later provider commits apply cleanly, but it is a large mechanical churn that should not be interleaved with anything else. | After the model batch; before any further provider imports                                                                |
| `TaskSemaphore` / `TaskRegistry` replacing the task stack (3.64.0, 3.74.0)                                                                                       | The structural prerequisite for every later delegation fix. Also the single largest conflict with the local delegation rewrite.                                                                                      | **Blocks** all delegation-area imports. Nothing from the delegation list should be attempted first                        |
| Delegation and subtask fixes (3.60.0, 3.64.0, 3.66.0, 3.68.0, 3.72.0)                                                                                            | See the delegation section below.                                                                                                                                                                                    | After `TaskRegistry`                                                                                                      |
| Destructive Command Guard and grouped tool approval (3.76.0)                                                                                                     | Real safety value; opt-in so it can land dark. Touches the approval path, which the local fork also edits.                                                                                                           | After the terminal fixes                                                                                                  |
| Configurable relaxed diff thresholds and `apply_diff` prompt improvements (3.64.0)                                                                               | Quality-of-life for editing accuracy; no urgency.                                                                                                                                                                    | Independent                                                                                                               |
| Context-compaction button and context-window progress bar (3.70.0); completion review actions (3.64.0)                                                           | Useful UI, but all land in `ChatRow.tsx` / task header where local subtask links live. Take them together in one pass to pay the conflict cost once.                                                                 | After the chat memory fix                                                                                                 |
| Router-provider model metadata fetched before context decisions (3.74.0)                                                                                         | Correctness improvement for context sizing.                                                                                                                                                                          | After the provider-identifier migration                                                                                   |
| Node 22.23.1, Vitest 4, `@vscode/ripgrep` 1.18+                                                                                                                  | Toolchain upgrades; do them in a quiet window since they can break the whole test suite at once.                                                                                                                     | Independent, but isolate                                                                                                  |
| Rules Management UI (3.64.0); relative-symlink realpath in rules files (3.60.0)                                                                                  | The symlink fix is the one verified gap. The Rules UI is nice but interacts with local `.roo/shared-rules/` layout.                                                                                                  | Symlink fix first, UI later                                                                                               |

### SKIP

| Area                                                                                       | Rationale                                                                                       |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Zoo Gateway provider, auth callback, multi-profile token sync                              | Ties the fork to a hosted service we do not use.                                                |
| Kenari, Friendli, Semble embedding, OpenCode-Go, Moonshot / Kimi Code OAuth device flow    | New provider integrations with no local demand; each adds surface area and future merge weight. |
| Telemetry circuit breaking and delta aggregation (3.76.0)                                  | Expands a subsystem this fork has no use for.                                                   |
| Cloud, evals, MDM / org-membership enforcement changes                                     | Same reasoning; not used here.                                                                  |
| MCP marketplace changes and `tool-writer` marketplace mode (3.62.0)                        | The marketplace subsystem is absent locally; importing would mean reintroducing it.             |
| Roo-to-Zoo branding (3.74.0)                                                               | Mechanical repo-wide string churn, zero functional gain, permanently noisy diffs.               |
| Playwright visual-regression harness                                                       | Heavy CI infrastructure for a single-maintainer fork.                                           |
| Per-mode MCP allowlist (3.60.0), `rootResolution` (3.60.0), VS Code LM condensing (3.66.0) | Already present locally, and the local versions are further along. Verified above.              |
| Architect-mode plans kept workspace-relative (3.74.0)                                      | Conflicts with this fork's own plan-location rules.                                             |
| `ask_followup_question` non-array `follow_up` as a type error (3.64.0)                     | Behaviour change with modest payoff; local modes already pass arrays.                           |
| GitHub-style alerts, configurable chat font size (3.58.0)                                  | Cosmetic.                                                                                       |
| Roo Code history import on About page (3.64.0)                                             | Migration aid for users moving off Roo; irrelevant to a fork that never left.                   |
| Dart and plain-text indexing fixes (3.72.0)                                                | No Dart in this workspace. Revisit only if that changes.                                        |
| Ripgrep diagnostic command, terminal profile settings redesign (3.60.0)                    | Diagnostic and preference surface; not worth the settings-schema conflict.                      |

## The delegation and subtask area

This is where the fork's main value-add lives, so it gets an explicit call.

**Recommendation: port local behaviour on top of upstream. Adopt Zoo's model; retire the local
implementation as the structural base; keep only the local behaviour that Zoo does not
provide.**

Reasoning:

- Zoo has spent five releases (3.60.0 through 3.72.0) hardening exactly this area: return to
  the active parent, `atomicReadAndUpdate` serialization of `delegateParentAndOpenChild`, a
  status transition guard, startup delegation reconciliation, preserved parent-child links on
  interrupt, safe abandonment, and a task-history lock. That is a body of concurrency and
  crash-recovery work that a fork will not independently reproduce.
- The 3.74.0 `TaskRegistry` refactor removes the task stack that the local rewrite is built
  on. Staying divergent means every future delegation fix from Zoo becomes unusable, and the
  divergence compounds with each release.
- The local fork's distinctive value in this area is mostly _user-visible_: subtask links in
  [`webview-ui/src/components/chat/ChatRow.tsx`](../../webview-ui/src/components/chat/ChatRow.tsx)
  and its delegation UX. That is a thin layer and it can sit on top of Zoo's lifecycle model.
  Zoo's own 3.72.0 delegation-status surfacing may already cover part of it.

Sequenced approach:

1. Write down the local delegation behaviour as observable requirements, using
   [`src/__tests__/provider-delegation.spec.ts`](../../src/__tests__/provider-delegation.spec.ts)
   and [`src/__tests__/history-resume-delegation.spec.ts`](../../src/__tests__/history-resume-delegation.spec.ts)
   as the source of truth. Do this before touching anything.
2. Import `TaskSemaphore` / `TaskRegistry` (3.64.0, 3.74.0). Accept a large one-time conflict
   in [`src/core/webview/ClineProvider.ts`](../../src/core/webview/ClineProvider.ts).
3. Import the delegation fixes in release order: 3.60.0, 3.64.0, 3.66.0, 3.68.0, 3.72.0. Order
   matters; the later fixes assume the earlier state machine.
4. Replay the step-1 requirements against the result. Keep local tests only where they cover
   behaviour Zoo's tests do not. Delete local tests that merely duplicate upstream coverage,
   since keeping both means two competing definitions of correct.
5. Reapply the local subtask-link UI on top, dropping any part Zoo's delegation-status UI
   already provides.

This is the largest item in the whole plan and should be its own effort, not mixed with the
provider or UI batches.

## Assumptions

- The maintainer intends to keep tracking upstream rather than freeze the fork. If the fork is
  headed for a hard freeze or a move to a different base, most of IMPORT LATER becomes SKIP.
- Zoo Code is a legitimate continuation of the same codebase and the same license, so
  cherry-picking is appropriate. This has not been independently verified.
- The categorized inventory of Zoo changes supplied in the task brief is accurate. It was not
  re-derived from Zoo's own history.
- Cloud, telemetry and evals remain present locally but unused. If they are later removed to
  match Roo v3.54.0, several IMPORT LATER items would need re-checking for hidden dependencies.

## Open questions

These would change the recommendation:

- **Is Zoo Code stable and maintained?** If it forks again or stalls, investing in the
  `TaskRegistry` realignment buys nothing. Worth watching commit cadence for a period before
  committing to step 2 of the delegation plan.
- **Does Zoo's 3.72.0 delegation-status UI already deliver the local subtask-link experience?**
  If yes, the local UI layer can be dropped entirely rather than reapplied, which shrinks the
  delegation effort considerably.
- **Is the local delegation rewrite ahead of Zoo's in any respect?** If it solves something Zoo
  still gets wrong, that specific behaviour should be contributed upstream rather than merely
  preserved locally.
- **Will the fork ever remove Cloud, telemetry and evals?** Deciding this first would avoid
  importing changes into subsystems that are about to be deleted.
- **Does the provider-identifier migration have a mechanical codemod in Zoo's history?** If so,
  that migration drops from large to routine and could move up to IMPORT NOW.

## Related local documents

- [`docs/design/per-mode-mcp-settings.md`](../design/per-mode-mcp-settings.md)
- [`docs/design/workspace-root-resolution.md`](../design/workspace-root-resolution.md)
- [`docs/investigation/roo-to-copilot/README.md`](../investigation/roo-to-copilot/README.md) —
  no Zoo counterpart, no conflict risk.

## References

- Zoo Code releases: https://github.com/Zoo-Code-Org/Zoo-Code/releases
- Zoo Code changelog: https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/CHANGELOG.md
- Roo Code releases (archived): https://github.com/RooCodeInc/Roo-Code/releases
