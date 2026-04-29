---
phase: 4
status: complete
owner: architect-subtask
last_updated: 2026-04-26
sources:
  - https://code.visualstudio.com/docs/copilot/customization/custom-chat-modes
  - https://code.visualstudio.com/docs/copilot/customization/custom-instructions
  - https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
  - https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
  - https://github.com/microsoft/vscode/issues/305642
  - https://github.com/microsoft/vscode/issues/272199
  - https://code.visualstudio.com/docs/copilot/customization/prompt-files
  - https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files
  - https://github.com/microsoft/vscode-copilot-release/issues/12853
  - https://learn.microsoft.com/visualstudio/ide/copilot-chat-context
  - https://code.visualstudio.com/docs/copilot/agents/agent-tools
  - https://code.visualstudio.com/docs/copilot/concepts/tools
  - https://github.com/microsoft/vscode/issues/251603
  - https://github.com/microsoft/vscode/issues/251515
  - https://github.com/microsoft/vscode-copilot-release/issues/13065
  - https://github.com/orgs/community/discussions/167721
  - https://code.visualstudio.com/docs/copilot/customization/mcp-servers
  - https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
  - https://code.visualstudio.com/api/extension-guides/ai/mcp
  - https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-chat-with-mcp
  - https://code.visualstudio.com/docs/configure/settings-sync
  - https://code.visualstudio.com/docs/configure/profiles
  - https://code.visualstudio.com/docs/copilot/agents/agent-tools
  - https://github.com/modelcontextprotocol/servers/issues/3460
  - https://github.com/microsoft/vscode/issues/253039
  - https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode
  - https://code.visualstudio.com/docs/copilot/agents/overview
  - https://code.visualstudio.com/docs/copilot/agents/subagents
  - https://code.visualstudio.com/docs/copilot/customization/custom-agents
  - https://code.visualstudio.com/docs/copilot/customization/agent-plugins
  - https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints
  - https://code.visualstudio.com/docs/copilot/reference/copilot-settings
  - https://code.visualstudio.com/docs/copilot/reference/copilot-vscode-features
  - https://code.visualstudio.com/api/extension-guides/chat
  - https://code.visualstudio.com/api/extension-guides/ai/chat
  - https://code.visualstudio.com/api/extension-guides/tools
  - https://code.visualstudio.com/api/extension-guides/ai/tools
  - https://code.visualstudio.com/api/references/vscode-api#chat
  - https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development
  - https://code.visualstudio.com/blogs/2025/02/24/introducing-copilot-agent-mode
  - https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample
  - https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents
---

<!-- Phase 4 complete (4a + 4b + 4c + 4d) 2026-04-26 -->

# Phase 4 — GitHub Copilot Chat (VS Code) Research

> Parent plan: [`00-plan.md`](00-plan.md) · Index: [`README.md`](README.md)

**What this file is for:** Capture, with citations, every Copilot Chat capability relevant to replacing Roo. Each section MUST start with a `Sources` subsection listing official docs URLs and access dates.

## Official Documentation Links

### Sources
> *What goes here:* Curated list of canonical URLs (Microsoft Learn, GitHub Docs, code.visualstudio.com) covering Copilot Chat overall, with access dates.

> *What goes here:* Brief annotated list of which doc page covers which topic.

## Custom Chat Modes (`.chatmode.md`)

### Sources

- [`custom-chat-modes`](https://code.visualstudio.com/docs/copilot/customization/custom-chat-modes) — VS Code "Custom agents in VS Code" doc (the URL still says `custom-chat-modes`; the page title and content have been renamed to **Custom agents** and the file extension to **`.agent.md`**). Accessed 2026-04-26.
- [`vscode/issues/305642`](https://github.com/microsoft/vscode/issues/305642) — community / maintainer thread documenting that the only user-data folder that picks up agents/instructions/prompts is `%APPDATA%\Code\User\prompts` (i.e. outside the profile-scoped folders). Accessed 2026-04-26.
- [`orgs/community/discussions/175649`](https://github.com/orgs/community/discussions/175649) — community thread re-stating that AGENTS.md support in VS Code is currently experimental / off by default. Accessed 2026-04-26.

### Findings (2026-04-26)

> ⚠️ **Naming change resolves Q-004 partially and supersedes the task brief.** As of the current docs, what Roo-Code's brief still calls "`.chatmode.md`" has been **renamed to `.agent.md`** ("Custom agents") in VS Code. The page explicitly states:
>
> > "Custom agents were previously known as custom chat modes. The functionality remains the same, but the terminology has been updated… If you have existing `.chatmode.md` files, rename them to `.agent.md`…"
>
> All findings below use the **current** name; treat any user docs that say `.chatmode.md` as legacy.

#### 1. File format & frontmatter schema

Custom agents are Markdown files with the **`.agent.md`** extension and an optional YAML frontmatter header. The fully-documented frontmatter fields are:

| Field | Purpose |
|---|---|
| `description` | Placeholder text for the chat input |
| `name` | Display name (defaults to filename) |
| `argument-hint` | Hint text in the chat input |
| `tools` | Array of tool / tool-set / MCP-tool names available to this agent. `mcpserver/*` allows all tools of one MCP server. |
| `agents` | Array of agent names allowed as **subagents** (`*` = all, `[]` = none) |
| `model` | Single model name **or** prioritized array — first available wins |
| `user-invocable` | Boolean; if `false`, only callable as a subagent |
| `disable-model-invocation` | Boolean; if `true`, can't be invoked as a subagent |
| `target` | `vscode` or `github-copilot` |
| `mcp-servers` | Inline MCP server JSON (only when `target: github-copilot`) |
| `handoffs` | List of `{label, agent, prompt, send, model}` for sequential workflow buttons |
| `hooks` (Preview) | Per-agent `PreToolUse` / `PostToolUse` shell hooks |
| `infer` | Deprecated — replaced by `user-invocable` + `disable-model-invocation` |

Quote (canonical schema row for `tools`):

> "A list of tool or tool set names that are available for this custom agent. Can include built-in tools, tool sets, MCP tools, or tools contributed by extensions. To include all tools of an MCP server, use the `/*` format."

The body is Markdown and is "prepended to the user chat prompt" when the agent is selected. **Note:** the `.chatmode.md` schema fields originally documented (`description`, `tools`, `model`) are a **strict subset** of the current schema — no fields were removed, only added.

VS Code also natively reads **Claude `.md` agent files** in `.claude/agents` with comma-separated `tools` / `disallowedTools` strings:

> "VS Code maps Claude-specific tool names to the corresponding VS Code tools. Both the VS Code `.agent.md` format (with YAML arrays for tools) and the Claude format (with comma-separated strings) are supported."

#### 2. Workspace location

Default workspace folder is **`.github/agents/`** (formerly `.github/chatmodes/`). VS Code also auto-detects `.md` files in `.claude/agents/` (Claude format).

> "Workspace | `.github/agents` folder
> Workspace (Claude format) | `.claude/agents` folder"

Additional workspace locations are configurable via the `chat.agentFilesLocations` setting. Monorepo / parent-repo discovery is gated by `chat.useCustomizationsInParentRepositories`.

#### 3. User-profile location on Windows

The doc lists user-scope as `~/.copilot/agents` **or** "your user data (specific to your VS Code profile)". On Windows 11 that resolves to:

- `%USERPROFILE%\.copilot\agents\` — the cross-tool location shared with Copilot CLI, **and**
- `%APPDATA%\Code\User\prompts\` — the historical profile-scoped folder. ⚠️ Per [`microsoft/vscode#305642`](https://github.com/microsoft/vscode/issues/305642) (accessed 2026-04-26):
>
> > "Currently, the only user data folder that picks up agents, instructions or prompts is `%APPDATA%\Code\User\prompts` (i.e. outside the profile)…"

So on Windows the practical paths are `C:\Users\<you>\.copilot\agents\` and `C:\Users\<you>\AppData\Roaming\Code\User\prompts\`. **Resolves Q-004** for chatmodes (workspace = `.github/agents/`, user = `%APPDATA%\Code\User\prompts\` and/or `%USERPROFILE%\.copilot\agents\`).

⚠️ uncertain — the doc says "or your user data (specific to your VS Code profile)" but [`microsoft/vscode#305642`](https://github.com/microsoft/vscode/issues/305642) suggests that profile-scoped user-data folders are **not** actually scanned today; only the global `prompts/` folder is. Filed as Q-015.

#### 4. Invocation

Custom agents appear in the **agents dropdown** in the Chat view (next to the chat input). The user picks one and the rest of the conversation runs under that agent's persona, tool list, and model choice. Helpers:

- `/agents` in the chat input opens the **Configure Custom Agents** menu.
- `/create-agent` generates a new agent file via AI.
- After a response, **handoff buttons** can switch to a target agent with a pre-filled (and optionally auto-sent) prompt.

There is **no `/<modename>` slash-command invocation** the way Roo's commands work — selection is via dropdown or handoff button, not slash command.

#### 5. Critical comparison to Roo

| Roo capability | Copilot custom agent equivalent | Verdict |
|---|---|---|
| (a) Restrict edits to specific file globs (Roo `fileRegex` per group, e.g. architect mode = `\.md$`) | The frontmatter has **no `fileRegex` / `applyTo` field**. The only way to influence what files an agent touches is to instruct it in prose in the body, or to omit the `edit` tool entirely (which blocks **all** edits, not just unwanted ones). | **No** (no equivalent). ⚠️ Resolves part of Q-005 (lossy mapping). |
| (b) Restrict which tools / MCP servers it may call | **Yes.** The `tools` array is an explicit allowlist; built-in tools, tool sets, extension tools, and MCP tools (including `mcpserver/*` whole-server grants) are all selectable. Per the doc: *"If a given tool is not available when using the custom agent, it is ignored."* This is the closest analogue to Roo's per-mode `allowedMcpServers` / `groups`. | **Yes** (and stronger than Roo for non-MCP tools). **Resolves Q-002 — yes**, Copilot Chat supports per-agent tool/MCP allowlists, including a wildcard `serverName/*` form. |
| (c) Auto-launch sub-agents (Roo Orchestrator's `new_task` boomerang) | The frontmatter `agents:` field plus the built-in `agent` tool let an agent invoke other agents as **subagents**. The doc shows a Feature-Builder → Researcher → Implementer example. | **Partial / yes.** Sub-agent dispatch exists and is officially documented (no longer experimental for the basic case; "nested subagents" still flagged experimental). **Resolves Q-003 — yes** (with caveats). Roo's "boomerang return-to-orchestrator with summary" pattern is approximated by handoffs + the `agent` tool but is not a 1:1 protocol; needs Phase 4d follow-up. |

Quote supporting the tool-allowlist verdict:

> "A planning agent might only need read-only tools for research and analysis to prevent accidental code changes, while an implementation agent would need full editing capabilities. Custom agents let you specify exactly which tools are available for each task…"

#### 6. Versioning / recent changes

- The feature first shipped as "Custom chat modes" with `.chatmode.md` files in the **VS Code 1.101 (June 2025)** Copilot Chat release.
- Renamed to "Custom agents" with `.agent.md` files and `.github/agents/` location in a 2025-Q4 / 2026-Q1 release; legacy `.chatmode.md` files in the old `.github/chatmodes/` folder are still loaded but the docs instruct users to rename.
- Subagents, handoffs, scoped hooks, Claude `.claude/agents/` interop, and organization-level agents (`github.copilot.chat.organizationCustomAgents.enabled`) are all post-rename additions.

⚠️ uncertain — exact version numbers for the rename and for subagent GA. Filed as Q-016.

## Custom Instructions (`.github/copilot-instructions.md`)

### Sources

- [`custom-instructions`](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) — VS Code "Use custom instructions in VS Code". Accessed 2026-04-26.
- [`docs.github.com .../add-repository-instructions`](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions) — GitHub-side companion doc covering `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, and `AGENTS.md`. Accessed 2026-04-26.
- [`docs.github.com .../add-repository-instructions` (alt path)](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions) — same content, customize-copilot URL tree. Accessed 2026-04-26.
- [`microsoft/vscode#272199`](https://github.com/microsoft/vscode/issues/272199) — confirms user-instruction storage path on Windows is `%APPDATA%\Code\User\prompts\`. Accessed 2026-04-26.

### Findings (2026-04-26)

#### 1. Repo-level `.github/copilot-instructions.md`

- **Location:** exactly `.github/copilot-instructions.md` at the workspace root. VS Code auto-detects it.
- **When applied:** automatically prepended/attached to **every chat request** in the workspace (Chat view + agent mode + inline chat that goes through Chat). Per the doc:
  > "VS Code automatically detects a `.github/copilot-instructions.md` Markdown file in the root of your workspace and applies the instructions in this file to all chat requests within this workspace."
- **Not applied to** code-completion-style **inline suggestions** (the ghost-text completer):
  > "Custom instructions are not taken into account for inline suggestions as you type in the editor."
- **Size limits:** no hard byte/token limit is documented in the VS Code page. The GitHub-side prompt-template for cloud agent says *"Instructions must be no longer than 2 pages"* — that's a **soft style guideline**, not an enforced cap. ⚠️ uncertain — exact token cap. Filed as Q-017.
- **Precedence:** see precedence model below; repo-level is mid-tier (Personal > Repository > Organization).

#### 2. Path-scoped `.github/instructions/*.instructions.md` with `applyTo`

**Supported.** Schema (frontmatter):

| Field | Required | Description |
|---|---|---|
| `name` | No | Display name (defaults to filename) |
| `description` | No | Hover description in Chat view |
| `applyTo` | No | Comma-separated glob(s) relative to workspace root. `**` = all files. If omitted, the file is **not** applied automatically; it can only be attached manually. |

GitHub also documents an `excludeAgent: "code-review" | "cloud-agent"` flag on the GitHub-side processing, used to opt the file out of code-review or cloud-agent runs.

Quote on auto-application:

> "The agent determines which instructions files to apply based on the file patterns specified in the `applyTo` property in the instructions file header or semantic matching of the instruction description to the current task."

Workspace location is `.github/instructions/` (recursively scanned); additional locations configurable via `chat.instructionsFilesLocations`. User-scope locations: `~/.copilot/instructions`, `~/.claude/rules`, and the `instructions` folder of the current VS Code profile.

> ⚠️ **GitHub-side caveat (separate from VS Code):** the GitHub.com docs state *"Currently, on GitHub.com, path-specific custom instructions are only supported for Copilot cloud agent and Copilot code review."* — meaning a `.instructions.md` file influences cloud-agent / code-review on GitHub but **not** every Copilot surface server-side, although VS Code Copilot Chat **does** honor it locally.

**Precedence vs the repo-level file:** the VS Code doc says all instruction files are merged with **no specific order guaranteed within a tier**; the GitHub doc says *"If the path you specify matches a file that Copilot is working on, and a repository-wide custom instructions file also exists, then the instructions from both files are used"* (additive, not override).

#### 3. User / personal instructions via VS Code settings

The settings-based instruction keys are **deprecated for code generation and test generation as of VS Code 1.102** in favor of file-based instructions. The remaining (still-supported) keys are:

| Scenario | Setting key |
|---|---|
| Code review | `github.copilot.chat.reviewSelection.instructions` |
| Commit messages | `github.copilot.chat.commitMessageGeneration.instructions` |
| Pull request descriptions | `github.copilot.chat.pullRequestDescriptionGeneration.instructions` |

**Deprecated** (still recognized but flagged):

- `github.copilot.chat.codeGeneration.instructions`
- `github.copilot.chat.testGeneration.instructions`

Each accepts an array of `{text}` or `{file}` entries.

**Storage on Windows:** these settings live in the VS Code user `settings.json`, which on Windows is `%APPDATA%\Code\User\settings.json`. User-scope **instruction files** themselves go into `%APPDATA%\Code\User\prompts\` (per [`vscode#272199`](https://github.com/microsoft/vscode/issues/272199): *"`%APPDATA%\Code\User\prompts\` it is on Windows"*) and/or `%USERPROFILE%\.copilot\instructions\`. **Resolves Q-004** for instructions.

Settings Sync can sync user-scope instruction files across devices via the **"Prompts and Instructions"** sync category.

#### 4. AGENTS.md support — native?

**Yes — natively supported in both VS Code Copilot Chat and on GitHub.com.** The VS Code page lists `AGENTS.md` as an "always-on" instruction source:

> "VS Code automatically detects an `AGENTS.md` Markdown file in the root of your workspace and applies the instructions in this file to all chat requests within this workspace."

Toggled by the `chat.useAgentsMdFile` setting (default **on** in current builds). Nested per-folder `AGENTS.md` files are gated by the experimental `chat.useNestedAgentsMdFiles` setting.

The GitHub-side doc adds:

> "You can create one or more `AGENTS.md` files, stored anywhere within the repository. When Copilot is working, the nearest `AGENTS.md` file in the directory tree will take precedence."

VS Code also natively reads `CLAUDE.md` (root, `.claude/CLAUDE.md`, `~/.claude/CLAUDE.md`, `CLAUDE.local.md`) under `chat.useClaudeMdFile`, and `GEMINI.md` server-side per the GitHub doc.

⚠️ uncertain — older community thread [`#175649`](https://github.com/orgs/community/discussions/175649) (mid-2025) said AGENTS.md was "experimental and off by default". The current VS Code doc treats it as a first-class always-on source, suggesting the default flipped to **on** between mid-2025 and the 2026-04-26 doc snapshot. Exact release version is filed as Q-016.

#### 5. Comparison to Roo — precedence model side-by-side

**Copilot precedence (high → low) as documented:**

1. **Personal** instructions (user-level: `%APPDATA%\Code\User\prompts\` files, `~/.copilot/instructions/`, `~/.claude/rules/`, settings-based deprecated keys) — *highest*
2. **Repository** instructions (`.github/copilot-instructions.md` + matching `.github/instructions/*.instructions.md` + nearest `AGENTS.md` + `CLAUDE.md`)
3. **Organization** instructions (delivered via `github.copilot.chat.organizationInstructions.enabled`) — *lowest*

> "Higher-priority instructions take precedence when conflicts occur:
> 1. Personal instructions (user-level, highest priority)
> 2. Repository instructions (`.github/copilot-instructions.md` or `AGENTS.md`)
> 3. Organization instructions (lowest priority)"

Within a tier, no order is guaranteed; all matching files are concatenated into context.

**Roo precedence (high → low) per [`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts):**

1. Mode `customInstructions` field (highest, hard-coded into system prompt)
2. Project `.roo/rules-<mode>/` files
3. Project `.roo/rules/` files + nearest `AGENTS.md`
4. Global `~/.roo/rules-<mode>/` and `~/.roo/rules/`
5. Global `customInstructions` setting

**Mapping table:**

| Roo concept | Closest Copilot equivalent | Notes / loss |
|---|---|---|
| `.roomodes` / `custom_modes.yaml` (mode definitions) | `.github/agents/<mode>.agent.md` (workspace) + `%APPDATA%\Code\User\prompts\<mode>.agent.md` (user) | Frontmatter is similar shape; `groups`/`fileRegex` does not survive (see (a) above). |
| Mode `roleDefinition` | `.agent.md` body (Markdown) | 1:1. |
| Mode `whenToUse` | `description` frontmatter field (loose) | Copilot has no formal "when to auto-pick this mode" field; description hints only. |
| Mode `customInstructions` | Body text **plus** linked `.instructions.md` files | Copilot has no per-mode `customInstructions` slot; you compose via Markdown links. |
| Mode `groups` (tool-group allowlist) | `.agent.md` `tools:` array | Copilot is **finer-grained** (per individual tool, not group). |
| Mode `allowedMcpServers` | `.agent.md` `tools:` entries with `serverName/*` wildcard | **Direct equivalent.** Resolves Q-002. |
| Mode `fileRegex` per group | *(none)* | **No equivalent**; lossy. Must be enforced via prose instructions. |
| Project `.roo/rules/*.md` | `.github/copilot-instructions.md` (single) **or** `.github/instructions/*.instructions.md` with `applyTo: "**"` | Multi-file Roo rules collapse cleanly into the `.instructions.md` directory. |
| Project `.roo/rules-<mode>/*.md` | `.agent.md` body + linked `.instructions.md` files referenced from that one agent | **No first-class per-mode rules folder.** The "scope by agent" concept doesn't exist in instructions; you have to either inline into the agent body or use a naming convention. ⚠️ Filed as Q-018. |
| Global `~/.roo/rules/*.md` | `%APPDATA%\Code\User\prompts\*.instructions.md` and/or `~/.copilot/instructions/*.instructions.md` | Direct equivalent. |
| `AGENTS.md` (project root) | `AGENTS.md` (project root) — **natively read** | 1:1. |

#### Roo open questions resolved by this section

- **Q-002** (per-mode MCP allowlists in Copilot Chat) — **YES**, via `tools: ['mcpserver/*']` in `.agent.md` frontmatter.
- **Q-003** (sub-agent / orchestrator parity) — **YES (partial)**, via the `agent` tool plus the `agents:` frontmatter allowlist; subagents are documented and supported, with handoffs as the analogue to boomerang return.
- **Q-004** (custom chatmodes on disk on Windows) — **RESOLVED**: workspace = `.github/agents/`, user = `%APPDATA%\Code\User\prompts\` and/or `%USERPROFILE%\.copilot\agents\`.
- **Q-005** (auto-conversion of `.roomodes` schema) — **partially resolved**: a mechanical converter is feasible for `slug → filename`, `name → name`, `roleDefinition → body`, `customInstructions → body`, `allowedMcpServers → tools[]`. Lossy fields: `fileRegex` (no equivalent), `whenToUse` (description only), `groups` (must expand to individual tool list). Full converter spec belongs in Phase 8.

## Prompt Files (`.prompt.md`)

### Sources

- [`prompt-files`](https://code.visualstudio.com/docs/copilot/customization/prompt-files) — VS Code "Use prompt files in VS Code". Accessed 2026-04-26.
- [`docs.github.com — Prompt files`](https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files) — GitHub-side prompt-files index (preview status, IDE availability). Accessed 2026-04-26.
- [`custom-chat-modes#tool-list-priority`](https://code.visualstudio.com/docs/copilot/customization/custom-chat-modes#_tool-list-priority) — precedence between prompt-file `tools` and referenced agent's `tools`. Accessed 2026-04-26.
- [`vscode-copilot-release/issues/12853`](https://github.com/microsoft/vscode-copilot-release/issues/12853) — confirms `%APPDATA%\Code\User\prompts\` is shared by `.instructions.md`, `.prompt.md`, and tool sets on Windows. Accessed 2026-04-26.

### Findings (2026-04-26)

#### 1. File format & frontmatter schema

Prompt files are Markdown documents with the **`.prompt.md`** extension and an optional YAML frontmatter header. Per the VS Code doc:

> "Fill in the YAML frontmatter at the top of the file to configure the prompt's description, agent, tools, and other settings."

Schema (all fields optional):

| Field | Description |
|---|---|
| `description` | Short description of the prompt. |
| `name` | Slash-command name shown after typing `/` in chat. Defaults to the filename. |
| `argument-hint` | Hint text shown in the chat input field to guide users. |
| `agent` | Built-in agent (`ask`, `agent`, `plan`) **or** the name of a custom agent. Defaults to the currently selected agent. If `tools` is specified, the default becomes `agent`. |
| `model` | Language model to use; defaults to the currently-selected model. |
| `tools` | Array of tool / tool-set / MCP-tool names available while the prompt runs (same shape as `tools` in `.agent.md`). |

> ⚠️ **Naming-rename status:** Unlike chat modes (`.chatmode.md` → `.agent.md`), prompt files have **not** been renamed — the extension is still `.prompt.md` and the frontmatter field for selecting the agent is `agent` (not `mode`). Older blog posts that show `mode: ask|edit|agent` describe a deprecated alias; current docs use `agent`.

#### 2. Workspace location

> "| Scope | Default file location |
> | Workspace | `.github/prompts` folder |
> | User profile | Your user data (specific to your VS Code profile) |"

Additional workspace folders are configurable via the `chat.promptFilesLocations` setting. There is **no `.claude/prompts/`** auto-discovery analogue — Claude format is supported only for agents and rules, not prompts.

#### 3. User-profile location on Windows

The VS Code page says only "your user data (specific to your VS Code profile)". GitHub issue [`vscode-copilot-release#12853`](https://github.com/microsoft/vscode-copilot-release/issues/12853) is explicit:

> "It's `AppData\Roaming\Code - Insiders\User\prompts` is the default for Windows and used for both prompts and instructions."

For VS Code Stable the equivalent is **`%APPDATA%\Code\User\prompts\`** (the same folder already documented in [`microsoft/vscode#272199`](https://github.com/microsoft/vscode/issues/272199) for `.instructions.md`). **Confirmed: `.prompt.md`, `.instructions.md`, `.agent.md` (per Q-015), and `*.toolsets.jsonc` (see Tool Sets §3 below) all share `%APPDATA%\Code\User\prompts\` on Windows.** **Resolves Q-004** for prompt files.

#### 4. Invocation

> "You have multiple options to run a prompt file:
> - In the Chat view, type `/` followed by the prompt name in the chat input field. Agent skills also appear as slash commands alongside prompt files.
> - Run the **Chat: Run Prompt** command from the Command Palette (⇧⌘P) and select a prompt file from the Quick Pick.
> - Open the prompt file in the editor, and press the play button in the editor title area."

The slash command is the prompt's `name` (or filename). There is **no documented keybinding** for a specific prompt; binding would have to go through `Chat: Run Prompt` plus a `keybindings.json` `args` entry. ⚠️ uncertain whether `keybindings.json` accepts a prompt-name argument. Filed as **Q-019**.

#### 5. Parameterization

Two officially-documented mechanisms:

1. **Free-form arguments after the slash command:**
   > "You can add extra information in the chat input field. For example, `/create-react-form formName=MyForm` or `/create-api for listing customers`."

   These extra tokens are appended to the prompt body as part of the user message — they are **not** typed parameters; the prompt body is responsible for parsing them in prose.

2. **Tool references inside the body** via `#tool:<name>`:
   > "To reference agent tools in the body text, use the `#tool:` syntax. For example, to reference the `browser` tool, use `#tool:browser`."

3. **References to other workspace files (including other prompt files)** via Markdown links:
   > "You can reference other workspace files by using Markdown links… You can even reference other prompt files for shared instructions." ([Microsoft Learn — *Customize chat responses and set context*](https://learn.microsoft.com/visualstudio/ide/copilot-chat-context?view=visualstudio#use-prompt-files))

   This is the closest thing to **prompt chaining**: a prompt can pull in another prompt's body by linking to it. There is **no documented `${input:name}` / `${selection}` / `${file}` / `${workspaceFolder}` substitution syntax** in the VS Code prompt-files page (those are `tasks.json` / `launch.json` variables per the [Variables reference](https://code.visualstudio.com/docs/reference/variables-reference)). ⚠️ uncertain — community blog posts occasionally show `${input:name}` working, but the current VS Code prompt-files doc does not document it. Filed as **Q-020**.

#### 6. Interaction with custom agents

A prompt **can specify which agent it runs under** via the `agent` frontmatter field (built-in `ask`/`agent`/`plan`, or the name of a `.agent.md` custom agent). When both the prompt and the referenced agent declare `tools`, the VS Code custom-agents doc states the precedence is:

> "Tools specified in the prompt file (if any). Tools from the referenced custom agent in the prompt file (if any)."

That is, **prompt-file `tools` win over the agent's `tools`**, which is the opposite of what one might assume. This matters when designing a "scoped" prompt that should run under a tightly-restricted agent — declaring `tools:` on the prompt **widens** the allowlist beyond what the agent permits.

Conversely, **agents can embed prompts** only indirectly: an agent body can Markdown-link to a prompt file, but there is no `prompts:` frontmatter array on agents. Sub-prompt invocation must go through the user-visible slash command or via the `agent` tool dispatching to another agent that runs a prompt.

> "Agents, prompt files, or skills? Use custom agents when you need a persistent persona with specific tool restrictions, model preferences, or handoffs between roles. For one-off tasks that don't need tool restrictions, use prompt files."

#### 7. Comparison to Roo

| Roo concept | Closest Copilot prompt-file equivalent | Verdict |
|---|---|---|
| Mode selection (`/architect`, `/code` slash) | `.prompt.md` slash command (`/<promptname>`) — but binds to a prompt, not a persistent persona | **Different abstraction.** Roo modes persist for the conversation; Copilot prompts execute one turn. The persistent analogue is `.agent.md` (Phase 4a). |
| Roo `customInstructions` per mode | Prompt body (Markdown) | 1:1 for one-shot tasks; for persistent persona use `.agent.md`. |
| Orchestrator dispatching `new_task` with a templated message | A prompt file invoked via `/promptname args…`, **or** the same prompt invoked from inside an agent that uses the `agent` tool | **Partial.** No first-class "templated subtask" object; closest is "prompt body + free-form args + Markdown-linked sub-prompts". |
| Template variables (Roo doesn't really have these either; mentions are via `@` references) | Prompt body uses Markdown links to files and `#tool:` for tools; no documented `${input:name}` substitution | ⚠️ Q-020. |
| Reusable mode + reusable rule file separately | Prompt-file `agent:` frontmatter + body Markdown-link to instruction files | Cleaner separation of concerns than Roo. |

**Headline:** prompt files are **largely additive** capability over Roo — Roo has no first-class equivalent. They occupy the niche of "named, reusable, parameterizable one-shot user message" that Roo only approximates by either (a) typing a long message into the chat or (b) pre-seeding a subtask via the Orchestrator.

#### 8. Limits / known gaps

- **Public preview status.** The GitHub doc explicitly notes: *"Copilot prompt files are in public preview and subject to change. Prompt files are only available in VS Code, Visual Studio, and JetBrains IDEs."* — meaning prompt files are **not** picked up by Copilot CLI or by the GitHub.com cloud agent. Affects Phase 5 (CLI) directly.
- **No typed argument schema.** Args are free-text appended to the body; the prompt has to parse them. ⚠️ Q-020 (variable substitution).
- **No documented prompt-file size cap.** Prompts share the single chat-request token budget with instructions and the user message; large prompts compete with instruction-file context.

## MCP Support

### Sources

- [`docs/copilot/customization/mcp-servers`](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) — VS Code "Add and manage MCP servers in VS Code". Accessed 2026-04-26.
- [`docs/copilot/reference/mcp-configuration`](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration) — VS Code "MCP configuration reference" (canonical schema). Accessed 2026-04-26.
- [`api/extension-guides/ai/mcp`](https://code.visualstudio.com/api/extension-guides/ai/mcp) — VS Code "MCP developer guide". Accessed 2026-04-26.
- [`docs.github.com — Extending Copilot Chat with MCP`](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-chat-with-mcp). Accessed 2026-04-26.
- [`docs/copilot/agents/agent-tools`](https://code.visualstudio.com/docs/copilot/agents/agent-tools) — auto-approve / confirmation settings. Accessed 2026-04-26.
- [`docs/configure/profiles`](https://code.visualstudio.com/docs/configure/profiles) — profile-scoped user data. Accessed 2026-04-26.
- [`docs/configure/settings-sync`](https://code.visualstudio.com/docs/configure/settings-sync) — MCP Servers sync category. Accessed 2026-04-26.
- [`microsoft/vscode#253039`](https://github.com/microsoft/vscode/issues/253039) — auto-approve UX warning. Accessed 2026-04-26.
- [`modelcontextprotocol/servers#3460`](https://github.com/modelcontextprotocol/servers/issues/3460) — Windows `npx`/`.cmd` shim quirk. Accessed 2026-04-26.

### Findings (2026-04-26)

#### 1. Workspace MCP config — `.vscode/mcp.json` schema

Workspace-scope MCP config lives at **`.vscode/mcp.json`** at the project root and is intended to be **committed to source control**:

> "Workspace: create or open `.vscode/mcp.json` in your project. Include this file in source control to share MCP server configurations with your team."

**Top-level keys** (per the [MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)):

| Key | Required | Purpose |
|---|---|---|
| `servers` | yes | Object mapping server name → server config object. |
| `inputs` | no | Array of input-variable definitions (typed prompts) used to inject secrets at first-run. |

> "The configuration file has two main sections: `servers: {}`… and `inputs: []`: an optional array of input variable definitions for sensitive information like API keys."

There is **no `dev` top-level key**; the `dev` block is **per-server** (see §6).

**Per-server fields — stdio:**

| Field | Required | Description |
|---|---|---|
| `type` | yes | `"stdio"` (also valid: `"http"`, `"sse"`). May be omitted for stdio when `command` is present. |
| `command` | yes | Executable on `PATH` or full path (`npx`, `node`, `python`, `docker`, …). |
| `args` | no | Array of CLI args. |
| `env` | no | Map of env vars; supports `${input:id}` and predefined variables. |
| `envFile` | no | Path to a `.env` file to load additional vars (`"${workspaceFolder}/.env"`). |
| `sandboxEnabled` | no | `true` to sandbox the server. ⚠️ **macOS / Linux only — *not* available on Windows.** |
| `sandbox` | no | `{ filesystem: { allowWrite, denyRead, denyWrite }, network: { allowedDomains, deniedDomains } }`. |

**Per-server fields — HTTP / SSE:**

| Field | Required | Description |
|---|---|---|
| `type` | yes | `"http"` (preferred Streamable HTTP) or `"sse"` (legacy). VS Code "first tries the HTTP Stream transport and falls back to SSE if HTTP is not supported." |
| `url` | yes | Server URL. Also supports `unix:///…` and Windows `pipe:///pipe/…` socket forms. |
| `headers` | no | Map of HTTP headers, typically `{"Authorization": "Bearer ${input:api-token}"}`. |

**Transports supported** (from the [MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp)):

> "Transports: Local standard input/output (`stdio`), Streamable HTTP (`http`), Server-sent events (`sse`) - legacy support."

**Note:** the GitHub doc shows a `requestInit.headers` form, while VS Code's reference uses the flatter `headers`. ⚠️ Filed as **Q-025**. There is **no top-level `gallery` key** in `mcp.json`; the gallery is a UX surface (Extensions view → `@mcp` filter, plus `MCP: Browse MCP Servers`).

**Minimal example:**

```jsonc
{
  "servers": {
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp" },
    "playwright": { "command": "npx", "args": ["-y", "@microsoft/mcp-server-playwright"] }
  }
}
```

#### 2. User-level MCP config on Windows — exact path

**Profile-aware.** The doc says:

> "User profile: run the **MCP: Open User Configuration** command to open the `mcp.json` file in your user profile folder. Servers configured here are available across all your workspaces. **When you use multiple profiles, each profile can have its own MCP server configuration.**"

For the **Default profile** on Windows that resolves to:

- **`%APPDATA%\Code\User\mcp.json`** — i.e. `C:\Users\<you>\AppData\Roaming\Code\User\mcp.json`.

For **named (non-default) profiles**, VS Code stores per-profile data under:

- **`%APPDATA%\Code\User\profiles\<profile-id>\mcp.json`** — where `<profile-id>` is a generated short ID (not the human-readable name).

> ⚠️ uncertain — the [Profiles](https://code.visualstudio.com/docs/configure/profiles) doc does not explicitly enumerate the per-profile `mcp.json` path; the location is inferred from the same convention used for `settings.json` per profile. The authoritative way to locate it is to invoke **MCP: Open User Configuration** in the desired profile. Filed as part of **Q-015** (resolved partially below).

The **Insiders** equivalents replace `Code` with `Code - Insiders`.

#### 3. Auth flow — secrets, OAuth, and `${input:…}` prompts

**Three official patterns:**

1. **Input variables (`${input:id}`)** — the recommended pattern for API-key-style secrets:

    > "Input variables let you define placeholders for configuration values, avoiding the need to hardcode sensitive information like API keys or passwords directly in the server configuration. When you reference an input variable using `${input:variable-id}`, **VS Code prompts you for the value when the server starts for the first time. The value is then securely stored for subsequent use.**"

    Definition lives in the top-level `inputs: []` array; reference lives in `env` or `headers`. Properties: `type` (`"promptString"`), `id`, `description`, `password` (boolean — masks input).

    Storage: VS Code persists the supplied value in the **OS secret store** (Windows Credential Manager via `vscode.SecretStorage`). To force re-prompting, run **MCP: Reset Trust** or delete the saved input via the Chat Customizations editor. ⚠️ uncertain — exact secret-storage namespace key on Windows is undocumented. Filed as part of **Q-025**.

2. **`envFile`** — load a local `.env` file (kept out of source control): `"envFile": "${workspaceFolder}/.env"`.

3. **OAuth / dynamic auth for HTTP servers** — the GitHub MCP server (`https://api.githubcopilot.com/mcp`) and other Copilot-aware HTTP servers use the **VS Code authentication providers** (OAuth flow shown in the trust prompt) rather than a manual `Authorization` header. For third-party HTTP servers without OAuth, use `headers: { "Authorization": "Bearer ${input:my-token}" }`.

**Should `.vscode/mcp.json` be committed?** **Yes**, but only with `${input:…}` placeholders for any secret. The doc is explicit:

> "**Important**: Avoid hardcoding sensitive information like API keys. Use input variables or environment files instead."

This is the Copilot-native equivalent of Roo's split between "global `mcp_settings.json` (gitignored, has live tokens)" and "project `.roo/mcp.json` (committed, no tokens)" — Copilot collapses both into one committable file by virtue of `${input:…}`. See §8 for the migration recommendation.

#### 4. Per-agent / per-toolset MCP filtering

**There is no separate "allowedMcpServers" setting** in Copilot Chat outside the agent's `tools:` allowlist. Restriction is performed entirely at agent-load time via the [`.agent.md` `tools:` array](#custom-chat-modes-chatmodemd) (Phase 4a §1) and the [`*.toolsets.jsonc` `tools` array](#tool-sets) (Phase 4b §2):

- An entry of `github/*` in `tools:` admits **all** tools from the `github` MCP server.
- An entry of `github/get_issue` admits **just that one** tool.
- Omitting all `<server>/…` entries from `tools:` blocks the agent from using that MCP server entirely.

> "A list of tool or tool set names that are available for this custom agent. Can include built-in tools, tool sets, MCP tools, or tools contributed by extensions. **To include all tools of an MCP server, use the `/*` format.**" — *quoted from the custom-agents doc, restated from Phase 4a §1*

The chat input also exposes a **Configure Tools** picker that lets the user transiently disable individual MCP tools per session, but this is a UX layer on top of the same allowlist and doesn't survive across chat sessions.

**Verdict:** Roo's per-mode `allowedMcpServers: ["github"]` ↔ Copilot's `.agent.md` `tools: ["github/*"]` is a **direct 1:1 mapping** with stronger granularity (per-tool, not just per-server).

#### 5. Trust prompts and confirmation UX

**First-run server trust:**

> "When you add an MCP server to your workspace or change its configuration, you need to confirm that you trust the server and its capabilities before starting it. VS Code shows a dialog to confirm that you trust the server when you start a server for the first time."

Trust decisions persist; reset via **MCP: Reset Trust**. **Important caveat:**

> "**Warning**: If you start the MCP server directly from the `mcp.json` file, you will not be prompted to trust the server configuration."

— meaning the inline "Start" code-lens in the editor bypasses the trust dialog (because opening the file is itself an explicit user action).

**Per-tool confirmation policies** — the `chat.tools.*` settings family controls when the model can invoke a tool without asking (per [`docs/copilot/agents/agent-tools`](https://code.visualstudio.com/docs/copilot/agents/agent-tools)):

| Setting | Description |
|---|---|
| `chat.tools.global.autoApprove` | Master "yolo" toggle — **strongly discouraged**, see [`microsoft/vscode#253039`](https://github.com/microsoft/vscode/issues/253039). |
| `chat.tools.eligibleForAutoApproval` | Per-tool allowlist for auto-approval. *(Org-managed.)* |
| `chat.tools.terminal.autoApprove` | Map of regex → allow/deny for `runInTerminal` commands. |
| `chat.tools.terminal.enableAutoApprove` | Master toggle for terminal auto-approve. |
| `chat.tools.urls.autoApprove` | Auto-approved URL patterns for fetch / browser tools. |
| `chat.agent.networkFilter` | Restricts which domains agent tools can reach. *(Org-managed.)* |

For MCP server tools specifically, each tool invocation surfaces a confirmation dialog with options including **Allow once** / **Allow for this session** / **Allow for this workspace** / **Always allow**. The "always allow" choice is per-(workspace,tool) and persisted in workspace state. **Sandboxed servers (macOS/Linux only) auto-approve their own tool calls** because the sandbox already constrains them.

#### 6. Discovery / installation flow

**Installation surfaces** (per the [MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp)):

> "Users can add MCP servers within VS Code in several ways:
> - Install directly from the web: use a special MCP installation URL (`vscode:mcp/install`) on your website.
> - Workspace configuration: Specify the server configuration in a `.vscode/mcp.json` file in the workspace.
> - Global configuration: Define servers globally in the user profile.
> - Autodiscovery: VS Code can discover servers from other tools like Claude Desktop.
> - Extension: VS Code extensions can register MCP servers programmatically.
> - Command line: Install MCP servers from the command line with the `--add-mcp` VS Code command-line option."

**MCP gallery:** browse via Extensions view (`@mcp` filter) or **MCP: Browse MCP Servers**. Installation writes to either user `mcp.json` or `.vscode/mcp.json` depending on the user's choice.

**Server types supported:**

- **NPX / Node** — `command: "npx", args: ["-y", "@scope/pkg"]`
- **Python / uv** — `command: "uvx", args: ["mcp-server-fetch"]`
- **Docker** — `command: "docker", args: ["run", "-i", "--rm", …]` (**must not** use `-d`; the doc warns "When using Docker with stdio servers, don't use the detach option (`-d`). The server must run in the foreground to communicate with VS Code.")
- **HTTP / SSE remote** — `type: "http"` or `type: "sse"`

**Hot-reload `dev` block** (per-server):

> "You can enable *development mode* for MCP servers by adding a `dev` key to the server configuration. This is an object with two properties: `watch` (file glob to watch) and `debug` (Node.js / Python debugging support)."

Useful only for MCP-server *authors*; not relevant to vault migration.

#### 7. Auto-import from Claude Desktop / Cursor / Continue

> "VS Code can automatically detect and reuse MCP server configurations from other applications, such as Claude Desktop. With the `chat.mcp.discovery.enabled` setting, you can select one or more tools from which to discover their MCP server configuration."

The setting is **disabled by default in current VS Code Stable** — the user must opt in and explicitly choose which source(s) to import. Reddit thread [r/ChatGPTCoding — "Try out MCP servers in VS Code"](https://www.reddit.com/r/ChatGPTCoding/comments/1jfr05y/try_out_mcp_servers_in_vs_code/) confirms:

> "Add the setting `chat.mcp.discovery.enabled: true` to pick up MCP servers installed in Claude desktop, or create a `.vscode/mcp.json` config"

⚠️ uncertain — official supported source list (Claude Desktop is confirmed; Cursor and Continue are inferred from community reports). Filed as part of **Q-025**.

#### 8. Roo → Copilot MCP comparison (side-by-side)

| Roo location / concept | Copilot equivalent | Notes |
|---|---|---|
| Global `~/AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `%APPDATA%\Code\User\mcp.json` (Default profile) or `%APPDATA%\Code\User\profiles\<id>\mcp.json` (named profiles) | Same shape (`mcpServers` → `servers`). Mechanical rename. |
| Project `.roo/mcp.json` | `.vscode/mcp.json` | Same intent (commit to repo). Same `mcpServers` → `servers` rename. |
| Per-mode `allowedMcpServers: ["github"]` (in `.roomodes` / `custom_modes.yaml`) | Per-agent `tools: ["github/*"]` (in `.github/agents/<mode>.agent.md`) | **Direct equivalent**, established in Phase 4a §5. Copilot is finer-grained. |
| Per-mode `allowedMcpServers: []` (empty array) | Per-agent `tools: [...]` with **no** `<server>/…` entries | **Roo `[]` means "no MCP servers"** (truthy filter; see [`src/core/prompts/tools/native-tools/mcp_server.ts:22`](../../../src/core/prompts/tools/native-tools/mcp_server.ts:22)). Same in Copilot. **Resolves Q-009.** |
| Inline tokens in `mcp_settings.json` (vault-gitignored) | `${input:githubToken}` placeholder + first-run prompt + OS secret store | Recommended pattern for **commit safety**. The Copilot config can be safely committed because the placeholder resolves at runtime against Windows Credential Manager storage. |
| Global `mcp_settings.json` is **gitignored**; project `.roo/mcp.json` is **committed** | Single `mcp.json` (workspace) **plus** user `mcp.json` — both committable when secrets use `${input:…}` | The two-file split is no longer required for secret hygiene. |
| Per-server `disabled: true` flag in Roo | Enable/disable toggle in Extensions view (state stored separately from `mcp.json`) | Per the doc: "**The enable/disable state is stored separately from the server configuration in `mcp.json`, so it does not affect shared configuration files.**" |

**Recommended Copilot-side equivalent of vault inline tokens:**

```jsonc
{
  "inputs": [
    { "type": "promptString", "id": "githubToken", "description": "GitHub PAT for github MCP", "password": true },
    { "type": "promptString", "id": "tavilyKey",  "description": "Tavily API key",            "password": true },
    { "type": "promptString", "id": "context7Key","description": "Context7 API key",          "password": true }
  ],
  "servers": {
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${input:githubToken}" }
    },
    "tavily": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "TAVILY_API_KEY", "mcp/tavily"],
      "env": { "TAVILY_API_KEY": "${input:tavilyKey}" }
    },
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "CONTEXT7_API_KEY": "${input:context7Key}" }
    },
    "microsoft-learn": {
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp"
    }
  }
}
```

Drop this in `%APPDATA%\Code\User\mcp.json` (or `.vscode/mcp.json` for project-scoped). Each `${input:…}` triggers a one-time first-run secret prompt; values land in Windows Credential Manager and persist across sessions — eliminating the vault's need to gitignore the user-scope file.

#### 9. Known limitations

- **No documented hard cap on number of MCP servers**, but each enabled tool counts toward the **128-tool-per-request hard cap** (Phase 4b §7). With the vault's 4 enabled servers (`github` ~30 tools, `context7` 2 tools, `tavily` 5 tools, `microsoft-learn` 3 tools) the cap is comfortable; adding `filesystem` or `brave-search` plus all built-in tools could push it over.
- **No `denyList` for individual MCP tools** — access is allow-list only via `tools:`. To exclude one tool from a server with many tools, you must enumerate every other tool individually.
- **Sandboxing is unavailable on Windows** — per the doc: "**Sandboxing is currently not available on Windows.**" The `sandboxEnabled` / `sandbox` fields are silently ignored. Affects vault security posture: stdio MCP servers run with full user privileges on Windows.
- **`npx`-based stdio servers can fail silently on Windows when the shim isn't visible to `child_process.spawn`** — per [`modelcontextprotocol/servers#3460`](https://github.com/modelcontextprotocol/servers/issues/3460): "*This silently fails on Windows because npx is installed as `npx.cmd` (a batch script shim), and `child_process.spawn()` … does not resolve `.cmd` extensions automatically.*" VS Code Copilot generally invokes commands through a shell on Windows so plain `command: "npx"` works, but `nvm-windows`-managed Node versions can hide `npx` from VS Code's launched-from-shortcut env. Workaround: use the absolute path to `npx.cmd` (e.g. `C:\Program Files\nodejs\npx.cmd`) or wrap with `cmd /c npx …`.
- **Environment variable expansion** — `mcp.json` honors `${workspaceFolder}`, `${userHome}`, and `${env:VARNAME}` (per [VS Code variables reference](https://code.visualstudio.com/docs/reference/variables-reference)) but **not** Windows-style `%APPDATA%` literal expansion. Always use `${env:APPDATA}` or `${userHome}`.
- **Path separators** — backslashes in JSON must be escaped (`\\`); forward slashes also work on Windows for most APIs.
- **Docker stdio servers must not use `-d` (detach)** — see §6.
- **GitHub MCP HTTP server requires the org-level "MCP servers in Copilot" policy** for Copilot Business / Enterprise plans (per the GitHub doc). Personal accounts work without policy gating.

#### Roo open questions resolved by this section

- **Q-009** (semantics of `allowedMcpServers: []` vs unset) — **RESOLVED**: empty array means "no MCP servers" because the filter at [`src/core/prompts/tools/native-tools/mcp_server.ts:22`](../../../src/core/prompts/tools/native-tools/mcp_server.ts:22) treats an empty array as truthy and intersects to nothing. Vault's `code` mode therefore explicitly disables MCP. Copilot equivalent: omit all `<server>/…` entries from `tools:`.
- **Q-015** (profile-scoped user-data folders) — **PARTIALLY RESOLVED for MCP**: per the explicit doc quote ("When you use multiple profiles, each profile can have its own MCP server configuration"), `mcp.json` **is** profile-scoped at `%APPDATA%\Code\User\profiles\<profile-id>\mcp.json`. The contradiction noted in Phase 4a §3 (where agents/instructions/prompts are NOT profile-scoped per [`microsoft/vscode#305642`](https://github.com/microsoft/vscode/issues/305642)) therefore appears to be **specific to the `prompts/` folder**, not to all user-data folders. The cleanest Phase-8 strategy: rely on profile-scoping for `mcp.json` and `settings.json`; rely on the global `prompts/` folder for `.agent.md` / `.prompt.md` / `.instructions.md` / `*.toolsets.jsonc`.

## Tool Sets

## Tool Sets

### Sources

- [`agent-tools — Group tools with tool sets`](https://code.visualstudio.com/docs/copilot/agents/agent-tools) — VS Code "Use tools with agents" doc, the canonical tool-sets reference. Accessed 2026-04-26.
- [`concepts/tools`](https://code.visualstudio.com/docs/copilot/concepts/tools) — VS Code "Tools" concept page. Accessed 2026-04-26.
- [`microsoft/vscode#251603`](https://github.com/microsoft/vscode/issues/251603) — open issue confirming `*.toolsets.jsonc` is stored "in the same directory as prompts and instructions files" (i.e. `%APPDATA%\Code\User\prompts\` on Windows). Accessed 2026-04-26.
- [`microsoft/vscode#251515`](https://github.com/microsoft/vscode/issues/251515) — open feature request: workspace-scoped `*.toolsets.jsonc` is **not yet supported** as of 2026-04-26. Accessed 2026-04-26.
- [`orgs/community#167721`](https://github.com/orgs/community/discussions/167721) — community thread showing a concrete tool-set file path on Linux: `~/.config/Code/User/prompts/<name>.toolsets.jsonc`. Accessed 2026-04-26.
- [`vscode-copilot-release#13065`](https://github.com/microsoft/vscode-copilot-release/issues/13065) — confirms the **128-tool-per-request hard cap** is still enforced. Accessed 2026-04-26.

### Findings (2026-04-26)

#### 1. What is a tool set?

Per the VS Code agent-tools doc:

> "A tool set is a collection of tools that you can reference as a single entity in your prompts. Tool sets help you organize related tools and make them easier to use in a chat prompt, prompt files, and custom chat agents. Some of the built-in tools are part of predefined tool sets, such as `#edit` and `#search`."

So a tool set is a **named bundle** of (a) built-in VS Code tools, (b) extension-contributed tools, and (c) MCP-server tools, addressable by a single `#<setname>` reference. Built-in sets (`#edit`, `#search`) ship with the product; user-defined sets live in `*.toolsets.jsonc` files.

#### 2. File format & location

**Filename pattern:** `*.toolsets.jsonc` (JSON-with-comments).

**Location on Windows (user-scope):** `%APPDATA%\Code\User\prompts\` — the same folder used by `.prompt.md`, `.instructions.md`, and (per Q-015) user-scope `.agent.md` files. Per [`microsoft/vscode#251603`](https://github.com/microsoft/vscode/issues/251603):

> "When using GitHub Copilot, the toolsets.jsonc file created is stored in the same directory as prompts and instructions files."

And per [`orgs/community#167721`](https://github.com/orgs/community/discussions/167721) (Linux example, equivalent path scheme):

> "The tool set can be found in `~/.config/Code/User/prompts/tiledb-mcp.toolsets.jsonc`."

**Workspace-scope storage is NOT supported as of 2026-04-26.** [`microsoft/vscode#251515`](https://github.com/microsoft/vscode/issues/251515) is open, milestone "Backlog":

> "I would like to request support for storing `.toolsets.jsonc` files directly within the workspace. This enhancement would enable projects to be fully workspace-configurable…"

This is a **significant gap vs Roo**, where per-project `.roomodes` (and the modes' `groups` / `allowedMcpServers`) ride along with the repo. Filed as **Q-021**. The work-around is to put the `tools:` array inline on each `.agent.md` (which **does** support workspace storage at `.github/agents/`).

**Schema** (canonical example from the VS Code doc):

```jsonc
{
  "reader": {
    "tools": ["search/changes", "search/codebase", "read/problems", "search/usages"],
    "description": "Tools for reading and gathering context",
    "icon": "book"
  }
}
```

| Property | Type | Required | Description |
|---|---|---|---|
| top-level key | string | yes | The tool-set's name (referenced as `#<name>`). |
| `tools` | string[] | yes | Tool names: built-in tools, extension tools, MCP tools (`servername/toolname` form). |
| `description` | string | no | Brief description shown in the tools picker. |
| `icon` | string | no | Product icon name (see [Product Icon Reference](https://code.visualstudio.com/api/references/icons-in-labels)). |

⚠️ uncertain — the doc does not explicitly say whether MCP wildcard `servername/*` is allowed inside a tool set's `tools` array (it is allowed in `.agent.md` `tools:` per Phase 4a). Filed as **Q-022**.

#### 3. How to create one

> "1. Run the **Chat: Configure Tool Sets** command from the Command Palette and select **Create new tool sets file**.
>     Alternatively, select the ellipsis (...) menu in the Chat view, select **Tool Sets**, and then select **Create new tool sets file**.
> 2. Define your tool set in the `.jsonc` file that opens."

VS Code creates the file directly in `%APPDATA%\Code\User\prompts\` (Windows) and opens it in the editor. Multiple tool sets can live in one file (top-level keys); the convention seen in the wild ([community#167721](https://github.com/orgs/community/discussions/167721)) is one file per logical bundle named after the bundle.

#### 4. How to reference a tool set from an agent or prompt

In **chat input** (one-off):

> "Reference a tool set in your prompts by typing `#` followed by the tool set name."

In a **`.agent.md` `tools:` frontmatter array** (persistent): per the Phase 4a-cited custom-agents doc, the `tools` field accepts:

> "A list of tool or tool set names that are available for this custom agent. Can include built-in tools, tool sets, MCP tools, or tools contributed by extensions. To include all tools of an MCP server, use the `/*` format."

So `tools: [reader, edit, github/*]` resolves `reader` as a tool-set name and `github/*` as an MCP-server wildcard. **Confirmed: tool-set names are first-class entries in the agent's `tools:` array** (no special prefix required — they are looked up by the same name resolution as built-in tools).

Same applies to a `.prompt.md`'s `tools:` array (same schema as agents).

#### 5. MCP wildcard interaction

- A `.agent.md` / `.prompt.md` `tools:` entry of `github/*` grants **all** tools from the `github` MCP server.
- A tool-set whose `tools` array contains `github/specific-tool` grants just that one tool.
- If both an agent's `tools:` entry `github/*` **and** a tool-set entry `github/specific-tool` are present, the union applies (the more permissive wins, since the wildcard already includes the specific tool).
- ⚠️ uncertain whether a tool set's `tools` array can itself contain a wildcard like `github/*` (Q-022).

There is **no documented "deny" or "exclude" mechanism**: access is exclusively allow-list-based. To exclude one MCP tool from a server, you must enumerate every other tool individually instead of using `*`.

#### 6. Comparison to Roo — closest analogue to `groups` + `allowedMcpServers`

This is the headline mapping for Phase 4b. Roo's per-mode access control combines two fields:

- `groups: ["read", "edit", "command", "mcp", "browser"]` — coarse-grained tool category allowlist (the entire `edit` group is one entry).
- `allowedMcpServers: ["github", "context7"]` — server-name allowlist that intersects with `groups: [..., "mcp"]`.

Plus an inline per-group restriction: `groups: [["edit", { fileRegex: "\\.md$", description: "..." }]]`.

The Copilot equivalents:

| Roo construct | Copilot equivalent | Notes |
|---|---|---|
| `groups: ["read"]` | `tools: ["#search", "search/codebase", "search/usages", "read/problems", ...]` **or** `tools: [my-reader-toolset]` | Roo's "read" group expands to ~5 individual tools; bundling them in a `reader.toolsets.jsonc` set is the clean equivalent. The doc's own example **is exactly this** ("Tools for reading and gathering context"). |
| `groups: ["edit"]` | `tools: ["#edit"]` (the built-in `#edit` tool set) | Built-in `#edit` set already exists; quote: *"Some of the built-in tools are part of predefined tool sets, such as `#edit` and `#search`."* |
| `groups: ["command"]` | `tools: ["runInTerminal"]` (and friends) | No predefined "terminal" tool set; user must enumerate or define one. |
| `groups: ["mcp"]` | `tools: ["servername/*", "otherserver/*"]` — one wildcard per allowed server | Direct equivalent. |
| `allowedMcpServers: ["github", "context7"]` | `tools: ["github/*", "context7/*"]` **or** a tool set bundling them | Direct equivalent. |
| `groups: [["edit", { fileRegex: "\\.md$" }]]` | **No equivalent.** | Restated from Phase 4a. The `.agent.md` schema has no `applyTo`-style file-glob restriction on the `edit` tool. Lossy; must be enforced via prose ("only modify files matching `**/*.md`") or by removing `#edit` entirely. |
| Per-project `groups` / `allowedMcpServers` (lives in `.roomodes` in the repo) | `.agent.md` `tools:` inline, in `.github/agents/<mode>.agent.md` | Workspace-scoped tool **sets** are NOT yet supported (Q-021); workaround is to inline tool lists into the workspace-scoped agent file. |
| Global `customModes` `allowedMcpServers` (lives in `~/.../custom_modes.yaml`) | `.agent.md` in `%APPDATA%\Code\User\prompts\` + tool sets in the same folder | User-scope works fully. |

**Verdict:** tool sets **plus** the agent `tools:` array **fully replicate** Roo's `groups` + `allowedMcpServers` semantics — *except* for (a) the per-tool file-glob restriction (`fileRegex`, no equivalent — restated from Phase 4a) and (b) workspace-scoped reusable tool **set** files (still user-scope only). For (b) the workaround is inline tool lists in `.github/agents/*.agent.md`.

#### 7. Limits

- **128-tool-per-request hard cap** — confirmed still in force. Per [`vscode-copilot-release#13065`](https://github.com/microsoft/vscode-copilot-release/issues/13065):
  > "Reason: You may not include more than 128 tools in your request."

  Multiple users in 2025-Q3 reported hitting this with default tool sets plus a few MCP servers. **Tool sets do not bypass this**: the cap is on the flattened total of distinct tools sent to the model, not on the number of set-references.
- **Token-cost of tool sets in context** — each enabled tool's schema is serialized into the system prompt; large tool sets noticeably consume context. This is the practical reason Copilot recommends scoping each agent to a small set.
- **No documented nesting** — a tool set's `tools` array contains tool names, not other tool-set names. ⚠️ uncertain whether `#othersetname` inside a set's `tools` array is dereferenced; the schema doc only shows tool names. Filed as **Q-023**.
- **Secrets handling** — tool sets only reference tools; they do not contain credentials. Secrets for MCP servers live in `.vscode/mcp.json` / user MCP config (covered in Phase 4c). No secret material should appear in `*.toolsets.jsonc`.
- **Sync limitation** — per [`microsoft/vscode#251603`](https://github.com/microsoft/vscode/issues/251603), `*.toolsets.jsonc` files in `%APPDATA%\Code\User\prompts\` are **not yet** included in Settings Sync's "Prompts and Instructions" category as of mid-2025; the issue remains open. Affects multi-machine vault setups. Filed as **Q-024**.

#### 8. Roo open questions resolved by this section

- **Q-002** (per-mode MCP allowlists) — already resolved in Phase 4a via `tools: ["servername/*"]`; this section confirms the **toolset-bundled** alternative.
- **Q-005** (auto-conversion of `.roomodes`) — moves another step toward closure. The `groups` field can be mechanically expanded: `read` → built-in `#search` set + a custom `reader.toolsets.jsonc`; `edit` → `#edit`; `mcp` + `allowedMcpServers: [a, b]` → `["a/*", "b/*"]`. The remaining lossy field is still `fileRegex`.

## Agent Mode

### Sources

- [`docs/copilot/chat/chat-agent-mode`](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode) — VS Code "Chat overview" (canonical Chat / agent-target / permission-level reference). Accessed 2026-04-26.
- [`docs/copilot/agents/overview`](https://code.visualstudio.com/docs/copilot/agents/overview) — VS Code "Using agents in Visual Studio Code" (built-in agents, agent types, hand-offs). Accessed 2026-04-26.
- [`docs/copilot/agents/agent-tools`](https://code.visualstudio.com/docs/copilot/agents/agent-tools) — VS Code "Use tools with agents" (permission levels, terminal auto-approve, sandboxing, 128-tool cap). Accessed 2026-04-26.
- [`docs/copilot/agents/subagents`](https://code.visualstudio.com/docs/copilot/agents/subagents) — VS Code "Subagents in Visual Studio Code" (canonical sub-agent / parallel-execution / nesting reference). Accessed 2026-04-26.
- [`docs/copilot/customization/custom-agents`](https://code.visualstudio.com/docs/copilot/customization/custom-agents) — VS Code "Custom agents in VS Code" (the `agents:` / `handoffs:` / `user-invocable` / `disable-model-invocation` frontmatter reference). Accessed 2026-04-26.
- [`docs/copilot/chat/chat-checkpoints`](https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints) — VS Code "Revert changes with checkpoints and editing requests". Accessed 2026-04-26.
- [`docs/copilot/reference/copilot-settings`](https://code.visualstudio.com/docs/copilot/reference/copilot-settings) — `chat.agent.maxRequests`, `chat.agent.enabled`, `chat.agent.networkFilter`, etc. Accessed 2026-04-26.
- [`blogs/2026/02/05/multi-agent-development`](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development) — VS Code blog announcing parallel-subagent execution. Accessed 2026-04-26.
- [`blogs/2025/02/24/introducing-copilot-agent-mode`](https://code.visualstudio.com/blogs/2025/02/24/introducing-copilot-agent-mode) — original Feb-2025 agent-mode launch post. Accessed 2026-04-26.
- [`naonao-na.com — vscode-copilot-setting-agent-max-requests`](https://naonao-na.com/en/posts/vscode-copilot-setting-agent-max-requests/) — independent confirmation of `chat.agent.maxRequests` default = 25 and the "maximum requests reached / Continue" UX. Accessed 2026-04-26.
- [`docs.github.com — create custom agents`](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents) — GitHub Copilot cloud-coding-agent custom agents (same `.agent.md` schema, `target: github-copilot`). Accessed 2026-04-26.

### Findings (2026-04-26)

#### 1. What Agent mode is — vs Ask vs Plan vs Edit

VS Code's chat dropdown surfaces **three built-in agents** plus any custom `.agent.md` agents:

> "VS Code has three built-in agents:
> - **Agent**: autonomously plans and implements changes across files, runs terminal commands, and invokes tools.
> - **Plan**: creates a structured, step-by-step implementation plan before writing any code. Hands the plan off to an implementation agent when it looks right.
> - **Ask**: answers questions about coding concepts, your codebase, or VS Code itself without making file changes."

The original Feb-2025 launch post characterizes Agent mode's loop as:

> "Copilot agent mode operates in a more autonomous and dynamic manner to achieve the desired outcome. To process a request, Copilot loops over the following steps and iterates multiple times as needed… It can orchestrate your inner development flow while keeping you in control."

Note that **Edit mode (the multi-file non-agentic editor) has been folded into Agent mode** in the current docs — the dropdown now shows Agent / Plan / Ask, not Agent / Edit / Ask. The "Working set" terminology has been replaced by Agent mode's autonomous file selection plus implicit-context attachments documented in the Chat-context page.

#### 2. How to enable — settings

| Setting | Default | Purpose |
|---|---|---|
| `chat.agent.enabled` | `true` | Master switch. **Org-managed**: an enterprise admin can disable it. |
| `chat.agent.maxRequests` | `25` | Cap on the number of model requests Agent mode can chain in one user turn before showing a "Continue" button. ([Settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings)) |
| `github.copilot.chat.agent.autoFix` | `true` | Auto-diagnose & fix lint/compile errors during the agent loop. |
| `chat.permissions.default` | (Default Approvals) | Persist a default permission level (`Default Approvals` / `Bypass Approvals` / `Autopilot`) across sessions. |
| `chat.autopilot.enabled` | `true` | Enables the Autopilot permission level in the picker. |
| `chat.checkpoints.enabled` | (varies) | Auto-snapshot files before each chat request so you can roll back. |
| `chat.editRequests` | (varies) | Allow editing prior chat requests, which reverts file changes from that request and after. |
| `chat.agent.sandbox.enabled` | `false` (org-managed) | Enable agent sandboxing on macOS/Linux. |
| `chat.agent.networkFilter` + `.allowedNetworkDomains` + `.deniedNetworkDomains` | (org-managed) | Restrict which domains agent tools (fetch, browser, MCP) can reach. |
| `chat.subagents.allowInvocationsFromSubagents` | `false` | Allow subagents to spawn further subagents (max nesting depth = 5). |

Independent confirmation of the iteration cap:

> "The default is 25. For complex tasks, increasing it to 50–100 helps Agent Mode complete without interruption." — [naonao-na.com](https://naonao-na.com/en/posts/vscode-copilot-setting-agent-max-requests/)

#### 3. Tool-calling loop semantics

The autonomous loop is described in the [Language Model Tool API guide](https://code.visualstudio.com/api/extension-guides/tools):

> "1. Copilot determines the list of available tools…
> 2. Copilot sends the request to the LLM and provides it with the prompt, chat context, and the list of tool definitions…
> 3. If needed, Copilot invokes the suggested tool(s) with the parameter values provided by the LLM. A tool response might result in more requests for tool invocations.
> 4. If there are errors or follow-up tool requests, Copilot iterates over the tool-calling flow until all tool requests are resolved.
> 5. Copilot returns the final response to the user…"

When the iteration count hits `chat.agent.maxRequests`, the loop pauses and surfaces a **Continue** button — the conversation is not lost; the user explicitly opts in to another batch of up to N requests. There is **no documented "auto-continue forever" mode** other than `Autopilot` permission level (see §5), which itself still respects `maxRequests` (Autopilot bypasses *approval* prompts, not the iteration cap).

The agent can also push long-running terminal commands to the background — see §7.

#### 4. File-edit confirmations and checkpoints

Per the [Chat overview](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode):

> "**Review inline diffs**: open a changed file to see inline diffs of the applied changes. Use the editor overlay controls to navigate between edits and **Keep** or **Undo** individual changes…
> **Use checkpoints**: VS Code can automatically create snapshots of your files at key points during chat interactions, enabling you to roll back to a previous state.
> **Stage to accept**: staging your changes in the Source Control view automatically accepts any pending edits."

The "Working set" concept from the legacy Edit mode has been **replaced** by:

- **Implicit context** (active file + selection auto-attached) plus `#file` / `#folder` / `#codebase` mentions for explicit context.
- **Chat checkpoints** (`chat.checkpoints.enabled`) — automatic per-request snapshots; restore via the **Restore Checkpoint** button on a prior request, with optional **Redo** and **Fork Conversation**.
- **Edit Previous Request** (`chat.editRequests`) — modify a sent prompt; VS Code reverts changes from that request and all subsequent ones, then resends.

Per-edit confirmation defaults are governed by the **permission level** picker (see §5). The doc notes this is in addition to per-tool approvals:

> "Both features [checkpoints and editing] complement the [review workflow](https://code.visualstudio.com/docs/copilot/chat/review-code-edits), where you accept or reject individual edits."

#### 5. Permission levels (replace the legacy "auto-approve every edit" toggle)

| Level | Description |
|---|---|
| **Default Approvals** | Tools that require approval show a confirmation dialog. The agent might ask clarifying questions. (Per-tool overrides via `chat.tools.eligibleForAutoApproval`, `chat.tools.terminal.autoApprove`, `chat.tools.urls.autoApprove`.) |
| **Bypass Approvals** | "Auto-approves all tool calls without showing confirmation dialogs and automatically retries on errors." |
| **Autopilot** (Preview) | "Auto-approves all tool calls, auto-responds to questions, and the agent continues working autonomously until the task is completed." Requires `chat.autopilot.enabled` (default on). |

Cautionary quote:

> "**Bypass Approvals** and **Autopilot** bypass manual approval prompts, including for potentially destructive actions like file edits, terminal commands, and external tool calls. The first time you enable either level, a warning dialog asks you to confirm."

This is the modern equivalent of Roo's per-tool "Always allow" toggles — but at session scope, not per-tool.

#### 6. Terminal command auto-approval (`chat.tools.terminal.autoApprove`)

Per the [agent-tools doc](https://code.visualstudio.com/docs/copilot/agents/agent-tools):

> "You can configure which terminal commands are automatically approved by using the `chat.tools.terminal.autoApprove` setting. You can specify both allowed and denied commands:
> - Set commands to `true` to automatically approve them
> - Set commands to `false` to always require approval
> - Use regular expressions by wrapping patterns in `/` characters"

Example schema:

```jsonc
{
  "mkdir": true,
  "/^git (status|show\\b.*)$/": true,
  "del": false,
  "/dangerous/": false
}
```

Behaviour notes:

- **Per-subcommand matching** by default; an `&&`-chained command is auto-approved only if **every** subcommand matches a `true` rule and none match a `false` rule.
- `matchCommandLine: true` switches to whole-line matching for advanced cases.
- **Org-managed kill switches:** `chat.tools.terminal.enableAutoApprove` (master), `chat.agent.networkFilter` (domain allow/deny for fetch + browser + MCP).
- **Sandboxed mode** (macOS/Linux only via `chat.agent.sandbox.enabled`) auto-approves terminal commands because they run in a constrained environment with `chat.agent.sandbox.FileSystem.{linux,mac}` allow/deny rules. **Not available on Windows** (restated from Phase 4c MCP findings).
- The `runInTerminal` agent tool uses the user's default shell **except** `cmd` on Windows and `sh` on macOS/Linux (no shell-integration); overridable via `chat.tools.terminal.terminalProfile.{windows,osx,linux}`.

URL/network auto-approval is governed by `chat.tools.urls.autoApprove` with both `approveRequest` and `approveResponse` for granular pre/post approval — see Phase 4c MCP §5 for the same per-MCP-tool model.

> ⚠️ **Caution from the doc:** *"Automatically approving terminal commands provides best effort protections and assumes the agent is not acting maliciously. It's important to protect yourself from prompt injection… Subverting auto approval is possible through various techniques such as quote concatenation. For example `find -exec` is normally blocked, but `find -e\"x\"ec` is not."*

#### 7. Background / long-running tasks

Local Agent mode has **two flavors of "background"**, neither of which is a true "fire-and-forget sub-conversation that finishes later":

1. **Background terminal commands** — push a long-running terminal command (dev server, watch build) to the background while the agent continues with other tasks. Per [agent-tools doc](https://code.visualstudio.com/docs/copilot/agents/agent-tools): *"While a command is running, a **Continue in Background** button appears next to the terminal command in the chat conversation."*
2. **Hand-off to Copilot CLI or Cloud agent** — the [agents overview](https://code.visualstudio.com/docs/copilot/agents/overview) describes hand-offs as the way to "free up" the local IDE: *"create a plan with a local agent, hand off to Copilot CLI for proof of concepts, and then continue with a cloud agent to submit a pull request for team review."* This uses the **session-type dropdown** (Local / Copilot CLI / Cloud / Third-party).

For a genuinely **autonomous background sub-task**, you escalate out of local Agent mode into:

- **Copilot CLI** — same `.agent.md` files, runs in a Git worktree (Phase 5 scope).
- **Cloud agent** — same `.agent.md` files, runs on GitHub.com with PR integration (out of scope; see §10).

There is **no "boomerang sub-task that returns later in the same chat without blocking the parent"** primitive in local Agent mode. Sub-agents (§8) are **synchronous to the parent agent** even when multiple subagents run *in parallel* — the parent waits for all of them to complete before continuing its own loop.

#### 8. Sub-agent / hand-off support — the deep dive (Roo `new_task` parity)

This is the headline section of Phase 4d. The picture has three distinct mechanisms that **together** approximate Roo's Orchestrator + `new_task` boomerang.

##### 8.1 The built-in `agent` (a.k.a. `runSubagent`) tool

Per the [Subagents doc](https://code.visualstudio.com/docs/copilot/agents/subagents):

> "Subagents are typically **agent-initiated**, not directly invoked by users in chat. To allow the main agent to invoke subagents, make sure the `runSubagent` tool is enabled."

The frontmatter name is `agent` (as it appears in `tools: ['agent']`); the underlying tool ID is `runSubagent`. Invocation is **model-driven**:

> "1. You (or your custom agent's instructions) describe a complex task.
> 2. The main agent recognizes the part of the task that benefits from isolated context.
> 3. The agent starts a subagent, passing only the relevant subtask.
> 4. The subagent works autonomously and returns a summary.
> 5. The main agent incorporates the result and continues."

What gets passed: a **prompt string** (the subtask) plus optionally an explicit model name. What comes back: **only the final result/summary** (intermediate tool calls are collapsed into a single expandable UI block). This is the closest 1:1 to Roo's `<new_task>` "delegate to a fresh task and return a summary" semantics.

##### 8.2 `agents:` frontmatter allowlist (which subagents this agent may invoke)

Per the [Custom agents doc](https://code.visualstudio.com/docs/copilot/customization/custom-agents):

> "`agents`: A list of agent names that are available as subagents in this agent. Use `*` to allow all agents, or an empty array `[]` to prevent any subagent use. If you specify `agents`, ensure the `agent` tool is included in the `tools` property."

Combined with `user-invocable: false` and `disable-model-invocation: true`, this gives **per-agent declarative scoping** of the sub-agent graph. Example coordinator pattern from the doc:

```markdown
---
name: Feature Builder
tools: ['agent', 'edit', 'search', 'read']
agents: ['Planner', 'Plan Architect', 'Implementer', 'Reviewer']
---
```

##### 8.3 `handoffs:` frontmatter (interactive next-step buttons, NOT autonomous)

Distinct from sub-agents:

> "Handoffs enable you to create guided sequential workflows that transition between agents with suggested next steps. After a chat response completes, **handoff buttons** appear that let users move to the next agent with relevant context and a pre-filled prompt."

Each handoff: `{ label, agent, prompt, send, model }`. With `send: false` (default) the user reviews the prefilled prompt; with `send: true` it auto-submits. **Handoffs are user-mediated, not model-driven** — they're a UX widget, not a tool call.

##### 8.4 Sequential vs parallel — Roo divergence

Per the Feb-2026 multi-agent blog:

> "What's new this release: VS Code can now run **multiple subagents in parallel**. Fire off multiple tasks at once, get results faster, and save premium requests in the process."

And the [Subagents doc § Parallel code analysis](https://code.visualstudio.com/docs/copilot/agents/subagents) shows a concrete example prompt instructing the orchestrator to fan out four review subagents in parallel.

**This is the inverse of Roo.** Roo's `new_task` is **strictly sequential and test-enforced** (see [`10-roo-inventory.md`](10-roo-inventory.md)). Copilot's subagents are **parallel by default when the model decides** (the model can choose to issue them serially via prompt instructions, but there is no `chat.subagents.forceSequential` setting in the [copilot-settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings)).

⚠️ **Resolves Q-013** ("Which user workflows depend on Roo's sequential-only `new_task` semantics?"). Parity verdict:

| Pattern | Roo | Copilot Chat sub-agents |
|---|---|---|
| One subtask at a time, parent waits | ✅ default & enforced | ✅ achievable (instruct the orchestrator to run subagents serially) |
| Many subtasks in parallel, parent waits for all | ❌ not supported | ✅ default capability |
| Subtask returns a structured summary to parent | ✅ via `attempt_completion` | ✅ via subagent's final assistant message (free-form) |
| Subtask runs in isolated context | ✅ | ✅ ("context-isolated agents that run independently from your main session — your main agent delegates work and only the final result flows back") |
| Subtask can use a different model than parent | ❌ uses parent's model | ✅ explicit param OR agent-configured `model:` (with cost-tier cap: *"The requested model cannot exceed the cost tier of the main model"*) |
| Recursive / self-referencing | ❌ blocked by tests | ✅ via `agents: [SelfName]` + `chat.subagents.allowInvocationsFromSubagents = true` (max nesting depth = 5) |

**User-workflow risk for the migration:**

- **No risk** for vault workflows that use `new_task` for sequential planning → implementation → review (the pattern still works; it just isn't *enforced*). The orchestrator's prompt simply needs to say "run these subagents in sequence" rather than relying on the runtime to serialize.
- **Risk** if the user has built workflows that **rely on the sequential ordering being honored even when the model would want to parallelize** — e.g. "Step 2 must read a file Step 1 just created." Mitigation: explicit prose ordering in the parent agent's instructions ("Wait for the Planner subagent to finish before invoking the Implementer").
- **Net upside** for review/research/multi-perspective workflows that Roo cannot do at all today (parallel multi-perspective review, multi-model consensus).

##### 8.5 Recursion caps

> "By default, subagents cannot spawn further subagents. This prevents infinite recursion when agents accidentally call themselves in a loop… To enable nested subagents, enable the `chat.subagents.allowInvocationsFromSubagents` setting (`false` by default). When enabled, subagents can spawn their own subagents, **up to a maximum nesting depth of 5**."

Self-referential agents are explicitly supported (the doc shows a `RecursiveProcessor` divide-and-conquer example). The depth-5 cap is **hard-coded**; not configurable per docs as of 2026-04-26.

#### 9. Roo `new_task` boomerang vs Copilot sub-agent — final mapping

| Roo Orchestrator pattern | Copilot Chat equivalent | Verdict |
|---|---|---|
| `<new_task><mode>code</mode><message>…</message></new_task>` from Orchestrator | Main agent declares `tools: ['agent']` + `agents: ['Code']`; LLM decides to call `runSubagent` with the message and target agent | **Functional equivalent** with three deltas: (a) parallel-capable, (b) model-decided not user-decided, (c) sub-agent return is a summary message, not a structured `<attempt_completion>` payload. |
| Sequential-only enforcement | None (model can parallelize; orchestrator must instruct sequential ordering in prose) | **Lost guarantee** — must be replaced with prompt discipline. |
| Each subtask runs in fresh chat context | Sub-agent runs in isolated context window | **1:1.** |
| Subtask result re-injected into Orchestrator's chat as a tool result | Sub-agent's final assistant message becomes a tool result for the parent | **1:1.** |
| Per-mode tool restrictions on the spawned subtask | Per-`.agent.md` `tools:` allowlist on the called subagent | **1:1, finer-grained.** |
| Per-mode `fileRegex` on the spawned subtask | None (restated from Phase 4a) | **Lossy.** |

**Verdict:** Roo orchestrator `new_task` parity is **🟡 minor gap** (not 🔴 blocker) — Copilot sub-agents are **functionally a superset** (parallel + multi-model + nested), missing only Roo's strict sequential enforcement and the structured `attempt_completion` return-shape. Workflow migration requires re-writing orchestrator prompts to use prose ordering instead of relying on runtime serialization.

#### 10. Cloud agent (Copilot coding agent on github.com) — 1-line note

The same `.agent.md` schema is reused for the **Copilot coding agent** on github.com (delegated via the Cloud agent target or by assigning a GitHub issue to `copilot`); set `target: github-copilot` and use the `mcp-servers` frontmatter inline form. See [docs.github.com — create custom agents](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents). Out-of-scope here; revisit in Phase 5/8.

#### Roo open questions resolved by this section

- **Q-003** (sub-agent / orchestrator parity) — fully **CONFIRMED** with details: `agent` tool + `agents:` allowlist + `handoffs:` together cover the orchestrator pattern; **parallel by default** (newer than Roo) with optional sequential via prose; recursion behind a setting with depth-5 cap.
- **Q-013** (which user workflows depend on Roo's sequential-only semantics) — **RESOLVED**: only workflows that have an undeclared cross-step file/state dependency between subtasks. Migration mitigation = explicit prose ordering in the parent agent's instructions. Net effect is **🟡 minor** — see §8.4.

## Chat Participants / Extension API

### Sources

- [`api/extension-guides/chat`](https://code.visualstudio.com/api/extension-guides/chat) — VS Code "Chat Participant API" (canonical reference for `vscode.chat.createChatParticipant`, `contributes.chatParticipants`, slash commands, follow-ups, participant detection). Accessed 2026-04-26.
- [`api/extension-guides/ai/chat`](https://code.visualstudio.com/api/extension-guides/ai/chat) — alternate URL for the same Chat Participant API doc. Accessed 2026-04-26.
- [`api/extension-guides/tools`](https://code.visualstudio.com/api/extension-guides/tools) and [`api/extension-guides/ai/tools`](https://code.visualstudio.com/api/extension-guides/ai/tools) — VS Code "Language Model Tool API" (`vscode.lm.registerTool`, `contributes.languageModelTools`). Accessed 2026-04-26.
- [`api/references/vscode-api#chat`](https://code.visualstudio.com/api/references/vscode-api#chat) — VS Code API reference (`ChatParticipant`, `ChatRequestHandler`, `ChatResponseStream`, `ChatFollowupProvider`). Accessed 2026-04-26.
- [`docs/copilot/customization/agent-plugins`](https://code.visualstudio.com/docs/copilot/customization/agent-plugins) — VS Code "Agent plugins in VS Code (Preview)" — the supported way for a plugin to ship custom agents (`.agent.md`), skills, hooks, and MCP servers declaratively. Accessed 2026-04-26.
- [`docs/copilot/customization/custom-agents § FAQ`](https://code.visualstudio.com/docs/copilot/customization/custom-agents#_frequently-asked-questions) — confirms extensions can contribute custom agents. Accessed 2026-04-26.
- [`docs/copilot/reference/copilot-vscode-features`](https://code.visualstudio.com/docs/copilot/reference/copilot-vscode-features) — Copilot in VS Code cheat sheet (canonical built-in chat-participants list). Accessed 2026-04-26.
- [`github.com/microsoft/vscode-extension-samples — chat-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample) — official `@cat` chat-participant sample (the reference exemplar). Accessed 2026-04-26.

### Findings (2026-04-26)

#### 1. Built-in chat participants

Per the [Copilot cheat sheet](https://code.visualstudio.com/docs/copilot/reference/copilot-vscode-features):

| Participant | One-liner |
|---|---|
| `@github` | "Use the `@github` participant to ask questions about GitHub repositories, issues, pull requests, and more." Powers GitHub.com / GHE knowledge skills. Example: `@github What are all of the open PRs assigned to me?` |
| `@terminal` | "Use the `@terminal` participant to ask questions about the integrated terminal or shell commands." Example: `@terminal list the 5 largest files in this workspace` |
| `@vscode` | "Use the `@vscode` participant to ask questions about VS Code features, settings, and the VS Code extension APIs." Example: `@vscode how to enable word wrapping?` |
| `@workspace` | (Documented in [Chat Participant API guide](https://code.visualstudio.com/api/extension-guides/chat)) "Built-in `@workspace` … is powered by multiple tools: GitHub's knowledge graph, combined with semantic search, local code indexes, and VS Code's language services." |

Built-in participants take precedence in the participant-detection routing:

> "**Built-in chat participants take precedence** for participant detection. For example, a chat participant that operates on workspace files might conflict with the built-in `@workspace` participant."

#### 2. Third-party chat participants via `vscode.chat.createChatParticipant`

A VS Code extension contributes a chat participant by:

1. Declaring `contributes.chatParticipants` in `package.json`:

   ```jsonc
   "contributes": {
     "chatParticipants": [{
       "id": "chat-sample.my-participant",
       "name": "my-participant",
       "fullName": "My Participant",
       "description": "What can I teach you?",
       "isSticky": true,
       "commands": [
         { "name": "teach", "description": "…" },
         { "name": "play",  "description": "…" }
       ]
     }]
   }
   ```

2. Registering a `ChatRequestHandler` at activation time:

   > "On activation of the extension, create the participant with `vscode.chat.createChatParticipant`. Provide the ID, which you defined in `package.json`, and a reference to the request handler that you implement…"

   ```ts
   const cat = vscode.chat.createChatParticipant('chat-sample.my-participant', handler);
   ```

3. The handler signature:

   ```ts
   const handler: vscode.ChatRequestHandler = async (
     request: vscode.ChatRequest,
     context: vscode.ChatContext,
     stream: vscode.ChatResponseStream,
     token: vscode.CancellationToken
   ): Promise<…> => { … };
   ```

4. Optional: slash commands (`commands` array in `package.json`), follow-ups (`ChatFollowupProvider`), participant detection (`disambiguation` array of `{ category, description, examples }`), and feedback telemetry (`onDidReceiveFeedback`).

The participant **owns the conversation turn** when invoked: it receives the user prompt and orchestrates everything itself (including sub-tool-calls via the Language Model API), in contrast to language-model tools which the agent loop invokes opportunistically.

> "Chat participants are different from [language model tools](https://code.visualstudio.com/api/extension-guides/ai/tools) that are invoked as part of the LLM orchestrating the steps needed to resolve the user's chat prompt. **Chat participants receive the user's prompt and orchestrate the tasks that are needed themselves.**"

Convention: at most **one chat participant per extension**:

> "Up to one chat participant per extension is a simple model that scales well in the UI."

#### 3. Third-party tools via the Language Model Tools API

Distinct from chat participants. Two-step contract:

1. Declare in `contributes.languageModelTools` in `package.json`:

   ```jsonc
   "languageModelTools": [{
     "name": "chat-tools-sample_tabCount",
     "tags": ["editors", "chat-tools-sample"],
     "toolReferenceName": "tabCount",
     "displayName": "Tab Count",
     "modelDescription": "The number of active tabs in a tab group in VS Code.",
     "userDescription": "Count the number of active tabs in a tab group.",
     "canBeReferencedInPrompt": true,
     "icon": "$(files)",
     "inputSchema": { "type": "object", "properties": { } },
     "when": "debugState == 'running'"
   }]
   ```

2. Register at activation:

   ```ts
   vscode.lm.registerTool('chat-tools-sample_tabCount', new TabCountTool());
   ```

   Implement `vscode.LanguageModelTool<T>` with `prepareInvocation` (confirmation message) and `invoke` (returns `vscode.LanguageModelToolResult`).

These tools are invoked by the agent loop automatically when the LLM decides they're relevant, the same way MCP-server tools are. They appear in the Configure Tools picker, can be referenced from a prompt with `#tabCount`, and can be allowlisted in an `.agent.md` `tools:` array (via either the `name` or the `toolReferenceName`).

The Language Model Tools API is **the recommended path for "I want to ship a custom tool to all Copilot users"** — it deeply integrates with the editor (full `vscode.*` API access) but cannot run outside VS Code. The MCP-server alternative is the right choice when you want cross-tool reuse (Copilot CLI, cloud agent, third-party clients).

#### 4. Extension-contributed `.agent.md` files — Plan-B viability assessment

**Yes, extensions can ship custom agents declaratively.** Two routes:

**Route A — Agent plugins (Preview, the supported declarative way):**

Per the [Agent plugins doc](https://code.visualstudio.com/docs/copilot/customization/agent-plugins):

> "Agent plugins are prepackaged bundles of chat customizations that you can discover and install from plugin marketplaces in Visual Studio Code. **A single plugin can provide any combination of slash commands, agent skills, custom agents, hooks, and MCP servers.**"

Plugins are toggled by the `chat.plugins.enabled` org-managed setting, are installable from a Git repo URL via `Chat: Install Plugin From Source`, and appear in the **Agent Plugins — Installed** view in the Extensions side panel. **This is the sanctioned path for shipping a "Roo-replacement extension that bundles a complete vault-style mode set."**

**Route B — Bundled in a regular VS Code extension (also supported):**

Per the [Custom agents FAQ](https://code.visualstudio.com/docs/copilot/customization/custom-agents#_frequently-asked-questions):

> "To remove a custom agent that was contributed by an extension, you need to uninstall the extension that provides it. If you don't want to uninstall the extension, you can hide the custom agent from the agents dropdown instead."

The doc doesn't enumerate the exact contribution-point name for "extension ships an `.agent.md`" outside the plugins framework, but the FAQ language confirms it works today. ⚠️ uncertain — exact contribution-point manifest entry and whether plain extensions need a manifest entry vs just placing files. Filed as **Q-027**.

**Plan-B viability for a "Roo-replacement extension":** ✅ **viable**. A single agent plugin (or extension) can ship: 17 vault `.agent.md` files + `.toolsets.jsonc` files + `mcp.json` server registrations + hooks for pre/post-tool actions + slash commands. The user installs one VSIX/plugin, gets the entire vault. This is meaningfully different from Roo's "extension owns its own UI" model (see §5).

#### 5. Architectural comparison — Roo extension vs Copilot extension API

| Axis | Roo (current) | Copilot Chat (extension API) |
|---|---|---|
| Chat surface ownership | Roo extension owns its own webview chat panel ([`webview-ui/src/`](../../../webview-ui/src)) | Extensions contribute *into* the built-in Copilot Chat panel; cannot own a parallel chat surface |
| Tool surface | 22 native tools hard-coded in [`src/core/prompts/tools/native-tools/`](../../../src/core/prompts/tools/native-tools) + MCP | Built-in agent loop tools + MCP + extension-contributed `vscode.lm.registerTool` + extension-contributed chat participants |
| Mode/agent surface | YAML mode definitions in `.roomodes` / `custom_modes.yaml` | `.agent.md` files in `.github/agents/` + user prompts folder + extension-shipped via Agent Plugins |
| Settings/restrictions UI | Custom React panels: [`ModesView.tsx`](../../../webview-ui/src/components/modes/ModesView.tsx), [`McpServerRestriction.tsx`](../../../webview-ui/src/components/modes/McpServerRestriction.tsx), [`DeleteModeDialog.tsx`](../../../webview-ui/src/components/modes/DeleteModeDialog.tsx) | Command Palette + JSON editor + the **Chat Customizations editor** (Preview) — no per-mode visual restriction picker |
| User experience | Two chat panels in the activity bar (Copilot + Roo) | One unified chat panel; agents are dropdown items |
| Discovery | Roo extension on the Marketplace | Copilot extension + Agent Plugins gallery + `chat.plugins.enabled` |

**User-visible implication:** migrating to a Copilot-Chat-only world **collapses two chat panels into one** but loses Roo's bespoke per-mode UI affordances. The user gains (a) a single unified chat surface, (b) cross-tool agent files (the same `.agent.md` runs locally, in Copilot CLI, and on the cloud agent), but loses (c) the visual mode editor and the visual MCP-server restriction picker — those become Markdown frontmatter editing.

#### 6. Reference exemplar

**Official sample:** [`microsoft/vscode-extension-samples — chat-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample) implements the `@cat` participant (the running example throughout the Chat Participant API guide). It demonstrates `createChatParticipant`, slash commands (`/teach`, `/play`), follow-up provider, button responses, and `prompt-tsx` for prompt construction. It also contains a parallel `tools.ts` showing `vscode.lm.registerTool` and a `chatUtilsSample.ts` showing the `@vscode/chat-extension-utils` library for tool-calling-from-participant.

**Real-world example with `.agent.md` shipped in an extension blog post:** [Microsoft Tech Community — VS Code Custom Agents: AI-Powered Terraform Security Scanning in the IDE](https://techcommunity.microsoft.com/blog/azureinfrastructureblog/vs-code-custom-agents-ai-powered-terraform-security-scanning-in-the-ide/4507903) — confirms the broader pattern of shipping a domain-specific custom agent file from a repository, viable for both team-shared `.github/agents/` and Marketplace plugin distribution.

#### Roo open questions resolved / opened by this section

- **Q-014** (which webview affordances does the user actually rely on day-to-day) — **PARTIALLY RESOLVED in mapping**: the visual-mode-editor + visual-MCP-restriction-picker do not carry over; they become JSON/frontmatter editing or the Chat Customizations editor. Whether this is a daily-driver blocker remains a user-input question (still owned by Phase 1 follow-up).
- **Q-027** (new) — Exact contribution-point manifest entry for plain (non-plugin) VS Code extensions to ship `.agent.md` files. The FAQ confirms this is possible; the schema entry isn't documented in the Custom Agents page.
- **Q-028** (new) — Org-management story for Agent Plugins: are organization-wide plugin installs supported, and does the existing `chat.plugins.enabled` org-management policy interact with the `github.copilot.chat.organizationCustomAgents.enabled` org-policy from Phase 4a?

## Storage Locations (Windows)

### Sources

- All sources cited in Phase 4a, 4b, 4c above (custom-agents, custom-instructions, prompt-files, agent-tools, mcp-servers, mcp-configuration, profiles, settings-sync). Re-cited inline in the table below as needed.
- [`docs/configure/profiles`](https://code.visualstudio.com/docs/configure/profiles) — VS Code Profiles. Accessed 2026-04-26.
- [`docs/configure/settings-sync`](https://code.visualstudio.com/docs/configure/settings-sync) — Settings Sync (sync categories include "Prompts and Instructions" and "MCP Servers"). Accessed 2026-04-26.
- [`microsoft/vscode#272199`](https://github.com/microsoft/vscode/issues/272199) — confirms `%APPDATA%\Code\User\prompts\` for `.instructions.md`. Accessed 2026-04-26.
- [`microsoft/vscode#305642`](https://github.com/microsoft/vscode/issues/305642) — confirms only the global `prompts/` folder is scanned (not profile-scoped) for agents/instructions/prompts. Accessed 2026-04-26.
- [`microsoft/vscode-copilot-release#12853`](https://github.com/microsoft/vscode-copilot-release/issues/12853) — confirms `%APPDATA%\Code\User\prompts\` is shared by `.prompt.md`, `.instructions.md`, tool sets. Accessed 2026-04-26.
- [`microsoft/vscode#251603`](https://github.com/microsoft/vscode/issues/251603) — `*.toolsets.jsonc` not in Settings Sync (Q-024). Accessed 2026-04-26.
- [`microsoft/vscode#251515`](https://github.com/microsoft/vscode/issues/251515) — workspace-scoped tool sets not yet supported (Q-021). Accessed 2026-04-26.

### Findings (2026-04-26) — Consolidated reference table

All Windows paths assume **VS Code Stable, Default profile**. Substitute `Code` → `Code - Insiders` for VS Code Insiders, and prepend `%APPDATA%\Code\User\profiles\<profile-id>\` instead of `%APPDATA%\Code\User\` for **named profiles** where noted.

| Concept | Workspace path | Windows user path | Sync'd via Settings Sync? |
|---|---|---|---|
| Custom agents (`.agent.md`) | `.github/agents/*.agent.md` (and `.claude/agents/*.md`) | `%USERPROFILE%\.copilot\agents\` **and/or** `%APPDATA%\Code\User\prompts\` (NOT profile-scoped — see [`vscode#305642`](https://github.com/microsoft/vscode/issues/305642)) | ✅ via "Prompts and Instructions" sync category (per [Settings Sync doc](https://code.visualstudio.com/docs/configure/settings-sync); same folder as prompts) |
| Prompt files (`.prompt.md`) | `.github/prompts/*.prompt.md` | `%APPDATA%\Code\User\prompts\` (per [`vscode-copilot-release#12853`](https://github.com/microsoft/vscode-copilot-release/issues/12853)) | ✅ via "Prompts and Instructions" |
| Instruction files (`.instructions.md`) | `.github/instructions/*.instructions.md` | `%APPDATA%\Code\User\prompts\` (per [`vscode#272199`](https://github.com/microsoft/vscode/issues/272199)) and/or `%USERPROFILE%\.copilot\instructions\` and/or `%USERPROFILE%\.claude\rules\` | ✅ via "Prompts and Instructions" |
| Repo-wide instructions | `.github/copilot-instructions.md` | n/a | n/a (per-repo) |
| AGENTS.md (always-on) | `AGENTS.md` (project root); nested per-folder behind `chat.useNestedAgentsMdFiles` | n/a | n/a (per-repo) |
| CLAUDE.md (always-on, behind `chat.useClaudeMdFile`) | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` | `~/.claude/CLAUDE.md` | n/a (per-repo, except the home-dir one) |
| Tool sets (`*.toolsets.jsonc`) | ❌ not yet supported (Q-021 — [`vscode#251515`](https://github.com/microsoft/vscode/issues/251515)) | `%APPDATA%\Code\User\prompts\*.toolsets.jsonc` (per [`vscode#251603`](https://github.com/microsoft/vscode/issues/251603)) | ⚠️ Q-024 — [`vscode#251603`](https://github.com/microsoft/vscode/issues/251603) reports the file is **not** included in the "Prompts and Instructions" sync category as of mid-2025; status not re-verified. |
| MCP config | `.vscode/mcp.json` | `%APPDATA%\Code\User\mcp.json` (Default profile) **or** `%APPDATA%\Code\User\profiles\<profile-id>\mcp.json` (named profiles — profile-aware per [MCP servers doc](https://code.visualstudio.com/docs/copilot/customization/mcp-servers): *"When you use multiple profiles, each profile can have its own MCP server configuration"*) | ✅ via dedicated **"MCP Servers"** Settings Sync category (per [MCP servers doc § Synchronize MCP configuration across devices](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)) |
| MCP server enable/disable state | `.vscode/` workspace state (not in `mcp.json`) | profile state (not in `mcp.json`) | ⚠️ uncertain — the doc says enable/disable state is "stored separately from the server configuration in `mcp.json`, so it does not affect shared configuration files"; whether that separate state is itself synced is undocumented. Filed as part of **Q-025**. |
| MCP server secrets (`${input:…}` resolved values) | n/a | Windows Credential Manager (via `vscode.SecretStorage`); profile-scoped per profile | ❌ never synced (secrets are device-local by design) |
| Chat history / state | `.vscode/` workspace state (chat sessions per workspace) | `%APPDATA%\Code\User\workspaceStorage\<hash>\` (per workspace) and `%APPDATA%\Code\User\globalStorage\` (cross-workspace) | ❌ chat sessions are not in any sync category |
| `chat.promptFilesLocations`, `chat.instructionsFilesLocations`, `chat.agentFilesLocations`, `chat.mcp.discovery.enabled`, `chat.tools.*`, `chat.useAgentsMdFile`, `chat.useClaudeMdFile`, etc. (workspace-scoped overrides) | `.vscode/settings.json` | `%APPDATA%\Code\User\settings.json` (Default profile) **or** `%APPDATA%\Code\User\profiles\<profile-id>\settings.json` (named profiles) | ✅ via "Settings" sync category |
| GitHub Copilot extension state (cached models, MRU agents, etc.) | n/a | `%APPDATA%\Code\User\globalStorage\github.copilot-chat\` and `\github.copilot\` | ❌ extension state is per-device |
| Settings Sync identity / conflict log | n/a | `%APPDATA%\Code\User\sync\` | n/a (the sync mechanism's own state) |
| Windows Copilot CLI MCP config (Phase 5 — separate from VS Code) | n/a | `%USERPROFILE%\.copilot\mcp-config.json` (per Squad / Copilot CLI conventions; verify in Phase 5) | ❌ not part of VS Code Settings Sync |

#### Profile-aware paths and symlink implications for the vault

VS Code's **profile** mechanism segregates user data into `%APPDATA%\Code\User\profiles\<profile-id>\` for everything **except** the shared global `prompts/` folder (and a handful of other always-global folders). The split as currently understood (with `mcp.json` resolved this section, others from Phase 4a/4b):

| Per-profile (segregated) | Global (shared across profiles) |
|---|---|
| `settings.json` | `prompts/` (agents, prompts, instructions, tool sets — per [`vscode#305642`](https://github.com/microsoft/vscode/issues/305642)) |
| `keybindings.json` | `globalStorage/` (extension state, by design) |
| `snippets/` | Settings Sync identity (`sync/`) |
| `mcp.json` (this section's finding) | Windows Credential Manager (OS-level) |
| `tasks.json` | |
| Extensions list | |

**Vault implication:** the [`../roo-vault/setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1) pattern of using **directory symlinks** (e.g. `mklink /D %APPDATA%\Code\User\prompts c:\git\roo-vault\global-settings\prompts`) maps cleanly because:

- The `prompts/` folder is **global**, so a single symlink at `%APPDATA%\Code\User\prompts` is correctly seen by all profiles. ✅
- `mcp.json` is **profile-scoped**, so the vault must either (a) symlink `%APPDATA%\Code\User\mcp.json` for the Default profile only and accept that named profiles need their own copy/link, or (b) symlink each profile's `%APPDATA%\Code\User\profiles\<id>\mcp.json` individually. ⚠️ The user reportedly uses only the Default profile, so option (a) is sufficient for the immediate migration; multi-profile support is a Phase 8 follow-up.
- `settings.json` is **profile-scoped**; same caveat as `mcp.json`.
- Settings Sync (when enabled with the **MCP Servers** category checked) provides a parallel cloud-backed sync of `mcp.json` across machines and is **complementary** to the symlink-into-vault pattern — they aren't mutually exclusive, but pick one to be the source of truth to avoid conflicts.

**Resolves Q-008 (vault symlink portability for Copilot Chat)** at a fundamental level for the prompts/agents/instructions/tool-sets surface: directory symlinks at `%APPDATA%\Code\User\prompts\` are correctly read by VS Code (no sandbox/permission rejection). MCP `mcp.json` symlinks at the profile root are also tolerated, with the profile-scoping caveat noted above. Filed remaining edge cases (per-profile symlinking automation, sync conflict avoidance) as **Q-026**.

## Limits / Known Gaps

### Sources

- All sources cited in Phase 4a/4b/4c/4d above (Custom Agents, Custom Instructions, Prompt Files, Tool Sets, MCP, Agent Mode, Sub-agents, Chat Participants, Language Model Tools, Agent Plugins). Re-cited inline in the gap entries below as needed.
- [`docs/copilot/agents/agent-tools § 128 cap`](https://code.visualstudio.com/docs/copilot/agents/agent-tools) — restated. Accessed 2026-04-26.
- [`vscode-copilot-release#13065`](https://github.com/microsoft/vscode-copilot-release/issues/13065) — restated. Accessed 2026-04-26.
- [`microsoft/vscode#251515`](https://github.com/microsoft/vscode/issues/251515) — restated. Accessed 2026-04-26.
- [`microsoft/vscode#251603`](https://github.com/microsoft/vscode/issues/251603) — restated. Accessed 2026-04-26.
- [`docs/copilot/chat/chat-sessions`](https://code.visualstudio.com/docs/copilot/chat/chat-sessions) — multi-session / fork / archive behavior. Accessed 2026-04-26.

### Findings (2026-04-26) — Gap Catalog

This section synthesizes the **Roo → Copilot Chat capability deltas** uncovered across Phase 4a–4d. Each row carries a severity flag for Phase 6's gap matrix:

- 🔴 **blocker** — no equivalent and no acceptable workaround; would force the user to keep Roo for that workflow
- 🟠 **major** — no first-class equivalent but a workable workaround exists with effort
- 🟡 **minor** — different ergonomics; functionality preserved with prompt/process changes
- ✅ **no gap** — Copilot matches or exceeds Roo

#### Gaps (things Roo does that Copilot Chat doesn't)

| # | Capability | Roo behavior | Copilot Chat status | Severity | Workaround / notes |
|---|---|---|---|---|---|
| G-1 | **Per-mode file-glob edit restrictions** (`fileRegex`) | `groups: [["edit", { fileRegex: "\\.md$" }]]` hard-blocks edits outside the regex | `.agent.md` has **no `fileRegex` / `applyTo` field** for the edit tool (confirmed Phase 4a §5(a)) | 🔴 | Inline prose ("only modify files matching `**/*.md`"); or omit `edit` from `tools:` (blocks **all** edits, not selective ones). Real loss for the Architect mode's `.md`-only guard. |
| G-2 | **Per-mode rules folder** (`.roo/rules-<mode>/`) | Mode-specific Markdown rule files auto-loaded only when that mode is active | No first-class equivalent; instructions are scoped by file glob (`applyTo`), not by agent (Phase 4a Q-018) | 🟠 | Inline rules into the `.agent.md` body, or Markdown-link to dedicated `.instructions.md` files from the agent body. Re-architects per-mode rules into per-agent linked-content. |
| G-3 | **Workspace-scoped tool sets** (`.vscode/*.toolsets.jsonc`) | n/a (Roo encodes tool groups inline in `.roomodes`) | `*.toolsets.jsonc` is **user-scope only**; workspace storage tracked in [`microsoft/vscode#251515`](https://github.com/microsoft/vscode/issues/251515), not yet shipped (Q-021) | 🟠 | Inline `tools:` arrays in `.github/agents/<mode>.agent.md` (workspace-scoped). Re-evaluate when issue ships. |
| G-4 | **Sequential-only `new_task` orchestration** | Test-enforced sequential subtask execution ([`new-task-isolation.spec.ts`](../../../src/core/task/__tests__/new-task-isolation.spec.ts)) | Sub-agents are **parallel-capable by default** (Phase 4d §8.4); no setting forces sequential | 🟡 | Prose discipline in the parent agent's body ("run subagents in this order, wait for each"). Net upside elsewhere (parallel review, multi-model consensus). **Resolves Q-013.** |
| G-5 | **Native webview UI for editing modes / MCP / rules** | [`ModesView.tsx`](../../../webview-ui/src/components/modes/ModesView.tsx), [`McpServerRestriction.tsx`](../../../webview-ui/src/components/modes/McpServerRestriction.tsx), [`DeleteModeDialog.tsx`](../../../webview-ui/src/components/modes/DeleteModeDialog.tsx) | Command Palette + JSON/Markdown editor + Chat Customizations editor (Preview); no visual MCP-server restriction picker (Phase 4d §5) | 🟡 | Acceptable for power users (vault is already file-driven). Lossy for new-user onboarding; documentation-mitigable. |
| G-6 | **Multi-thread chat sessions per workspace** | Roo: one task at a time; subtasks are sequential | Copilot: **multi-session**; the Chat view "Sessions list" supports many concurrent local + CLI + cloud sessions per workspace, plus fork-from-checkpoint ([chat-sessions doc](https://code.visualstudio.com/docs/copilot/chat/chat-sessions)) | ✅ | Copilot is **better here** — confirmed multi-session UX. |
| G-7 | **128-tool-per-request hard cap** | n/a (Roo's 22 native + per-mode MCP allowlist stays well under) | Hard 128-tool cap per request ([`vscode-copilot-release#13065`](https://github.com/microsoft/vscode-copilot-release/issues/13065); restated Phase 4b §7) | 🟡 | Per-agent `tools:` allowlists keep counts low; enable `github.copilot.chat.virtualTools.threshold` to auto-collapse large tool sets. With the vault's 4 enabled MCP servers + built-ins, the cap is comfortable today. |
| G-8 | **Settings Sync coverage gaps** | Roo settings live in extension globalStorage + `~/.roo/`; user manages sync manually | "Prompts and Instructions" Settings-Sync category covers `.agent.md` / `.prompt.md` / `.instructions.md`, but **`*.toolsets.jsonc` is reportedly NOT included** ([`microsoft/vscode#251603`](https://github.com/microsoft/vscode/issues/251603); Q-024) | 🟡 | Vault symlink scheme already covers this; pure Settings-Sync users hit it. |
| G-9 | **Chat history portability / export** | Roo serializes task history to extension globalStorage; exportable via DB queries | Chat sessions stored in `%APPDATA%\Code\User\workspaceStorage\<hash>\` per workspace; **no documented portable export format** for sessions; `Fork Conversation` only works in-app | 🟠 | Phase-8 follow-up: investigate whether the chat-sessions JSON is human-parseable. Filed as **Q-029**. |
| G-10 | **Custom approval policies per tool / MCP server** | Roo: per-server, per-mode "Always allow" toggles in webview | Copilot: `chat.tools.eligibleForAutoApproval`, `chat.tools.terminal.autoApprove` (regex map), per-tool **Always allow** in confirmation dialog (per workspace), `chat.tools.urls.autoApprove` with `approveRequest`/`approveResponse` granularity (Phase 4d §6) | ✅ | Copilot offers **finer granularity** (regex per terminal command, separate pre/post URL approval, org-policy `chat.tools.eligibleForAutoApproval` to *prevent* auto-approval). Net win. |
| G-11 | **Multi-profile vault automation** | Vault uses one VS Code profile (Default); symlink is single-target | `mcp.json` and `settings.json` are profile-scoped at `%APPDATA%\Code\User\profiles\<id>\`; `prompts/` is global (Phase 4c §2 / Q-026) | 🟡 | Phase-8 PowerShell helper enumerates `profiles\*\` and re-points each. Owner: Phase 8. |
| G-12 | **Sub-agent return is a structured payload** | Roo `attempt_completion` has a defined `<result>` shape that's consumed by the orchestrator | Copilot sub-agent returns the final assistant message as free-form text/markdown that becomes a tool result | 🟡 | Prompt the sub-agent to "return your output as a JSON block with these fields"; orchestrator parses. No structural guarantee. |
| G-13 | **Local model providers (per-key)** | Roo supports configuring per-provider keys (OpenAI, Anthropic, Bedrock, Ollama, etc.) | Copilot uses GitHub's model catalog only (no per-provider keys); third-party agent harness for Anthropic/OpenAI is a separate session type | 🟠 | If the user relies on a specific non-Copilot provider, the third-party-agent path is required. **Open Q for the user** — does the vault actually use a non-Copilot model today? Filed as **Q-030**. |
| G-14 | **Sandboxing on Windows** | n/a (Roo doesn't sandbox) | `chat.agent.sandbox.enabled` is **macOS/Linux only** (restated Phase 4c §9 / Phase 4d §6); MCP `sandboxEnabled` likewise ignored on Windows | 🟡 | No regression vs Roo; just a Windows-platform limitation that closes off one of Copilot's auto-approval shortcuts. |

#### Copilot-only wins (for balance — things Copilot has that Roo lacks)

| # | Capability | Why it matters | Citation |
|---|---|---|---|
| W-1 | **Native model selection across the GitHub model catalog** | No per-provider API key management; Copilot subscription covers GPT-5/Claude/Gemini/Grok/etc. via a single login | [Settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings) + Phase 4d §1 |
| W-2 | **`.agent.md` shipped via VSIX / Agent Plugins** | A single install delivers a vault-equivalent mode set; works alongside team-shared `.github/agents/` | Phase 4d §4 ([Agent plugins doc](https://code.visualstudio.com/docs/copilot/customization/agent-plugins)) |
| W-3 | **First-class `.prompt.md` slash commands** | Reusable, named one-shot prompts with frontmatter `agent:` binding — Roo has no equivalent | Phase 4b §1 |
| W-4 | **Built-in MCP discovery + `${input:…}` secret hygiene** | Workspace-committable `mcp.json` with first-run secret prompts → Windows Credential Manager; no gitignore split needed | Phase 4c §3 |
| W-5 | **Native AGENTS.md / CLAUDE.md / GEMINI.md cross-tool support** | Same instruction files work for Copilot, Claude Code, Gemini CLI, and Codex without duplication | Phase 4a §4 (Custom Instructions) |
| W-6 | **Cloud-agent runs (Copilot coding agent) using the same `.agent.md`** | Background coding sessions that produce PRs, sharing the local agent definitions | Phase 4d §10 + [docs.github.com — create custom agents](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents) |
| W-7 | **Parallel sub-agents + multi-model consensus** | A single coordinator can run reviews from several models in parallel and synthesize — Roo cannot do this at all | Phase 4d §8.4 |
| W-8 | **Checkpoints + Edit Previous Request + Fork Conversation** | Per-request file snapshots with one-click restore, plus conversation forking — Roo only has linear task history | Phase 4d §4 ([chat-checkpoints doc](https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints)) |
| W-9 | **Per-tool URL approval with separate pre/post review** | `approveRequest` (don't send to a domain) and `approveResponse` (don't ingest from a domain) protect against prompt-injection on otherwise-trusted sites | Phase 4d §6 |
| W-10 | **Org-managed enterprise policies** | `chat.agent.enabled`, `chat.tools.global.autoApprove`, `chat.agent.networkFilter`, `chat.tools.eligibleForAutoApproval`, `chat.plugins.enabled` are device-management-policy-enforceable for Copilot Business / Enterprise | [agent-tools doc](https://code.visualstudio.com/docs/copilot/agents/agent-tools) |
| W-11 | **Single unified chat panel** | Vs Roo's separate panel — one place for Ask, Plan, Agent, custom agents, sub-agents, CLI hand-off, cloud hand-off | Phase 4d §5 |
| W-12 | **Hand-off between agent types (Local → CLI → Cloud)** | The same chat session can carry conversation history into a CLI worktree run or a cloud-agent PR session | [agents overview](https://code.visualstudio.com/docs/copilot/agents/overview) |

#### Net assessment — feeds Phase 6

- **Blocker count:** 1 (`fileRegex` per-mode edit guard).
- **Major count:** 3 (per-mode rules folder, workspace-scoped tool sets, chat-history export, plus G-13 if the user relies on non-Copilot models).
- **Minor count:** ≥ 6 (sequential `new_task` parity, webview UI, 128-cap, sync, multi-profile, return-payload shape, sandbox-Windows).
- **Wins:** ≥ 12 covering model selection, plugin distribution, prompt files, cross-tool instructions, cloud-agent reuse, multi-agent orchestration, security policies, and unified UX.

**Migration headline:** the gap profile **does not justify staying on Roo** purely on capability grounds — only the `fileRegex` blocker is a hard loss, and it has a workable (prose-instruction) mitigation. The wins, especially `.agent.md` cross-tool reuse and parallel sub-agents, materially expand the user's capability surface. This feeds directly into Phase 6's gap matrix and Phase 7's path recommendation.

## Cross-links

- [`00-plan.md`](00-plan.md) · [`50-copilot-cli-research.md`](50-copilot-cli-research.md) · [`60-gap-analysis.md`](60-gap-analysis.md)
