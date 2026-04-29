---
phase: plan
status: not-started
owner: tbd
last_updated: 2026-04-26
sources: []
---

# Investigation Plan — Roo-Code → GitHub Copilot

> Read [`README.md`](README.md) and [`90-decision-log.md`](90-decision-log.md) before editing this file.

## Goal (verbatim)

Replicate the Roo-Code experience — **modes, orchestrator, MCP, custom prompts, rules, memory** — in **GitHub Copilot Chat** and/or **Copilot CLI**, possibly via **Squad**; ultimately **leave Roo-Code**.

## Non-goals

- Building a new AI coding agent from scratch.
- Forking or maintaining Roo-Code long-term.
- Evaluating non-Copilot agents (Cursor, Cline, Continue, Aider, etc.) beyond brief mention.
- Migrating teammates / org-wide tooling — this is a single-developer migration.

## Success Criteria

The investigation is "done" when **all** of the following hold:

1. A clear, recorded **decision** in [`90-decision-log.md`](90-decision-log.md) on path A/B/C/D (Chat-only / CLI-only / Squad-mediated / hybrid).
2. A working **migration playbook** in [`80-migration-playbook.md`](80-migration-playbook.md) that maps every Roo concept the user actually relies on to a concrete Copilot artifact.
3. A populated **gap analysis** in [`60-gap-analysis.md`](60-gap-analysis.md) with no gap rated `blocker` left without a workaround or accepted-loss note.
4. The user can disable the Roo-Code extension and continue working on existing projects in [`roo-vault`](../../../../roo-vault) without functional regression beyond accepted losses.

## Constraints

- **OS**: Windows 11.
- **Editor**: Visual Studio Code (stable).
- **Multi-project layout**: User maintains [`roo-vault`](../../../../roo-vault) at `c:/git/roo-vault` containing global settings, per-project overrides, setup scripts, and memory/notes conventions.
- **Squad**: Source available at `c:/git/squad` for inspection.
- **Roo workspace**: Active development copy at `c:/git/Roo-Code` (this repo).
- **No paid tier assumptions** beyond the user's existing GitHub Copilot subscription tier (to be confirmed in Phase 4).
- **Preserve memory/context**: existing project memory conventions must survive migration.

## 9-Phase Plan

### Phase 1 — Inventory the Roo-Code experience
**Artifact:** [`10-roo-inventory.md`](10-roo-inventory.md)

Concrete questions to answer:
- What built-in modes exist and what is each one's system prompt shape?
- Schema of `.roomodes` and the global `custom_modes.yaml`?
- How does the Orchestrator mode delegate to other modes (boomerang/subtask mechanics)?
- How is MCP wired: global `mcp_settings.json` vs project `.roo/mcp.json`, per-mode `allowedMcpServers`?
- Custom prompt/rule loading order: `.roo/rules/`, `AGENTS.md`, mode-specific rules.
- What memory/context features exist (todo list, reminders, condensing, memory bank patterns)?
- Native tool surface — full enumerated list of tools each mode can call.
- Where are settings stored on disk on Windows (globalStorage paths, workspace `.roo/`)?
- Which webview-UI features (mode picker, MCP toggles, context settings) are worth replicating?

### Phase 2 — Inventory the roo-vault layout
**Artifact:** [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md)

Concrete questions:
- Top-level directory layout of `c:/git/roo-vault`.
- What lives in `global-settings/` (e.g. `custom_modes.yaml`)?
- How are per-project overrides organized under `projects/<name>/.roo/`?
- What does `setup/setup_dev_box.ps1` install/configure?
- Memory/notes conventions: file names, locations, lifecycle.
- MCP server inventory: which servers are registered globally vs per-project.

### Phase 3 — Investigate Squad
**Artifact:** [`30-squad-inventory.md`](30-squad-inventory.md)

Concrete questions:
- What is Squad? (Project description, README, package.json, entry points.)
- Architecture — is it an extension, CLI, library, orchestrator?
- Relationship to Copilot — does it wrap, extend, or replace Copilot APIs?
- Relationship to Roo-Code — overlap, divergence, shared concepts.
- Feature overlap matrix vs Roo features identified in Phase 1.
- Verdict: use as primary / use partially / don't use.

### Phase 4 — Research GitHub Copilot Chat in VS Code
**Artifact:** [`40-copilot-chat-research.md`](40-copilot-chat-research.md)

Concrete questions:
- Custom chat modes — `.chatmode.md` file format, location, capabilities, limits.
- `.github/copilot-instructions.md` — scope, precedence, multi-file support.
- Prompt files — `.prompt.md` format, invocation, parameters.
- MCP support — config file location, per-mode allowlists?, transport types.
- Tool sets — defining and scoping tools per mode.
- Agent mode — capabilities, sub-agent / delegation support.
- Chat participants & extension API — can custom extensions add modes/tools?
- Storage locations on Windows (globalStorage, workspace settings).
- Known limits and gaps vs Roo.

### Phase 5 — Research GitHub Copilot CLI
**Artifact:** [`50-copilot-cli-research.md`](50-copilot-cli-research.md)

Same shape as Phase 4 but for the CLI:
- Install/auth, agent loop semantics, MCP support, custom instructions, scripting/automation hooks, storage locations, limits.

### Phase 6 — Gap analysis matrix
**Artifact:** [`60-gap-analysis.md`](60-gap-analysis.md)

Build a single table: **Roo feature → Copilot Chat equivalent → Copilot CLI equivalent → Squad equivalent → gap severity → workaround → notes**. Severity scale: `none / minor / major / blocker`.

### Phase 7 — Migration path options
**Artifact:** [`70-migration-paths.md`](70-migration-paths.md)

Evaluate four candidate paths with pros, cons, effort, risk, prerequisites:
- **Path A:** Copilot Chat only.
- **Path B:** Copilot CLI only.
- **Path C:** Squad-mediated (Squad as orchestrator over Copilot).
- **Path D:** Hybrid (Chat for interactive, CLI for automation, Squad optionally for orchestration).

### Phase 8 — Concrete migration playbook
**Artifact:** [`80-migration-playbook.md`](80-migration-playbook.md)

File-by-file mappings:
- `.roomodes` → Copilot `.chatmode.md` files (+ schema converter notes).
- `.roo/rules/*` → `.github/copilot-instructions.md` (+ split strategy).
- Global `custom_modes.yaml` → user-scope chatmode location.
- `mcp.json` (global + project) → Copilot MCP config.
- Memory bank conventions → Copilot prompt files + instruction files.
- `roo-vault` layout → equivalent Copilot multi-project layout.
- Step-by-step migration order with rollback notes.

### Phase 9 — Executive summary + decision record
**Artifact:** [`90-decision-log.md`](90-decision-log.md) (final entry) + summary section in [`README.md`](README.md).

Final entry must include: chosen path, rationale, accepted losses, follow-up tasks.

## Methodology Rules

- **Cite sources.** Every factual claim sourced from the web includes URL + access date. Every claim about Roo internals references a file path with line number where possible (e.g. [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts)).
- **Quote primary docs** verbatim where ambiguity matters; paraphrase only when summarizing.
- **Note uncertainty explicitly** with `> ⚠️ Uncertain:` callouts rather than silent guesses.
- **Prefer official Microsoft / GitHub documentation** over blog posts; mark community sources as such.
- **Append-only decision log.** Never rewrite history; supersede with a new dated entry.
- **One decision per log entry.** Bundling decisions hides rationale.
- **Date everything.** ISO-8601.

## Cross-links

- Index: [`README.md`](README.md)
- Decision log: [`90-decision-log.md`](90-decision-log.md)
- Open questions: [`99-open-questions.md`](99-open-questions.md)
