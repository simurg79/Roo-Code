---
phase: 6
status: complete
owner: architect-synthesis-subtask
last_updated: 2026-04-26
sources:
  - docs/investigation/roo-to-copilot/10-roo-inventory.md
  - docs/investigation/roo-to-copilot/20-roo-vault-inventory.md
  - docs/investigation/roo-to-copilot/30-squad-inventory.md
  - docs/investigation/roo-to-copilot/40-copilot-chat-research.md
  - docs/investigation/roo-to-copilot/50-copilot-cli-research.md
  - docs/investigation/roo-to-copilot/99-open-questions.md
---

# Phase 6 — Unified Gap Analysis Matrix

> Parent plan: [`00-plan.md`](00-plan.md) · Index: [`README.md`](README.md)

## A. Methodology / Reading Guide

**Question this file answers.** For every Roo-Code feature catalogued in [`10-roo-inventory.md`](10-roo-inventory.md) (and the vault patterns in [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md)), what is the closest equivalent — or the explicit gap — in (i) GitHub Copilot Chat (VS Code), (ii) GitHub Copilot CLI (`@github/copilot`), and (iii) Squad layered on top of either Copilot surface?

**Severity legend (per-target cell).**

- 🔴 **blocker** — no acceptable workaround; would force keeping Roo or accepting a hard loss.
- 🟠 **major** — no first-class equivalent but a workable workaround exists with non-trivial effort.
- 🟡 **minor** — different ergonomics; functionality preserved with prompt/process changes.
- ✅ **parity** — drop-in or near-drop-in replacement.
- ➕ **additive** — Copilot/Squad ships a capability Roo does not have at all.

**Dual-severity convention.** Each row's *Gap severity* column carries **per-path severities** when Chat and CLI diverge — written as `Chat <icon> / CLI <icon>` (e.g., `Chat 🔴 / CLI 🟠` for G-1). When both paths are equivalent, a single icon is used.

**Squad column convention** (see also § E). The Squad cell expresses **what Squad adds on top of CLI** for that row, not a separate replacement path. Values: `same as CLI` (no delta), `+ <feature>` (additive on Path C only), or `n/a` (Squad has no opinion on that surface).

**Backref IDs.** Cells reference the source-catalog identifiers rather than restating descriptions:

- **G-1…G-14, W-1…W-12** — Chat-side Gap Catalog from [`40-copilot-chat-research.md` § Limits / Known Gaps](40-copilot-chat-research.md#limits--known-gaps).
- **CG-1…CG-15, CW-1…CW-12** — CLI-side Gap Catalog from [`50-copilot-cli-research.md` § 13](50-copilot-cli-research.md#13-limits--known-gaps-relative-to-roo-cli-gap-catalog--phase-5b-ii-b-2).
- **Q-NNN** — open questions from [`99-open-questions.md`](99-open-questions.md).
- **`50 § 9.4`** etc. — section anchors in source files.

Rows are grouped by Roo concept area, in roughly the order of [`10-roo-inventory.md`](10-roo-inventory.md). New gaps discovered during synthesis are tagged `[NEW]` and have a corresponding Q-ID.

## B. Master Gap Matrix

### B.1 Modes / agents schema

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| Mode `slug` (`^[a-zA-Z0-9-]+$`) | Filename `<slug>.agent.md` under `.github/agents/` | Filename `<slug>.agent.md` under `.github/agents/` or `~/.copilot/agents/` | same as CLI | ✅ | Mechanical rename | 40 § Custom Chat Modes; 50 § 5.4 |
| Mode `name` | Frontmatter `name:` (defaults to filename) | Frontmatter `name:` (defaults to filename) | same as CLI | ✅ | — | Identical semantics. |
| Mode `roleDefinition` + `customInstructions` | `.agent.md` body (Markdown, prepended to user turn) | `.agent.md` body (Markdown, prepended to user turn) | same as CLI | ✅ | Concatenate the two Roo fields into one body | 50 § 5.4 mapping table. |
| Mode `whenToUse` (auto-pick hint) | No formal field; `description:` shows hover hint only | No equivalent; agent is selected via `--agent`/`/agent` | same as CLI | 🟡 | Capture intent in `description`; rely on user to pick agent | Roo also doesn't *enforce* `whenToUse`; user picks too. Accept loss. |
| Mode `description` (chat-input placeholder) | Frontmatter `description:` | Frontmatter `description:` (also drives autonomous skill triggering) | same as CLI | ✅ | — | 40 § Custom Chat Modes (1). |
| Mode `source` (`global` / `project`) and precedence (project wins) | Workspace `.github/agents/` overrides user `~/.copilot/agents/` overrides plugin agents | Project `.github/agents/` > user `~/.copilot/agents/` > plugin agents (50 § 5.1) | same as CLI | ✅ | Use the same precedence; built-ins overridable by name | Cleaner than Roo's separate "auto-stamp" of `source`. |
| Built-in modes (architect/code/ask/debug/orchestrator) | No matching built-ins; user re-creates as `.agent.md` | 7 built-ins (`code-review`, `general-purpose`, `explore`, `research`, `rubber-duck`, `task`, `configure-copilot`) | same as CLI | 🟡 | Author 5 vault `.agent.md` files mirroring Roo built-ins; CLI users can also start from built-ins | 50 § 5.1; CLI better-than. |
| Vault layered composition (built-in → global YAML → project `.roomodes`) | Plugin → user → workspace `.github/agents/` (3-tier) | Plugin → user → project (3-tier; same shape) | same as CLI | ✅ | Direct mapping; vault `global-settings/custom_modes.yaml` (21 modes) explodes to 21 `.agent.md` files in the user-scope dir | 20 § Global Settings; 40 § Custom Chat Modes (2). |

### B.2 Tool restrictions (per-mode tool/MCP/file gating)

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| `groups: [read/edit/command/mcp/modes/browser]` (coarse tool-group ACL) | `.agent.md` `tools:` array (per-tool, finer-grained); `#edit` / `#search` built-in tool sets approximate `edit`/`read` groups | `.agent.md` `tools:` array; group expansion per 50 § 5.4 (`read` → `view`/`grep`/`glob`; `command` → `bash`/`powershell`; `browser` → `web_fetch`) | same as CLI | ✅ (W-stronger) | Mechanical group→tool expansion in the converter | Copilot is **finer-grained** than Roo. |
| `groups[].fileRegex` per-group edit restriction (e.g., architect = `\.md$`) | **No equivalent** in `.agent.md` — G-1 | `preToolUse` hook pattern-matches `toolArgs.path` per CG-1/CW-1 reference impl (50 § 10.4) | + parallel-orchestration *ignores* the policy on `task` dispatch (CG-11) → recommend Squad-disabled when policy critical | **Chat 🔴 / CLI 🟠** | Chat: prose-only ("only edit `.md`"); CLI: PowerShell `preToolUse` policy | **G-1 (headline)**; binding constraint = CG-11 sub-agent bypass; final severity hinges on Q-047. |
| Per-mode `allowedMcpServers: ["github"]` | `tools: ["github/*"]` in `.agent.md` (W-3 directly; resolves Q-002) | `tools: ["github-mcp-server/*"]` plus optional `mcp-servers:` allowlist (50 § 9.4) | same as CLI | ✅ | Direct rename | Both paths are 1:1 with Roo. |
| `allowedMcpServers: []` (empty = "no MCP") | Omit all `<server>/…` from `tools:` | Omit all `<server>/…` from `tools:` | same as CLI | ✅ | Resolves Q-009 | 40 § MCP Support (8); used by vault `code` mode. |
| Per-mode rules folder (`.roo/rules-<mode>/`) | No first-class equivalent — G-2; `.instructions.md` is file-glob-scoped (`applyTo:`), not agent-scoped | Same root cause — G-2 inherits | same as CLI | 🟠 | Inline rules into `.agent.md` body, or Markdown-link `.instructions.md` from agent body | Q-018 still tracks the converter design. |
| Vault per-mode `groups[].fileRegex` examples (translate, docs-extractor, architect) | No equivalent; multi-mode loss | `preToolUse` hook table mapping `agentName → regex` (50 § 10.4 prototype) | + Squad's `protected-files` skill could reinforce in prose | **Chat 🔴 / CLI 🟠** | Same as G-1 row | The vault uses `fileRegex` on ≥3 modes (20 § Global Settings); Q-047 quantifies blast radius. |

### B.3 Custom prompts / rules

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| Project `.roo/rules/*.md` (always-on) | `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md` (with `applyTo:`) | `.github/copilot-instructions.md` + `.github/instructions/**/*.instructions.md` (50 § 4.1) | same as CLI | ✅ | Rename + concatenate | 40 § Custom Instructions; 1:1 cross-tool. |
| Global `~/.roo/rules/*.md` | `%APPDATA%\Code\User\prompts\*.instructions.md` and/or `~/.copilot/instructions/` | `~/.copilot/instructions/*.instructions.md` (follows `COPILOT_HOME`) | same as CLI | ✅ | Vault symlink target switches from `~/.roo/rules/` to `~/.copilot/instructions/` | 40 § Storage Locations; 50 § 2.2. |
| Per-mode rules `.roo/rules-<mode>/` | G-2 (no per-agent rules folder) | G-2 inherits | same as CLI | 🟠 | Inline into agent body; Q-018 | See B.2 also. |
| `AGENTS.md` (always-on, project root) | Native — `chat.useAgentsMdFile` default on (W-5) | Native — read from workspace root (50 § 4.1) | same as CLI | ✅ | 1:1 | Cross-tool standard. |
| `AGENTS.local.md` (gitignored personal layer) | Read by VS Code (`AGENTS.local.md` listed alongside `AGENTS.md`) | Read by CLI (`Copilot.md` / `CLAUDE.md` / etc. compatible — verify suffix `.local.md` mapping in Q-048) | same as CLI | 🟡 (verify) | Test on conversion | `[NEW]` Q-048 — unconfirmed `AGENTS.local.md` suffix support on CLI. |
| Subfolder `.roo/` discovery (`enableSubfolderRules`) | Nested `AGENTS.md` behind `chat.useNestedAgentsMdFiles` (experimental); nested `.instructions.md` discovery via `chat.instructionsFilesLocations` | Nested instructions via `**` glob in `applyTo:` | same as CLI | 🟡 | Use `applyTo:` globs | Roo Q-007 also still open on the production default. |

### B.4 MCP integration

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| Global MCP config (Win: `…\globalStorage\…\mcp_settings.json`) | `%APPDATA%\Code\User\mcp.json` (Default profile) or `%APPDATA%\Code\User\profiles\<id>\mcp.json` (named) | `~/.copilot/mcp-config.json` (follows `COPILOT_HOME`) | same as CLI | ✅ | One-time move + `mcpServers` ↔ `servers` rename for Chat | 40 § MCP (8); 50 § 9.1. |
| Project MCP config (`.roo/mcp.json`) | `.vscode/mcp.json` (committed; `${input:…}` placeholders) | `.github/mcp.json` (canonical) or `.mcp.json` at repo root | same as CLI (Squad uses non-canonical `.copilot/mcp-config.json`) | ✅ | Per-format renames | Resolves Q-031 — Squad's `.copilot/mcp-config.json` is non-canonical (50 § 9.1). |
| Top-level shape (`mcpServers`) | Renamed to `servers:` + top-level `inputs:[]` | Stays `mcpServers:`; no `inputs` array | n/a | 🟡 (CG-3 schema fork) | `jq '{mcpServers: .servers}'` migration | 50 § 9.2; same logical config, two file shapes. |
| stdio transport (`command`/`args`/`env`) | Supported; `envFile` + `sandboxEnabled`/`sandbox` (mac/linux only) extras | Supported; adds `tools:[]` per-server filter, `timeout`, `cwd` | same as CLI | ✅ | Direct mapping | 40 § MCP (1); 50 § 9.2. |
| streamable-http transport | `type: "http"` (preferred) + `headers` (HTTP-stream then SSE fallback) | `type: "http"`, `url`, `headers`, plus `oauthClientId`/`oauthPublicClient`/`oidc` | same as CLI | ✅ (CLI ➕ OAuth) | Use HTTP form on both sides | CLI **adds** OAuth flow for HTTP servers. |
| Inline tokens in `mcp_settings.json` (vault gitignored) | `${input:id}` first-run prompt → Windows Credential Manager (W-4) | **Process-env substitution only** (`${VAR}`); no keychain prompt — CG-2 / Q-033 | + Squad's `secret-handling` skill formalises env-var pattern | **Chat ✅ / CLI 🟡** | Chat uses `${input:…}`; CLI uses `[Environment]::SetEnvironmentVariable("KEY","val","User")` then `${KEY}`; vault must dual-author or pick canonical | 40 § MCP (3); 50 § 9.3. **No shared secret story.** |
| Per-mode MCP allowlist (`allowedMcpServers`) | `.agent.md` `tools: ["server/*"]` | Same plus `.agent.md` `mcp-servers:` to scope server visibility (50 § 9.4) | same as CLI | ✅ | Resolves Q-002 | Both paths beat Roo's coarse per-mode list with per-tool granularity. |
| `disabled: true` per server | Extension-view enable/disable (state stored separately from `mcp.json`) | `/mcp disable <name>` (per-session); `--disable-mcp-server` (per-invocation); built-ins via `--disable-builtin-mcps` | + Squad does not host MCP itself | ✅ | Choose tier-appropriate primitive | 40 § MCP (8); 50 § 9.5. |
| Per-tool `alwaysAllow` array | Chat dialog "Always allow" per (workspace, tool) + `chat.tools.eligibleForAutoApproval` | `--allow-tool='server(tool)'` / `settings.json` `allowedTools` | same as CLI | ✅ (CW-12) | Both finer than Roo's per-server array | 50 § 3.3. |
| MCP discovery from other clients (Claude Desktop / Cursor / Continue) | `chat.mcp.discovery.enabled` (off by default) — Claude Desktop confirmed; others inferred (Q-025) | No formal discovery; `--additional-mcp-config @file` for ad-hoc imports | n/a | 🟡 | Manual import from vault | 40 § MCP (7). |
| `/mcp` REPL commands | None in Chat (toggles via UI) | `/mcp [show\|add\|edit\|delete\|disable\|enable\|auth\|reload]` (50 § 9.5) | + Squad documents but does not extend | ➕ on CLI | — | CLI is materially better for keyboard-driven MCP ops. |

### B.5 Orchestrator / sub-agents

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| `new_task(<mode>, <message>)` delegation primitive | Built-in `agent` tool (a.k.a. `runSubagent`) + `agents:` frontmatter allowlist | Built-in `task` tool + `.agent.md` `mcp-servers`/`tools` scoping | + Squad `fan-out` / `wave-dispatch` / `fleet-dispatch` (parallel-by-default) | ✅ | Mechanical translation; subagent receives prompt string and returns summary | 40 § Agent Mode (8); 50 § 5.1. |
| Sequential-only enforcement (Roo test-enforced) | Parallel by default; sequential needs prose discipline — G-4 | Parallel by default; same prose-discipline mitigation — G-4 inherits | + Squad **doubles down on parallel** (fan-out is the point) | 🟡 | Parent agent body says "run subagents in this order, await each" | Resolves Q-013; net upside elsewhere (parallel review). |
| Boomerang return shape (structured `attempt_completion` payload) | Subagent's final assistant message becomes a tool result (free-form) — G-12 | Same — G-12 inherits | same as CLI | 🟡 | Prompt subagent: "return JSON with these fields"; orchestrator parses | 40 § Agent Mode (8.4 last row). |
| Subagent recursion / nesting | `chat.subagents.allowInvocationsFromSubagents` (default off); max depth 5 | Default depth 6, concurrency 32 (50 § 5.1) — CG-5 minor caveat | + Squad's casting registry adds named persistence (different model) | ✅/➕ | — | Both paths exceed Roo (which forbids nesting via test). |
| Subagent uses different model from parent | Explicit `model:` param; cost-tier capped to parent's tier | `task(agent="…", model=…)` honours `.agent.md` `model:` | + Squad `model-selection` skill | ➕ | — | Roo cannot do this; pure win. |
| Vault orchestrator demoted to `read`-only (delegation-only guardrail) | Replicate via `tools: ['agent', 'view', 'grep']` in orchestrator `.agent.md` | Same | same as CLI | ✅ | Mechanical | 20 § Notable patterns. |

### B.6 Native tool surface

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| Read tools (`read_file`, `list_files`, `search_files`, `codebase_search`) | Built-in: `#search`, `read/problems`, `search/codebase`, `search/usages` (W-via tool sets) | Built-in: `view`, `glob`, `grep` (rg-backed), `show_file` (experimental) | same as CLI | ✅ | Group→tool expansion per 50 § 5.4 | Both paths cover Roo's read group. |
| Edit tools (`apply_diff`, `apply_patch`, `edit_file`, `write_to_file`, `search_replace`) | Built-in `#edit` tool set | Built-in `apply_patch`, `create`, `edit` | same as CLI | ✅ | Use `#edit` (Chat) or enumerate `apply_patch`/`create`/`edit` (CLI) | Both cover Roo's edit group. |
| Command execution (`execute_command`, `read_command_output`) | Built-in `runInTerminal`; per-command auto-approve via `chat.tools.terminal.autoApprove` regex map | Built-in `bash` / `powershell` / `bash_list` / `bash_read` / `bash_stop` / `bash_write` (POSIX + PS1 twins) | same as CLI | ✅/➕ | CLI ships full background-job lifecycle (`*_list`/`*_stop`) | 50 § 3.6; richer than Roo. |
| MCP tool synthesis (`<server>__<tool>`) | Per-tool entries from `tools:` allowlist; `mcpserver/*` wildcard | Synthetic `<server>(<tool>)` per MCP-server tool; allowlist via `Kind(arg)` | same as CLI | ✅ | — | 40 § MCP (4); 50 § 3.6. |
| `update_todo_list` always-on tool | No first-class todo tool; can author via `.prompt.md` or skill | No first-class todo tool; same | + Squad `.squad/identity/now.md` is similar shape | 🟡 [NEW] Q-049 | Author a `todo-list.skill` or use Markdown checklist in chat | The reminders surface (Roo re-injects the todo each turn) is **not** replicated by Copilot. |
| 128-tool-per-request hard cap (Roo's 22 native + N MCP stays under) | Hard 128-cap per request — G-7 | Same model-side limit — G-7 inherits | same as CLI | 🟡 | Per-agent `tools:` keeps counts low; enable `github.copilot.chat.virtualTools.threshold` (Chat) | Comfortable today with vault's 4 enabled MCP servers. |

### B.7 Webview UI / mode editing

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| `ModesView.tsx` (visual mode CRUD with `groups`/`fileRegex` form) | Command Palette + JSON/Markdown editor + Chat Customizations editor (Preview); `Chat: New Agent…` (G-5) | None — TTY only; `/init` scaffolds; `/agent` picker (CG-1) | n/a (Squad has no UI either) | **Chat 🟡 / CLI 🟠** | Edit `.agent.md` directly; consider extension-shipped UI (Path D) | 40 § Chat Participants (5); 50 § 13 CG-1. |
| `McpServerRestriction.tsx` (per-mode MCP picker) | Inline `tools: ["server/*"]` in agent file; no GUI | Inline `tools:` / `mcp-servers:`; no GUI; `/mcp show` lists | n/a | 🟠 | Edit JSON/Markdown | Vault users lose the visual checklist. |
| `DeleteModeDialog.tsx` (with cascade-delete `rules-<slug>/`) | Manual file delete; no cascade UX | Manual; `/skills remove <name>` for skills | n/a | 🟡 | Wrapper PowerShell script | Trivial to recreate; not blocking. |
| Marketplace tab for community modes | Agent Plugins (Preview) gallery; `chat.plugins.enabled` (W-2) | Plugin marketplaces via `extraKnownMarketplaces` | + Squad `plugin marketplace add/list/browse` | ✅/➕ | — | Both paths beat Roo's MarketplaceManager. |
| Context settings (todoListEnabled, autoCondense thresholds, partial-reads toggles) | `chat.checkpoints.enabled`, `chat.editRequests`, `github.copilot.chat.agent.autoFix`, `chat.agent.maxRequests` | `settings.json` cascade (`~/.copilot/settings.json` → repo → local) | same as CLI | ✅/🟡 | Different setting names; one-time mapping | 40 § Agent Mode (2); 50 § 2.3. |

### B.8 CLI / scripting

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| `apps/cli` headless invocation | None (Chat is GUI-only) | `copilot -p "<prompt>" -s --no-ask-user --allow-tool='…'` (50 § 12.2) | + Squad `squad watch --execute` Ralph daemon (CW-7 on Path C) | **Chat 🔴-irrelevant / CLI ✅** | Path B native; Path A users must script around the IDE | Headless is a CLI-only path. |
| NDJSON event stream (`json-event-emitter.ts`: 28+ typed events with deltas) | None | **Plain text only**; structured-output flag is feature request [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) — CG-7 / Q-042 | + SDK `session.on(event, …)` (`@github/copilot-sdk` streaming) | **Chat n/a / CLI 🟠** | Drop down to `@github/copilot-sdk` for structured events | Single largest CLI scripting gap vs Roo (50 § 12.6). |
| `--resume` / session history | `Fork Conversation` button + per-workspace session list (no portable export — G-9) | `--continue`, `--resume[=name]`, `/resume`, FTS5 search (CW-4) | + Squad's `.squad/log/` is the persistence | **Chat 🟠 / CLI ✅** | CLI is notably better; Chat sessions are profile-scoped state DB | 40 § Agent Mode (4); 50 § 3.5. |
| `--json` / structured output for CI | None | Absent today (CG-7); SDK or `--share=PATH` Markdown transcript only | + SDK | 🟠 | Same as NDJSON row | Tracked upstream. |
| Exit codes (granular) | n/a | `0` success / non-zero overloaded — CG-7 / Q-043 | same as CLI | 🟡 | Parse stderr or `--share` transcript | 50 § 12.3. |
| OpenTelemetry observability | None | OTLP env-var export (CW-3) — *strict win vs Roo* | + Squad `runtime/otel` wraps the SDK's spans | ➕ | — | 50 § 12.7. |

### B.9 Settings storage / portability

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| Windows global paths (`%APPDATA%\Code\User\globalStorage\…\settings\…`) | `%APPDATA%\Code\User\prompts\` (global) + profile-scoped `mcp.json`/`settings.json` | `%USERPROFILE%\.copilot\` (or wherever `COPILOT_HOME` points) | same as CLI | ✅/➕ | — | 40 § Storage Locations; 50 § 2.1. |
| `~/.roo/` global rules dir (homedir, NOT VS Code globalStorage) | `~/.copilot/instructions/` and/or `%APPDATA%\Code\User\prompts\` | `~/.copilot/instructions/` (or `${COPILOT_HOME}/instructions/`) | same as CLI | ✅ | Vault symlink retargets | 10 § Settings Storage Paths; resolves Q-008 partially. |
| Settings Sync coverage | "Prompts and Instructions" + "MCP Servers" categories cover most files; `*.toolsets.jsonc` reportedly excluded — G-8 / Q-024 | N/A — uses `COPILOT_HOME`; sync is via git, not VS Code | + Squad commits `.squad/` to git | **Chat 🟡 / CLI ✅** | CLI eliminates the sync question | 40 § Storage Locations; 50 § 2.2. |
| Multi-profile vault automation | `mcp.json`/`settings.json` profile-scoped at `…\profiles\<id>\` — G-11 / Q-026 | No "profile" concept; `COPILOT_HOME` = single env var | n/a | **Chat 🟡 / CLI ✅** | CLI closes G-11 entirely (CW-6) | 50 § 2.1. |
| Vault `setup-vault.ps1` symlink scheme | Works for global `prompts/` folder; per-profile `mcp.json` needs PowerShell helper | Works trivially via `COPILOT_HOME` env var | n/a | **Chat 🟡 / CLI ✅** | Phase-8 owns the helper script | 20 § Setup Scripts; 50 § 6.4. |
| `roo-vault/projects/<name>/.roo/` per-project blueprint | `.github/agents/`, `.github/instructions/`, `.vscode/mcp.json`, `AGENTS.md` per project | `.github/agents/`, `.github/instructions/`, `.github/mcp.json`, `.github/skills/`, `.github/hooks/`, `AGENTS.md` per project | + Squad adds `.squad/` (committed team state) | ✅ | Direct mapping | Phase 8 will produce the converter. |

### B.10 Model selection

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| 30+ provider abstraction (`src/api/providers/`) — OpenAI, Anthropic, Bedrock, Azure, Ollama, OpenRouter | Restricted to GitHub-curated catalog (W-1 covers GPT/Claude/Gemini via Copilot subscription) — G-13 if vault uses non-Copilot models | `COPILOT_PROVIDER_BASE_URL` / `COPILOT_PROVIDER_TYPE` (openai/azure/anthropic) / `COPILOT_PROVIDER_API_KEY` (CW-2) — closes G-13 | same as CLI | **Chat 🟠 / CLI ✅** | CLI eliminates the BYOK gap | Resolves Q-030 for CLI; Chat-side stands. |
| Per-mode `apiConfigId` (different model per mode) | `.agent.md` `model:` (single name or prioritized array) | `.agent.md` `model:` | same as CLI | ✅ | — | 40 § Custom Chat Modes (1); 50 § 5.2. |
| Local model (Ollama, LM Studio) | None first-class — G-13 | OpenAI-compat endpoint via `COPILOT_PROVIDER_BASE_URL=http://localhost:11434/v1` | same as CLI | **Chat 🟠 / CLI ✅** | Confirmed in 50 § 7.2 | Big win for offline/cost-control workflows. |
| Default model selection (vault-wide) | Per `.agent.md` only (no global default outside Copilot's own catalog default) | `--model auto/<name>` flag; `~/.copilot/settings.json` global | same as CLI | ✅ | Vault-level convention | 50 § 3.4. |

### B.11 Sessions / state / history

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| Task history (per workspace globalState) | Multi-session list per workspace; "Sessions list" ribbon; **no portable export** — G-9 / Q-029 | `session-state/<id>/` is plain JSONL + Markdown plan + checkpoints (50 § 2.2) | + Squad commits team state to git (`.squad/log/`, per-agent `history.md`) | **Chat 🟠 / CLI ✅ / Squad ➕** | CLI is trivially backup-able | G-9 dropped from major to minor on CLI. |
| Checkpoints (shadow-git rollback per task) | Native `chat.checkpoints.enabled` + `Restore Checkpoint` + Fork (W-8) | `session-state/<id>/checkpoints/` per session | same as CLI | ✅ | Both paths match | 40 § Agent Mode (4); 50 § 2.2. |
| Fork conversation | `Fork Conversation` button (W-8) | Manual (`copilot --resume <id>` → branch) | same as CLI | ✅/🟡 | Chat is more ergonomic; CLI is scriptable | 40 § Agent Mode (4). |
| Export task history | None portable today — G-9 / Q-029 | `--share=PATH` Markdown transcript; full JSONL on disk | + Squad `squad sharing` export commands | **Chat 🟠 / CLI ✅ / Squad ➕** | Use `--share` or `xcopy session-state` | 50 § 12.2. |
| Full-text search across history | Limited (UI-driven) | SQLite FTS5 index in `session-store.db` (CW-4) | same as CLI | ➕ on CLI | — | 50 § 3.5. |

### B.12 Approval / safety

| Roo feature | Copilot Chat | Copilot CLI | Squad | Gap severity | Workaround | Notes |
|---|---|---|---|---|---|---|
| Per-tool confirmation prompt | Per-tool dialog with Allow/Always/Session/Workspace; `chat.permissions.default` (Default Approvals / Bypass / Autopilot) | Per-tool TTY prompt with `Kind(arg)` allow/deny grammar (CW-12) | same as CLI | ✅ | Map vault's "Always allow" lists per-tool | 40 § Agent Mode (5); 50 § 3.3. |
| Per-mode allowlist of pre-approved tools | `chat.tools.eligibleForAutoApproval` (org-managed) + per-tool dialog choices | `settings.json` `allowedTools` / `deniedTools`; `--allow-tool='…'` per-invocation; **deny wins** (CW-12) | same as CLI | ✅ (CLI ➕) | CLI's `Kind(arg)` is finer-grained than Chat | Both beat Roo. |
| `chat.tools.terminal.autoApprove` regex map (Chat) / `--allow-tool='shell(git:*)'` (CLI) | Regex-based command auto-approve (W-10 org-policy capable) | `Kind(arg)` allow/deny patterns; per-invocation flags | same as CLI | ✅/➕ | — | Material upgrade over Roo's per-server `alwaysAllow`. |
| Hooks (pre/post tool, session lifecycle) | None first-class (Preview `hooks:` in `.agent.md` frontmatter) | 13 events × `command`/`prompt` types (50 § 10.2); enables G-1 mitigation via `preToolUse` (CW-1) | + Squad's SDK `SessionHooks` for in-process hooks | **Chat 🔴 (no hooks → cannot mitigate G-1) / CLI 🟢 with caveats** | This is the load-bearing CLI advantage | CG-11 (sub-agent bypass), CG-13/14/15 are caveats. |
| Sandboxing | `chat.agent.sandbox.enabled` mac/linux only — G-14; ignored on Windows | Same — G-14 inherits | n/a | 🟡 | No regression vs Roo | Windows-platform limitation. |
| Org-managed policies | `chat.agent.networkFilter`, `chat.tools.global.autoApprove`, `chat.plugins.enabled`, etc. (W-10) | Six-key repo-settings allowlist (`disableAllHooks`, `hooks`, `enabledPlugins`, …) — CG-4 limits scope | + Squad's `protected-files` / `secret-handling` skills add prompt-level policy | **Chat ✅ / CLI 🟠 (CG-4 scope)** | Push policy to user-scope on CLI; Chat has richer enterprise controls | 50 § 10.5. |

## C. Severity Tally

Counts include the matrix rows in §§ B.1–B.12 (≈70 row-cells per path). Rows with dual severity contribute to both columns (Chat severity counted in Chat row, CLI severity counted in CLI row). Squad row counts only deltas where Squad is `+ <feature>` or `same as CLI`.

| Path | 🔴 | 🟠 | 🟡 | ✅ | ➕ |
|---|---|---|---|---|---|
| **Chat** | 2 | 8 | 12 | 22 | 4 |
| **CLI** | 0 | 7 | 11 | 27 | 8 |
| **Squad (delta over CLI)** | 0 | 0 | 0 | (rows where Squad is `same as CLI`) | 7 (parallel fan-out, Ralph daemon, casting registry, plugin marketplace, `secret-handling`/`protected-files` skills, `.squad/log/` portable state, in-process `SessionHooks`) |

**Interpretation.**

1. **Chat carries 2 blockers (G-1 file-regex on edit + B.8 row "headless invocation" being structurally absent for any CI/scripting workflow).** CLI eliminates **both** — the first via `preToolUse` (with CG-11 caveat), the second by being a CLI in the first place.
2. **CLI introduces no new blockers** but ships ~7 majors centered on observability/SDK churn/UI-loss (CG-1, CG-4, CG-7, CG-8, CG-11, plus inherited G-2, G-5).
3. **Wins favour the CLI by a meaningful margin** (8 ➕ vs 4 ➕). Chat's wins are unified-panel + multi-profile UX; CLI's wins are headless + hooks + BYOK + portability + skills + OTel + FTS5 + `Kind(arg)` permission grammar.
4. **Squad's value is real but narrow**: it adds 7 distinct capabilities on top of CLI (parallel orchestration, Ralph, casting, marketplace, two skills, portable state, in-process hooks), but is gated on accepting CG-12's alpha-stability tax. Only relevant on Path C.

## D. Top 10 Most Important Rows

The 10 highest-impact rows for path selection and playbook scoping (with one-line "what to do about it"):

1. **B.2 row 2 — `groups[].fileRegex` (G-1).** `Chat 🔴 / CLI 🟠`. **Chat:** accept loss + prose enforcement. **CLI:** ship `preToolUse` PowerShell hook from 50 § 10.4; restrict `task` dispatch in regex-bound agents (CG-11).
2. **B.8 row 1 — Headless invocation.** `Chat n/a / CLI ✅`. CLI is the only path for CI/automation workflows; Path A users must accept "interactive only".
3. **B.10 row 1 — Provider abstraction / BYOK (G-13).** `Chat 🟠 / CLI ✅`. If the vault uses Ollama/Anthropic/Azure direct (Q-030), the CLI is required.
4. **B.4 row 6 — MCP secret model (CG-2 / Q-033).** `Chat ✅ (Credential Manager) / CLI 🟡 (env-var only)`. Pick one canonical secret store; vault must dual-author or generate.
5. **B.5 row 1 — Subagent dispatch.** `Chat ✅ / CLI ✅ / Squad ➕ parallel fan-out`. All three paths work; Squad adds parallel-by-default; Roo's serial enforcement is lost everywhere (G-4 minor).
6. **B.7 row 1 — Webview UI for mode CRUD (G-5 / CG-1).** `Chat 🟡 / CLI 🟠`. File-driven editing + Command Palette; Path D could re-add visual UI.
7. **B.8 row 2 — Structured event stream (CG-7 / Q-042).** `CLI 🟠`. Track [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52); meanwhile use `@github/copilot-sdk` streaming events.
8. **B.9 row 4 — Multi-profile vault automation (G-11).** `Chat 🟡 / CLI ✅`. CLI's `COPILOT_HOME` closes the gap; Chat needs a Phase-8 PowerShell helper for `…\profiles\<id>\mcp.json`.
9. **B.11 row 4 — Chat history export (G-9).** `Chat 🟠 / CLI ✅`. CLI's plain JSONL is portable; Chat's profile-scoped DB is opaque (Q-029).
10. **B.12 row 4 — Hooks.** `Chat 🔴 (no hooks ↔ no G-1 mitigation) / CLI 🟢 (with CG-11 caveat)`. The single load-bearing reason to consider Path B over Path A.

## E. Squad Column Interpretation

The Squad column in the matrix is **not a third migration path**; it expresses **what Squad layers on top of CLI** (and only CLI — Squad has no `vscode.lm` dependency and cannot embed in Chat per [`30-squad-inventory.md` § Architecture](30-squad-inventory.md#architecture) and [`50-copilot-cli-research.md` § 6.2](50-copilot-cli-research.md#62-squad--vscodelm-resolves-q-010)).

- `same as CLI` — Squad doesn't change behaviour for that row; Path C inherits the CLI cell.
- `+ <feature>` — Squad **adds** a capability the bare CLI doesn't have (e.g., parallel fan-out, Ralph watch daemon, persistent named agents from a casting registry, `protected-files` / `secret-handling` skills, `.squad/log/` git-committed state, in-process `SessionHooks` via the SDK).
- `n/a` — Squad has no opinion on the surface (e.g., Windows path layout, MCP transport choice).

**Squad is non-zero only on Path C.** Path A (Chat) and Path B (CLI built-ins) are unaffected by Squad's existence; Path D (vault-as-VSIX) cannot reuse Squad as-is. Phase 7 will weigh Squad's additive value (parallel orchestration, Ralph, casting registry) against its cost (CG-12 alpha-stability tax + Q-011 still open + the indirection-debugging tax noted in [`30-squad-inventory.md` § Preliminary Verdict](30-squad-inventory.md#preliminary-verdict-final-verdict-reserved-for-phase-7)).

## F. Phase 7 / Phase 8 Hand-off

### F.1 Rows that determine path selection (largest Chat-vs-CLI severity divergence)

Phase 7's path-selection synthesis hinges on these rows where the dual severity diverges most:

- **B.2 row 2 (G-1 `fileRegex`)** — Chat 🔴 vs CLI 🟠. **Decisive** if vault's `fileRegex` usage is broad (Q-047). If narrow → Chat survives; if broad → CLI required.
- **B.8 row 1 (headless invocation)** — Chat n/a vs CLI ✅. **Decisive** if any vault automation runs from CI / cron / pre-commit hooks today.
- **B.10 row 1 (BYOK, G-13)** — Chat 🟠 vs CLI ✅. **Decisive** iff Q-030 confirms vault uses non-Copilot models.
- **B.12 row 4 (hooks)** — Chat 🔴-for-G-1-mitigation vs CLI 🟢. **Decisive** because hooks are the only mechanism that closes G-1; if you need it, you need CLI.
- **B.9 row 4 (multi-profile, G-11)** — Chat 🟡 vs CLI ✅. **Tie-breaker**, not decisive on its own.

### F.2 Rows that determine playbook complexity (Phase 8 effort sizing)

These 🔴/🟠 rows have non-trivial workarounds that Phase 8 must script:

- **B.2 row 2 / row 6 (G-1 + vault `fileRegex` examples)** — Phase 8 owns the `enforce-file-regex.ps1` reference + the per-agent regex policy table; must address Q-047, Q-037 (active-agent in payload), Q-039 (`pwsh` cold-start latency).
- **B.3 row 3 (G-2 per-mode rules folder)** — Phase 8 owns the inlining strategy (agent-body inline vs Markdown-link to `.instructions.md`).
- **B.4 row 3 (CG-3 schema fork)** — Phase 8 owns the `jq` migration + the canonical-source decision (which file is the truth; the other is generated).
- **B.4 row 6 (CG-2 secret model)** — Phase 8 owns the `[Environment]::SetEnvironmentVariable("KEY","val","User")` bootstrap and the dual-format converter for `${input:…}` ↔ `${KEY}`.
- **B.7 row 1 (G-5 / CG-1 webview UI)** — Phase 8 must decide whether to ship a thin Path-D VSIX for visual mode CRUD or accept file-driven editing.
- **B.8 row 2 (CG-7 structured output)** — Phase 8 must pick: `@github/copilot-sdk` for code-driven consumers, OTel for aggregate metrics, or accept text-only `copilot -p`.
- **B.9 row 4 (G-11 multi-profile)** — Phase 8 owns the PowerShell helper that enumerates `%APPDATA%\Code\User\profiles\*\` and re-points each profile's `mcp.json` (only relevant for Path A).
- **B.12 row 6 (CG-4 repo-settings allowlist)** — Phase 8 must encode the "wrap `copilot` in a project-local launcher that exports `--allow-tool` / `--deny-tool` / `--mode`" pattern, since per-project `allowedTools` is silently dropped.

### F.3 Open questions still relevant to the matrix

The matrix's severities depend on these still-open Q-IDs from [`99-open-questions.md`](99-open-questions.md):

- **Q-047** (vault's actual `fileRegex` usage breadth) — directly determines whether G-1 stays 🟠 on CLI or re-escalates to 🔴 once you account for `task`-dispatched sub-agents (CG-11). **Phase 6 owns the count.**
- **Q-030** (does the vault use non-Copilot models?) — determines whether G-13 is 🟠 or moot on Chat.
- **Q-029** (chat-sessions JSON portability) — determines whether G-9 stays 🟠 on Chat.
- **Q-027 / Q-028** (Agent Plugins manifest + org policy) — determines Path-D viability scoring.
- **Q-046** (CLI binary bundling for Path-D VSIX) — determines whether Path D is "user installs CLI" vs "VSIX bundles CLI".
- **Q-031 / Q-033** — already resolved in Phase 5b-i; restated in B.4 rows 2 and 6 for traceability.

### F.4 New questions opened during this synthesis

- **Q-048** — Does Copilot CLI / Chat read `AGENTS.local.md` (gitignored personal layer) the way Roo does? CLI doc lists `Copilot.md` / `GEMINI.md` / `CODEX.md` / `CLAUDE.md` compat suffixes but `.local.md` suffix support is unverified. Affects B.3 row 5. Owner: Phase 8.
- **Q-049** — How is Roo's "always-on todo list re-injection" (every prompt turn re-emits the `update_todo_list` snapshot in `environment_details`) replicated under Copilot? No first-class equivalent in Chat or CLI; can be approximated by an `agentStop` hook (CLI) or a `.prompt.md` rerun (Chat) but neither is the same UX. Affects B.6 row 5. Owner: Phase 8.

## Cross-links

- [`10-roo-inventory.md`](10-roo-inventory.md) · [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md) · [`30-squad-inventory.md`](30-squad-inventory.md) · [`40-copilot-chat-research.md`](40-copilot-chat-research.md) · [`50-copilot-cli-research.md`](50-copilot-cli-research.md) · [`70-migration-paths.md`](70-migration-paths.md) · [`90-decision-log.md`](90-decision-log.md) · [`99-open-questions.md`](99-open-questions.md)
