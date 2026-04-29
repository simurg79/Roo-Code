---
phase: 1
status: complete
owner: architect-subtask
last_updated: 2026-04-26
sources:
  - packages/types/src/mode.ts
  - packages/types/src/__tests__/mode-allowedMcpServers.spec.ts
  - schemas/roomodes.json
  - .roomodes
  - .roo/mcp.json
  - src/core/config/CustomModesManager.ts
  - src/core/prompts/system.ts
  - src/core/prompts/sections/custom-instructions.ts
  - src/core/prompts/sections/capabilities.ts
  - src/core/prompts/tools/native-tools/mcp_server.ts
  - src/core/task/build-tools.ts
  - src/services/roo-config/index.ts
  - docs/design/per-mode-mcp-settings.md
  - docs/analysis/squad-vs-roo-comparison.md
  - webview-ui/src/components/modes/ModesView.tsx
  - webview-ui/src/components/modes/McpServerRestriction.tsx
  - AGENTS.md
---

# Phase 1 — Roo-Code Experience Inventory

> Parent plan: [`00-plan.md`](00-plan.md) · Index: [`README.md`](README.md)

A complete inventory of the Roo-Code features the user relies on, derived from local source. Every claim is anchored to a file path with a line number.

## Modes & Built-in Mode Definitions

Built-in modes are declared as the `DEFAULT_MODES` array in [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:169). Their schema is the `modeConfigSchema` defined at [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:96), which requires `slug`, `name`, `roleDefinition`, and `groups`, and optionally accepts `whenToUse`, `description`, `customInstructions`, `source` (`global` | `project`), and `allowedMcpServers`.

| Slug | Name | Default tool groups | File restrictions | Notable role / instructions |
|---|---|---|---|---|
| `architect` | 🏗️ Architect | `read`, `edit`, `mcp` | `edit` restricted to `\.md$` (markdown only) | Plan-and-design role; instructions force the agent to gather context, ask clarifying questions, build a todo list with `update_todo_list`, draw Mermaid diagrams, then `switch_mode`. Source: [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:171-181) |
| `code` | 💻 Code | `read`, `edit`, `command`, `mcp` | None | Generic software engineer; no `customInstructions`. Source: [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:182-191) |
| `ask` | ❓ Ask | `read`, `mcp` | None (read-only by absence of `edit`) | Q&A assistant; instructed not to switch into implementing code unless asked. Source: [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:192-203) |
| `debug` | 🪲 Debug | `read`, `edit`, `command`, `mcp` | None | Systematic debugger; instructed to enumerate 5–7 hypotheses, narrow to 1–2, add logs, ask the user to confirm before fixing. Source: [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:204-215) |
| `orchestrator` | 🪃 Orchestrator | `[]` (empty — no tool groups) | n/a | Coordinator that delegates via `new_task` to other modes; explicit instructions to bundle "all necessary context", "clearly defined scope", "supersede" clause. Has access to `new_task` and `attempt_completion` because those tools are not gated by the `read`/`edit`/`command`/`mcp`/`modes`/`browser` group system (see [`src/core/prompts/tools/filter-tools-for-mode.ts`](../../../src/core/prompts/tools/filter-tools-for-mode.ts)). Source: [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:216-227) |

Group names allowed by the schema: `read`, `edit`, `command`, `mcp`, `modes`, `browser` (deprecated, silently stripped via `groupEntryArraySchema` preprocess at [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:91-94) and the `deprecatedToolGroups` list referenced at line 3). Each `groups` entry can be either a bare string or a `[name, { fileRegex, description }]` tuple, where `fileRegex` is validated as a real regex via the refinement at [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:13-26).

## Custom Modes (`.roomodes`, global `custom_modes.yaml`)

### Schema

[`schemas/roomodes.json`](../../../schemas/roomodes.json:1) is a JSON Schema (draft-07) that validates the `.roomodes` file. Required mode fields: `slug` (regex `^[a-zA-Z0-9-]+$`), `name`, `roleDefinition`, `groups`. Optional: `whenToUse`, `description`, `customInstructions`, `source` (`"global"` | `"project"`), `rulesFiles` (array of `{relativePath, content}` for export/import), and `allowedMcpServers` (added at [`schemas/roomodes.json`](../../../schemas/roomodes.json:84-90)). `additionalProperties: false`.

The `allowedMcpServers` field has identical semantics in TypeScript and JSON-Schema land — see the Zod definition at [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:105) and the dedicated test suite [`packages/types/src/__tests__/mode-allowedMcpServers.spec.ts`](../../../packages/types/src/__tests__/mode-allowedMcpServers.spec.ts:1).

### Files on disk

- **Project-scoped:** `<repo>/.roomodes` (YAML; this repo's actual file is at [`.roomodes`](../../../.roomodes:1) and overrides every built-in mode plus adds `translate`, `issue-fixer`, `pr-fixer`, `merge-resolver`, `issue-investigator`, `issue-writer`, `docs-extractor`).
- **Global (user-scope, Windows):** `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\custom_modes.yaml` — i.e. `C:\Users\<user>\AppData\Roaming\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\custom_modes.yaml`. Confirmed by the open-tab path in this workspace's environment and by the `mockSettingsPath`/`mockRoomodes` constants used in [`src/core/config/__tests__/CustomModesManager.spec.ts`](../../../src/core/config/__tests__/CustomModesManager.spec.ts:97). The file is YAML, structured `{ customModes: [ ... ] }`.

### Loader & precedence

`CustomModesManager` at [`src/core/config/CustomModesManager.ts`](../../../src/core/config/CustomModesManager.ts:1) loads both files. The merge logic is **`.roomodes` wins** — see [`src/core/config/CustomModesManager.ts`](../../../src/core/config/CustomModesManager.ts:301-302) (`Merge modes from both sources (.roomodes takes precedence)`) and the watcher block at [`src/core/config/CustomModesManager.ts`](../../../src/core/config/CustomModesManager.ts:323-335) (`// .roomodes takes precedence`). The `source` field is auto-stamped: project for `.roomodes`, global for the YAML settings file ([`src/core/config/CustomModesManager.ts`](../../../src/core/config/CustomModesManager.ts:210-216), [`src/core/config/CustomModesManager.ts`](../../../src/core/config/CustomModesManager.ts:389-394)).

Resolution order **as observed in code**:
1. Project `.roomodes` (highest).
2. Global `custom_modes.yaml`.
3. Built-in `DEFAULT_MODES` (lowest fallback when no override exists).

A built-in slug (e.g. `code`) can be replaced wholesale by a project or global definition with the same slug.

## Orchestrator Behavior

Orchestrator is defined in two places:
- The built-in entry at [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:216-227) (`groups: []` — meaning the only tools available are the always-on ones: `new_task`, `switch_mode`, `attempt_completion`, `ask_followup_question`, `update_todo_list`).
- A project override at [`.roomodes`](../../../.roomodes:2-31) which is byte-identical to the built-in.

The delegation contract is encoded as plain prose in `customInstructions`. Each `new_task` invocation must include: full context, scope, "do only this work" clause, instruction to call `attempt_completion` with a thorough summary, and a "these instructions supersede general mode instructions" clause ([`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:225)).

The native tool implementing delegation is `new_task` at [`src/core/prompts/tools/native-tools/new_task.ts`](../../../src/core/prompts/tools/native-tools/new_task.ts:1) (registered via [`src/core/prompts/tools/native-tools/index.ts`](../../../src/core/prompts/tools/native-tools/index.ts:1) and dispatched in `Task.startSubtask()` at [`src/core/task/Task.ts`](../../../src/core/task/Task.ts:2380)). Sub-task runtime semantics are **strictly serial**: only the first `new_task` per assistant turn is honoured; additional ones are truncated and rejected with an injected error result. Test-enforced at [`src/core/task/__tests__/new-task-isolation.spec.ts`](../../../src/core/task/__tests__/new-task-isolation.spec.ts:1) (named test: *"should only consider the first new_task if multiple exist"*). Cited by [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:174-178).

The parent task pauses; the child runs to completion or `attempt_completion`; the parent resumes with the child's result string. This is the boomerang loop.

## MCP Integration

### Configuration files

- **Global, user-scope (Windows):** `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json` — confirmed by the open-tab path in this workspace. Top-level shape `{ "mcpServers": { <name>: <serverConfig>, ... } }`. Each server config has `command` + `args` (stdio), or `type: "streamable-http"` + `url` + optional `headers` (HTTP), and shared keys `disabled`, `alwaysAllow`, `env`. Real example shape visible in [`../roo-vault/global-settings/mcp_settings.json`](../../../../roo-vault/global-settings/mcp_settings.json:1) (a checked-in copy of the same structure).
- **Project-scope:** `<repo>/.roo/mcp.json` — same schema. This repo's file is at [`.roo/mcp.json`](../../../.roo/mcp.json:1) and registers `ado` (stdio via `npx @azure-devops/mcp`) and `git` (stdio via `docker run mcp/git`).

### Transports supported

- `stdio` — `command` + `args` (e.g. `npx`, `docker`).
- `streamable-http` — `type: "streamable-http"` + `url` + optional `headers` (e.g. `context7`, `microsoft-learn`).

### Server discovery & precedence

`McpHub.getServers()` (referenced from [`src/core/prompts/tools/native-tools/mcp_server.ts`](../../../src/core/prompts/tools/native-tools/mcp_server.ts:19) and described in [`docs/design/per-mode-mcp-settings.md`](../../design/per-mode-mcp-settings.md:26)) deduplicates global vs project servers with **project-wins** semantics.

### Per-mode `allowedMcpServers`

Defined as `z.array(z.string()).optional()` at [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:105). Semantics, per [`docs/design/per-mode-mcp-settings.md`](../../design/per-mode-mcp-settings.md:80-84):

- **Omitted** → all servers available (backward-compatible default).
- **Empty `[]`** → MCP capability text is excluded from the system prompt and **no** MCP server tools are injected — even if the `mcp` group is in `groups`.
- **Populated** → only listed servers are visible to that mode.

Filtering is implemented in `getMcpServerTools()` at [`src/core/prompts/tools/native-tools/mcp_server.ts`](../../../src/core/prompts/tools/native-tools/mcp_server.ts:14-25): a `Set` of allowed names filters `mcpHub.getServers()` before tool definitions are emitted. The allowlist is plumbed in from `buildNativeToolsArrayWithRestrictions()` at [`src/core/task/build-tools.ts`](../../../src/core/task/build-tools.ts:128-133):

```ts
const modeConfig = getModeBySlug(mode ?? defaultModeSlug, customModes)
const allowedMcpServers = modeConfig?.allowedMcpServers
const mcpTools = getMcpServerTools(mcpHub, allowedMcpServers)
```

System-prompt rendering of MCP capability text is gated by both the `mcp` group **and** non-empty filtered server set — exercised by tests at [`src/core/prompts/__tests__/system-prompt.spec.ts`](../../../src/core/prompts/__tests__/system-prompt.spec.ts:579-639) (`"should exclude MCP capability text when allowedMcpServers is empty array"` and `"should include MCP capability text when allowedMcpServers matches connected servers"`). The capability string itself lives in [`src/core/prompts/sections/capabilities.ts`](../../../src/core/prompts/sections/capabilities.ts:10-16).

### Tool-name shaping

MCP tool names are sanitized for OpenAI-compatible function-name rules via `buildMcpToolName(server.name, tool.name)` at [`src/core/prompts/tools/native-tools/mcp_server.ts`](../../../src/core/prompts/tools/native-tools/mcp_server.ts:42). Duplicates are deduplicated (first-wins; project servers come first because of `McpHub.getServers()` ordering — [`src/core/prompts/tools/native-tools/mcp_server.ts`](../../../src/core/prompts/tools/native-tools/mcp_server.ts:44-48)).

### Per-tool enable/allow

Each MCP tool can be individually disabled via `tool.enabledForPrompt === false` ([`src/core/prompts/tools/native-tools/mcp_server.ts`](../../../src/core/prompts/tools/native-tools/mcp_server.ts:36-38)). Each server config carries an `alwaysAllow` array that suppresses approval prompts for listed tool names (e.g. [`.roo/mcp.json`](../../../.roo/mcp.json:11-67)).

## Custom Prompts / Rules

The rule loader is `addCustomInstructions()` at [`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts:382). It composes the system-prompt's "USER'S CUSTOM INSTRUCTIONS" block from several sources, in this order:

1. **Mode-specific rules** — for the active mode `<slug>`, the loader walks the `.roo/rules-<slug>/` directory in each entry returned by `getRooDirectoriesForCwd()` (i.e. global first, then project) ([`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts:409-419)). Files are concatenated in directory order.
2. **Legacy fallback** — if no `rules-<slug>/` directory contributes content, the loader looks for `<repo>/.roorules-<slug>` and then `<repo>/.clinerules-<slug>` ([`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts:426-434)).
3. **`AGENTS.md` family** — `loadAgentRules()` at [`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts:347-379) reads `AGENTS.md` (and the alternate `AGENT.md`) plus `AGENTS.local.md` from the project root and, when `enableSubfolderRules` is on, every directory that contains a `.roo/`. The repo-level workspace file is [`AGENTS.md`](../../../AGENTS.md:1).
4. **Generic rules** — `loadRuleFiles()` at [`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts:206) reads `<scope>/.roo/rules/**/*` (global and project; subfolders included when enabled). Symlinks are followed to a max depth (`MAX_DEPTH = 5`, line 46).

### Directory resolution

`getRooDirectoriesForCwd(cwd)` returns `[ getGlobalRooDirectory(), getProjectRooDirectoryForCwd(cwd) ]` — i.e. `[ os.homedir() + ".roo", cwd + ".roo" ]` ([`src/services/roo-config/index.ts`](../../../src/services/roo-config/index.ts:26-29) and [`src/services/roo-config/index.ts`](../../../src/services/roo-config/index.ts:104-106)). On Windows, the global rules directory is therefore `C:\Users\<user>\.roo\` — **not** the VS Code globalStorage path. (Important: this is distinct from `custom_modes.yaml` and `mcp_settings.json`, which live under VS Code globalStorage.)

`getAllRooDirectoriesForCwd()` ([`src/services/roo-config/index.ts`](../../../src/services/roo-config/index.ts:305-319)) extends this with subfolder `.roo/` directories discovered via ripgrep. Order: global → project → subfolders alphabetically (test at [`src/services/roo-config/__tests__/index.spec.ts`](../../../src/services/roo-config/__tests__/index.spec.ts:462-476)).

`loadConfiguration()` at [`src/services/roo-config/index.ts`](../../../src/services/roo-config/index.ts:402-441) makes the override semantics explicit: when both global and project copies of the same relative-path file exist, the merged content concatenates them with the literal header `# Project-specific rules (override global):`.

### Conflict resolution

There is no key-level merge. Files are concatenated in the order: mode-specific (or legacy fallback) → AGENTS.md (root + subfolder) → generic `.roo/rules/`. Later content does not erase earlier content; it is simply appended. For overlapping advice the model decides — there is no static-resolution layer.

## Memory / Context Features

Roo ships several first-class context-management features, all observable in source:

- **Todo list tool** — `update_todo_list` is a dedicated native tool ([`src/core/prompts/tools/native-tools/update_todo_list.ts`](../../../src/core/prompts/tools/native-tools/update_todo_list.ts:1)). Several modes (architect, issue-writer) explicitly require it as the planning surface ([`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:180); [`.roomodes`](../../../.roomodes:138-145)).
- **Reminders** — every prompt turn re-injects a "REMINDERS" table containing the current todo list (visible in this very session's `environment_details`), powered by the same `update_todo_list` plumbing.
- **Context condensing (auto-summarization)** — when a request's prevContextTokens exceed an effective threshold, `summarizeConversation()` is called from [`src/core/context-management/index.ts`](../../../src/core/context-management/index.ts:306-331) and emits a `condense_context` say-event with `{summary, cost, prevContextTokens, newContextTokens, condenseId}` ([`src/core/task/Task.ts`](../../../src/core/task/Task.ts:1733-1739)). Nested condensing is supported via `condenseId`/`condenseParent` linkage (test at [`src/core/condense/__tests__/nested-condense.spec.ts`](../../../src/core/condense/__tests__/nested-condense.spec.ts:1)).
- **Sliding-window truncation fallback** — if condensing fails or is disabled, `truncateConversation()` removes oldest messages and emits `sliding_window_truncation` ([`src/core/task/Task.ts`](../../../src/core/task/Task.ts:3924-3943)).
- **Checkpoints (shadow git)** — diff-style rollback of workspace edits inside a single task; subsystem at [`src/core/checkpoints/`](../../../src/core/checkpoints) (cited in [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:147)).
- **Skills system** — markdown SKILL.md files loaded on demand via the `skill` tool ([`src/core/prompts/tools/native-tools/skill.ts`](../../../src/core/prompts/tools/native-tools/skill.ts:1)). Mandatory pre-flight skill applicability check is part of architect mode's system prompt (visible in this turn's prompt under `<mandatory_skill_check>`).
- **No formal "memory bank"** — there is no built-in long-term project memory beyond the rules/AGENTS.md/skill files and shadow-git checkpoints. The user's `roo-vault` adds external memory conventions (Phase 2).

## Tool Surface (Native Tools)

Native tools live under [`src/core/prompts/tools/native-tools/`](../../../src/core/prompts/tools/native-tools/) and are registered via [`src/core/prompts/tools/native-tools/index.ts`](../../../src/core/prompts/tools/native-tools/index.ts:1). The full file inventory (excluding `__tests__/` and the helper `converters.ts` / `mcp_server.ts` / `index.ts`):

| Tool | File | Group gate (typical) |
|---|---|---|
| `access_mcp_resource` | [`access_mcp_resource.ts`](../../../src/core/prompts/tools/native-tools/access_mcp_resource.ts:1) | `mcp` + has-resources check ([`filter-tools-for-mode.ts`](../../../src/core/prompts/tools/filter-tools-for-mode.ts:305-307)) |
| `apply_diff` | [`apply_diff.ts`](../../../src/core/prompts/tools/native-tools/apply_diff.ts:1) | `edit` |
| `apply_patch` | [`apply_patch.ts`](../../../src/core/prompts/tools/native-tools/apply_patch.ts:1) | `edit` |
| `ask_followup_question` | [`ask_followup_question.ts`](../../../src/core/prompts/tools/native-tools/ask_followup_question.ts:1) | always |
| `attempt_completion` | [`attempt_completion.ts`](../../../src/core/prompts/tools/native-tools/attempt_completion.ts:1) | always |
| `codebase_search` | [`codebase_search.ts`](../../../src/core/prompts/tools/native-tools/codebase_search.ts:1) | `read` (gated by CodeIndexManager availability) |
| `edit_file` | [`edit_file.ts`](../../../src/core/prompts/tools/native-tools/edit_file.ts:1) | `edit` |
| `edit` | [`edit.ts`](../../../src/core/prompts/tools/native-tools/edit.ts:1) | `edit` (alias / variant) |
| `execute_command` | [`execute_command.ts`](../../../src/core/prompts/tools/native-tools/execute_command.ts:1) | `command` |
| `generate_image` | [`generate_image.ts`](../../../src/core/prompts/tools/native-tools/generate_image.ts:1) | experimental |
| `list_files` | [`list_files.ts`](../../../src/core/prompts/tools/native-tools/list_files.ts:1) | `read` |
| `new_task` | [`new_task.ts`](../../../src/core/prompts/tools/native-tools/new_task.ts:1) | always (delegation primitive) |
| `read_command_output` | [`read_command_output.ts`](../../../src/core/prompts/tools/native-tools/read_command_output.ts:1) | `command` |
| `read_file` | [`read_file.ts`](../../../src/core/prompts/tools/native-tools/read_file.ts:1) | `read` (description varies with `supportsImages`) |
| `run_slash_command` | [`run_slash_command.ts`](../../../src/core/prompts/tools/native-tools/run_slash_command.ts:1) | always |
| `search_files` | [`search_files.ts`](../../../src/core/prompts/tools/native-tools/search_files.ts:1) | `read` |
| `search_replace` | [`search_replace.ts`](../../../src/core/prompts/tools/native-tools/search_replace.ts:1) | `edit` |
| `skill` | [`skill.ts`](../../../src/core/prompts/tools/native-tools/skill.ts:1) | always (skills system) |
| `switch_mode` | [`switch_mode.ts`](../../../src/core/prompts/tools/native-tools/switch_mode.ts:1) | always (gated by `modes` group only when used to *create* modes) |
| `update_todo_list` | [`update_todo_list.ts`](../../../src/core/prompts/tools/native-tools/update_todo_list.ts:1) | always (toggleable per-config via `todoListEnabled`) |
| `write_to_file` | [`write_to_file.ts`](../../../src/core/prompts/tools/native-tools/write_to_file.ts:1) | `edit` |

Plus dynamic MCP tools synthesized by [`mcp_server.ts`](../../../src/core/prompts/tools/native-tools/mcp_server.ts:1) (one entry per `<server>__<tool>`).

The build pipeline that filters this set per mode is [`src/core/task/build-tools.ts`](../../../src/core/task/build-tools.ts:83). Final selection passes through `filterNativeToolsForMode()` and `filterMcpToolsForMode()` from [`src/core/prompts/tools/filter-tools-for-mode.ts`](../../../src/core/prompts/tools/filter-tools-for-mode.ts:1). The `experiments.customTools` flag enables loading user-authored tools from `<each .roo dir>/tools/` ([`src/core/task/build-tools.ts`](../../../src/core/task/build-tools.ts:139-147)).

## Settings Storage Paths (Windows)

| Artifact | Path | Source of fact |
|---|---|---|
| Global custom modes | `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\custom_modes.yaml` | Open-tab path in this workspace; `mockSettingsPath` constants in [`src/core/config/__tests__/CustomModesManager.spec.ts`](../../../src/core/config/__tests__/CustomModesManager.spec.ts:97) |
| Global MCP settings | `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json` | Open-tab path in this workspace |
| Global rules / shared content | `%USERPROFILE%\.roo\` (i.e. `C:\Users\<user>\.roo\`) | `getGlobalRooDirectory()` returns `path.join(os.homedir(), ".roo")` at [`src/services/roo-config/index.ts`](../../../src/services/roo-config/index.ts:26-29) |
| Global agents directory | `%USERPROFILE%\.agents\` | `getGlobalAgentsDirectory()` at [`src/services/roo-config/index.ts`](../../../src/services/roo-config/index.ts:53-56) |
| Project custom modes | `<repo>\.roomodes` (YAML) | [`src/core/config/CustomModesManager.ts`](../../../src/core/config/CustomModesManager.ts:320); constant `ROOMODES_FILENAME` |
| Project MCP servers | `<repo>\.roo\mcp.json` | [`.roo/mcp.json`](../../../.roo/mcp.json:1) |
| Project rules (generic) | `<repo>\.roo\rules\**` | [`src/services/roo-config/index.ts`](../../../src/services/roo-config/index.ts:104-106) + [`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts:206) |
| Project rules (per mode) | `<repo>\.roo\rules-<modeSlug>\**` | [`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts:411-419) |
| Project AGENTS.md | `<repo>\AGENTS.md` (also `AGENT.md`, `AGENTS.local.md`) | [`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts:294-319) |
| Project ignore | `<repo>\.rooignore` | mentioned in this turn's environment under `.rooignore` heading; read by `RooIgnoreController` |
| Custom tools | `<each-roo-dir>\tools\` (when `experiments.customTools` is enabled) | [`src/core/task/build-tools.ts`](../../../src/core/task/build-tools.ts:140) |

## Webview UI Features Worth Replicating

The mode/MCP UX lives under [`webview-ui/src/components/modes/`](../../../webview-ui/src/components/modes/) and is invoked by `ModesView.tsx`:

- **Mode picker / editor** ([`webview-ui/src/components/modes/ModesView.tsx`](../../../webview-ui/src/components/modes/ModesView.tsx:1)) — searchable list of modes (built-in + project + global), edit form for `name`, `roleDefinition`, `whenToUse`, `description`, `customInstructions`, `groups` checkboxes (`read`, `edit`, `command`, `mcp`, `modes`, `browser`), per-`edit` group `fileRegex` field, and a Save button. Built-ins can be overridden from this UI; the override is written to the appropriate scope (project `.roomodes` or global `custom_modes.yaml`).
- **Per-mode MCP allowlist** ([`webview-ui/src/components/modes/McpServerRestriction.tsx`](../../../webview-ui/src/components/modes/McpServerRestriction.tsx:1)) — when the `mcp` group is checked, a "Restrict to specific MCP servers" toggle appears; when on, a checklist of currently connected MCP server names (sourced from the global mcpServers state) is shown and selections map to `allowedMcpServers`. Behavior matches the design spec at [`docs/design/per-mode-mcp-settings.md`](../../design/per-mode-mcp-settings.md:172-180).
- **Delete-mode confirmation dialog** ([`webview-ui/src/components/modes/DeleteModeDialog.tsx`](../../../webview-ui/src/components/modes/DeleteModeDialog.tsx:1)) — destructive-action confirmation that also offers to delete the `.roo/rules-<slug>/` directory.

Adjacent webview features (not under `modes/` but noted in [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md:148)) worth flagging:

- **MCP server panel** with health/enable toggles, connection logs, and a "Restart" action (settings-tab UI).
- **Context settings** — toggles for `todoListEnabled`, autoCondense thresholds, partial-reads, etc.
- **Prompts UI** — view/edit per-mode `customInstructions` and per-support-prompt overrides.
- **Marketplace tab** for downloading community modes — see [`src/services/marketplace/MarketplaceManager.ts`](../../../src/services/marketplace/MarketplaceManager.ts:255).

These are the user-visible surfaces that any Copilot-based replacement will need analogues for (Phase 6 will rate which exist in Copilot Chat / CLI).

## Cross-links

- [`00-plan.md`](00-plan.md) · [`60-gap-analysis.md`](60-gap-analysis.md) · [`80-migration-playbook.md`](80-migration-playbook.md)
- Companion analysis: [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md)
- MCP design: [`docs/design/per-mode-mcp-settings.md`](../../design/per-mode-mcp-settings.md)
