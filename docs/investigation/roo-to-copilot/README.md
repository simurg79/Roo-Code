---
phase: index
status: complete
owner: architect-subtask
last_updated: 2026-04-30
sources:
    - docs/investigation/roo-to-copilot/10-roo-inventory.md
    - docs/investigation/roo-to-copilot/20-roo-vault-inventory.md
    - docs/investigation/roo-to-copilot/30-squad-inventory.md
    - docs/investigation/roo-to-copilot/35-paw-inventory.md
---

# Roo-Code → GitHub Copilot Migration Investigation

> 📌 **START HERE → [`00-executive-summary.md`](00-executive-summary.md)** — single self-contained 5–10 minute read covering the recommendation (**Path Hybrid: Copilot Chat + CLI**), the gap landscape, and a 10-step rollout plan. **Now includes a Phase 10 addendum (§ 7.1)** documenting the PAW evaluation: Hybrid stays primary at 3.90; Hybrid+PAW (3.85) is a Stage-3 escalation; Path E (PAW alone, 2.60) is not recommended. All other files in this folder are supporting detail.

## Purpose

This memory-file set tracks a long-running investigation into the question:

> **How do I leave Roo-Code and recreate the same experience using GitHub Copilot (Chat extension and/or CLI), with Squad as a possible intermediary?**

The user's verbatim goal: replicate the Roo-Code experience — **modes, orchestrator, MCP, custom prompts, rules, memory** — in **GitHub Copilot Chat** and/or **Copilot CLI**, possibly via **Squad**; ultimately leave Roo-Code.

## Decision Question

> **Squad vs Copilot Chat built-ins vs Copilot CLI built-ins — which path?**

Sub-questions:

- Can Copilot Chat's custom chat modes + prompt files + MCP fully replace Roo modes/orchestrator/MCP?
- Does Copilot CLI offer enough automation surface to replace Roo for terminal workflows?
- Does Squad add value as a translation/orchestration layer, or is it redundant?
- What is the minimal-effort migration path that preserves the [`roo-vault`](../../../../roo-vault) multi-project layout?

## File Map

| File                                                         | Phase | Description                                                                                                                     |
| ------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`README.md`](README.md)                                     | —     | This index. Read first.                                                                                                         |
| [`00-executive-summary.md`](00-executive-summary.md)         | 9     | **START HERE.** Self-contained 5–10 minute summary; recommendation = Path Hybrid; 10-step rollout.                              |
| [`00-plan.md`](00-plan.md)                                   | All   | Investigation plan, goals, methodology, 9-phase breakdown (historical; superseded as entry point by `00-executive-summary.md`). |
| [`10-roo-inventory.md`](10-roo-inventory.md)                 | 1     | Inventory of Roo-Code features to replicate.                                                                                    |
| [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md)     | 2     | Inventory of the user's `roo-vault` multi-project layout.                                                                       |
| [`30-squad-inventory.md`](30-squad-inventory.md)             | 3     | Investigation of Squad at `c:/git/squad`.                                                                                       |
| [`35-paw-inventory.md`](35-paw-inventory.md)                 | 10a   | Investigation of PAW (Phased Agent Workflow) at `c:/git/phased-agent-workflow`.                                                 |
| [`40-copilot-chat-research.md`](40-copilot-chat-research.md) | 4     | Research on GitHub Copilot Chat (VS Code).                                                                                      |
| [`50-copilot-cli-research.md`](50-copilot-cli-research.md)   | 5     | Research on GitHub Copilot CLI.                                                                                                 |
| [`60-gap-analysis.md`](60-gap-analysis.md)                   | 6     | Roo-vs-Copilot/Squad feature gap matrix.                                                                                        |
| [`70-migration-paths.md`](70-migration-paths.md)             | 7     | Candidate migration paths A/B/C/D with trade-offs.                                                                              |
| [`80-migration-playbook.md`](80-migration-playbook.md)       | 8     | Concrete file-by-file migration playbook.                                                                                       |
| [`90-decision-log.md`](90-decision-log.md)                   | All   | Append-only decision log. Read first.                                                                                           |
| [`99-open-questions.md`](99-open-questions.md)               | All   | Running list of unresolved questions.                                                                                           |

## How to Use These Memory Files

Future agents working on this investigation **must**:

1. **Always read first**, in this order:
    - [`README.md`](README.md) (this file)
    - [`00-plan.md`](00-plan.md) (the plan and methodology)
    - [`90-decision-log.md`](90-decision-log.md) (what has already been decided)
2. **Append, do not overwrite.** Findings files grow over time. Preserve prior content; add new sections with dated headings.
3. **Date every entry.** Use ISO-8601 (`YYYY-MM-DD`) at minimum; `YYYY-MM-DD HH:MM` for the decision log.
4. **Cite sources.** Every factual claim about Copilot, Squad, or Roo internals must include a URL and access date in the file's `sources:` front-matter and inline near the claim.
5. **Update the front-matter** `status` and `last_updated` fields on every edit.
6. **Log decisions** in [`90-decision-log.md`](90-decision-log.md) — never silently change direction.
7. **Open questions** go in [`99-open-questions.md`](99-open-questions.md) as soon as they arise; remove or strike through only when resolved (with a link to the resolving decision).

## Status Badges

| Phase                                                 | File                                                                                                                                                                                                         | Status                                                                                                                                                                                                                                                                                                                                                                                     | Last updated |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 0 — Scaffolding                                       | [`README.md`](README.md), [`00-plan.md`](00-plan.md)                                                                                                                                                         | ✅ scaffold complete                                                                                                                                                                                                                                                                                                                                                                       | 2026-04-26   |
| 1 — Roo inventory                                     | [`10-roo-inventory.md`](10-roo-inventory.md)                                                                                                                                                                 | ✅ complete                                                                                                                                                                                                                                                                                                                                                                                | 2026-04-26   |
| 2 — roo-vault inventory                               | [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md)                                                                                                                                                     | ✅ complete                                                                                                                                                                                                                                                                                                                                                                                | 2026-04-26   |
| 3 — Squad inventory                                   | [`30-squad-inventory.md`](30-squad-inventory.md)                                                                                                                                                             | ✅ complete                                                                                                                                                                                                                                                                                                                                                                                | 2026-04-26   |
| 4 — Copilot Chat research                             | [`40-copilot-chat-research.md`](40-copilot-chat-research.md)                                                                                                                                                 | ✅ complete (4a + 4b + 4c + 4d — agents/instructions, prompt files, tool sets, MCP, Windows storage, agent mode + sub-agents, chat extension API, Gap Catalog)                                                                                                                                                                                                                             | 2026-04-26   |
| 5 — Copilot CLI research                              | [`50-copilot-cli-research.md`](50-copilot-cli-research.md)                                                                                                                                                   | ✅ complete (5a + 5b-i + 5b-ii-A + 5b-ii-B-1 + 5b-ii-B-2 — identity/install, agent loop, custom instructions/agents, Squad cross-ref, Roo↔CLI mapping, MCP deep-dive, Hooks deep-dive incl. preToolUse/fileRegex verdict, Skills + Scripting/automation, full `@github/copilot-sdk` export catalogue + Path-D embeddability verdict, **CLI Gap Catalog (G-/W- inherited + CG-/CW- new)**) | 2026-04-26   |
| 6 — Gap analysis                                      | [`60-gap-analysis.md`](60-gap-analysis.md)                                                                                                                                                                   | ✅ complete (unified Chat + CLI gap matrix, 12 grouped sections, ~70 rows, severity tally, top-10 callout, Squad-as-overlay interpretation, Phase 7/8 handoff)                                                                                                                                                                                                                             | 2026-04-26   |
| 7 — Migration paths                                   | [`70-migration-paths.md`](70-migration-paths.md)                                                                                                                                                             | ✅ complete (8 weighted criteria, A/B/C/D + Hybrid scored, side-by-side table, recommendation = **Path Hybrid**, decision tree, sensitivity analysis, Phase-8 hand-off)                                                                                                                                                                                                                    | 2026-04-26   |
| 8 — Migration playbook                                | [`80-migration-playbook.md`](80-migration-playbook.md)                                                                                                                                                       | ✅ complete (8a + 8b-i + **8b-ii**: shared assets + Chat side + 17-mode table + CLI-side config + preToolUse hook + MCP generator + setup automation + 24-row validation matrix + rollback plan + Path B appendix)                                                                                                                                                                         | 2026-04-26   |
| 9 — Executive summary                                 | [`00-executive-summary.md`](00-executive-summary.md)                                                                                                                                                         | ✅ complete                                                                                                                                                                                                                                                                                                                                                                                | 2026-04-26   |
| 10a — PAW inventory                                   | [`35-paw-inventory.md`](35-paw-inventory.md)                                                                                                                                                                 | ✅ complete                                                                                                                                                                                                                                                                                                                                                                                | 2026-04-30   |
| 10b — PAW gap-matrix evaluation (Path E + Hybrid+PAW) | [`60-gap-analysis.md`](60-gap-analysis.md) § G + [`70-migration-paths.md`](70-migration-paths.md) §§ 2.F / 2.G                                                                                               | ✅ complete                                                                                                                                                                                                                                                                                                                                                                                | 2026-04-30   |
| 10c — Re-score recommendation                         | [`00-executive-summary.md`](00-executive-summary.md) §§ 1, 6, 7.1, 12, 13, 14 updated with Phase 10b finding (Hybrid 3.90 unchanged; Path E = 2.60; Hybrid+PAW = 3.85; PAW documented as Stage-3 escalation) | ✅ complete                                                                                                                                                                                                                                                                                                                                                                                | 2026-04-30   |

Legend: ⬜ not-started · 🟡 in-progress / partially-seeded · ✅ complete · ⛔ blocked

## Phase 10 — PAW evaluation (re-opened 2026-04-30)

The investigation was closed at the end of Phase 9 with **Path Hybrid (Chat + CLI)** as the recommendation (weighted 3.90; see [`00-executive-summary.md`](00-executive-summary.md)). Phase 10 was re-opened on 2026-04-30 to evaluate a new candidate, **PAW (Phased Agent Workflow)** at `c:/git/phased-agent-workflow`. Phase 10 is a 3-step sequence:

| Sub-phase                                             | Scope                                                                                                                                                                                                                                                                                                                                                                                  | Status                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **10a — Inventory PAW**                               | Read-only inspection of PAW source. Produce [`35-paw-inventory.md`](35-paw-inventory.md) modelled on [`30-squad-inventory.md`](30-squad-inventory.md) with frontmatter + 13 sections + preliminary Gap Catalog (P-/PW-) + open questions (Q-059..).                                                                                                                                    | ✅ complete (2026-04-30)                                                                                                     |
| **10b — Gap-matrix evaluation (Path E + Hybrid+PAW)** | Fold the P-/PW- catalog into [`60-gap-analysis.md`](60-gap-analysis.md) (PAW column added to all 12 sub-tables + new § G PAW Surface Summary). Define **Path E (PAW alone on top of one host)** and **Path Hybrid+PAW (Hybrid substrate + PAW layer)** as new candidate paths and score both with the Phase-7 rubric in [`70-migration-paths.md`](70-migration-paths.md) §§ 2.F / 2.G. | ✅ complete (2026-04-30) — **Path E = 2.60 (worst); Hybrid+PAW = 3.85 (2nd); Hybrid 3.90 standing recommendation unchanged** |
| **10c — Re-score recommendation**                     | Update [`00-executive-summary.md`](00-executive-summary.md) headline to reflect the Phase 10b finding (Hybrid stays primary; Hybrid+PAW is a Stage-3 escalation analogous to Squad on Path C). Recommendation does **not** flip per Phase 10b.                                                                                                                                         | ✅ complete (2026-04-30) — addendum landed in §§ 1, 6, 7.1, 12, 13, 14; investigation re-closed                              |

Phase 10 does **not** invalidate Phases 1–9 — Path Hybrid remains the standing recommendation. **Phase 10b confirmed this**: Path E (2.60) and Hybrid+PAW (3.85) both score below plain Hybrid (3.90). PAW is documented as a Stage-3 escalation path for users whose workflow is dominated by spec-driven feature PRs. **Phase 10c re-closed the investigation on 2026-04-30** after threading the Phase 10b finding into the executive summary. See [`90-decision-log.md`](90-decision-log.md) for the Phase 10b and Phase 10c decision entries.
