---
phase: 10a
status: complete
owner: architect-subtask
date: 2026-04-30
last_updated: 2026-04-30
source_path: c:/git/phased-agent-workflow
sources:
    - ../../../../phased-agent-workflow/README.md
    - ../../../../phased-agent-workflow/package.json
    - ../../../../phased-agent-workflow/plugin.json
    - ../../../../phased-agent-workflow/paw-specification.md
    - ../../../../phased-agent-workflow/agents/PAW.agent.md
    - ../../../../phased-agent-workflow/agents/PAW-Review.agent.md
    - ../../../../phased-agent-workflow/skills/paw-init/SKILL.md
    - ../../../../phased-agent-workflow/skills/paw-workflow/SKILL.md
    - ../../../../phased-agent-workflow/skills/paw-implement/SKILL.md
    - ../../../../phased-agent-workflow/skills/paw-transition/SKILL.md
    - ../../../../phased-agent-workflow/src/extension.ts
    - ../../../../phased-agent-workflow/src/tools/handoffTool.ts
    - ../../../../phased-agent-workflow/src/agents/installer.ts
    - ../../../../phased-agent-workflow/src/agents/platformDetection.ts
    - ../../../../phased-agent-workflow/cli/bin/paw.js
    - ../../../../phased-agent-workflow/cli/package.json
---

# Phase 10a — PAW Inventory

> Parent plan: [`00-plan.md`](00-plan.md) · Index: [`README.md`](README.md) · Companion inventories: [`30-squad-inventory.md`](30-squad-inventory.md), [`10-roo-inventory.md`](10-roo-inventory.md) · Gap taxonomy: [`60-gap-analysis.md`](60-gap-analysis.md)

**TL;DR.** PAW (Phased Agent Workflow) is a **two-agent prompt-and-skill bundle** that turns GitHub Copilot Chat / Copilot CLI / Claude Code into a structured, artifact-driven multi-phase development workflow (Spec → Research → Plan → Implement → Review → PR). It is **not** a runtime, agent loop, MCP host, or model client of its own — it ships only Markdown agents, ~30 SKILL.md files, two thin distribution wrappers (a 310-line VS Code extension that installs the agent files plus a Node CLI installer), and a 23-field `WorkflowContext.md` configuration schema.

> ⚠️ **Read order discipline.** This file describes **only what PAW is**, in PAW's own terms, against [`30-squad-inventory.md`](30-squad-inventory.md)'s structure. **No comparison to Roo, Copilot, or Squad capabilities** outside § 12 (Gap Catalog) — that's Phase 10b's job.

---

## 1. Identity & Provenance

| Field                        | Value                                                                                                                                                                                                                                                                          | Source                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Project name                 | **Phased Agent Workflow** (PAW)                                                                                                                                                                                                                                                | [`README.md`](../../../../phased-agent-workflow/README.md:1-3)                                                                                                                 |
| Repo URL                     | `https://github.com/lossyrob/phased-agent-workflow`                                                                                                                                                                                                                            | [`package.json`](../../../../phased-agent-workflow/package.json:7-10), [`plugin.json`](../../../../phased-agent-workflow/plugin.json:10)                                       |
| License                      | MIT                                                                                                                                                                                                                                                                            | [`package.json`](../../../../phased-agent-workflow/package.json:11), [`plugin.json`](../../../../phased-agent-workflow/plugin.json:11), `LICENSE`                              |
| Languages                    | TypeScript (VS Code extension) + JavaScript ESM (Node CLI) + ~30 Markdown agent/skill files                                                                                                                                                                                    | [`package.json`](../../../../phased-agent-workflow/package.json:240), [`cli/package.json`](../../../../phased-agent-workflow/cli/package.json:5)                               |
| Runtime                      | VS Code `^1.109.0` (extension); Node `>=18.0.0` (CLI installer); GitHub Copilot CLI / Claude Code (the agents themselves)                                                                                                                                                      | [`package.json`](../../../../phased-agent-workflow/package.json:13), [`cli/package.json`](../../../../phased-agent-workflow/cli/package.json:35)                               |
| Package manager              | npm (with `package-lock.json` in both root and `cli/`)                                                                                                                                                                                                                         | [`package.json`](../../../../phased-agent-workflow/package.json), [`cli/package-lock.json`](../../../../phased-agent-workflow/cli/package-lock.json)                           |
| Distribution channels        | (a) **Copilot CLI plugin** `copilot plugin install lossyrob/phased-agent-workflow`, (b) **NPM CLI** `npx @paw-workflow/cli install copilot                                                                                                                                     | claude`, (c) **VS Code `.vsix`\*\* download from GitHub Releases                                                                                                               | [`README.md`](../../../../phased-agent-workflow/README.md:7-65) |
| VS Code extension version    | `0.0.2-dev` (development build; `-dev` suffix triggers reinstall on every activation per [`installer.ts`](../../../../phased-agent-workflow/src/agents/installer.ts:74-80))                                                                                                    | [`package.json`](../../../../phased-agent-workflow/package.json:5)                                                                                                             |
| Plugin (Copilot CLI) version | `0.3.0`                                                                                                                                                                                                                                                                        | [`plugin.json`](../../../../phased-agent-workflow/plugin.json:4)                                                                                                               |
| NPM CLI version              | `0.0.1`                                                                                                                                                                                                                                                                        | [`cli/package.json`](../../../../phased-agent-workflow/cli/package.json:3)                                                                                                     |
| Maintainer                   | **Rob Emanuele** (`@lossyrob`)                                                                                                                                                                                                                                                 | [`plugin.json`](../../../../phased-agent-workflow/plugin.json:5-8)                                                                                                             |
| Maturity indicators          | Early-stage. VS Code extension at `0.0.2-dev`, NPM CLI at `0.0.1`, plugin at `0.3.0`. The `paw-specification.md` (1113 lines) and `paw-review-specification.md` are recent normative documents; `.paw/work/` contains 25+ in-flight work items showing very active dogfooding. | [`package.json`](../../../../phased-agent-workflow/package.json:5), [`cli/package.json`](../../../../phased-agent-workflow/cli/package.json:3), `.paw/work/` directory listing |

**Elevator pitch (verbatim from README).** From [`README.md`](../../../../phased-agent-workflow/README.md:39-45):

> **Phased Agent Workflow** (PAW) enables **Context-Driven Development**—a practice where AI agents build understanding through structured research and planning phases before writing code. Each phase produces durable artifacts (specs, research docs, implementation plans) that accumulate context and feed the next phase. By the time code is written, both agent and human share deep, documented understanding of what's being built and why.
>
> PAW integrates with GitHub Pull Requests at every implementation step, enabling human review and iteration on AI-generated code. Every phase is traceable, rewindable, and version-controlled.

**Credit lineage** ([`README.md`](../../../../phased-agent-workflow/README.md:147-150)): inspired by Dex Horthy's "Advanced Context Engineering for Coding Agents", agent prompts adapted from HumanLayer's `.claude/` subagents/commands, spec structure influenced by [`github/spec-kit`](https://github.com/github/spec-kit).

---

## 2. Architecture Overview

### 2.1 Top-level directory tree (annotated)

```
phased-agent-workflow/                ← repo root
├── README.md  paw-specification.md  paw-review-specification.md  DEVELOPING.md  LICENSE
├── package.json                       ← VS Code extension manifest (paw-workflow 0.0.2-dev)
├── plugin.json                        ← Copilot CLI plugin manifest (paw-workflow 0.3.0)
├── mkdocs.yml                         ← MkDocs site config (lossyrob.github.io/phased-agent-workflow)
├── agents/                            ← 2 Markdown orchestrator agents
│   ├── PAW.agent.md                   ← Implementation workflow orchestrator
│   └── PAW-Review.agent.md            ← PR-review workflow orchestrator
├── prompts/                           ← 2 slash-command entry prompts
│   ├── paw.prompt.md
│   └── paw-review.prompt.md
├── skills/                            ← ~30 SKILL.md skill packages (the workflow primitives)
│   ├── paw-init/  paw-spec/  paw-spec-research/  paw-spec-review/
│   ├── paw-code-research/  paw-planning/  paw-plan-review/
│   ├── paw-planning-docs-review/  paw-implement/  paw-impl-review/
│   ├── paw-pr/  paw-final-review/  paw-transition/  paw-status/
│   ├── paw-rewind/  paw-work-shaping/  paw-workflow/  paw-lite/
│   ├── paw-review-*/  (12 review-workflow skills)
│   ├── paw-sot/                       ← Society-of-Thought engine (multi-perspective review)
│   │   └── references/{perspectives,specialists}/
│   └── paw-init/references/presets/   ← 7 built-in workflow presets (yaml)
├── src/                               ← VS Code extension (TypeScript)
│   ├── extension.ts                   ← Activation entry point (~310 lines)
│   ├── agents/                        ← installer / platformDetection / template renderer
│   ├── commands/                      ← initializeWorkItem / getWorkStatus / stopTrackingArtifacts
│   ├── tools/handoffTool.ts           ← Registers `paw_new_session` Language Model Tool
│   ├── prompts/  ui/  utils/  git/  types/  skills/
│   └── test/                          ← VS Code-test-electron suite
├── cli/                               ← @paw-workflow/cli (Node ESM installer; ~10 files)
│   ├── bin/paw.js                     ← Binary: install / upgrade / list / uninstall
│   └── lib/{commands,manifest,paths,registry,version,color,utils}.js
├── tests/integration/                 ← External end-to-end test harness (tsx --test)
│   ├── lib/{harness,fixtures,multi-checkout,judge,answerer,trace,…}.ts
│   └── tests/{skills,workflows}/      ← ~20 integration specs incl. multi-model planning
├── scripts/                           ← build-vsix.sh, render-vscode-skills.js, lint-prompting.sh, count-tokens.js
├── docs/                              ← MkDocs site source (guide/, reference/, specification/)
├── .paw/work/                         ← Dogfood: 25+ in-flight workflow artifact directories
│   └── <work-id>/{WorkflowContext.md,Spec.md,CodeResearch.md,ImplementationPlan.md,Docs.md,prompts/}
└── .github/  .vscode/  img/
```

Confirmed via `list_files` recursive on [`../../../../phased-agent-workflow`](../../../../phased-agent-workflow).

### 2.2 Entry points

PAW is **multi-surface**. Each surface has its own entry point but they all install/load the **same `agents/` + `skills/` Markdown bundle**:

| Surface                | Entry point                                                                                                                           | What it does                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Copilot CLI plugin** | `copilot plugin install lossyrob/phased-agent-workflow` then `copilot --agent PAW [...] `                                             | Plugin manifest [`plugin.json`](../../../../phased-agent-workflow/plugin.json:21-22) declares `"agents": "agents/", "skills": "skills/"` and the CLI hosts them natively.                                 |
| **NPM CLI installer**  | `npx @paw-workflow/cli install copilot\|claude`                                                                                       | Standalone Node binary [`cli/bin/paw.js`](../../../../phased-agent-workflow/cli/bin/paw.js:37-90) that copies the agent/skill files into `~/.copilot/agents` (Copilot CLI) or `~/.claude/` (Claude Code). |
| **VS Code extension**  | `paw-workflow` VSIX → activates `onStartupFinished` → [`src/extension.ts`](../../../../phased-agent-workflow/src/extension.ts:66-122) | Installs the agent files into `~/.copilot/agents` (so Copilot Chat picks them up), registers 3 commands + 1 Language Model Tool.                                                                          |

There is **no PAW-owned binary that talks to a model**. Every "agent" runs inside someone else's chat host (Copilot CLI, Copilot Chat, Claude Code). PAW is structurally a **prompt and skill distribution mechanism with a configuration schema**.

### 2.3 Key dependencies (what they hint at)

**VS Code extension** ([`package.json`](../../../../phased-agent-workflow/package.json:225-241)) — `devDependencies` only; **zero runtime dependencies beyond `vscode`**. No `@github/copilot-sdk`, no `@anthropic-ai/sdk`, no `@modelcontextprotocol/sdk`. Notable devDeps:

- `@types/vscode ^1.109.0`, `@vscode/test-electron`, `@vscode/vsce` — pure VS Code extension tooling.
- `@dqbd/tiktoken ^1.0.0` — used only by [`scripts/count-tokens.js`](../../../../phased-agent-workflow/scripts/count-tokens.js) for development-time token-budget linting of agent prompts; not loaded at runtime.
- `@playwright/test` and `mocha` — testing only.

**NPM CLI** ([`cli/package.json`](../../../../phased-agent-workflow/cli/package.json:37-39)) — `devDependencies`: `eslint ^9.0.0` only. **Zero runtime dependencies.** The whole CLI is hand-rolled with Node built-ins (`fs`, `path`, ANSI codes in [`cli/lib/color.js`](../../../../phased-agent-workflow/cli/lib/color.js)).

**Integration tests** ([`tests/integration/package.json`](../../../../phased-agent-workflow/tests/integration/package.json)) — separate workspace running `tsx --test` (Node native test runner). Multi-checkout / fixtures / `judge` / `answerer` (LLM-as-judge harness) live here.

**Hint:** The dependency-free design confirms that **PAW does not own a model client, an MCP client, or an agent loop**. All those are inherited from the host (Copilot CLI / Copilot Chat / Claude Code). PAW supplies prompts, skills, scaffolding scripts, and one VS Code Language Model Tool (`paw_new_session`).

### 2.4 Where the "agent loop" lives

**There is no PAW-owned agent loop.** The orchestration logic lives **entirely in two Markdown agent files** that are read by the host LLM at session start:

- [`agents/PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:1-222) — 222 lines of orchestration rules (Mandatory Transitions table, Stage Boundary Rule, Hybrid Execution Model, Workflow Tracking, Candidate Promotion Flow, Before-Yielding-Control checklist).
- [`agents/PAW-Review.agent.md`](../../../../phased-agent-workflow/agents/PAW-Review.agent.md:1-88) — 88 lines for the PR-review workflow (Understanding → Evaluation → Output stages, multi-repo support, SoT mode handling).

The closest thing to PAW-owned in-process logic is the VS Code Language Model Tool [`src/tools/handoffTool.ts`](../../../../phased-agent-workflow/src/tools/handoffTool.ts:103-156) (`paw_new_session`), which is a ~30-line shim that calls `vscode.commands.executeCommand("workbench.action.chat.newChat")` then `workbench.action.chat.open` with the target agent — pure UX glue, not a loop.

---

## 3. Mode / Agent / Phase System ⭐

This is the most important section because PAW's name puts phases at the centre.

### 3.1 Three orthogonal layers — be precise

PAW has **three distinct concepts** that are easy to conflate:

| PAW concept | What it is                                                                                                                                                                  | File extension      | Where defined                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| **Agent**   | A long-lived chat-mode persona / orchestrator. Two exist: `PAW` (implementation) and `PAW-Review` (PR review).                                                              | `.agent.md`         | [`agents/`](../../../../phased-agent-workflow/agents) |
| **Skill**   | A loadable activity/capability. ~30 exist (`paw-init`, `paw-spec`, `paw-implement`, `paw-impl-review`, …). Each is a _directory_ with `SKILL.md` + optional resource files. | `SKILL.md` (in dir) | [`skills/`](../../../../phased-agent-workflow/skills) |
| **Phase**   | A unit of _implementation work_ declared inside `ImplementationPlan.md` for a single work item. Phases are content, not files.                                              | (Markdown sections) | `.paw/work/<work-id>/ImplementationPlan.md`           |

The **agent** picks **skills** to execute, and one of those skills (`paw-implement`) iterates through **phases**. There is **no PAW concept that maps 1:1 to Roo's "mode"** — the closest thing is the agent, but only two exist.

### 3.2 Agent schema

Each `.agent.md` file is YAML-frontmatter + Markdown body. Minimal frontmatter ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:1-3)):

```yaml
---
description: "PAW - Executes the PAW implementation workflow"
---
```

The frontmatter is **only `description`** — no `tools:`, `agents:`, `model:`, `mode:`, or `slug:` fields. The body uses **Mustache-style host conditionals** ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:88-104)):

```markdown
{{#vscode}}

- `per-stage`: Use `paw_new_session` at stage boundaries for fresh context
  {{/vscode}}
  {{#cli}}
- `per-stage`: Unavailable; continue in the current session
  {{/cli}}
```

These are expanded by the renderer in [`src/agents/agentTemplateRenderer.ts`](../../../../phased-agent-workflow/src/agents/agentTemplateRenderer.ts) (and a parallel CLI-side renderer) so a single agent source file emits a VS-Code-flavoured copy and a CLI-flavoured copy.

### 3.3 Skill schema

Each skill is a _directory_ containing `SKILL.md` plus optional sibling files (referenced via `references/...`). Frontmatter from [`skills/paw-init/SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:1-4):

```yaml
---
name: paw-init
description: Bootstrap skill for PAW workflow initialization. Creates WorkflowContext.md, directory structure, and git branch. Runs before workflow skill is loaded.
---
```

Confirmed schema fields seen in skills: `name`, `description`. Body convention:

- **Execution Context** callout (subagent vs direct).
- **Capabilities** bullet list.
- **Input Parameters** table.
- **Desired End States** with validation.
- **Completion Response** specifying what the orchestrator gets back.

Skills can declare references: `paw-init` ships `references/presets/{quick,standard,thorough,team,auto,auto-full,shaping-full}.yaml` ([`skills/paw-init/references/presets/`](../../../../phased-agent-workflow/skills/paw-init/references/presets)) and `paw-sot` ships `references/{perspectives,specialists}/` (society-of-thought multi-perspective review).

### 3.4 Where agents/skills live (per host)

**In the repo (canonical sources):**

```
agents/                                    ← PAW.agent.md, PAW-Review.agent.md
skills/                                    ← ~30 skill directories
prompts/                                   ← paw.prompt.md, paw-review.prompt.md (slash entries)
```

**On the user's machine after install** (resolved by [`platformDetection.ts`](../../../../phased-agent-workflow/src/agents/platformDetection.ts:223-247)):

| Host                                    | Agent install dir (Windows)                                                                                                                    | Skill install dir                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Copilot CLI plugin                      | (managed by `copilot plugin install`; usually under `~/.copilot/plugins/<plugin>/`)                                                            | same plugin dir                                       |
| Copilot CLI / VS Code extension default | `%USERPROFILE%\.copilot\agents\`                                                                                                               | not installed by extension; CLI plugin manages skills |
| NPM CLI for Copilot                     | `~/.copilot/agents/` and `~/.copilot/skills/` (per-target paths from [`cli/lib/paths.js`](../../../../phased-agent-workflow/cli/lib/paths.js)) | same                                                  |
| NPM CLI for Claude Code                 | `~/.claude/agents/`, `~/.claude/skills/`                                                                                                       | same                                                  |
| Override                                | `paw.agentDirectory` setting (or deprecated `paw.promptDirectory`)                                                                             | n/a                                                   |

**No project-level agents.** Unlike Roo's `.roomodes` or Squad's `.github/agents/squad.agent.md`, PAW's two agents are **always installed at user/global scope** by the extension/CLI. Per-project customisation is achieved through the **`WorkflowContext.md`** parameters and **`copilot-instructions.md` / `AGENTS.md`** which the agents are coded to read (see § 6).

### 3.5 How phases are sequenced — declarative pipeline + interactive orchestrator

PAW phases are sequenced by a **prose state machine in [`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md)**, not by a programmatic engine. The Mandatory Transitions table ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:14-29)) is the spec:

```
| After Activity                              | Required Next                | Skippable? |
|---------------------------------------------|------------------------------|------------|
| paw-init                                    | paw-spec or paw-work-shaping | Per intent |
| paw-spec                                    | paw-spec-review              | NO         |
| paw-planning                                | paw-plan-review              | NO         |
| paw-implement (any phase)                   | paw-impl-review              | NO         |
| paw-impl-review (passes, more phases)       | Push & Phase PR (prs strategy)| NO        |
| paw-impl-review (passes, last phase, …)     | paw-final-review or paw-pr   | NO         |
| paw-final-review                            | paw-transition → paw-pr      | NO         |
```

A separate `paw-transition` _subagent_ skill ([`skills/paw-transition/SKILL.md`](../../../../phased-agent-workflow/skills/paw-transition/SKILL.md:18-100)) is mechanically called at every "stage boundary" and returns structured output (`pause_at_milestone`, `next_activity`, `session_action`, `preflight`, `promotion_pending`, `artifact_lifecycle*`). The orchestrator is **forbidden** from yielding control without first calling `paw-transition` ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:36-52, 137-152)).

Pipeline shape ([`paw-specification.md` § Workflow Modes](../../../../phased-agent-workflow/paw-specification.md:24-58)):

- **Full mode:** Spec → Spec Research → Code Research → Implementation Plan → Planning Docs Review → Implementation (1..N phases incl. Documentation phase) → Final Review → Final PR → Status
- **Minimal mode:** Code Research → Implementation Plan → Implementation (1..N phases) → Final Review → Final PR
- **Custom mode:** user-defined via `Custom Workflow Instructions` field on `WorkflowContext.md`.

### 3.6 Worked example — the `paw-init` skill (complete definition)

The full skill definition is at [`skills/paw-init/SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md) (305 lines). Key extracts:

**Frontmatter** ([`SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:1-4)):

```yaml
---
name: paw-init
description: Bootstrap skill for PAW workflow initialization. Creates WorkflowContext.md, directory structure, and git branch. Runs before workflow skill is loaded.
---
```

**Input Parameters** ([`SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:22-67)) — **34 parameters** including `base_branch`, `work_id`, `target_branch`, `execution_mode` (`current-checkout` | `worktree`), `repository_identity`, `execution_binding`, `preset`, `workflow_mode` (`full|minimal|custom`), `review_strategy` (`prs|local`), `review_policy` (`every-stage|milestones|planning-only|final-pr-only`), `session_policy` (`per-stage|continuous`; VS Code only), `artifact_lifecycle` (`commit-and-clean|commit-and-persist|never-commit`), `final_review_mode` (`single-model|multi-model|society-of-thought`), `planning_review_mode`, `implementation_model`, plus seven society-of-thought-specific fields (specialists, interaction_mode, perspectives, perspective_cap, etc.).

**Desired End States** include a [`WorkflowContext.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:198-242) template that codifies all 34 fields plus `Repository Identity` (`<normalized-origin-slug>@<root-commit-sha>`) and `Execution Binding` (`worktree:<work_id>:<target_branch>`) — explicitly portable proof strings, never machine-local paths.

**Preset System** ([`SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:82-138)) — built-in presets `quick`, `standard`, `thorough`, `team`, `auto`, `auto-full`, `shaping-full`; user presets at `~/.paw/presets/<name>.yaml` with `extends:` inheritance (max depth 5).

### 3.7 Handoff between phases — state via committed artifacts

Phase handoff is **artifact-based, not in-memory**. Each stage produces durable Markdown files at `.paw/work/<work-id>/`:

```
.paw/work/<work-id>/
├── WorkflowContext.md      ← Configuration + state (always present)
├── WorkShaping.md          ← Pre-spec ideation (optional; from paw-work-shaping)
├── Spec.md                 ← Feature specification
├── SpecResearch.md         ← Research answers (optional)
├── CodeResearch.md         ← Implementation details with file:line refs
├── ImplementationPlan.md   ← Phased implementation plan (Phase Status checklist + Phase Candidates)
├── Docs.md                 ← Technical documentation (created during final phase)
├── prompts/                ← Generated prompt files (optional)
├── planning/               ← Multi-model planning artifacts (gitignored)
│   └── PLAN-{MODEL}.md
└── reviews/                ← Review artifacts (gitignored)
    ├── planning/{REVIEW.md, REVIEW-{MODEL}.md, REVIEW-SYNTHESIS.md}
    └── {REVIEW.md, REVIEW-{MODEL}.md, REVIEW-SYNTHESIS.md}
```

Source: [`skills/paw-workflow/SKILL.md`](../../../../phased-agent-workflow/skills/paw-workflow/SKILL.md:75-101).

**Resumability:** When the PAW agent re-enters an existing work directory, it derives TODO state by inspecting which artifacts exist ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:8-10): _"If resuming existing work, derive TODO state from completed artifacts"_). State persistence is just _the files in git_ (or in a worktree, depending on `execution_mode`).

**Session reset:** On VS Code, `paw-transition` may return `session_action = new_session` if `Session Policy = per-stage`; the orchestrator then invokes the `paw_new_session` LM tool ([`src/tools/handoffTool.ts`](../../../../phased-agent-workflow/src/tools/handoffTool.ts:71-95)) which opens a fresh chat with the target agent and a `Work ID: ...` priming prompt. On Copilot CLI this option is unavailable; sessions stay continuous ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:100-104)).

**Hybrid Execution Model** ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:177-198)) further partitions execution:

- **Direct execution (this session):** `paw-spec`, `paw-planning`, `paw-implement`, `paw-pr`, `paw-final-review`, `paw-init`, `paw-status`, `paw-rewind`, …
- **Subagent delegation:** `paw-spec-research`, `paw-code-research`, `paw-spec-review`, `paw-plan-review`, `paw-impl-review`, `paw-transition`.

Subagent skills are dispatched via the host's sub-agent mechanism (`runSubagent` on Copilot Chat, `task` on Copilot CLI) — PAW does not implement sub-agent dispatch itself.

---

## 4. Tool Access & Restrictions

### 4.1 Built-in tools

**PAW ships zero of its own tools** for read/write/exec/search at the agent level. Every tool the agents call is provided by the host (Copilot CLI built-ins, Copilot Chat tool registry, Claude Code tools).

The **single exception** is the VS Code Language Model Tool [`paw_new_session`](../../../../phased-agent-workflow/package.json:170-202) registered by [`src/tools/handoffTool.ts`](../../../../phased-agent-workflow/src/tools/handoffTool.ts:103-156). It accepts:

```jsonc
{
  "target_agent": "PAW" | "PAW-Review",   // enum (the only two PAW agents)
  "work_id": "<lowercase-slug>",           // required
  "inline_instruction": "Phase 2"          // optional
}
```

…validates `work_id` against `^[a-z0-9-]+$`, then opens a fresh chat with the target agent and the priming prompt. It is **fire-and-forget** (cannot wait for completion — see the comment at [`handoffTool.ts:65-70`](../../../../phased-agent-workflow/src/tools/handoffTool.ts:65-70)) and includes a confirmation message via `prepareInvocation`.

### 4.2 Per-phase / per-skill tool restrictions

**No first-class per-skill tool ACL is exposed in PAW's documented schema.** Confirmed from inspection:

- Frontmatter for `.agent.md` files — only `description` is used; no `tools:`, no `allowed-tools:` ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:1-3)).
- Frontmatter for `SKILL.md` files — only `name` + `description` observed across the skills sampled (`paw-init`, `paw-implement`, `paw-workflow`, `paw-transition`).

The cross-tool [Agent Skills standard](https://agentskills.io/) defines an `allowed-tools` frontmatter field, and Copilot CLI's skill loader honours it. Whether PAW _intends_ skills to use it (and simply hasn't populated the field on the shipped skills) is not stated in the inspected source. **Filed as Q-061 below.**

What PAW _does_ enforce is **prose-level discipline**:

- The `paw-implement` skill explicitly forbids `git add .` / `git add -A` ([`skills/paw-implement/SKILL.md`](../../../../phased-agent-workflow/skills/paw-implement/SKILL.md:14-22): _"DO NOT use `git add .` or `git add -A` (can capture unrelated changes)"_).
- The PAW-Review agent forbids manually creating activity-skill artifacts ([`PAW-Review.agent.md`](../../../../phased-agent-workflow/agents/PAW-Review.agent.md:81-87)).
- The `paw-implement` skill mandates **NEVER push** at the implementer level — push is a `paw-impl-review` responsibility ([`SKILL.md`](../../../../phased-agent-workflow/skills/paw-implement/SKILL.md:81-83, 95)).

There is **no path-regex / file-pattern enforcement** ("write only to `*.md`", etc.) in any frontmatter or runtime check observed.

### 4.3 Approval / human-in-the-loop model

PAW's HITL model is the **Review Policy** parameter on `WorkflowContext.md`, controlling _when the orchestrator pauses_:

| `review_policy`        | Pauses at                                                                                   | Source                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `every-stage`          | Every artifact                                                                              | [`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:73) |
| `milestones` (default) | Spec.md, ImplementationPlan.md, Planning Docs Review completion, Phase completion, Final PR | [`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:74) |
| `planning-only`        | Spec.md, Plan, Planning Docs Review, Final PR (auto through phases)                         | [`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:75) |
| `final-pr-only`        | Final PR only                                                                               | [`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:76) |

Critically, **automated quality gates (`paw-spec-review`, `paw-plan-review`, `paw-impl-review`) are mandatory regardless of Review Policy** ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:71-72)). Review Policy controls only _human_ pause points.

**Per-tool approval (e.g., `--allow-tool=PATTERN`, "Bypass Approvals")** is **outside PAW's scope** — it lives in the host (Copilot CLI flags or Copilot Chat's three approval modes). PAW agents are written to _recommend_ certain approval strategies via WorkflowContext fields (e.g., `final_review_interactive: smart`) but cannot _enforce_ tool-call gates.

**Pending-review safeguard for the PR-Review agent:** [`PAW-Review.agent.md`](../../../../phased-agent-workflow/agents/PAW-Review.agent.md:73-75) — _"Pending GitHub reviews are created but NEVER auto-submitted. Human reviewers make final decisions on all feedback."_

---

## 5. MCP Integration

**PAW does not host an MCP client and does not ship an MCP config schema.**

Confirmed by:

- No `mcp.json`, `.mcp.json`, or `mcp-config.json` file in the repo (verified via the recursive `list_files`).
- No `mcp` / `modelcontextprotocol` strings in the inspected source files ([`extension.ts`](../../../../phased-agent-workflow/src/extension.ts), [`handoffTool.ts`](../../../../phased-agent-workflow/src/tools/handoffTool.ts), [`installer.ts`](../../../../phased-agent-workflow/src/agents/installer.ts), [`cli/bin/paw.js`](../../../../phased-agent-workflow/cli/bin/paw.js)).
- No `@modelcontextprotocol/sdk` dependency in `package.json`, `cli/package.json`, or `tests/integration/package.json`.

**How PAW integrates with external tools today:** entirely via the **host's** MCP plumbing. If the user runs `copilot --agent PAW`, the Copilot CLI's MCP servers (configured in `~/.copilot/mcp-config.json` or `.github/mcp.json`) are available; the PAW agent's prompt does not enumerate, restrict, or filter them. Same on Copilot Chat (`.vscode/mcp.json` + `tools:` frontmatter) and Claude Code.

**No per-skill MCP allowlist** is observable in any frontmatter.

<!-- TODO Phase 10b deeper read: scan all 30 skill SKILL.md files for any `mcp:` or `tools:` frontmatter; current sample of ~6 skills shows none, but full coverage not yet verified. -->

---

## 6. Rules / Instructions / Context

### 6.1 Layered instruction sources

PAW reads instructions from **host-native** locations rather than its own. From the `paw-init` skill ([`skills/paw-init/SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:68-78)):

> When parameters are not provided:
>
> 1. Apply defaults from the table above
> 2. Check user-level defaults in `copilot-instructions.md` or `AGENTS.md` (these override table defaults)
> 3. If a `preset` was specified, apply preset configuration
> 4. Apply any explicit user overrides

Precedence (lowest → highest): table defaults → user-level defaults (`copilot-instructions.md` / `AGENTS.md`) → preset → explicit overrides.

**PAW's own former layered-rules mechanism was deprecated.** The VS Code extension actively warns about it ([`src/extension.ts`](../../../../phased-agent-workflow/src/extension.ts:274-309)):

> _"PAW custom instructions (`.paw/instructions/`) are deprecated and no longer loaded. Migrate to `copilot-instructions.md` for project-level customization."_

So the **only PAW-owned instruction surface is the WorkflowContext.md per-work-item config**. Project-level customisation flows through host-native files (`AGENTS.md`, `copilot-instructions.md`, `.github/copilot-instructions.md`, `~/.claude/CLAUDE.md`).

### 6.2 File watching / hot-reload

- **Agent files** are installed once per VS Code activation; the installer compares package version + file hashes and only re-installs on change ([`src/agents/installer.ts`](../../../../phased-agent-workflow/src/agents/installer.ts:182-223)). Development builds (`-dev` suffix) reinstall on every activation ([`installer.ts:74-80`](../../../../phased-agent-workflow/src/agents/installer.ts:74-80)).
- **Skill files** are reloadable from inside a session via the host's `/skills reload` slash command (Copilot CLI), not by PAW.
- A development helper [`scripts/watch-vscode-assets.js`](../../../../phased-agent-workflow/scripts/watch-vscode-assets.js) watches and re-renders the VS-Code-flavoured copies of skills when the source `skills/` files change (compile-time only).

### 6.3 AGENTS.md awareness

**Yes, first-class.** The `paw-init` skill's parameter-resolution algorithm ([`SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:68-78)) reads `AGENTS.md` for user-level workflow defaults, and the inline conditionals in `PAW.agent.md` already differentiate VS Code vs CLI runtime, so the host-native AGENTS.md ingestion behaviour is preserved. PAW does not redefine `AGENTS.md` semantics.

---

## 7. Orchestration / Sub-Agent Delegation

### 7.1 Sub-agent / subagent skills

PAW relies on the host's sub-agent dispatch mechanism. Skills classified as **subagent delegation** in the Hybrid Execution Model ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:183-186)):

```
paw-spec-research, paw-code-research,
paw-spec-review, paw-plan-review, paw-impl-review,
paw-transition
```

These are dispatched via the host's `runSubagent` (Copilot Chat) or `task` (Copilot CLI) tool. PAW does **not** implement a `new_task`-equivalent tool of its own — the only tool it ships is `paw_new_session` (§ 4.1), which is for **session reset**, not sub-agent invocation.

### 7.2 Parallel vs serial

**Implicitly serial in the orchestrator's prose.** The PAW agent's transitions table ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:14-29)) and the Stage Boundary Rule ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:36-52)) describe a strictly sequential pipeline: each activity produces an artifact, the orchestrator delegates to `paw-transition`, then proceeds. The exception is **multi-model planning / multi-model review / society-of-thought debate**, where the `paw-planning` and `paw-final-review` skills explicitly invoke multiple models in parallel and synthesise the results ([`skills/paw-workflow/SKILL.md`](../../../../phased-agent-workflow/skills/paw-workflow/SKILL.md:127-128) "Multi-model planning artifacts"). This parallelism is also delegated to the host's parallel sub-agent capability.

### 7.3 State persistence / resume capability

Persistence is **artifact-based, in git**. The full state of any in-flight workflow is recoverable from `.paw/work/<work-id>/` because:

- `WorkflowContext.md` carries every input parameter (34 fields).
- Existence of `Spec.md` / `CodeResearch.md` / `ImplementationPlan.md` / `Docs.md` tells `paw-init`/`paw-status` exactly which stage the work is at.
- `ImplementationPlan.md` carries `Phase Status: - [ ] / - [x]` checkboxes that are the source of truth for which phases have been done.
- `Phase Candidates` section lists deferred / promoted / skipped follow-ups with terminal markers `[promoted]`, `[skipped]`, `[deferred]`, `[not feasible]` ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:125-135)).

Worktree mode supports **multi-checkout development** via the `Execution Binding` field (`worktree:<work_id>:<target_branch>`) and `Repository Identity` (`<normalized-origin-slug>@<root-commit-sha>`) ([`skills/paw-init/SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:244-271)). Strict execution-checkout rules ([`PAW.agent.md`](../../../../phased-agent-workflow/agents/PAW.agent.md:60-68)) require all git mutations to use the proven execution checkout path, never a session cwd that disagrees.

### 7.4 Compared to Roo's orchestrator mode (description only — comparison reserved for Phase 10b)

PAW's orchestrator is **the `PAW.agent.md` itself**, plus the `paw-transition` subagent for boundary-gating. The pattern is: the PAW agent (a single long-lived persona) owns the workflow state machine and dispatches activity skills (some direct-in-session, some via sub-agent). There is no concept of a separate "Orchestrator" agent that delegates to "Code" / "Architect" / "Debug" personas — only the two agents `PAW` and `PAW-Review` exist, and they don't delegate to each other.

---

## 8. UI / Surface

PAW is a **multi-host wrapper**; it surfaces in three places:

| Surface                  | What the user sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Copilot CLI terminal** | `copilot --agent PAW`. All workflow output is text; pauses are conversational ("Spec complete. Say `continue` when ready"). Status feedback via `paw-status` skill.                                                                                                                                                                                                                                                                                                                          |
| **VS Code Copilot Chat** | The two installed agents appear in the chat agent picker. The VS Code extension also adds three Command Palette entries ([`package.json`](../../../../phased-agent-workflow/package.json:50-65)): `PAW: New PAW Workflow` (`paw.initializeWorkItem`), `PAW: Get Work Status` (`paw.getWorkStatus`), `PAW: Stop Tracking Artifacts` (`paw.stopTrackingArtifacts`). The `paw_new_session` Language Model Tool exposes a confirmation prompt (`Calling PAW Agent`) before opening a fresh chat. |
| **Claude Code**          | Same agents installed at `~/.claude/agents/` by `npx @paw-workflow/cli install claude`. Claude Code's CLI / desktop UI hosts them.                                                                                                                                                                                                                                                                                                                                                           |

**No webview, no diff approval UI of PAW's own.** Diff/edit approval is whatever the host provides (Copilot Chat's diff editor, Copilot CLI's per-tool approval prompts, Claude Code's per-tool prompts). There is no "Mode Switcher" because there are only two agents and switching is done via the host's agent picker / `/agent` slash.

**An `Output Channel: PAW Workflow`** is created on activation ([`extension.ts`](../../../../phased-agent-workflow/src/extension.ts:72-77)) for installer / handoff-tool logging only — not user-facing chat output.

---

## 9. Model & Provider Support

PAW is **provider-agnostic at the wrapper layer**. The model is whatever the host is configured with (Copilot CLI's `--model`, Copilot Chat's model picker, Claude Code's model setting). PAW _describes_ its preferences via `WorkflowContext.md` parameters:

| WorkflowContext field            | Default                                         | Purpose                                                                               |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `implementation_model`           | `none` (use session default)                    | Per-work-item override of the implementation model                                    |
| `plan_generation_models`         | `latest GPT, latest Gemini, latest Claude Opus` | Comma-separated list for **multi-model planning**                                     |
| `final_review_models`            | same default trio                               | Multi-model review participants                                                       |
| `final_review_specialist_models` | `none`                                          | Society-of-Thought specialist→model assignments (round-robin pool, pinning, or mixed) |
| `planning_review_*` mirrors      | same                                            | Same set for planning-stage review                                                    |

All from [`skills/paw-init/SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:44-66, 161-189).

**Model intent resolution** ([`SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:160-164)):

> Resolve model intents to concrete model names wherever they appear (e.g., "latest GPT" → `gpt-5.2`, "latest Gemini" → `gemini-3-pro-preview`, "latest Claude Opus" → `claude-opus-4.6`). … Present resolved models for user confirmation and store **resolved concrete model names** in WorkflowContext.md (not the intent strings).

So PAW carries _string preferences_ but does not call any provider SDK. Token-counting / context-window management is similarly host-delegated; the only token-related PAW asset is the development-time linter [`scripts/count-tokens.js`](../../../../phased-agent-workflow/scripts/count-tokens.js) using `@dqbd/tiktoken` (devDep only).

**Cost telemetry:** none observed in PAW source. Cost is whatever the host reports.

**BYOK / multi-model routing:** inherited entirely from the host (Copilot CLI's `COPILOT_PROVIDER_*` env vars, Copilot Chat's provider settings, Claude Code's settings). PAW does not gate, mediate, or proxy these.

---

## 10. Setup / Portability

### 10.1 Installation

Three first-party install paths, all documented in [`README.md`](../../../../phased-agent-workflow/README.md:7-128):

```powershell
# Path 1 — Copilot CLI plugin (recommended)
copilot plugin install lossyrob/phased-agent-workflow

# Path 2 — NPM CLI (also supports Claude Code)
npx @paw-workflow/cli install copilot
npx @paw-workflow/cli install claude

# Path 3 — VS Code .vsix from Releases
# (download then `Extensions: Install from VSIX...`)
```

The NPM CLI exposes `install / upgrade / list / uninstall` ([`cli/bin/paw.js`](../../../../phased-agent-workflow/cli/bin/paw.js:11-35)) with `--force` and `--no-banner` flags. Targets are enumerated in [`cli/lib/paths.js`](../../../../phased-agent-workflow/cli/lib/paths.js) (`SUPPORTED_TARGETS`). The VS Code extension performs the same install on activation ([`src/extension.ts:144-265`](../../../../phased-agent-workflow/src/extension.ts:144-265)) with versioning + cleanup logic that handles dev builds, version migrations, residual files, and a deprecated `paw.promptDirectory` fallback.

### 10.2 Configuration overrides

VS Code extension settings ([`package.json:28-48`](../../../../phased-agent-workflow/package.json:28-48)):

| Setting                       | Default                     | Effect                                                     |
| ----------------------------- | --------------------------- | ---------------------------------------------------------- |
| `paw.agentDirectory`          | `""` (use platform default) | Override the install target for agents                     |
| `paw.promptDirectory`         | `""` (deprecated)           | Legacy fallback                                            |
| `paw.enableWorktreeExecution` | `true`                      | Whether to enable dedicated worktree mode in workflow init |

Default install paths from [`platformDetection.ts:233-247`](../../../../phased-agent-workflow/src/agents/platformDetection.ts:233-247):

| OS      | Path                                                                               |
| ------- | ---------------------------------------------------------------------------------- |
| Windows | `%USERPROFILE%\.copilot\agents\`                                                   |
| macOS   | `$HOME/.copilot/agents/`                                                           |
| Linux   | `$HOME/.copilot/agents/`                                                           |
| WSL     | `$HOME/.copilot/agents/` (with optional Windows-side cleanup of legacy prompt dir) |

### 10.3 Vault-style portability

**No first-class vault primitive (no `PAW_HOME` / `COPILOT_HOME` style env var owned by PAW).** PAW inherits whatever portability the host provides (e.g., `COPILOT_HOME` on the Copilot CLI). The two PAW-owned escape hatches are:

- `paw.agentDirectory` (extension setting) — redirects the install target.
- `~/.paw/presets/<name>.yaml` ([`skills/paw-init/SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:117-118)) — user-level preset overrides.

Per-work-item config (`WorkflowContext.md`) is **deliberately portable**: the `Repository Identity` and `Execution Binding` fields are documented as exact contract strings, never machine-local execution paths ([`skills/paw-init/SKILL.md`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:244-249)).

### 10.4 Windows 11 / PowerShell friendliness

**Generally friendly.**

- The VS Code extension uses `path.win32` / `path.posix` correctly per platform ([`platformDetection.ts:235-241`](../../../../phased-agent-workflow/src/agents/platformDetection.ts:235-241)).
- WSL has special-case detection ([`platformDetection.ts:72-103`](../../../../phased-agent-workflow/src/agents/platformDetection.ts:72-103)) including Windows-username discovery via `/mnt/c/Users` enumeration.
- The NPM CLI is pure ESM Node (no shell-specific code).

**Unix-only assumptions found:**

- [`scripts/build-vsix.sh`](../../../../phased-agent-workflow/scripts/build-vsix.sh), [`scripts/lint-prompting.sh`](../../../../phased-agent-workflow/scripts/lint-prompting.sh), [`scripts/test-migration.sh`](../../../../phased-agent-workflow/scripts/test-migration.sh), [`scripts/export-for-cli.sh`](../../../../phased-agent-workflow/scripts/export-for-cli.sh) — Bash. A PowerShell parallel exists for one of them ([`scripts/export-for-cli.ps1`](../../../../phased-agent-workflow/scripts/export-for-cli.ps1)) but the build/lint/test wrappers are Bash-only. Windows users running `npm run build-vsix` / `npm run lint:agent` need WSL or Git-Bash.
- `package.json` script declarations use Unix `&&` chaining inside Node-evaluated strings — fine on Windows shells in practice.

No PowerShell-side install/setup script is provided.

---

## 11. Maturity Signals

### 11.1 Test coverage

| Surface                  | Test framework                                   | Notable specs                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code extension        | `@vscode/test-electron` + Mocha + ts-node        | [`src/test/suite/`](../../../../phased-agent-workflow/src/test/suite) — 11 spec files covering agents, backwardCompat, customization assets, error handling, gitValidation, handoffTool, initializeWorkItem, installer, userInput                                                                                                                                                                  |
| NPM CLI                  | `node --test`                                    | [`cli/test/build.test.js`](../../../../phased-agent-workflow/cli/test/build.test.js), [`cli/test/install.test.js`](../../../../phased-agent-workflow/cli/test/install.test.js) — 2 specs                                                                                                                                                                                                           |
| Integration / end-to-end | `tsx --test` (Node native) + Playwright (devDep) | [`tests/integration/tests/`](../../../../phased-agent-workflow/tests/integration/tests) — 8 skill specs (incl. `paw-agent-guardrails`, `tool-policy`, `plan-deliverable-guardrails`, `scratch-ignore-marker-policy`, `execution-contract-content`) and 8 workflow specs (incl. `full-local-workflow`, `paw-planning-multi-model`, `git-branching`, `code-research`, `current-checkout-regression`) |

The integration harness ([`tests/integration/lib/`](../../../../phased-agent-workflow/tests/integration/lib)) is non-trivial: `harness.ts`, `multi-checkout.ts`, `judge.ts` (LLM-as-judge), `answerer.ts` (synthetic user answers), `tool-policy.ts`, `trace.ts`, `fixtures.ts`. This is meaningful end-to-end testing for an alpha-stage project.

### 11.2 Documentation quality

- [`README.md`](../../../../phased-agent-workflow/README.md) — 152 lines, install + concept + workflow overview.
- [`paw-specification.md`](../../../../phased-agent-workflow/paw-specification.md) — **1113 lines**, normative spec of workflow modes, review strategies, artifacts, transitions, presets.
- [`paw-review-specification.md`](../../../../phased-agent-workflow/paw-review-specification.md) — separate normative spec for the PR-review workflow.
- [`docs/`](../../../../phased-agent-workflow/docs) — MkDocs site source: `guide/{cli-installation,society-of-thought-review,stage-transitions,two-workflows,vscode-extension,workflow-modes,workflow-presets}.md`, `reference/{agents,artifacts}.md`, `specification/{implementation,index,review}.md`. Site is published at `lossyrob.github.io/phased-agent-workflow` per [`plugin.json:9`](../../../../phased-agent-workflow/plugin.json:9).
- [`DEVELOPING.md`](../../../../phased-agent-workflow/DEVELOPING.md) at repo root.

Documentation is **denser than typical alpha-stage projects**. The 1113-line specification doc is itself a strong maturity signal.

### 11.3 Community signals (from local clone only)

- [`.github/`](../../../../phased-agent-workflow/.github) directory exists (workflows not enumerated here).
- [`.paw/work/`](../../../../phased-agent-workflow/.paw/work) contains **25+ in-flight workflow directories** for self-development (e.g., `agent-installation-management/`, `azure-devops/`, `move-chatmodes-to-agents/`, `paw-cli-package/`, `paw-context-tool-for-custom-instructions/`, `society-of-thought-final-review/`, `sot-context-filtering/`, `workflow-handoffs/`). This indicates **heavy active dogfooding** by the maintainer — recent and ongoing.
- Recent design effort visible: `move-chatmodes-to-agents` and `simplified-workflow` work items show the project recently moved through Microsoft's `.chatmode.md` → `.agent.md` rename and recently consolidated its workflow primitives.

### 11.4 Comparison to Squad alpha (v0.x) and Roo (mature, v3.x)

> ⚠️ Comparative language permitted only in § 12. Here only the bare maturity descriptor: PAW's component versions are 0.0.1 (CLI) / 0.0.2-dev (extension) / 0.3.0 (plugin); spec docs are normative and dense; integration test coverage is real; active dogfooding is visible. Phase 10b will assign a relative maturity tier.

---

## 12. PAW Gap Catalog (preliminary)

> **Format note.** Following the `60-gap-analysis.md` convention: `P-N` = first-class capability **gap** (something PAW does not do or does only via prose); `PW-N` = **workaround / limitation** (something PAW does, with caveats). Severities use the same icons as `60-gap-analysis.md` § B: 🔴 blocker, 🟠 major, 🟡 minor. **All entries below are preliminary** — Phase 10b will turn this into the gap-matrix row for Path E.

| ID       | Title                                                                       | Severity | Description                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P-1**  | **No per-skill / per-agent file-edit restriction** (`fileRegex`-equivalent) | 🟠 major | No frontmatter field constrains which file paths a skill or agent may edit. The `paw-implement` skill enforces `git add` discipline by prose only ([`skills/paw-implement/SKILL.md:14-22`](../../../../phased-agent-workflow/skills/paw-implement/SKILL.md:14-22)); there is no path-pattern ACL.                                                                                                                                                    |
| **P-2**  | **No per-skill MCP allowlist**                                              | 🟠 major | No frontmatter field on `SKILL.md` or `.agent.md` filters which MCP servers are visible to the skill. PAW inherits the host's full MCP server set without filtering.                                                                                                                                                                                                                                                                                 |
| **P-3**  | **No PAW-owned MCP client / config**                                        | 🟡 minor | PAW does not host MCP, does not ship an `mcp.json`, and does not document an MCP file path of its own. All MCP plumbing is the host's.                                                                                                                                                                                                                                                                                                               |
| **P-4**  | **Only two long-lived agents** (`PAW`, `PAW-Review`)                        | 🟠 major | There is no concept of arbitrary user-defined agent personas (no `slug`, no `roleDefinition` field). New "modes" must be added by writing new `.agent.md` files and editing `agentTemplates.ts` / installer logic, not by config.                                                                                                                                                                                                                    |
| **P-5**  | **No first-class sub-agent dispatch tool**                                  | 🟡 minor | PAW relies on the host's `runSubagent` (Copilot Chat) or `task` (Copilot CLI) for sub-agent dispatch. The only PAW-owned LM tool is `paw_new_session` ([`src/tools/handoffTool.ts`](../../../../phased-agent-workflow/src/tools/handoffTool.ts)), which is _session reset_, not sub-agent invocation.                                                                                                                                                |
| **P-6**  | **No webview / diff approval UI of its own**                                | 🟡 minor | PAW's UI surface in VS Code is 3 Command Palette commands + 1 LM Tool. No webview, no settings view, no MCP marketplace, no mode picker. All edit/diff approvals are handled by the host.                                                                                                                                                                                                                                                            |
| **P-7**  | **No BYOK / multi-model routing layer**                                     | 🟡 minor | PAW carries model-name _string preferences_ in `WorkflowContext.md` but does not route, gate, or mediate model calls. BYOK is entirely the host's responsibility.                                                                                                                                                                                                                                                                                    |
| **P-8**  | **No `PAW_HOME` / vault env-var primitive**                                 | 🟡 minor | The only PAW-owned override is `paw.agentDirectory` (a single VS Code setting). User presets live at the hard-coded `~/.paw/presets/<name>.yaml` ([`skills/paw-init/SKILL.md:117`](../../../../phased-agent-workflow/skills/paw-init/SKILL.md:117)). No env-var-driven config root that redirects every PAW path consistently.                                                                                                                       |
| **P-9**  | **Project-level `.paw/instructions/` deprecated**                           | 🟡 minor | Project-scope custom instructions are no longer loaded; the extension warns and points users at `copilot-instructions.md` ([`extension.ts:274-309`](../../../../phased-agent-workflow/src/extension.ts:274-309)). PAW has no project-scope rules folder of its own anymore.                                                                                                                                                                          |
| **P-10** | **No per-tool approval matrix**                                             | 🟡 minor | Approval policy is conceptual (`Review Policy`) and applies to _workflow milestones_, not individual tool calls. Per-tool `--allow-tool` / "Bypass Approvals" semantics are inherited from the host.                                                                                                                                                                                                                                                 |
| **P-11** | **No checkpointing / shadow-git of its own**                                | 🟡 minor | State is committed Markdown (`.paw/work/<work-id>/`); no per-edit shadow-git checkpoints in the Roo sense. Rewind is at the artifact level (whole `Spec.md` or `ImplementationPlan.md`) via the `paw-rewind` skill, not at the per-edit level.                                                                                                                                                                                                       |
| **PW-1** | Build/lint/test scripts are Bash-only                                       | 🟡 minor | [`scripts/build-vsix.sh`](../../../../phased-agent-workflow/scripts/build-vsix.sh), [`scripts/lint-prompting.sh`](../../../../phased-agent-workflow/scripts/lint-prompting.sh), [`scripts/test-migration.sh`](../../../../phased-agent-workflow/scripts/test-migration.sh) require Bash on Windows (WSL or Git-Bash). Only [`scripts/export-for-cli.ps1`](../../../../phased-agent-workflow/scripts/export-for-cli.ps1) ships a PowerShell parallel. |
| **PW-2** | Hot-reload of agent files requires extension/CLI re-install                 | 🟡 minor | Agent file changes require a re-install pass (extension reactivation or `npx @paw-workflow/cli install …`). Skill files can be `/skills reload`'d by the host.                                                                                                                                                                                                                                                                                       |
| **PW-3** | Two-host duplication for Copilot CLI vs VS Code                             | 🟡 minor | Copilot CLI plugin install (`copilot plugin install …`) and the VS Code extension both write to `~/.copilot/agents/`. The README ([`README.md:117-119`](../../../../phased-agent-workflow/README.md:117-119)) explicitly warns: _"If switching from NPM CLI to the plugin, uninstall the NPM version first to avoid duplicate agents."_                                                                                                              |
| **PW-4** | Mustache `{{#vscode}}` / `{{#cli}}` conditionals tied to a custom renderer  | 🟡 minor | Multi-host conditional content lives in agent/skill templates and is expanded by [`src/agents/agentTemplateRenderer.ts`](../../../../phased-agent-workflow/src/agents/agentTemplateRenderer.ts). A skill author who edits raw `.agent.md` outside the renderer may produce host-mismatched output.                                                                                                                                                   |
| **PW-5** | `paw_new_session` tool is fire-and-forget                                   | 🟡 minor | Per [`handoffTool.ts:65-70`](../../../../phased-agent-workflow/src/tools/handoffTool.ts:65-70), the tool cannot wait for sub-session completion. Stage-boundary chained workflows on VS Code rely on the user (or the priming `Work ID` prompt) to resume the next stage.                                                                                                                                                                            |

**Tally so far:** 0 × 🔴 · 4 × 🟠 · 12 × 🟡 (across P-1..P-11 and PW-1..PW-5). **Total entries: 16.**

> ⚠️ This catalog is **describing PAW**, not yet **comparing it**. Phase 10b will integrate this with the unified Gap Matrix in [`60-gap-analysis.md`](60-gap-analysis.md) and assign final Path-E severities relative to Roo / vault use-cases.

---

## 13. Open Questions

The following ambiguities surfaced from local source inspection. They are filed in [`99-open-questions.md`](99-open-questions.md) with the same wording for cross-reference; this section preserves the per-source rationale.

- **Q-059 — Skill `allowed-tools` frontmatter intent.** The cross-tool [Agent Skills standard](https://agentskills.io/) defines an `allowed-tools` field that Copilot CLI honours; none of the ~6 PAW skills sampled (`paw-init`, `paw-implement`, `paw-workflow`, `paw-transition`, `paw-init` presets) populate it. Question: is the omission deliberate (PAW intends host-level / prose enforcement) or pending (skills will gain `allowed-tools` later)? Answer affects how Phase 10b scores P-1.
- **Q-060 — Per-skill MCP filtering plans.** No `mcp:` or per-server allowlist field is observed in any `SKILL.md` or `.agent.md` frontmatter. Is per-skill MCP filtering on the PAW roadmap or out of scope? Answer affects P-2 severity.
- **Q-061 — Project-level agent customisation story.** With `.paw/instructions/` deprecated and no project-scope `.agent.md` discovery in PAW's code, the only project-level customisation surfaces are (a) `WorkflowContext.md` parameters, (b) host-native `AGENTS.md` / `.github/copilot-instructions.md`. Is there an intended pattern for, e.g., a project that wants its own _PAW-Lint_ agent in addition to the global PAW / PAW-Review pair?
- **Q-062 — `paw-lite` skill scope.** A [`skills/paw-lite/SKILL.md`](../../../../phased-agent-workflow/skills/paw-lite/SKILL.md) exists and a corresponding `.paw/work/paw-lite-skill/` work item is in flight, but the PAW agent's Mandatory Transitions table does not reference it. Is `paw-lite` an alternative compact orchestrator (analogous to a Roo `lite` mode), or only a building block? <!-- TODO Phase 10b deeper read: full read of paw-lite/SKILL.md needed -->
- **Q-063 — Society-of-Thought specialist isolation.** [`skills/paw-sot/references/specialists/`](../../../../phased-agent-workflow/skills/paw-sot/references/specialists) contains 9 specialist personas (architecture, assumptions, correctness, edge-cases, maintainability, performance, release-manager, security, testing) plus 4 perspective files (baseline, premortem, red-team, retrospective). Each specialist runs as a sub-session — but is the model invoked per specialist isolated from the others, or do they share a working-set context? Answer affects how Phase 10b describes parallel orchestration capability.
- **Q-064 — Plugin-vs-extension precedence.** [`README.md:117-119`](../../../../phased-agent-workflow/README.md:117-119) warns about duplicate agents when both the Copilot CLI plugin and the NPM CLI install are present. What is the documented precedence rule (plugin wins? user wins? alphabetical?) and is it enforced or merely warned? Affects PW-3 severity.

---

## Cross-links

- [`README.md`](README.md) — investigation index (re-opened in Phase 10).
- [`90-decision-log.md`](90-decision-log.md) — Phase 10a entry references this file.
- [`99-open-questions.md`](99-open-questions.md) — Q-059..Q-064 logged.
- [`30-squad-inventory.md`](30-squad-inventory.md) — companion inventory whose structure this file mirrors.
- [`10-roo-inventory.md`](10-roo-inventory.md) — Roo capability checklist for Phase 10b's gap-matrix evaluation.
- [`60-gap-analysis.md`](60-gap-analysis.md) — 12-section taxonomy; Phase 10b will fold P-1..P-11 / PW-1..PW-5 into the unified matrix as Path E.
- PAW home: [`../../../../phased-agent-workflow/README.md`](../../../../phased-agent-workflow/README.md), spec: [`../../../../phased-agent-workflow/paw-specification.md`](../../../../phased-agent-workflow/paw-specification.md).
