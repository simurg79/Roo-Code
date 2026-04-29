---
phase: 3
status: complete
owner: architect-subtask
last_updated: 2026-04-26
sources:
  - ../../../../squad/README.md
  - ../../../../squad/package.json
  - ../../../../squad/packages/squad-cli/package.json
  - ../../../../squad/packages/squad-sdk/package.json
  - ../../../../squad/.copilot/mcp-config.json
  - ../../../../squad/docs/src/content/docs/features/vscode.md
  - ../../../../squad/docs/src/content/docs/features/mcp.md
  - ../../../../squad/docs/src/content/docs/get-started/choose-your-interface.md
  - ../../../../squad/docs/src/content/docs/reference/integration.md
  - ../../../../squad/docs/src/content/docs/scenarios/client-compatibility.md
  - ../../../../squad/docs/src/content/blog/008-v040-release.md
  - ../../../../squad/docs/src/content/blog/018-the-adapter-chronicles.md
  - docs/analysis/squad-vs-roo-comparison.md
---

# Phase 3 — Squad Inventory

> Parent plan: [`00-plan.md`](00-plan.md) · Index: [`README.md`](README.md)

This file answers Q-001 from [`99-open-questions.md`](99-open-questions.md): "What is Squad actually for?". The answer is grounded in `c:/git/squad` (commit state at investigation time) and the existing companion document [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md), which had already done a deep comparison and is cross-cited liberally.

## What is Squad?

Squad is **a CLI-plus-SDK that orchestrates multi-agent "teams" on top of GitHub Copilot**. From [`../../../../squad/README.md`](../../../../squad/README.md:14-22):

> Squad gives you a human-directed AI development team through GitHub Copilot. Describe what you're building. Get a team of specialists — frontend, backend, tester, lead — that live in your repo as files. They persist across sessions, learn your codebase, share decisions, and help you move faster without giving up oversight.

Concretely:
- **Distribution:** two npm packages — [`@bradygaster/squad-sdk`](../../../../squad/packages/squad-sdk/package.json:2) and [`@bradygaster/squad-cli`](../../../../squad/packages/squad-cli/package.json:2). Both are at `0.9.1` (alpha; [`README.md`](../../../../squad/README.md:7-10)).
- **Primary entry-point:** the user runs `squad init` to scaffold a `.squad/` directory, then `copilot --agent squad` to run their team in **GitHub Copilot CLI** ([`README.md`](../../../../squad/README.md:54-72)). The interactive shell `squad` is **deprecated** ([`README.md`](../../../../squad/README.md:113), [`README.md`](../../../../squad/README.md:278-284)).
- **State:** committed markdown under `.squad/` — `team.md`, `routing.md`, `decisions.md`, `agents/<name>/charter.md`, `agents/<name>/history.md`, `skills/`, `log/` ([`README.md`](../../../../squad/README.md:373-396)).
- **Coordinator file:** `.github/agents/squad.agent.md` — the prompt that turns Copilot into the Squad coordinator. It is overwritten by `squad upgrade`; user state in `.squad/` is never touched ([`README.md`](../../../../squad/README.md:88-93)).

In one line: **Squad is a markdown-based, file-persistent team-of-agents prompt overlay for GitHub Copilot Chat (VS Code) and Copilot CLI**, plus a TypeScript SDK that programs the same orchestration.

## Repo Layout

Top-level directory listing of `c:/git/squad`:

```
squad/
├── README.md  README.zh.md  CHANGELOG.md  CONTRIBUTING.md  CONTRIBUTORS.md  SECURITY.md  LICENSE
├── package.json                ← npm-workspaces root, 0.9.1
├── package-lock.json
├── tsconfig.json  vitest.config.ts  squad.config.ts  eslint.config.mjs  cspell.json
├── cli.js  index.cjs           ← bundled CLI entry shims
├── .changeset/                 ← independent versioning per package
├── .copilot/
│   ├── mcp-config.json         ← team-shared MCP config (committed) — real file in this repo
│   └── skills/                 ← 25 SKILL.md files (collaboration, conduct, CLI wiring, security, …)
├── .github/                    ← GitHub workflows (heartbeat, triage, CI, release …)
├── .squad/                     ← Squad's own dogfood team state
├── .squad-templates/           ← legacy templates dir
├── docs/                       ← Astro-based docs site (features/, get-started/, reference/, scenarios/, blog/)
├── lib/                        ← compiled output staging
├── packages/
│   ├── squad-cli/              ← @bradygaster/squad-cli (the binary)
│   │   ├── package.json
│   │   ├── src/                ← cli/, shell/, commands/, remote-ui/
│   │   └── templates/
│   └── squad-sdk/              ← @bradygaster/squad-sdk (the runtime library)
│       ├── package.json
│       ├── src/                ← coordinator/, agents/, casting/, ralph/, runtime/, marketplace/, sharing/, platform/, storage/, streams/, hooks/, tools/, presets/, …
│       └── templates/
├── samples/                    ← 8 sample projects
├── scripts/                    ← release/build/sync helpers
├── templates/                  ← markdown templates copied into a user's .squad/ on `squad init`
├── test/  test-fixtures/       ← ~200 vitest specs
└── ...lint/style configs (.gitattributes, .lycheeignore, .markdownlint-cli2.jsonc, .npmignore)
```

Confirmed via `list_files` on [`../../../../squad`](../../../../squad). Roles:

- [`packages/squad-sdk/`](../../../../squad/packages/squad-sdk) — the bulk of the codebase. Subsystems include coordinator/fan-out/response-tiers, agents/charter-compiler, casting (persistent agent-name registry), ralph (the watch / triage daemon), runtime (i18n, otel, hooks), marketplace (plugin discovery), sharing (export/import), platform (GitHub vs Azure DevOps detection), storage (fs / in-memory / sql.js providers), streams (sub-squad streams), tools, presets, upstream inheritance.
- [`packages/squad-cli/`](../../../../squad/packages/squad-cli) — the `squad` binary, `bin: { squad: "dist/cli-entry.js" }` ([`packages/squad-cli/package.json`](../../../../squad/packages/squad-cli/package.json:6-8)). Includes an Ink-based `shell/` (deprecated) and `remote-ui/` (Squad RC — a PWA/web companion).
- [`templates/`](../../../../squad/templates), [`packages/squad-sdk/templates/`](../../../../squad/packages/squad-sdk/templates), [`packages/squad-cli/templates/`](../../../../squad/packages/squad-cli/templates) — copies of `squad.agent.md`, `team.md`, `routing.md`, charters, ceremony, skill scaffolds. Multiple copies are kept in sync by [`scripts/sync-templates.mjs`](../../../../squad/scripts/sync-templates.mjs) ([`package.json`](../../../../squad/package.json:11)).
- [`.copilot/mcp-config.json`](../../../../squad/.copilot/mcp-config.json) — **the team-shared MCP config**. The file pattern itself is what Squad recommends to users ([`templates/mcp-config.md`](../../../../squad/templates/mcp-config.md:6-8)).

## Architecture

**Type:** A Node CLI binary plus a TypeScript SDK. Not a VS Code extension. Not a chat participant.

| Dimension | Value | Source |
|---|---|---|
| Runtime | Node `>=22.5.0` | [`../../../../squad/package.json`](../../../../squad/package.json:27) |
| Languages | TypeScript (strict, ESM throughout) | [`../../../../squad/tsconfig.json`](../../../../squad/tsconfig.json), [`../../../../squad/package.json`](../../../../squad/package.json:5) |
| Build | `tsc` per package + esbuild bundle for the CLI | [`../../../../squad/package.json`](../../../../squad/package.json:13) |
| UI runtime | Ink + React 19 (deprecated terminal shell); Squad RC is a PWA | [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:92) |
| Test | vitest 3 + Playwright | [`../../../../squad/package.json`](../../../../squad/package.json:14-15) |
| Bin | `squad → dist/cli-entry.js` | [`../../../../squad/packages/squad-cli/package.json`](../../../../squad/packages/squad-cli/package.json:6-8) |

The agent loop is implemented in [`packages/squad-sdk/src/coordinator/`](../../../../squad/packages/squad-sdk/src/coordinator) (coordinator + fan-out + response-tiers) and the long-running watch daemon ("Ralph") in [`packages/squad-sdk/src/ralph/`](../../../../squad/packages/squad-sdk/src/ralph). Cross-referenced by [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:111-114).

**Activation surface:** there is no `package.json` `activationEvents` or `contributes` block — Squad is not a VS Code extension. Its VS Code integration relies on **GitHub Copilot Chat reading `.github/agents/squad.agent.md`** as a custom chat-mode-style prompt, plus the existing `.squad/` files as repo-resident memory. See [`docs/src/content/docs/features/vscode.md`](../../../../squad/docs/src/content/docs/features/vscode.md:29-31) and [`docs/src/content/docs/scenarios/remote-qa.md`](../../../../squad/docs/src/content/docs/scenarios/remote-qa.md:18-21).

## Relationship to GitHub Copilot

This is **the** core question for Phase 3, and the answer is unambiguous in source:

### 1. Squad embeds the official GitHub Copilot SDK

[`packages/squad-sdk/package.json`](../../../../squad/packages/squad-sdk/package.json:235-236):

```json
"dependencies": {
  "@github/copilot-sdk": "^0.1.32",
  "vscode-jsonrpc": "^8.2.1"
}
```

It does **not** use VS Code's `vscode.lm` API (no such import in the SDK). Instead it links directly to the GitHub Copilot SDK published by GitHub itself (`@github/copilot-sdk`). The wrapper is `SquadClient`, described at [`docs/src/content/docs/reference/integration.md`](../../../../squad/docs/src/content/docs/reference/integration.md:10-12):

> `SquadClient` wraps `@github/copilot-sdk` with lifecycle management and auto-reconnection.

The adapter layer that bridges Squad's session interface to the SDK's actual shape is `CopilotSessionAdapter`, documented in [`docs/src/content/docs/whatsnew.md`](../../../../squad/docs/src/content/docs/whatsnew.md:78) and the post-mortem at [`docs/src/content/blog/018-the-adapter-chronicles.md`](../../../../squad/docs/src/content/blog/018-the-adapter-chronicles.md:1-72) (notably — "the Codespaces session exposes `send()`, not `sendMessage()`"). 

### 2. CLI dispatch goes through the Copilot CLI

For the watch / triage path (Ralph), Squad **shells out to `gh copilot` / `copilot --agent squad`** with a context file via the `-p <path>` flag ([`README.md`](../../../../squad/README.md:172-178)):

> Ralph builds a context snapshot … writes this context to a temp file using the `-p <path>` flag … invokes the agent with that file: `gh copilot -p context.md` … the agent decides which issue to work on.

The flag `--agent-cmd <cmd>` lets the user swap the runner ([`README.md`](../../../../squad/README.md:155-158)).

### 3. VS Code mode = Copilot Chat reading the `squad.agent.md` agent file

For VS Code, Squad ships a single markdown file: [`.github/agents/squad.agent.md`](../../../../squad/.github/agents). When opened in VS Code, GitHub Copilot Chat's agent picker discovers this file and exposes it as the **Squad** agent ([`docs/src/content/docs/features/vscode.md`](../../../../squad/docs/src/content/docs/features/vscode.md:29-31)):

> Creates `.github/agents/squad.agent.md` and `.squad/templates/`. Then open VS Code and select **Squad** from the agent picker.

This is **not** a custom chat participant in the `vscode.chat.createChatParticipant` sense; Squad does not register a participant. It is a Copilot-Chat–native **agent file** under `.github/agents/`, which Copilot Chat auto-discovers.

### 4. MCP — Squad does not host an MCP client; it relies on Copilot's

Per [`templates/mcp-config.md`](../../../../squad/templates/mcp-config.md:6-8):

> Users configure MCP servers at these locations (checked in priority order):
> 1. **Repository-level:** `.copilot/mcp-config.json` (team-shared, committed to repo)

The Squad coordinator prompt teaches agents *which MCP tools exist* and *when to call them*. The actual MCP plumbing — server lifecycle, tool dispatch — is performed by **Copilot itself** (CLI or VS Code). This is consistent with [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:134) ("Squad has only lightweight MCP configuration awareness … Squad does not host the MCP client itself"). The `.copilot/mcp-config.json` filename is the **GitHub-owned convention**; Squad simply documents and uses it.

### 5. Summary of integration points

| Squad surface | Talks to Copilot via | File citation |
|---|---|---|
| SDK (`SquadClient`) | `@github/copilot-sdk` (programmatic agent sessions) | [`packages/squad-sdk/package.json`](../../../../squad/packages/squad-sdk/package.json:235), [`docs/src/content/docs/reference/integration.md`](../../../../squad/docs/src/content/docs/reference/integration.md:10-12) |
| `CopilotSessionAdapter` | `@github/copilot-sdk` `CopilotSession` (mapping `sendMessage`/`send`/`on`/`destroy`/`close`) | [`docs/src/content/docs/whatsnew.md`](../../../../squad/docs/src/content/docs/whatsnew.md:78), [`docs/src/content/blog/018-the-adapter-chronicles.md`](../../../../squad/docs/src/content/blog/018-the-adapter-chronicles.md:1) |
| Watch daemon (Ralph) | `gh copilot -p <ctx-file>` (subprocess) | [`README.md`](../../../../squad/README.md:172-178) |
| Interactive use (recommended) | `copilot --agent squad` (Copilot CLI) or VS Code Copilot Chat agent picker | [`README.md`](../../../../squad/README.md:54-72), [`docs/src/content/docs/features/vscode.md`](../../../../squad/docs/src/content/docs/features/vscode.md:29-31) |
| MCP servers | Inherits from Copilot's MCP config (`.copilot/mcp-config.json` and `.vscode/mcp.json`) | [`templates/mcp-config.md`](../../../../squad/templates/mcp-config.md:6-8), [`docs/src/content/docs/features/mcp.md`](../../../../squad/docs/src/content/docs/features/mcp.md:25-28) |

> ⚠️ **Uncertain:** whether Copilot Chat exposes a per-agent MCP allowlist analogous to Roo's `allowedMcpServers`. Squad's docs imply it inherits *all* configured MCP servers without a Squad-side allowlist mechanism. This becomes a Phase-4/6 question (already tracked as Q-002).

## Relationship to Roo-Code

[`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:1-198) already lays this out exhaustively. Highlights:

- **Not a fork.** Squad is original work by `@bradygaster`. Roo-Code is a fork/derivative of Cline. They share zero code ([`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:25-36)).
- **Conceptual overlap on "modes" / "agents"**, but different mental model:
  - Roo modes are **stateless personas** keyed by slug, defined in [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:96) and [`schemas/roomodes.json`](../../../schemas/roomodes.json).
  - Squad agents are **persistent, named team members** with `charter.md` + evolving `history.md` ([`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:140-142)). They are intended to *learn* across sessions and be committed to git.
- **Tool surface:** Roo has its own native-tool implementations (read_file, apply_diff, write_to_file, execute_command, browser_action, …) executed in-process. Squad's "tools" module is mostly SDK-side primitives (file-write guards, PII scrubbing, reviewer lockout) — execution happens inside the Copilot agent runner ([`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:128-131)).
- **MCP:** Roo is a **first-class MCP client host** with per-mode allowlists ([`docs/design/per-mode-mcp-settings.md`](../../design/per-mode-mcp-settings.md)). Squad is **MCP-aware but not an MCP host**.
- **Provider abstraction:** Roo wraps ~30 LLM providers in [`src/api/providers/`](../../../src/api/providers). Squad has no provider abstraction — model selection is a *policy* (which Copilot-side model tier to ask for) in [`packages/squad-sdk/src/config/models.ts`](../../../../squad/packages/squad-sdk/src/config/models.ts).
- **Parallelism:** Squad runs agents in parallel by default (fan-out, session-pool, `--max-concurrent`, `wave-dispatch`, `fleet-dispatch`); Roo enforces serial sub-task execution ([`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:154-178)).
- **State:** Squad commits team state to git under `.squad/`; Roo persists in VS Code globalState plus shadow-git checkpoints ([`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:144-148)).

No shared dependencies of note. Both happen to use changesets and vitest. Both use TypeScript. That's the extent of code-level overlap.

## Feature Overlap Matrix (Roo ↔ Squad)

| Roo feature (from Phase 1) | Squad has it? | How / where |
|---|---|---|
| Built-in modes (architect / code / ask / debug / orchestrator) | ⚠️ Different model | Squad has *roles* in [`packages/squad-sdk/src/roles/catalog.ts`](../../../../squad/packages/squad-sdk/src/roles/catalog.ts) + persistent named agents from a casting registry. No fixed slugs like Roo's. |
| Custom modes via `.roomodes` / global YAML | ⚠️ Different format | Squad agents are markdown files under `.squad/agents/<name>/charter.md` ([`README.md`](../../../../squad/README.md:373-396)). Recently added: `squad.config.ts` SDK-first mode ([`README.md`](../../../../squad/README.md:399-417)). |
| Per-mode tool groups (`read`, `edit`, `command`, `mcp`) | ❌ No | Squad does not expose a tool-group ACL. Tool restrictions are achieved at the prompt level inside the charter, not enforced by the runtime. |
| Per-mode `allowedMcpServers` allowlist | ❌ No | Squad inherits all MCP servers from Copilot's config; no per-agent filter visible in source. |
| Per-mode `fileRegex` edit restriction | ❌ No | Not present in Squad's runtime. Squad's `defineSkill()` and SDK file-write guards exist ([`packages/squad-sdk/src/runtime/`](../../../../squad/packages/squad-sdk/src/runtime)) but are coarser. |
| Orchestrator boomerang (`new_task` → child mode → `attempt_completion`) | ✅ Conceptually | Coordinator dispatches to agents in parallel via `fan-out.ts`; agents return summaries via `attempt_completion`-equivalent. Architecturally different (parallel vs serial). |
| Sub-task isolation / nested condense | ⚠️ Different | Squad uses `.squad/log/` and per-agent `history.md` for persistence; no shadow-git checkpointing. |
| MCP integration (global + per-project + transports) | ⚠️ Inherited | Squad documents `.copilot/mcp-config.json` (CLI) and `.vscode/mcp.json` (VS Code) ([`docs/src/content/docs/features/mcp.md`](../../../../squad/docs/src/content/docs/features/mcp.md:25-28)). The MCP client itself is Copilot's. |
| Custom prompts / rules (`.roo/rules/`, `.roo/rules-<mode>/`, `AGENTS.md`) | ⚠️ Different files | Squad uses `.squad/decisions.md`, per-agent `history.md`, plus `.copilot/skills/<name>/SKILL.md`. The Anthropic SKILL.md format is shared with Roo's `skills/`. |
| Memory / context features (todo, condense, sliding window) | ⚠️ Different | Squad: `.squad/identity/now.md`, `.squad/identity/wisdom.md`, per-agent `history.md`; "Squad nap" command for compress/prune/archive ([`README.md`](../../../../squad/README.md:117-118)). No automatic context-condensing in the Roo sense (Copilot handles that). |
| Native tools (read_file, apply_diff, write_to_file, execute_command, …) | ❌ Not Squad's responsibility | Tools are whatever Copilot provides. Squad adds SDK-side hooks (file-write guards, reviewer lockout, PII scrubbing). |
| Webview UI (mode picker, MCP toggle, prompts UI) | ❌ N/A | No webview. Optional Squad RC PWA exists but is for chat-style remote control, not config management ([`docs/src/content/docs/features/squad-rc.md`](../../../../squad/docs/src/content/docs/features/squad-rc.md)). |
| Settings storage in VS Code globalStorage | ❌ N/A | Squad state lives in the working tree (`.squad/`), or externalized via `squad externalize` ([`README.md`](../../../../squad/README.md:111)). |
| Parallel agent execution | ✅ Yes | First-class: fan-out, session-pool, `--max-concurrent N`, `wave-dispatch`, `fleet-dispatch` ([`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:160-170)). |
| Watch / autonomous polling daemon | ✅ Yes | Ralph: `squad watch --execute --interval 5` ([`README.md`](../../../../squad/README.md:122-272)). Roo has no equivalent. |
| Localisation (14+ locales) | ❌ Largely English | Squad has runtime i18n module + Chinese README; not the depth of Roo's locale coverage ([`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:151-152)). |
| Plugin marketplace | ✅ Yes | `squad plugin marketplace add/remove/list/browse` ([`README.md`](../../../../squad/README.md:115)); upstream Squad sources via `squad upstream`. |

## Preliminary Verdict (final verdict reserved for Phase 7)

> ⚠️ This is a Phase-3-only assessment based on local source inspection. Phases 4–7 may revise it.

- **When Squad helps:** When the user actually wants the *team-of-personas / parallel-execution / autonomous-watch-loop* paradigm. Squad shines for `squad watch --execute` overnight triage, GitHub-issue→PR pipelines, and parallel fan-out across many independent files. It's also useful as a packaged "best practices for the `.copilot/mcp-config.json` + `.github/agents/squad.agent.md` + `.squad/` pattern" — i.e., it codifies a Copilot-native repo layout the user could otherwise hand-craft.
- **When Squad is redundant:** For the user's *core* Roo workflow — single-developer interactive coding with strongly typed mode definitions, per-mode `allowedMcpServers`, edit-file regex restrictions — Squad does not improve on what raw Copilot Chat custom modes + `.github/copilot-instructions.md` would give them. Squad does not provide tool-group ACLs, per-agent MCP allowlists, or `fileRegex` edit gates. Going through Squad on top of Copilot adds a markdown-prompt layer without buying back those Roo guardrails.
- **When Squad adds risk:**
  1. **Alpha software** (`0.9.1`, "Status: alpha"; [`README.md`](../../../../squad/README.md:7-10)). Recent post-mortems ([`docs/src/content/blog/018-the-adapter-chronicles.md`](../../../../squad/docs/src/content/blog/018-the-adapter-chronicles.md), [`docs/src/content/blog/024-v0823-release.md`](../../../../squad/docs/src/content/blog/024-v0823-release.md)) describe P0 Codespaces breakage and ESM-import crashes patched recently — the integration surface against `@github/copilot-sdk` is not yet stable.
  2. **Indirection.** A bug now has three potential layers: Squad coordinator prompt, `@github/copilot-sdk` adapter, Copilot itself. Diagnosis cost rises.
  3. **Different mental model from Roo.** Squad agents are *persistent named team members* expected to evolve `history.md`. Roo modes are *stateless slugs*. Migrating from one to the other is not a rename — it's an ontology shift that may not match the user's working style. The user already maintains a `roo-vault` with global modes that explicitly avoid persistent per-agent learning state; Squad's model fights that.
  4. **No per-mode MCP allowlist.** This is one of the user's documented Roo guardrails (see Phase 1's per-mode MCP section and [`.roomodes`](../../../.roomodes:179-181) which sets `allowedMcpServers: [github, git]` on `docs-extractor`, etc.). Squad does not preserve this.

## Cross-links

- [`00-plan.md`](00-plan.md) · [`10-roo-inventory.md`](10-roo-inventory.md) · [`60-gap-analysis.md`](60-gap-analysis.md) · [`70-migration-paths.md`](70-migration-paths.md)
- Companion: [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md)
- Squad home: [`../../../../squad/README.md`](../../../../squad/README.md)
