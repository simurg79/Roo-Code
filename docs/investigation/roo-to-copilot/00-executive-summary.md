---
phase: 9
status: complete
owner: architect-phase-9
last_updated: 2026-04-26
sources:
  - docs/investigation/roo-to-copilot/10-roo-inventory.md
  - docs/investigation/roo-to-copilot/20-roo-vault-inventory.md
  - docs/investigation/roo-to-copilot/30-squad-inventory.md
  - docs/investigation/roo-to-copilot/40-copilot-chat-research.md
  - docs/investigation/roo-to-copilot/50-copilot-cli-research.md
  - docs/investigation/roo-to-copilot/60-gap-analysis.md
  - docs/investigation/roo-to-copilot/70-migration-paths.md
  - docs/investigation/roo-to-copilot/80-migration-playbook.md
  - docs/investigation/roo-to-copilot/90-decision-log.md
  - docs/investigation/roo-to-copilot/99-open-questions.md
tldr: |
  After a 9-phase investigation, the recommended migration path off Roo-Code is **Path Hybrid** —
  Copilot Chat in VS Code for interactive work plus Copilot CLI for automation, BYOK, and
  hook-based file-edit policy enforcement, sharing one canonical `.agent.md` per mode and one
  `AGENTS.md` per project. Estimated effort: 1–2 weeks for the first project, <1 day per
  additional project, with a clean rollback path back to Roo-Code preserved for 30 days.
---

# Phase 9 — Executive Summary

> Parent index: [`README.md`](README.md) · Recommendation source: [`70-migration-paths.md` § 4](70-migration-paths.md#-4--recommendation) · Execution source: [`80-migration-playbook.md`](80-migration-playbook.md)

> 📌 **This file replaces [`00-plan.md`](00-plan.md) as the entry point.** `00-plan.md` is preserved as a historical record of the investigation methodology; new readers should start here.

---

## § 1 — TL;DR

**Recommendation: adopt Path Hybrid — Copilot Chat (VS Code) + Copilot CLI (`@github/copilot`), sharing `.agent.md` files and `AGENTS.md` between both surfaces.** Use Chat for interactive IDE work and CLI for anything headless, BYOK, or policy-enforced. Squad and a custom VS Code extension (Path C and Path D) are documented but **not** recommended as starting points.

- **Headline cost:** 1–2 weeks first-project setup; <1 day per additional project; ~3–5 hours/month ongoing maintenance. No new paid subscription tier required (works on existing Copilot tier; BYOK on CLI requires Pro+).
- **Headline gain:** native cross-tool standards (`AGENTS.md`, `.agent.md`), Windows Credential Manager for MCP secrets, native checkpoints + Fork Conversation, parallel sub-agent dispatch, OpenTelemetry, BYOK to local Ollama on the CLI side.
- **Headline loss:** per-mode `fileRegex` is structurally enforceable only on the CLI surface (prose-only on Chat); Roo-Code's webview UI for visual mode CRUD is gone; `.roo/rules-<mode>/` per-mode rules folders inline into agent bodies.
- **Headline risk:** [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) (sub-agent hook bypass) caps the CLI's `fileRegex` mitigation; mitigated today by avoiding `task` dispatch of restricted modes.
- **Single most important next step:** run the vault `fileRegex` audit ([`80 § 1` step 1](80-migration-playbook.md#-1--pre-migration-checklist)) and execute Stage-1 of the playbook (Chat-only scaffold — converts the 17 modes to `.github/agents/*.agent.md`).

A reader who stops here knows what to do: **read [`80-migration-playbook.md`](80-migration-playbook.md) §§ 0–6 and start Stage 1 today.**

---

## § 2 — The Question

The user's verbatim ask, restated: *"How do I leave Roo-Code entirely and recreate the same experience using GitHub Copilot — the Chat extension and/or the CLI — preserving my existing [`roo-vault`](../../../../roo-vault) multi-project layout (17 modes, 7 MCP servers, layered rules, symlink-and-commit pattern) on a Windows 11 dev box?"*

The investigation treated three sub-questions as load-bearing: (a) can Copilot Chat's custom agents + prompt files + MCP fully replace Roo's modes/orchestrator/MCP; (b) does Copilot CLI offer enough automation surface to replace Roo for terminal workflows; (c) does Squad add value as an orchestration layer or is it redundant? The vault is the actual migration unit, not the Roo-Code extension itself — any answer must preserve the multi-project composition that the vault provides.

---

## § 3 — What We Investigated (9-Phase Methodology)

| Phase | Deliverable | File | Status |
|-------|-------------|------|--------|
| 0 | Investigation plan, methodology, file taxonomy | [`00-plan.md`](00-plan.md) | ✅ |
| 1 | Roo-Code feature inventory (modes, MCP, rules, tools, storage) | [`10-roo-inventory.md`](10-roo-inventory.md) | ✅ |
| 2 | `roo-vault` inventory (17 modes, 7 MCP servers, symlink layout) | [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md) | ✅ |
| 3 | Squad inventory (`@bradygaster/squad-cli` v0.9.1 alpha) | [`30-squad-inventory.md`](30-squad-inventory.md) | ✅ |
| 4 | Copilot Chat (VS Code) research — 4 sub-phases (4a–4d) | [`40-copilot-chat-research.md`](40-copilot-chat-research.md) | ✅ |
| 5 | Copilot CLI research — 5 sub-phases (5a, 5b-i, 5b-ii-A, 5b-ii-B-1/2) | [`50-copilot-cli-research.md`](50-copilot-cli-research.md) | ✅ |
| 6 | Unified gap analysis (~70 rows; Chat vs CLI vs Squad) | [`60-gap-analysis.md`](60-gap-analysis.md) | ✅ |
| 7 | Path scoring (A/B/C/D + Hybrid against 8 weighted criteria) | [`70-migration-paths.md`](70-migration-paths.md) | ✅ |
| 8 | Migration playbook (12 sections + Path B appendix; 24-row validation matrix) | [`80-migration-playbook.md`](80-migration-playbook.md) | ✅ |
| 9 | This summary | [`00-executive-summary.md`](00-executive-summary.md) | ✅ |

Cross-cutting: [`90-decision-log.md`](90-decision-log.md) (append-only ADRs, ~14 entries) and [`99-open-questions.md`](99-open-questions.md) (Q-001..Q-058, with strikethroughs for resolved items). All findings cite primary sources; no claim is unsourced.

---

## § 4 — The Three Surfaces, Compared

The investigation evaluated three Copilot surfaces against Roo-Code. Squad layers on top of the CLI but is not an independent surface.

| Dimension | Copilot Chat (VS Code) | Copilot CLI (`@github/copilot`) | SDK (`@github/copilot-sdk`) |
|---|---|---|---|
| **Identity** | VS Code extension; webview-driven | Standalone Node CLI; TTY-driven | MIT, public preview 0.3.x; transport wrapper over the CLI |
| **Install (Win 11)** | VS Code Marketplace | `npm i -g @github/copilot` | `npm i @github/copilot-sdk` |
| **Subscription** | Free tier eligible | Free tier eligible (BYOK Pro+) | Inherits CLI tier |
| **Modes / agents** | `.github/agents/*.agent.md` + `%APPDATA%\Code\User\prompts\*.agent.md` | `.github/agents/*.agent.md` + `~/.copilot/agents/*.agent.md` (subset schema) | Programmatic via `CopilotSession` |
| **Hooks** | ❌ none (`hooks:` Preview, no enforcement substrate) | ✅ 13 events × `command` and `prompt` types | ✅ in-process `SessionHooks` (6 callbacks) |
| **MCP** | `.vscode/mcp.json` (`servers:` shape + `${input:id}` Credential Manager) | `~/.copilot/mcp-config.json` (`mcpServers:` shape + `${ENV_VAR}`) | File-based discovery |
| **Headless / CI** | ❌ structurally absent (GUI-only) | ✅ `copilot -p '…' -s --no-ask-user --allow-tool=…`, OTel | ✅ programmatic |
| **BYOK (Ollama / Anthropic / Azure direct)** | ❌ G-13 — restricted to GitHub-curated catalog | ✅ `COPILOT_PROVIDER_*` env vars (Pro+) | ✅ same |
| **Vault portability** | 🟡 per-profile `mcp.json` symlinks (Q-026) | ✅ `COPILOT_HOME` env var redirects everything | ✅ `--config-dir` per-invocation |
| **Windows fit** | ✅ native | ✅ native (Node 20+); PowerShell hooks | ✅ extension-host only (no webviews) |
| **Maturity** | GA (custom agents in Preview) | GA (CLI ships ~weekly) | Public preview 0.x — 54 versions in 5 months |

**One-line takeaway per surface:** Chat owns the IDE ergonomics; CLI owns the automation, hooks, BYOK, and portability; SDK owns the "build your own" extensibility (Path D) but at ~1 engineer-month cost.

---

## § 5 — Gap Landscape

The unified gap matrix in [`60-gap-analysis.md`](60-gap-analysis.md) covers ~70 feature rows across 12 sections. Severity tally:

| Surface | 🔴 Blocker | 🟠 Major | 🟡 Minor | ✅ Parity | ➕ Additive (Copilot beats Roo) |
|---|---:|---:|---:|---:|---:|
| **Copilot Chat** | **2** | 8 | 12 | 22 | 4 |
| **Copilot CLI** | **0** | 7 | 11 | 27 | 8 |
| Squad (delta over CLI) | 0 | 0 | 0 | (inherits CLI) | 7 |

**The two Chat blockers are:**

| Blocker | What Roo has | Why Chat blocks | Playbook downgrade |
|---|---|---|---|
| **G-1 — `groups[].fileRegex` per-mode edit restriction** ([`60 § B.2`](60-gap-analysis.md#b2-tool-restrictions-per-mode-toolmcpfile-gating)) | `architect` can only edit `.md`, `translate` only `.md/.ts/.json`, `docs-extractor` only paths under `.roo/extraction/`, `docs-writer` only `.md/.txt/.rst/.adoc` — enforced at runtime by Roo | Chat has no hook substrate; the only enforcement is prose ("only edit Markdown") in the agent body | Hybrid downgrades 🔴→🟠 by routing the 4 restricted modes through the CLI surface, where a `preToolUse` PowerShell hook ([`80 § 8`](80-migration-playbook.md#-8--pretooluse-hook-for-fileregex-enforcement-phase-8b-i)) enforces structurally |
| **B.8 row 1 — Headless invocation** | Roo's [`apps/cli/src/agent/json-event-emitter.ts`](../../../apps/cli/src/agent/json-event-emitter.ts) emits NDJSON for CI/cron consumers | Chat is GUI-only; no command-line entry point | Hybrid resolves by including the CLI as a peer surface; the CLI is purpose-built for headless |

**Top CLI-side major gaps** (not blockers, but worth knowing): CG-1 (no webview UI for mode CRUD), CG-7 (no structured event stream — [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52)), CG-8 (SDK 0.x churn), CG-11 (sub-agent `preToolUse` bypass — [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392)).

Full row-level matrix and the Top-10 most-important-rows list live in [`60-gap-analysis.md` § D](60-gap-analysis.md#d-top-10-most-important-rows).

---

## § 6 — The Five Migration Paths

[`70-migration-paths.md`](70-migration-paths.md) scores all five against 8 weighted criteria (capability fidelity 30%, effort 20%, operational risk 15%, day-to-day UX 10%, automation 10%, portability 5%, reversibility 5%, cost 5%):

| # | Path | One-line description | Score | Rank |
|---|---|---|---:|---:|
| **Hybrid** | **Chat + CLI** | Both surfaces, sharing `.agent.md` and `AGENTS.md`; CLI owns hooks/BYOK | **3.90** | 🥇 1st |
| B | CLI only | Terminal-first; `preToolUse` hook closes G-1; loses webview UX | 3.70 | 2nd |
| D | Vault-as-VSIX | Custom VS Code extension via `@github/copilot-sdk`; closes G-1/G-2 cleanly at ~1 engineer-month cost | 3.25 | 3rd |
| C | CLI + Squad | Path B + Squad's parallel orchestration; alpha-stability tax (CG-12) | 3.20 | 4th |
| A | Chat only | IDE-native; G-1 unmitigated; no headless | 3.10 | 5th |

**Winner:** **Path Hybrid (3.90)**, beating the runner-up (Path B) by 0.20 points — a margin driven by Hybrid's parity-or-better score on every criterion (no value below 3) and the structural fact that the CLI is *additive*, not exclusive, with respect to the Chat surface.

---

## § 7 — Why Path Hybrid

Six reasons, each tied to a specific finding from earlier phases:

- **Closes G-1 where it matters.** The vault's 4 regex-bound modes (`docs-writer`, `translate`, `docs-extractor`, `architect`, confirmed by the [`80 § 4`](80-migration-playbook.md#-4--17-mode-mapping-table) audit) get structural enforcement via the CLI's `preToolUse` hook ([`80 § 8`](80-migration-playbook.md#-8--pretooluse-hook-for-fileregex-enforcement-phase-8b-i)). The remaining 13 IDE-bound modes use Chat with prose-only enforcement — acceptable because they have no `fileRegex` to enforce in the first place.
- **Single canonical `.agent.md` per mode, both surfaces consume.** The CLI's `.agent.md` schema is a **strict subset** of Chat's ([`80 § 7.2`](80-migration-playbook.md#-72--agentmd-schema-diff-cli-vs-chat)); a Chat-valid file is automatically CLI-valid. Author once, symlink twice — no drift.
- **MCP is the only thing that genuinely duplicates.** CG-3 forks the schema (Chat = `servers:`, CLI = `mcpServers:`). Hybrid resolves Q-050 by treating Chat's `.vscode/mcp.json` as the source of truth and generating the CLI mirror via [`80 § 9`](80-migration-playbook.md#-9--mcp-canonical-source-generator-phase-8b-i-resolves-q-050)'s PowerShell script, run as a pre-commit hook.
- **`COPILOT_HOME` solves vault portability cleanly.** A single env var redirects every CLI sub-path (settings, agents, hooks, MCP, sessions) to the vault. Massively simpler than Chat's per-profile-id `mcp.json` symlink dance. Closes Q-008.
- **BYOK retained on the CLI side.** `COPILOT_PROVIDER_BASE_URL=http://localhost:11434/v1` routes the CLI to local Ollama (Pro+); Chat falls back to the GitHub-curated catalog. Hybrid users who care about local models use them where they can be used.
- **Defers the SDK / VSIX risk.** Path D (build a custom extension on `@github/copilot-sdk`) remains documented as a Stage-3 escalation, not a starting point. Hybrid avoids the 0.x SDK churn (54 versions in 5 months) and the ~1-engineer-month build cost while keeping that door open if `fileRegex` enforcement gaps later become genuinely painful.

---

## § 8 — What You Get / What You Lose

| You **get** (additive over Roo) | You **lose** (regressions vs Roo) |
|---|---|
| Native `AGENTS.md` ingestion (W-5; cross-tool with Claude Code, Cursor, Codex, Gemini CLI) | Per-mode `groups[].fileRegex` enforced *in the IDE* (G-1; CLI hook only) |
| MCP secrets via Windows Credential Manager + `${input:id}` first-run prompt (W-4) | `.roomodes` workspace overrides as a discrete file format (replaced by `.github/agents/*.agent.md`) |
| Native checkpoints + Fork Conversation (W-8) — strictly better than Roo's per-task git-shadow rollback | Hot-reload of mode edits in a webview — Copilot needs `Developer: Reload Window` for some changes |
| Parallel sub-agent dispatch (W-7) — Roo's serial enforcement was a *limitation* | Roo-Code's mature `ModesView.tsx` / `McpServerRestriction.tsx` GUI for visual mode CRUD (CG-1) |
| `Kind(arg)` permission grammar on CLI (CW-12) — `shell(git:*)`, `write(./src/**)`; finer than Roo's per-server `alwaysAllow` | Roo's NDJSON event emitter (28+ event types) — Copilot CLI is text-only until [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) |
| BYOK on CLI side (CW-2) — local Ollama, Anthropic direct, Azure OpenAI | BYOK on Chat side (G-13 stays open) — IDE work uses GitHub-hosted models |
| `COPILOT_HOME` single-env-var portability (CW-6) | Per-profile VS Code `mcp.json` still needs a PowerShell helper (Q-026) |
| OpenTelemetry export via standard OTLP env vars (CW-3) | Roo's `update_todo_list` re-injection on every turn (Q-049 — no Copilot equivalent) |
| Session full-text search via SQLite FTS5 on CLI (CW-4) | `.roo/rules-<mode>/` per-mode rules folder (G-2 — must inline into agent body) |
| Official upgrade path; weekly CLI releases; org-policy ceiling on Chat (W-10) | Roo-Code's bespoke Marketplace tab for community modes (replaced by Agent Plugins Preview, gated by `chat.plugins.enabled`) |
| Copilot subscription pricing (no separate Roo licence to think about) | Roo-Code's mature `update_todo_list` ergonomics for long orchestrator tasks |

Net assessment: **Copilot Chat + CLI ships more capability than it removes.** The losses are real but bounded; the gains compound over time as Microsoft/GitHub iterate on the surfaces.

---

## § 9 — Migration Plan at a Glance

The full playbook is in [`80-migration-playbook.md`](80-migration-playbook.md). Effort sizing per section, with the critical path called out:

| § | Section | Effort | Critical path? |
|---:|---|---|---|
| 0 | Overview & scope | S | — |
| 1 | Pre-migration checklist (`fileRegex` audit, MCP source decision, backup, disable Roo) | S | **🚨 audit gates everything** |
| 2 | Shared assets (`AGENTS.md`, `.agent.md`, `.instructions.md`) | M | ✅ |
| 3 | Chat-side configuration (`.vscode/mcp.json`, user `mcp.json`, toolsets, `copilot-instructions.md`) | M | ✅ |
| 4 | 17-mode mapping table (1 row per vault mode) | M | ✅ |
| 5 | Stage-1 execution (8 PowerShell steps; reload + verify) | M | ✅ |
| 6 | Hand-off to Phase 8b | S | — |
| 7 | CLI-side configuration (`~/.copilot/`, `COPILOT_HOME`, BYOK env vars, `mcp-config.json`) | M | ✅ |
| 8 | `preToolUse` hook for the 4 `fileRegex` modes (PowerShell ref impl + JSON policy table) | L | **🚨 sole G-1 mitigation** |
| 9 | MCP canonical-source generator (Q-050; `scripts/generate-cli-mcp.ps1`) | M | ✅ |
| 10 | Setup automation (`setup-copilot-vault.ps1`, `setup-copilot-project.ps1`, pre-commit hook) | L | — |
| 11 | Validation matrix (24 tests across Chat / CLI / hooks / cross-cutting) | M | **🚨 cutover gate** |
| 12 | Rollback plan (full + 4 partial scenarios; sign-off checklist) | S | — |
| App. B | Path B (CLI-only) fallback playbook | S | — |

**Total estimated effort:** **1–2 weeks** for the first project (Stage 1 ≈ 3–7 days Chat scaffold; Stage 2 ≈ 2–5 days CLI + hooks); **<1 day per additional project**; **~3–5 hours/month** ongoing maintenance (track upstream issues, regenerate MCP on edits).

Effort scale: **S** = ≤ ½ day · **M** = ½ – 2 days · **L** = 2 – 5 days.

**Critical path** (must complete in order, cannot parallelise): § 1 audit → § 2–4 shared assets → § 5 Stage-1 verify → § 7–8 CLI + hook → § 11 validation → cutover. § 9 generator and § 10 automation can land in parallel with § 8 hook authoring.

---

## § 10 — Risks & Mitigations

Top 5 risks, ordered by severity × likelihood:

| # | Risk | Severity | Likelihood | Mitigation | Owner action |
|---|---|---|---|---|---|
| 1 | **CG-11 — sub-agent `preToolUse` bypass** ([`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392)). `task`-dispatched restricted modes leak past the hook | 🟠 Major | High (active bug) | Avoid dispatching `architect` / `translate` / `docs-extractor` / `docs-writer` as sub-agents; orchestrator agent body forbids it; warning paragraph in each restricted agent body ([`80 § 8.6`](80-migration-playbook.md#-86--caveats--known-limitations)) | Pin the issue; review monthly; drop the convention when fixed |
| 2 | **SDK 0.x churn** if user later considers Path D. 54 versions in 5 months; runtime patcher needed at squad ([`90 2026-04-26 17:58`](90-decision-log.md)) | 🟠 Major | Certain (so long as 0.x) | Defer Path D; if pursued, mirror Squad's adapter-types pattern + `as Parameters<typeof …>[N]` casts | Re-evaluate when SDK reaches 1.0 |
| 3 | **Copilot pricing changes** disrupt BYOK or agent-mode tier gating | 🟠 Major | Low–Medium | Keep CLI BYOK env vars set; fall back to local Ollama if Pro+ becomes uneconomic; preserve cross-tool `.agent.md` portability (W-5) | Re-verify [§ 1 step 3](80-migration-playbook.md#-1--pre-migration-checklist) tier table quarterly |
| 4 | **Microsoft renames `.agent.md` again** (it was `.chatmode.md` until early 2026) | 🟡 Minor | Low | Vault file naming is mechanical; rename is a `Get-ChildItem` one-liner; track [`microsoft/vscode#251515`](https://github.com/microsoft/vscode/issues/251515) and the Phase-4d release-version provenance (Q-016) | Monitor Insider release notes monthly |
| 5 | **Vault drift between Chat and CLI** if MCP edits land in the CLI mirror by accident | 🟡 Minor | Medium | Pre-commit hook regenerates `mcp-config.json` from `.vscode/mcp.json` on every commit ([`80 § 10.3`](80-migration-playbook.md#-103--pre-commit-hook-stub-closes--93-todo)); CLI mirror documented as build output | Audit `git status` of `mcp-config.json` after edits |

Lower-tier risks (filed but not in the top 5): pwsh cold-start latency (Q-039 / T-X-05), OneDrive symlink behaviour (Q-058), `AGENTS.local.md` dual-surface support (Q-051 — verification recipe shipped).

---

## § 11 — Open Questions Worth Watching

Of the ~58 questions filed in [`99-open-questions.md`](99-open-questions.md) (most resolved), the 5 most consequential remaining for the user:

| ID | Question | Why it matters | When to revisit |
|---|---|---|---|
| **Q-047** | Vault's actual `fileRegex` usage breadth — how many modes use `fileRegex` *and* are dispatched as sub-agents from the orchestrator? | Determines whether G-1 stays 🟠 or re-escalates to 🔴 on the CLI side under CG-11 | **Before Stage-1** (audit command in [`80 § 1`](80-migration-playbook.md#-1--pre-migration-checklist) step 1) |
| **Q-049** | Roo's `update_todo_list` re-injection has no Copilot equivalent | Long orchestrator tasks may lose "always-on" todo context; affects daily UX | After 30 days of Hybrid usage; file feature request if missed |
| **Q-054** | Does the CLI export `$env:COPILOT_AGENT` to hook subprocesses? | If yes, [`80 § 8.3`](80-migration-playbook.md#-83--active-agent-discovery-cg-13-mitigation)'s sidecar wrapper can be dropped — simpler hook | During Stage-2 (probe in 5 minutes per the question body) |
| **Q-057** | Hook latency baseline on the user's box — < 400 ms target per `enforce-file-regex.ps1` call (T-X-05) | If > 1 s, escalate to a compiled hook (Go binary); affects every restricted-mode tool call | During Stage-1 → Stage-2 cutover |
| **Q-058** | Symlink behaviour under OneDrive / corporate redirected profiles | Affects multi-machine / enterprise vault deployment | First cross-machine deployment |

Two upstream issues to subscribe to (GitHub bell icon): [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) (sub-agent hook bypass) and [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) (structured event stream). When either ships, revisit the score table in § 6.

---

## § 12 — Recommended Next Steps

A concrete, sequenced rollout. Each step references the playbook section that owns it.

| # | Step | Effort | Playbook reference |
|---:|---|---|---|
| 1 | **Today.** Run the vault `fileRegex` audit (Q-047) and confirm the 4-mode hook coverage list. Verify Copilot subscription tier at `https://github.com/settings/copilot`. Verify `node -v` ≥ 22.5. Subscribe to [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) and [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) | ½ day | [`80 § 1`](80-migration-playbook.md#-1--pre-migration-checklist) |
| 2 | **Day 1.** Take the dated backup (script in `§ 1` step 5). Disable (do **not** uninstall) the Roo-Code extension globally | 1 hour | [`80 § 1`](80-migration-playbook.md#-1--pre-migration-checklist) step 5–6 |
| 3 | **Days 2–4 — Stage 1.** Convert all 17 vault modes to `.github/agents/*.agent.md` per the worked architect example. Author / copy `AGENTS.md`. Convert `.roo/rules/` to `.github/instructions/*.instructions.md`. Convert `.roo/mcp.json` and global `mcp_settings.json` to the Chat schema. Reload VS Code; run the smoke tests in [`§ 5`](80-migration-playbook.md#-5--step-by-step-phase-8a-execution) step 7–8 | 3 days | [`80 §§ 2–5`](80-migration-playbook.md#-2--shared-assets-work-in-both-chat-and-cli) |
| 4 | **Days 5–6 — CLI bootstrap.** Install `@github/copilot`. Set `COPILOT_HOME` to the vault. Symlink `~/.copilot/agents/` → vault. Set 4 MCP env vars (`GITHUB_PAT`, `TAVILY_API_KEY`, `CONTEXT7_API_KEY`, `ADO_PAT`). Optionally set `COPILOT_PROVIDER_*` for Ollama BYOK | 2 days | [`80 § 7`](80-migration-playbook.md#-7--cli-side-configuration-phase-8b-i) |
| 5 | **Days 7–9 — Hook + generator.** Author `enforce-file-regex.ps1` and `mode-policies.json` for the 4 restricted modes. Author `generate-cli-mcp.ps1` and run it once. Wire up the `~/.copilot/hooks.json` registration | 3 days | [`80 §§ 8–9`](80-migration-playbook.md#-8--pretooluse-hook-for-fileregex-enforcement-phase-8b-i) |
| 6 | **Day 10.** Run `setup-copilot-vault.ps1` and `setup-copilot-project.ps1` to install symlinks and pre-commit hook. Verify with `Test-CanSymlink` pre-flight | ½ day | [`80 § 10`](80-migration-playbook.md#-10--setup-automation-phase-8b-ii) |
| 7 | **Day 11 — Cutover gate.** Execute the entire 24-row validation matrix. Record T-X-05 latency baseline (closes Q-057). Confirm T-CLI-CG11 reproduces (or doesn't — if not, the upstream bug is fixed and the playbook updates) | 1 day | [`80 § 11`](80-migration-playbook.md#-11--validation-matrix-phase-8b-ii) |
| 8 | **Day 11+.** Begin daily-driver use of Path Hybrid. Keep Roo-Code disabled but installed for 30 days. File a decision-log entry capturing any unexpected friction | ongoing | [`80 § 12`](80-migration-playbook.md#-12--rollback-plan-phase-8b-ii) sign-off criteria |
| 9 | **Day 41.** After 30 days of clean operation, **uninstall Roo-Code**. Archive `globalStorage\rooveterinaryinc.roo-cline\` to backup folder. Investigation officially closed at the user's end | ½ day | [`80 § 12.4`](80-migration-playbook.md#-124--sign-off-criteria-for-rollback-complete) (inverse) |
| 10 | **Ongoing — monthly.** Re-run validation matrix. Audit chat history for G-1 prose violations (>2 in 30 days = trigger Path B per Appendix B.1). Refresh issue subscriptions | 1 hour/month | [`80 § 11.3`](80-migration-playbook.md#-113--cross-cutting-tests-5-rows) "When to run what" |

**The single most consequential next step is #1 — without the `fileRegex` audit, Stage 1 cannot scope the hook coverage list.** Everything else flows from that count.

---

## § 13 — Decision Record (Top 5)

Condensed from [`90-decision-log.md`](90-decision-log.md). Format: decision · rationale · alternative rejected · date.

| # | Decision | Rationale | Alternative rejected | Date |
|---|---|---|---|---|
| 1 | **Adopt Path Hybrid (Chat + CLI) as primary** | Highest weighted score (3.90); closes G-1 where it matters; bounded effort; max reversibility | Path A (3.10 — G-1 unmitigated, no headless); Path C (3.20 — alpha tax); Path D (3.25 — ~1 month build cost) | 2026-04-26 18:27 |
| 2 | **Chat's `.vscode/mcp.json` is the canonical MCP source; CLI mirror is generated** (Q-050) | IDE-centric vault; `.vscode/mcp.json` is what the "MCP: Open Workspace Configuration" command edits; preserves Credential Manager UX | CLI-as-truth (loses `${input:id}` first-run prompt); third canonical YAML (extra file no tool reads) | 2026-04-26 18:45 |
| 3 | **Accept CG-11 as a known limitation; enforce by convention** (avoid `task` dispatch of restricted modes) | The 4 restricted modes are typically boot agents, not sub-agents; vault's actual usage pattern minimises blast radius; convention is enforceable via prose discipline; auto-resolves when [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) ships | Path D for the 4 modes (~1 month for one bug); abandon CLI side (loses headless + BYOK) | 2026-04-26 18:45 |
| 4 | **Symlink, do not copy, for vault → consumer paths** | Single source of truth; multi-machine portability; mirrors existing `roo-vault\setup-vault.ps1` pattern; `Test-CanSymlink` pre-flight surfaces the admin/Developer-Mode requirement clearly | Copy (forks edits, breaks multi-machine); junctions only (silent OneDrive degradation) | 2026-04-26 18:52 |
| 5 | **Phase 8 split into 8a (Chat) + 8b-i (CLI core) + 8b-ii (automation/validation/rollback)** | Lets Stage-1 work begin immediately without blocking on full CLI side; clean hand-off boundaries documented in inline TODOs | Monolithic Phase 8 (delays Stage 1); ship CLI first (worse onboarding for IDE-centric user) | 2026-04-26 18:35 → 18:52 |

---

## § 14 — Appendix: File Map

Every memory file in the investigation, with status and approximate line count.

| File | Status | Purpose | Approx. lines |
|---|---|---|---:|
| [`README.md`](README.md) | ✅ index | Phase status badges, file map, usage rules | ~80 |
| [`00-executive-summary.md`](00-executive-summary.md) | ✅ Phase 9 | **This file — START HERE** | ~370 |
| [`00-plan.md`](00-plan.md) | ✅ historical | Original 9-phase investigation plan and methodology | ~200 |
| [`10-roo-inventory.md`](10-roo-inventory.md) | ✅ Phase 1 | Roo-Code feature inventory (modes, MCP, rules, tools, storage) | ~300 |
| [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md) | ✅ Phase 2 | `roo-vault` layout (17 modes, 7 MCP servers, symlink-and-commit pattern) | ~250 |
| [`30-squad-inventory.md`](30-squad-inventory.md) | ✅ Phase 3 | Squad inventory (alpha v0.9.1; CLI-driver, no `vscode.lm`) | ~200 |
| [`40-copilot-chat-research.md`](40-copilot-chat-research.md) | ✅ Phase 4 | Custom agents, instructions, prompt files, tool sets, MCP, agent mode, Gap Catalog (G-/W-) | ~900 |
| [`50-copilot-cli-research.md`](50-copilot-cli-research.md) | ✅ Phase 5 | Identity/install, agent loop, MCP, Hooks (preToolUse verdict), Skills, Scripting, full SDK exports, CLI Gap Catalog (CG-/CW-) | ~1,400 |
| [`60-gap-analysis.md`](60-gap-analysis.md) | ✅ Phase 6 | Unified gap matrix (~70 rows × 12 sections); severity tally; top-10 callout | ~270 |
| [`70-migration-paths.md`](70-migration-paths.md) | ✅ Phase 7 | A/B/C/D + Hybrid scoring against 8 weighted criteria; recommendation = Path Hybrid | ~510 |
| [`80-migration-playbook.md`](80-migration-playbook.md) | ✅ Phase 8 | Concrete file-by-file Hybrid migration; 12 sections + Appendix B; 24-row validation matrix | ~1,770 |
| [`90-decision-log.md`](90-decision-log.md) | ✅ closed | Append-only ADRs (~14 entries); investigation closed by Phase 9 retrospective | ~700 |
| [`99-open-questions.md`](99-open-questions.md) | ✅ active | Q-001..Q-058; resolved items struck through with link to resolving entry | ~130 |

**Total investigation footprint:** ~7,100 lines of memory across 13 files, all cross-linked, all citing primary sources.

---

## Cross-links

- Recommendation source: [`70-migration-paths.md` § 4](70-migration-paths.md#-4--recommendation)
- Execution: [`80-migration-playbook.md`](80-migration-playbook.md)
- Decisions: [`90-decision-log.md`](90-decision-log.md)
- Open questions: [`99-open-questions.md`](99-open-questions.md)
- Vault entry points: [`../../../../roo-vault/global-settings/custom_modes.yaml`](../../../../roo-vault/global-settings/custom_modes.yaml) · [`../../../../roo-vault/global-settings/mcp_settings.json`](../../../../roo-vault/global-settings/mcp_settings.json) · [`../../../../roo-vault/setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1)
