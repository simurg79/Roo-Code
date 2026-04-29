---
phase: 5
status: complete
owner: architect-subtask
last_updated: 2026-04-26
sources:
  - https://www.npmjs.com/package/@github/copilot
  - https://www.npmjs.com/package/@github/copilot-sdk
  - https://github.com/github/copilot-sdk
  - https://github.com/github/copilot-sdk/blob/main/nodejs/README.md
  - https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md
  - https://github.com/github/copilot-sdk/blob/main/CHANGELOG.md
  - https://github.com/github/copilot-sdk/releases
  - https://github.com/github/copilot-sdk/pull/272
  - https://github.com/github/copilot-sdk/pull/868
  - https://github.com/github/copilot-sdk/pull/881
  - https://docs.github.com/en/copilot/how-tos/copilot-sdk/sdk-getting-started
  - https://github.blog/changelog/2026-04-02-copilot-sdk-in-public-preview/
  - https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-custom-instructions
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-custom-agents
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-skills
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks
  - https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
  - https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
  - https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference
  - https://docs.github.com/en/copilot/reference/hooks-configuration
  - https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks
  - https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference
  - https://github.com/github/copilot-cli
  - https://github.com/github/copilot-cli/issues/2392
  - https://github.com/github/copilot-cli/issues/2540
  - https://github.com/github/copilot-cli/issues/2893
  - https://github.com/github/copilot-cli/issues/2013
  - https://github.com/github/copilot-cli/issues/52
  - https://github.com/github/copilot-cli/issues/978
  - https://github.com/microsoft/vscode-copilot-release/issues/14131
  - https://github.com/anthropics/claude-code/issues/18737
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
  - https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
  - https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/custom-skills
  - https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/streaming-events
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/quickstart
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/automate-with-actions
  - https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/sdk-and-cli-compatibility
  - https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry
  - https://agentskills.io/
---

<!-- Phase 5 complete (5a + 5b-i + 5b-ii-A + 5b-ii-B-1 + 5b-ii-B-2) 2026-04-26 -->

# Phase 5 — GitHub Copilot CLI Research

> Parent plan: [`00-plan.md`](00-plan.md) · Index: [`README.md`](README.md)

**What this file is for:** Mirror of [`40-copilot-chat-research.md`](40-copilot-chat-research.md) but for the **GitHub Copilot CLI** — specifically the standalone agentic CLI distributed as the npm package [`@github/copilot`](https://www.npmjs.com/package/@github/copilot), **not** the legacy `gh copilot` extension. Each section starts with a `Sources` subsection.

## 0. Identity & Disambiguation

### Sources

- [`npmjs.com/package/@github/copilot`](https://www.npmjs.com/package/@github/copilot) — current CLI (v1.0.36 at access time). Accessed 2026-04-26.
- [`npmjs.com/package/@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) — companion TypeScript SDK (v0.3.0). Accessed 2026-04-26.
- [`docs.github.com — about-copilot-cli`](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli) — official concepts overview. Accessed 2026-04-26.
- [`github.com/github/copilot-cli`](https://github.com/github/copilot-cli) — public issue/release tracker (binary is closed-source; only release artefacts and the SDK source are public).

### Findings (2026-04-26)

> ⚠️ **Naming-collision warning that supersedes the file's original brief.** The Phase-5 file template uses the phrase *"`gh copilot` and/or the standalone Copilot CLI agent"*. As of 2026-04-26 these are **two different products**:
>
> | Product | Package / Distribution | Binary | Status |
> |---|---|---|---|
> | **Copilot CLI** (this research) | `@github/copilot` (npm), `winget install GitHub.Copilot`, `brew install --cask github-copilot` | `copilot` | GA, agentic, default model Claude Sonnet 4.5 |
> | Legacy `gh-copilot` extension | `gh extension install github/gh-copilot` | `gh copilot suggest` / `gh copilot explain` | Maintenance-only; non-agentic; *not* the migration target |
>
> All findings below refer to the **standalone agentic CLI** (`@github/copilot`). Where this document says "the CLI" without qualification, it means `@github/copilot` v1.0.36.

The CLI is a **closed-source Node application** distributed via npm; the public [`github/copilot-cli`](https://github.com/github/copilot-cli) repo carries release notes and an issue tracker but no source. The companion **SDK** [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) is open-source (MIT) TypeScript and ships a programmatic embedding surface (`CopilotClient`, `CopilotSession`, `defineTool`, …); see § 5 below.

The CLI implements the **Agent Client Protocol (ACP)** as a server (`copilot acp`) so editors and other clients can drive it as a backend agent.

---

## 1. Install & Authentication

### Sources

- [`docs.github.com — install-copilot-cli`](https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli). Accessed 2026-04-26.
- [`npmjs.com/package/@github/copilot`](https://www.npmjs.com/package/@github/copilot) — Install section + system requirements. Accessed 2026-04-26.
- [`docs.github.com — cli-config-dir-reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) — `COPILOT_HOME` semantics, OS-specific paths.

### Findings (2026-04-26)

#### 1.1 System requirements

- **Node.js ≥ 22** (per the CLI's npm page; the SDK README softens this to ≥ 18 but the bundled CLI hard-requires 22+).
- **Windows: PowerShell v6 or newer** (`pwsh`, not the in-box Windows PowerShell 5.1). The CLI shells out to `pwsh -Command …` for its `powershell` tool family; absence of `pwsh` results in tool-call failures even though the CLI itself launches.
- **macOS / Linux: bash or zsh** for the `bash` tool family.
- A **GitHub Copilot subscription** — Pro, Pro+, Business, or Enterprise. Free tier is **not** supported.

#### 1.2 Install methods (Windows-first)

| Method | Command | Notes |
|---|---|---|
| **winget** (recommended on Windows 11) | `winget install GitHub.Copilot` | Installs `copilot.exe`; auto-handles PATH. |
| **npm (global)** | `npm install -g @github/copilot` | Requires Node ≥ 22 already on PATH; portable across OSes. |
| **GitHub release download** | Download platform binary from [`github.com/github/copilot-cli/releases`](https://github.com/github/copilot-cli/releases) | No package-manager dependency. |
| **macOS** | `brew install --cask github-copilot` | Cask, not formula. |
| **Linux** | `curl -fsSL https://aka.ms/install-copilot-cli.sh | sh` | Auto-install script. |

Verify with `copilot --version` (prints CLI + bundled SDK versions and Node runtime).

#### 1.3 Authentication

The CLI supports three auth flows, evaluated in this **precedence order** (first non-empty wins):

1. **`COPILOT_GITHUB_TOKEN`** environment variable.
2. **`GH_TOKEN`** environment variable (shared with `gh` CLI).
3. **`GITHUB_TOKEN`** environment variable (shared with GitHub Actions).
4. **OAuth device flow** via the interactive `/login` slash command — opens the user's default browser, prompts for the device code, stores the resulting token in the **OS keychain** (Windows Credential Manager on Win11; macOS Keychain; libsecret on Linux). Set `storeTokenPlaintext: true` in `~/.copilot/settings.json` to fall back to a plaintext token file (not recommended).

**Token-type requirements:**
- For PAT-based auth (env-var route), tokens must be **fine-grained PATs** with the **Copilot Requests** permission. Classic `ghp_…` PATs are **not accepted**.
- For GitHub Enterprise Cloud with Data Residency, set `--host` or `GH_HOST` / `COPILOT_GH_HOST` (e.g., `--host github.acme.ghe.com`).

Logout: `/logout` slash command (clears keychain entry); env-var-based auth ignores `/logout`.

#### 1.4 Subscription tiers — feature gating

All paid Copilot tiers can run the CLI. Differences observed:
- **Pro** — single-user; default models (Claude Sonnet 4.5, GPT-5, Claude Opus 4.x); standard request quota.
- **Pro+** — adds higher-tier models (Opus 4.7) and increased monthly request budget.
- **Business / Enterprise** — adds **org policies** (model allowlists, MCP server allowlists, disable-hooks toggles); these are enforced fail-closed by the CLI.

---

## 2. Storage Locations (Windows)

### Sources

- [`docs.github.com — cli-config-dir-reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference). Accessed 2026-04-26.
- [`npmjs.com/package/@github/copilot`](https://www.npmjs.com/package/@github/copilot) — "Configuration directory" section.

### Findings (2026-04-26)

#### 2.1 Path layout

| Purpose | Default (Windows 11) | Override mechanism |
|---|---|---|
| **Config root** | `%USERPROFILE%\.copilot\` | `COPILOT_HOME` env var **or** `--config-dir <path>` CLI flag (per-invocation) |
| **Cache** (model responses, downloaded resources) | `%LOCALAPPDATA%\copilot\` | not user-configurable |
| Keychain entry | Windows Credential Manager: target `github.com:copilot-cli` | n/a |
| Logs | `%USERPROFILE%\.copilot\logs\` | follows `COPILOT_HOME` |

**`COPILOT_HOME` redirects every config sub-path** (settings, agents, skills, instructions, hooks, MCP, sessions). This is the integration hook for the user's vault — see § 6.4.

#### 2.2 Contents of `~/.copilot/`

```text
~/.copilot/
├── settings.json                  ← global settings (cascaded by repo + local)
├── copilot-instructions.md        ← always-on global instructions
├── instructions/                  ← *.instructions.md modular instructions
│   └── *.instructions.md
├── agents/                        ← user-scope custom agents (.agent.md or .md)
│   └── <slug>.agent.md
├── skills/                        ← user-scope skills (each in own subdir w/ SKILL.md)
│   └── <skill-name>/
│       └── SKILL.md
├── hooks/                         ← user-scope hooks.json or hooks.d/*.json
│   └── hooks.json
├── mcp-config.json                ← user-scope MCP servers
├── plugins/                       ← installed plugins
├── session-state/                 ← per-session event logs and checkpoints
│   └── <session-id>/
│       ├── events.jsonl
│       ├── workspace.yaml
│       ├── plan.md
│       ├── checkpoints/
│       └── files/
├── session-store.db               ← SQLite FTS5 index for /resume search
├── logs/
└── auth/                          ← (only if storeTokenPlaintext: true)
```

#### 2.3 Settings cascade

```text
~/.copilot/settings.json                    (user-global)
   └─► .github/copilot/settings.json        (repository, committed)
        └─► .github/copilot/settings.local.json   (per-clone, gitignored)
```

Each subsequent layer **deep-merges** over the previous. The repository layer only honours a small allowlist of keys: `companyAnnouncements`, `disableAllHooks`, `enabledPlugins`, `extraKnownMarketplaces`, `hooks`, `mergeStrategy`. All other repo-level keys are ignored (security guard against arbitrary settings injection from cloned repos).

A **legacy `config.json`** in the same locations is auto-migrated to `settings.json` on first run.

#### 2.4 What's safe to delete

| Path | Safe to delete? | Effect |
|---|---|---|
| `session-state/<id>/` | ✅ | Forgets that session; `--resume` will not find it. |
| `session-store.db` | ✅ | Index is rebuilt from `session-state/` on next launch. |
| `logs/` | ✅ | No effect. |
| `cache` (`%LOCALAPPDATA%\copilot\`) | ✅ | Re-downloads on next use. |
| `settings.json`, `mcp-config.json`, `agents/`, `skills/`, `instructions/` | ❌ | Loses user customisation. |
| `auth/` (or keychain entry) | ⚠️ | Forces re-login. |

---

## 3. Agent Loop

### Sources

- [`docs.github.com — about-copilot-cli`](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli) — modes, infinite sessions, BYOK. Accessed 2026-04-26.
- [`docs.github.com — cli-best-practices`](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices). Accessed 2026-04-26.
- [`docs.github.com — cli-command-reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference). Accessed 2026-04-26.
- [`docs.github.com — run-cli-programmatically`](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically). Accessed 2026-04-26.

### Findings (2026-04-26)

#### 3.1 Modes (Standard / Plan / Autopilot)

The CLI exposes **three execution modes**, cycled with **Shift+Tab** in interactive mode or pinned via `--mode=plan|interactive|autopilot`:

| Mode | Approval policy | Iteration cap | Use case |
|---|---|---|---|
| **Standard** (default) | Prompts on every tool call requiring `write` / `shell` / network | Unbounded (interactive) | Human-in-the-loop coding |
| **Plan** | Read-only; tool calls that would mutate state are converted to plan entries | Single planning pass | Pre-flight design; `/plan` slash command equivalent |
| **Autopilot** | Auto-approves anything matching the active allowlist; **does not** auto-approve outside it | Capped by `--max-autopilot-continues` (default ~25) | CI / scripted runs |

**Plan mode** writes a structured `plan.md` to `session-state/<id>/plan.md` and terminates without executing it. The user (or a follow-up `--continue`) executes it.

**Autopilot** + `/fleet` enables parallel sub-task fan-out.

#### 3.2 The control loop (per turn)

1. Read user prompt (interactive) or `--prompt` (programmatic).
2. Run **`userPromptSubmitted`** hooks (can mutate or block the prompt).
3. Compose system prompt from the cascade (§ 4) plus the active agent's body (§ 6).
4. LLM produces a thinking → tool-call → result cycle:
   - For each tool call: check **permission** (allow/deny/prompt) per the `Kind(argument)` pattern.
   - Run **`preToolUse`** hooks (HTTPS-required if `allowedEnvVars` is non-empty; can deny).
   - Execute tool.
   - Run **`postToolUse`** hooks (or `postToolUseFailure` on error).
5. Repeat 4 until the model emits a final answer or hits an iteration / token limit.
6. Run **`agentStop`** hook.
7. **Auto-compact** the conversation if context usage ≥ 95% (configurable); else persist new events to `session-state/<id>/events.jsonl`.

#### 3.3 Permission system

Permissions are matched as `Kind(argument)` patterns:

| Kind | Examples | Notes |
|---|---|---|
| `shell` | `shell(git status)`, `shell(git:*)`, `shell(npm test)` | `:*` matches `git ` plus any args (stem with trailing space). |
| `write` | `write`, `write(./src/**)`, `write(/tmp/**)` | Glob over absolute or workspace-relative paths. |
| `read` | same as `write` | Rarely needed (reads default-allowed in standard mode). |
| `url` | `url(https://api.github.com/**)`, `url(github.com)` | Matched on the fetch target. |
| `memory` | `memory` | The `memory` built-in tool. |
| `<MCP-server-name>` | `MyMcp(*)`, `Trello(create_card)` | One scope per registered MCP server; tool-name level filtering. |

Allow/deny lists are settable at: (a) `settings.json` (`allowedTools` / `deniedTools` arrays), (b) per-invocation `--allow-tool='shell(git:*)'` / `--deny-tool='shell(git push)'`, (c) the broad escape hatches `--allow-all-tools`, `--allow-all-paths`, `--allow-all-urls`, `--yolo` (== all three).

**Deny wins over allow** when both match.

#### 3.4 Programmatic / headless invocation

```cmd
copilot -p "summarize CHANGELOG.md" --allow-tool="read" --no-ask-user --output-format=json
```

Key flags for scripting:

| Flag | Effect |
|---|---|
| `-p, --prompt <text>` | One-shot prompt; CLI exits after the model completes. |
| `-s, --silent` | Suppress all chrome; emit only the final answer (or JSONL if combined with `--output-format`). |
| `--no-ask-user` | Disable the `ask_user` interactive tool (model can't pause for input). |
| `--allow-tool=PATTERN` | Repeatable; expand allowed-tool set. |
| `--deny-tool=PATTERN` | Repeatable; expand denied-tool set. |
| `--allow-all-tools` | ⚠️ Allow every tool, including `shell(*)`. |
| `--allow-all-paths` / `--allow-all-urls` | Looser scope variants. |
| `--yolo` | Equivalent to all three "all" flags. |
| `--mode=plan|interactive|autopilot` | Pin a mode. |
| `--max-autopilot-continues=N` | Cap auto-iterations (default ~25). |
| `--output-format=text|json` | `json` emits **JSONL** events (one JSON object per line). |
| `--share=<path>` / `--share-gist` | Persist a shareable transcript. |
| `--config-dir=<path>` | Per-invocation `COPILOT_HOME` override. |
| `--additional-mcp-config=JSON|@file` | Session-only MCP server definitions. |
| `--add-dir=<path>` | Add a workspace root (multi-repo). |
| `--agent=<name>` | Boot the session under a specific custom agent. |
| `--model=<name>` | Override default (Claude Sonnet 4.5). Special: `auto`, `claude-opus-4.5`, `claude-opus-4.7`, `gpt-5`, `gpt-5.2-codex`. |

Exit codes: `0` success; non-zero on tool-permission denial (with `--no-ask-user`), auth failure, or context-cap exceeded with no producible answer.

#### 3.5 Sessions, resume, infinite context

- Every session gets a UUID and is stored under `session-state/<id>/`.
- **Auto-compaction** at ~95% context preserves a summary + recent events; the running task continues without interruption ("infinite sessions").
- Resume:
  - `copilot --continue` — resumes the **most recent session in the current cwd**.
  - `copilot --resume` — interactive picker over all sessions.
  - `copilot --resume <id-or-name>` — non-interactive resume.
  - In-session: `/resume`, `/rename <name>`, `/session`.
- The `session-store.db` SQLite FTS5 index powers free-text search across events and plan files.

#### 3.6 Built-in tool surface

Tools available to the model by default (subject to permission gating):

| Group | Tools |
|---|---|
| **Shell** | `bash`, `bash_list`, `bash_read`, `bash_stop`, `bash_write` (POSIX); `powershell`, `powershell_list`, `powershell_read`, `powershell_stop`, `powershell_write` (Windows) |
| **Files** | `apply_patch`, `create`, `edit`, `view`, `glob`, `grep` (rg-backed), `show_file` *(experimental)* |
| **Task delegation** | `task` (dispatch a sub-agent), `list_agents`, `read_agent` |
| **User interaction** | `ask_user` (suppressed by `--no-ask-user`) |
| **Web / network** | `web_fetch` (subject to `url(...)` permission and the SSRF allowlist) |
| **Skills** | `skill` (invoke a registered skill) |
| **Memory** | `memory` (write/read/delete persistent notes; gated by the `memory` permission) |
| **MCP** | One synthetic tool per MCP-server tool, namespaced as `<server>(<tool>)` |

#### 3.7 Comparison to Roo's loop

| Axis | Roo-Code | Copilot CLI |
|---|---|---|
| Default loop shape | Sequential ReAct + `new_task` boomerang | ReAct + `task` sub-agent dispatch (parallel-capable) |
| Per-mode tool restriction | `groups` array + `fileRegex` | `.agent.md` `tools:` array + `--allow-tool` / `--deny-tool` (no `fileRegex` equivalent) |
| Per-mode MCP allowlist | `allowedMcpServers: [...]` | `tools: ["MyServer/*"]` (or `--allow-tool='MyServer(*)'`) |
| Iteration cap | None enforced; relies on prose | `--max-autopilot-continues` (autopilot only) |
| Auto-compaction | None (manual `/clear`-equivalent in webview) | Yes, at ~95% context, automatic |
| Headless / scriptable | Indirect (VS Code ext only) | First-class (`-p`, exit codes, JSONL) |
| Approval UX | Per-tool prompt in webview | Per-tool prompt in TTY; allow/deny lists; modes |

---

## 4. Custom Instructions

### Sources

- [`docs.github.com — use-custom-instructions`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-custom-instructions). Accessed 2026-04-26.
- [`docs.github.com — cli-config-dir-reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) — file-discovery rules.
- [`docs.github.com — cli-best-practices`](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices) — system-prompt customisation modes.

### Findings (2026-04-26)

#### 4.1 Discovery cascade

The CLI loads instructions from **all** of these locations and **concatenates** them (no priority fallback — every match is included):

| Scope | Path | Notes |
|---|---|---|
| User-global, primary | `~/.copilot/copilot-instructions.md` | Always-on across every project. |
| User-global, modular | `~/.copilot/instructions/*.instructions.md` | Each file may declare an `applyTo:` glob in YAML frontmatter. |
| Repository, primary | `.github/copilot-instructions.md` | Cross-tool standard (Copilot Chat reads the same file). |
| Repository, modular | `.github/instructions/**/*.instructions.md` | Same `applyTo:` semantics. |
| Workspace root | `AGENTS.md` | The cross-tool ["AGENTS.md" convention](https://agents.md/). |
| Workspace root (compat) | `Copilot.md`, `GEMINI.md`, `CODEX.md`, `CLAUDE.md` | Read iff present, for cross-tool portability. |

#### 4.2 System-prompt customisation modes

The `systemPrompt` setting in `settings.json` controls how user instructions interact with the built-in system prompt:

| Mode | Behaviour |
|---|---|
| `default` | User instructions are **appended** to the built-in prompt. |
| `customize` | User can **override individual sections** by name: `identity`, `tone`, `tool_efficiency`, `environment_context`, `code_change_rules`, `guidelines`, `safety`, `tool_instructions`, `custom_instructions`, `last_instructions`. Unspecified sections fall through to the default. |
| `replace` | Full override of the system prompt (advanced; risk of breaking tool calling). |

#### 4.3 Implications for the vault

- **The vault's per-mode rules folders (`.roo/rules-<mode>/`) have no first-class CLI equivalent.** Same gap as Copilot Chat (Q-018). Recommended pattern: inline rules into each `.agent.md` body (§ 6) or compose via an `applyTo:`-globbed `.instructions.md`.
- **Vault-wide global rules survive cleanly** by symlinking `~/.copilot/copilot-instructions.md` → `<vault>/global-settings/copilot-instructions.md` (mirrors the Roo `~/.roo/rules/` pattern).
- **`AGENTS.md` is shared with Copilot Chat** — single source of truth for cross-tool rules.

---

## 5. Custom Agents (`--agent`, `.agent.md`)

### Sources

- [`docs.github.com — use-custom-agents`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-custom-agents). Accessed 2026-04-26.
- [`docs.github.com — cli-command-reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) — `/agent` slash command, built-in agent list.
- [`npmjs.com/package/@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) — SDK-side agent registration.

### Findings (2026-04-26)

#### 5.1 Discovery & precedence

The CLI scans for agent files in this order (later overrides earlier when names collide):

1. **Plugin agents** (lowest priority) — bundled by installed plugins.
2. **User agents** — `~/.copilot/agents/*.agent.md` (and `*.md`); plus `~/.claude/agents/*.md` (Claude format).
3. **Project agents** (highest priority) — `.github/agents/*.agent.md`; plus `.claude/agents/*.md`.

Built-in agents (always available, can be overridden by name): `code-review`, `configure-copilot`, `explore`, `general-purpose`, `research`, `rubber-duck`, `task`.

Selection: `copilot --agent=<name>` boots the session under that agent; `/agent <name>` switches mid-session; `task(agent="<name>", prompt="…")` dispatches a sub-agent. Default sub-agent depth limit = 6; default concurrency = 32.

#### 5.2 Frontmatter schema (CLI flavour)

```yaml
---
name: code-reviewer            # optional; defaults to filename
description: Reviews diffs and flags issues   # required
model: claude-opus-4.7         # optional; falls back to session model
tools: [view, grep, glob, web_fetch, github-mcp-server/*]   # optional allowlist
mcp-servers: [github-mcp-server, my-internal-mcp]           # optional MCP allowlist
infer: true                    # optional; legacy — replaced by user-invocable
---

# Body — Markdown system prompt prepended to user turns
You are a senior code reviewer. ...
```

Supported fields (per CLI docs): `description` (required), `name`, `model`, `tools`, `mcp-servers`, `infer`. **The CLI flavour is a strict subset of the VS Code `.agent.md` schema** (no `agents:`, `handoffs:`, `target:`, `argument-hint:`, `user-invocable:`, `disable-model-invocation:` — those are VS Code extensions). Dual-target authoring is therefore safe: a CLI-valid `.agent.md` is also a valid VS Code agent (the extra fields are simply unused).

#### 5.3 Slash commands relevant to agents

`/agent`, `/agent <name>`, `/delegate`, `/fleet`, `/list-agents`, `/init` (scaffold a new agent in `.github/agents/`).

#### 5.4 Mapping the vault's 17 modes onto CLI agents

Each entry in `<roo-vault>/global-settings/custom_modes.yaml` (slug + name + roleDefinition + customInstructions + groups + allowedMcpServers) maps mechanically:

| `.roomodes` field | `.agent.md` equivalent | Notes |
|---|---|---|
| `slug` | filename `<slug>.agent.md` | |
| `name` | `name:` frontmatter | |
| `roleDefinition` + `customInstructions` | Body of the `.agent.md` | Concatenated. |
| `groups` (`read`, `edit`, `command`, `mcp`, `browser`) | `tools:` array | `read` → `view`, `glob`, `grep`. `edit` → `apply_patch`, `create`, `edit`. `command` → `bash`/`powershell` family. `browser` → `web_fetch`. `mcp` → enumerate `<server>/*`. |
| `groups[].fileRegex` | **No equivalent** | Lossy; must be enforced via prose ("only edit files matching …") or a `preToolUse` hook on `write`. (Same as Chat G-1.) |
| `allowedMcpServers: [...]` | `mcp-servers:` + `tools: ["<server>/*", ...]` | `[]` means "no MCP" → omit all server entries. |
| `whenToUse` | Not represented | Discoverability is via `/agent` picker only. |

---

## 6. Squad Cross-Reference

### Sources

- [`30-squad-inventory.md`](30-squad-inventory.md) — Phase-3 Squad findings.
- [`../squad/.copilot/mcp-config.json`](../../../../squad/.copilot/mcp-config.json) — actual squad MCP config.
- [`../squad/packages/squad-sdk/package.json`](../../../../squad/packages/squad-sdk/package.json) — confirms `@github/copilot-sdk` dependency.
- [`../squad/README.md`](../../../../squad/README.md) — invocation pattern `copilot --agent squad`.

### Findings (2026-04-26)

Squad does not replace the CLI — it **drives** the CLI via the SDK and registers itself as a custom agent (`copilot --agent squad`). Concrete observations from the squad workspace:

#### 6.1 Squad's `.copilot/` layout

```text
../squad/.copilot/
├── mcp-config.json     ← project-scoped MCP servers (CLI honours this for the squad workspace)
└── skills/             ← project-scoped skills
```

> ⚠️ **Non-standard MCP location.** The CLI documentation establishes `.github/mcp.json` and the user-global `~/.copilot/mcp-config.json` as the canonical project / user MCP locations. Squad uses **`.copilot/mcp-config.json` at the project root** — which is the **user-format file in a project-scope directory**. The CLI does load this when launched from the squad workspace because `COPILOT_HOME` is implicitly `.copilot/` for that project (squad's launcher sets it). This is a squad-specific convention, not a CLI default. **New question opened (Q-031).**

The squad sample `mcp-config.json` confirms the user-format MCP schema (`mcpServers` map; per-server `command`/`args`/`env` with `${VAR}` substitution):

```json
{
  "mcpServers": {
    "EXAMPLE-trello": {
      "command": "npx",
      "args": ["-y", "@trello/mcp-server"],
      "env": {
        "TRELLO_API_KEY": "${TRELLO_API_KEY}",
        "TRELLO_TOKEN":   "${TRELLO_TOKEN}"
      }
    }
  }
}
```

`${VAR}` is substituted from the **process environment** (not from a `.env` file unless the squad launcher loads one) — analogous to VS Code Copilot Chat's `${input:…}` but **without** the keychain-prompt UX. Secrets must therefore be set in the parent shell or in `.copilot/.env` (gitignored).

#### 6.2 Squad ↔ `vscode.lm` (resolves Q-010)

Squad depends only on `@github/copilot-sdk` ([`../squad/packages/squad-sdk/package.json`](../../../../squad/packages/squad-sdk/package.json)). It has **no** `vscode.lm`, `vscode`, or `@vscode/*` dependency. Squad is **strictly external CLI-driven** and cannot be embedded in a VS Code extension as-is.

#### 6.3 What squad adds on top of the CLI

| CLI primitive | Squad layer on top |
|---|---|
| `task` sub-agent dispatch | `fan-out`, `wave-dispatch`, `fleet-dispatch` parallel orchestrators |
| `--continue` / `--resume` | Persistent named agents with markdown state in `.squad/` |
| `--prompt` one-shot | Ralph watch-mode (file-watcher → re-prompt loop) |
| `~/.copilot/agents/` user agents | Casting registry (named-agent factory in `.squad/casting.md`) |

#### 6.4 Vault integration sketch

The vault's symlink-and-commit pattern can be mirrored on the CLI side via `COPILOT_HOME`:

```powershell
# Per-project bootstrap (added to setup-vault.ps1)
$projectRoot = "C:\git\<project>"
$vaultCli    = "C:\git\roo-vault\global-settings\copilot"
[Environment]::SetEnvironmentVariable("COPILOT_HOME", $vaultCli, "User")

# Or per-invocation:
copilot --config-dir "C:\git\roo-vault\global-settings\copilot" --agent code "$@"
```

This makes the vault's `agents/`, `instructions/`, `skills/`, `hooks/`, and `mcp-config.json` portable across machines without the per-profile-id complexity that VS Code Copilot Chat requires (Q-026).

---

## 7. SDK (`@github/copilot-sdk`) — Full Export Catalogue (Phase 5b-ii-B-1)

### Sources

- [`npmjs.com/package/@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) — package readme + API reference (v0.3.0 at access). Accessed 2026-04-26.
- [`github.com/github/copilot-sdk`](https://github.com/github/copilot-sdk) — public monorepo (Node, Go, .NET, Java, Python). Accessed 2026-04-26.
- [`github/copilot-sdk/blob/main/nodejs/README.md`](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md) — canonical Node.js API surface. Accessed 2026-04-26.
- [`github/copilot-sdk/blob/main/docs/getting-started.md`](https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md) — quickstart + custom-tool walkthrough. Accessed 2026-04-26.
- [`github/copilot-sdk/blob/main/CHANGELOG.md`](https://github.com/github/copilot-sdk/blob/main/CHANGELOG.md) — versioning & breaking-change history. Accessed 2026-04-26.
- [`github/copilot-sdk/releases`](https://github.com/github/copilot-sdk/releases) — release notes. Accessed 2026-04-26.
- [`docs.github.com — sdk-getting-started`](https://docs.github.com/en/copilot/how-tos/copilot-sdk/sdk-getting-started). Accessed 2026-04-26.
- [`github.blog — Copilot SDK in public preview (2026-04-02)`](https://github.blog/changelog/2026-04-02-copilot-sdk-in-public-preview/). Accessed 2026-04-26.
- [`docs.github.com — sdk-and-cli-compatibility`](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/sdk-and-cli-compatibility). Accessed 2026-04-26.
- Ground-truth Squad source: [`../squad/packages/squad-sdk/src/adapter/client.ts`](../squad/packages/squad-sdk/src/adapter/client.ts), [`../squad/packages/squad-sdk/src/adapter/types.ts`](../squad/packages/squad-sdk/src/adapter/types.ts), [`../squad/packages/squad-sdk/src/build/bundle.ts`](../squad/packages/squad-sdk/src/build/bundle.ts), [`../squad/packages/squad-cli/src/cli-entry.ts`](../squad/packages/squad-cli/src/cli-entry.ts).

### 7.1 Package identity

| Attribute | Value | Source |
|---|---|---|
| npm name | `@github/copilot-sdk` | npm page |
| Latest version | **v0.3.0** (54 versions; 134 dependents at access) | npm page |
| License | **MIT** | npm "License" panel + `nodejs/README.md` |
| Stability tier | **Public preview / alpha (`0.x`)** — *"While in public preview, minor breaking changes may still occur between releases"* (sister `copilot-sdk-java` releases note, mirrored across all language SDKs in the monorepo) | Java release page; reinforced by GA blog of 2026-04-02 |
| Node requirement | Node **20+** (typical for the 0.x line; Node 24+ has a known broken-ESM-import workaround patched at runtime by Squad — see [`squad-cli/src/cli-entry.ts`](../squad/packages/squad-cli/src/cli-entry.ts) lines 25–28) | Squad cli-entry comment + GitHub issues |
| Install | `npm install @github/copilot-sdk` (auto-installs the underlying CLI on first `client.start()` unless `cliPath`/`cliUrl` is set) | docs.github.com quickstart |
| Languages | Node.js, Go, .NET, Java, Python (sibling packages in the same monorepo) | repo top-level |
| Runtime deps | 3 (lean) — `vscode-jsonrpc` is the load-bearing one (JSON-RPC transport to the CLI subprocess) | npm "Dependencies" tab |

> *"The Copilot SDK provides language-specific wrappers for programmatic access to the GitHub Copilot CLI."* — towardsai.net summary, corroborating that the SDK **does not contain a model client of its own** — it speaks JSON-RPC to a spawned (or remote) CLI process.

### 7.2 Public exports — Node.js surface

Sourced from the [npm readme](https://www.npmjs.com/package/@github/copilot-sdk) and [`nodejs/README.md`](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md). "✅ doc" = explicitly named in the README API reference; "🟡 inferred" = visible in Squad's import/usage but not headline-documented.

#### Session / agent loop

| Export | Kind | Purpose | Status |
|---|---|---|---|
| `CopilotClient` | class | Top-level client; spawns or connects to the CLI. Constructor: `{ cliPath?, cliArgs?, cliUrl?, cwd?, port?, useStdio?, logLevel?, autoStart?, env?, githubToken?, useLoggedInUser?, telemetry? }`. | ✅ doc |
| `CopilotSession` | class | Per-conversation driver returned by `createSession`. Properties `sessionId`, `workspacePath`, `capabilities`, `ui`. | ✅ doc |
| `client.start()` / `stop()` / `forceStop()` | method | Lifecycle (`start: Promise<void>`, `stop: Promise<Error[]>`, `forceStop: Promise<void>`). | ✅ doc |
| `client.createSession(config)` | method | Required `onPermissionRequest`; optional `model`, `reasoningEffort` (`low|medium|high|xhigh`), `tools`, `systemMessage`, `infiniteSessions`, `provider`, `hooks`, `onUserInputRequest`, `onElicitationRequest`, `sessionId`. | ✅ doc |
| `client.resumeSession(id, config?)` | method | Resume by id; `workspacePath` populated when infinite sessions enabled. | ✅ doc |
| `client.listSessions(filter?)` | method | Returns `SessionMetadata[]` (`sessionId`, `startTime`, `modifiedTime`, `summary`, `isRemote`, `context`). | ✅ doc |
| `client.deleteSession(id)` / `getForegroundSessionId()` / `setForegroundSessionId(id)` | method | Session admin. | ✅ doc |
| `client.getLastSessionId()` / `getStatus()` / `getAuthStatus()` / `listModels()` / `ping(msg?)` | method | CLI introspection. | ✅ doc (used by Squad's [`adapter/client.ts:639–748`](../squad/packages/squad-sdk/src/adapter/client.ts:639)) |
| `session.send(opts)` / `sendAndWait(opts, timeout?)` | method | Streaming vs. await-final. | ✅ doc |
| `session.abort()` / `disconnect()` / `getMessages()` | method | Session control + replay. | ✅ doc |
| `session.destroy()` | method | Deprecated alias for `disconnect()`. | ✅ doc (deprecated) |

#### Tools (custom + built-in)

| Export | Purpose |
|---|---|
| `defineTool(name, { description, parameters: ZodSchema, handler })` | Type-safe custom tool registration. Tools become available to the model and route back to your handler when invoked. |
| `Tool` (type) | Runtime type returned by `defineTool`; passed in `createSession({ tools: [...] })`. |
| Per-tool `skipPermission` / "Overriding built-in tools" | Documented patterns (named sections in the readme) that let you replace `read`/`write`/`shell`/etc. with your own handler, or pre-approve specific tools. |

> *"You can let the CLI call back into your process when the model needs capabilities you own."* — [`nodejs/README.md`](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md) "Tools" section.

#### Hooks (programmatic — orthogonal to file-based hooks of § 10)

| Export | Purpose |
|---|---|
| `SessionHooks` (config) passed via `createSession({ hooks })` | In-process hooks (TypeScript callbacks, **not** spawned commands). |
| `onPreToolUse(input)` → `{ permissionDecision: "allow"\|"deny"\|"ask", modifiedArgs?, additionalContext? }` | Same semantics as file-based `preToolUse` but runs in your Node process. |
| `onPostToolUse(input, invocation)` → `{ additionalContext? }` | Result post-processing. |
| `onUserPromptSubmitted` / `onSessionStart` / `onSessionEnd` / `onErrorOccurred` | Lifecycle callbacks (parity list with file-based hooks). |

> Direct quote from the readme:
> *"Available hooks: `onPreToolUse` … `onPostToolUse` … `onUserPromptSubmitted` … `onSessionStart` … `onSessionEnd` … `onErrorOccurred`."*

#### MCP

| Export | Purpose |
|---|---|
| MCP servers configured **per-session** via `createSession({ mcpServers: {...} })` (not via `mcp-config.json`) | The SDK passes MCP server definitions through to the CLI subprocess. |
| `kind: "mcp"` permission requests | `onPermissionRequest` is fired for MCP tool calls; handler returns `{ kind: "approved" \| "denied" }`. |

> *"📖 Full MCP documentation → docs/features/mcp.md — Learn about local vs remote servers, all configuration options, and troubleshooting."* — getting-started.md.

⚠️ uncertain — Q-045: explicit programmatic `addMcpServer(...)` helper not visible in the README API reference; configuration appears to be declarative only via session config.

#### Model providers / BYOK

| Export | Purpose |
|---|---|
| `ProviderConfig` (type) | Passed to `createSession({ provider })`. Fields: `type?: "openai" \| "azure" \| "anthropic"` (default `"openai"`), `baseUrl`, `apiKey`, plus type-specific extras. **You must specify `model` explicitly when using a custom provider.** |
| Env-var fallback | `COPILOT_PROVIDER_BASE_URL` / `COPILOT_PROVIDER_TYPE` / `COPILOT_PROVIDER_API_KEY` / `COPILOT_MODEL` (resolves Q-030 for the CLI path; SDK inherits same env). |

> *"The SDK supports custom OpenAI-compatible API providers (BYOK - Bring Your Own Key), including local providers like Ollama. When using a custom provider, you must specify the `model` explicitly."* — readme.

#### Events / streaming

| Export | Purpose |
|---|---|
| `session.on(eventType, handler)` / `session.on(handler)` | Typed event filtering (added in [PR #272](https://github.com/github/copilot-sdk/pull/272), Node SDK). Returns an unsubscribe `() => void` (per Squad's [`adapter/client.ts:116`](../squad/packages/squad-sdk/src/adapter/client.ts:116)). |
| `client.on(eventType, handler)` / `client.on(handler)` | Client-level lifecycle (`SessionLifecycleEventType` / `SessionLifecycleHandler`). |
| Event types | Dotted-namespace strings: `assistant.message_delta`, `assistant.message`, `assistant.usage`, `assistant.reasoning_delta`, `assistant.reasoning`, `assistant.turn_start`, `assistant.turn_end`, `assistant.intent`, `session.idle`, `session.error`, plus `tool.execution_start`, `session.shutdown` (added per [PR #868](https://github.com/github/copilot-sdk/pull/868)). |
| `UnknownSessionEvent` | Forward-compat wrapper for unknown event types from newer CLI versions ([PR #881](https://github.com/github/copilot-sdk/pull/881) for .NET; same pattern across SDKs). |
| `AssistantMessageEvent` | Returned by `sendAndWait`. |

#### Auth, UI, telemetry, error handling

| Export | Purpose |
|---|---|
| `useLoggedInUser` / `githubToken` | Two auth paths (CLI's logged-in user vs. explicit token). |
| `PermissionHandler` / `PermissionRequest` / `PermissionRequestResult` | Per-tool gating. `request.kind` ∈ `shell \| write \| read \| mcp \| custom-tool \| url \| memory \| hook` (extensible — *"include a default case in handlers"*). |
| `approveAll` | Drop-in handler that approves everything (test/dev only). |
| `UserInputHandler` (`onUserInputRequest`) | Enables the `ask_user` tool. |
| `ElicitationHandler` (`onElicitationRequest`) | Lets the client present form-based dialogs; flips `session.capabilities.ui.elicitation`. |
| `session.ui` / `SessionUIApi` | UI elicitation surface (full details in readme "UI Elicitation"). |
| `TelemetryConfig` | OpenTelemetry — pass via `new CopilotClient({ telemetry })`. Spans on tool calls, hook invocations, model exchanges; supports trace-context propagation and file export. |
| Error types | Standard `Error` subclasses; readme shows `try/catch` around `session.send`. |

### 7.3 Canonical 12-line example

From the readme "Tools" section ([`nodejs/README.md`](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md), verbatim shape):

```typescript
import { z } from "zod";
import { CopilotClient, defineTool, approveAll } from "@github/copilot-sdk";

const client = new CopilotClient();              // spawns CLI via stdio
const session = await client.createSession({
  model: "gpt-5",
  onPermissionRequest: approveAll,               // required
  tools: [
    defineTool("lookup_issue", {
      description: "Fetch issue details from our tracker",
      parameters: z.object({ id: z.string() }),
      handler: async ({ id }) => fetchIssue(id), // your code
    }),
  ],
});
session.on("assistant.message_delta", (e) => process.stdout.write(e.data.delta));
await session.sendAndWait({ prompt: "Summarise issue ABC-123." });
await client.stop();
```

### 7.4 Squad's de-facto SDK usage (ground truth)

Recursive grep of `c:/git/squad/packages/**/*.ts` for `@github/copilot-sdk`:

| Squad file | What it imports | Why |
|---|---|---|
| [`squad-sdk/src/adapter/client.ts:10`](../squad/packages/squad-sdk/src/adapter/client.ts:10) | `import { CopilotClient } from "@github/copilot-sdk"` | **Only direct value-level SDK import in Squad.** Wraps `CopilotClient` in `SquadClient` for reconnection/OTel. |
| [`squad-sdk/src/adapter/types.ts`](../squad/packages/squad-sdk/src/adapter/types.ts) | (no SDK import) — defines `Squad*` mirror types (`SquadPermissionHandler`, `SquadSessionHooks`, `SquadProviderConfig`, `SquadInfiniteSessionConfig`, …). Comment at line 4: *"All Squad code should import types from this adapter layer, never directly from the Copilot SDK."* | **Insulation layer** against SDK churn. |
| [`squad-sdk/src/tools/index.ts:116`](../squad/packages/squad-sdk/src/tools/index.ts:116) | Re-implements `defineTool` (Squad-flavoured) — **not** a re-export of the SDK's `defineTool`. | Lets Squad register `squad_route`, `squad_decide`, `squad_memory`, `squad_status`, `squad_skill` at the adapter boundary. |
| [`squad-sdk/src/build/bundle.ts:34`](../squad/packages/squad-sdk/src/build/bundle.ts:34) | Lists `@github/copilot-sdk` in `DEFAULT_EXTERNAL` (esbuild externalises it). | Avoids bundling the SDK; ships as runtime peer-style dep. |
| [`squad-cli/src/cli-entry.ts:25–101`](../squad/packages/squad-cli/src/cli-entry.ts:25) | Runtime patcher for the broken `vscode-jsonrpc/node` import in `@github/copilot-sdk@0.1.32`. | Bug-workaround; loads SDK lazily on Node 24+. |
| [`squad-cli/src/cli/commands/doctor.ts:350`](../squad/packages/squad-cli/src/cli/commands/doctor.ts:350) | Health-check that validates the same ESM patch. | Defence in depth. |

**Squad pin:** `"@github/copilot-sdk": "^0.1.32"` ([`squad-sdk/package.json:235`](../squad/packages/squad-sdk/package.json:235)) — three minor versions behind current `0.3.0`. Squad's adapter layer absorbs the drift via `as Parameters<typeof this.client.createSession>[0]` casts ([`adapter/client.ts:472`](../squad/packages/squad-sdk/src/adapter/client.ts:472)).

**Surface actually exercised:** `CopilotClient` constructor + `start/stop/forceStop/createSession/resumeSession/listSessions/deleteSession/getLastSessionId/getStatus/getAuthStatus/listModels/ping/on`; `CopilotSession` `send/sendAndWait/abort/getMessages/destroy/on/sessionId`. Squad does **not** use `defineTool`, `approveAll`, `acpServer`, or the file-attachment helpers from the SDK — it re-implements them at the adapter boundary or sidesteps them. (This **corrects the Phase-5a stub** which claimed Squad uses `defineTool`.)

**Hidden / inferred surface used by Squad:** `client.on(SessionLifecycleEventType, handler)` returning an unsubscribe function (header docs above), session-event dotted naming (`assistant.message_delta`, etc. — mapped in Squad's `EVENT_MAP` at [`adapter/client.ts:48–59`](../squad/packages/squad-sdk/src/adapter/client.ts:48)), `client.stop()` returning `Error[]` (not `void`).

### 7.5 Embeddability inside a VS Code extension (Path-D signal)

| Concern | Verdict | Evidence |
|---|---|---|
| Pure-Node API surface (no DOM, no `vscode.*`) | ✅ | SDK has zero `vscode` / `vscode.lm` deps (Q-010 resolution from § 6.2). |
| Node-only runtime deps | 🟡 | Uses `vscode-jsonrpc` (Node IPC), spawns a child process via `CopilotClient.start()` (`useStdio: true` default). Both work in the **VS Code extension host** (which is full Node) but **not** in webviews. |
| Spawns the CLI binary | 🟡 | Default mode is `child_process` over stdio. Bundled CLI (`@github/copilot`) is ~tens of MB; an extension would either pin a peer-install (CLI must be on `PATH`) or ship the CLI inside the VSIX (size + signing concerns). Alternative: `cliUrl` mode connects to a remote CLI server (avoids spawning), per Squad's `useStdio: false` path. |
| Webview compatibility | 🔴 | Cannot run inside the webview process — webviews are sandboxed Chromium with no `child_process` / `fs` / `net` access. SDK calls must live in the extension host and proxy to the webview via `postMessage`. |
| Browser compatibility | 🔴 | Not a browser SDK. |
| Auth | ✅ | Honours `useLoggedInUser` (delegates to CLI's already-authenticated state) or explicit `githubToken`. The extension can defer auth to the user's existing `gh auth login`. |
| Event-loop integration | ✅ | All async, returns Promises; integrates naturally with extension activation. |

**Verdict — Path D (vault-as-VSIX): 🟡 embeddable with shim.** The SDK *can* run in the VS Code extension host, but a Path-D VSIX must (a) require the user to install `@github/copilot` separately or bundle the CLI, (b) keep all SDK calls in the extension-host process (never the webview), (c) accept process-spawn cost on every session, and (d) re-implement Roo's webview-driven UX as either chat-participant UI or webview ↔ extension-host postMessage bridge. **This nullifies the "trivially embed Squad" hope from Q-010** — Squad is structurally a CLI driver, not an embeddable library, and the SDK inherits that architecture.

### 7.6 License & versioning policy

| Dimension | Reading |
|---|---|
| License | MIT — vault-friendly. |
| Stability | **Public preview**, semver `0.x` — *"minor breaking changes may still occur between releases"* (Java release notes mirror this; Node SDK CHANGELOG documents `autoRestart` removal as a recent breaking change). |
| Cadence (rough, since v0.1.0 at end of 2025) | ~54 published versions across ~5 months; observable breaking changes per minor: removed `autoRestart`; new optional params backfilled as optional method params (C#); typed event filtering added (Node #272); new event types added (#868) — broadcast as **forward-compat duties** on the SDK consumer. |
| Compatibility | SDK ↔ CLI compatibility documented at [`docs.github.com — sdk-and-cli-compatibility`](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/sdk-and-cli-compatibility); a given SDK minor pins to a window of CLI versions. Mismatch surfaces as `protocolVersion` errors (Squad checks `client.getStatus().protocolVersion`). |
| Vault risk | 🟡 — depending on the SDK in vault automation means tracking ~monthly minor bumps. Mitigation patterns visible in Squad: (a) wrap SDK types in adapter mirrors, (b) `as Parameters<typeof …>[N]` casts for cross-version configs, (c) runtime ESM patcher for known broken imports, (d) doctor command. |

---

## 8. Roo ↔ Copilot CLI Mapping Table

### Sources

- This file §§ 1–6.
- [`10-roo-inventory.md`](10-roo-inventory.md) for Roo-side feature definitions.

### Findings (2026-04-26)

| Roo-Code feature | Copilot CLI mechanism | Parity | Notes |
|---|---|---|---|
| Built-in modes (5) | Built-in agents (7: `code-review`, `configure-copilot`, `explore`, `general-purpose`, `research`, `rubber-duck`, `task`) | 🟢 better | More built-ins; `general-purpose` covers `code` mode. |
| `.roomodes` (project) | `.github/agents/*.agent.md` (project) | 🟢 1:1 | Same precedence semantics (project beats user). |
| `~/AppData/.../custom_modes.yaml` (global) | `~/.copilot/agents/*.agent.md` | 🟢 1:1 | Single-file YAML → directory of `.agent.md` files (mechanically convertible). |
| Mode `groups` (read/edit/command/mcp/browser) | `.agent.md` `tools:` array | 🟢 1:1 | Map per § 5.4. |
| Mode `groups[].fileRegex` | None | 🔴 lost | **Same blocker as Chat G-1.** Workaround: prose + `preToolUse` hook on `write`. |
| Mode `allowedMcpServers: [...]` | `.agent.md` `tools: ["server/*"]` + `mcp-servers:` allowlist | 🟢 1:1 | Empty array → omit all. |
| Mode `whenToUse` | None | 🟡 minor | CLI relies on `/agent` picker / `--agent` flag. |
| `roleDefinition` + `customInstructions` | `.agent.md` body | 🟢 1:1 | Concatenate. |
| `~/.roo/rules/` global rules | `~/.copilot/copilot-instructions.md` + `instructions/*.instructions.md` | 🟢 1:1 | Modular `.instructions.md` ≅ Roo's per-file rules. |
| `.roo/rules/` project rules | `.github/copilot-instructions.md` + `.github/instructions/**/*.instructions.md` | 🟢 1:1 | Same cascade. |
| `.roo/rules-<mode>/` per-mode rules | None first-class | 🔴 lost | **Same as Chat G-2.** Workaround: inline into agent body. |
| `AGENTS.md` | `AGENTS.md` (read by both CLI and Chat) | 🟢 1:1 | Cross-tool standard. |
| MCP project config (`.roo/mcp.json`) | `.github/mcp.json` (canonical) **or** `.copilot/mcp-config.json` (squad-style) | 🟢 1:1 | Field renames: `mcpServers` ↔ `mcpServers` (same), `disabled` ↔ `enabled`. |
| MCP user config (`mcp_settings.json` in globalStorage) | `~/.copilot/mcp-config.json` | 🟢 1:1 | Symlink target via `COPILOT_HOME`. |
| Per-mode MCP allowlist | `.agent.md` `tools: ["server/*"]` | 🟢 1:1 | |
| Sequential `new_task` orchestrator | `task` tool (parallel-capable; serialise via prose) | 🟡 minor | Same nuance as Chat Q-013. |
| Approval per tool call | Per-tool prompt + `Kind(arg)` allow/deny lists | 🟢 better | Has both interactive and pinnable allowlists. |
| Iteration cap | `--max-autopilot-continues` (autopilot only) | 🟢 better | Roo has none. |
| Webview UI | None — TTY only | 🟡 different | Mode CRUD = edit `.agent.md`; `/agent` picker, `/mcp`, `/skills`, `/instructions` slash commands. |
| Headless / scripting | `-p`, JSONL `--output-format`, exit codes, `--allow-tool` | 🟢 better | Roo has no first-class headless mode. |
| Session resume | `--continue`, `--resume[=name]`, `/rename`, FTS5 search | 🟢 better | Roo persists by VS Code workspace only. |
| Auto-context-management | Auto-compact at ~95% | 🟢 better | Roo has no equivalent. |
| Hooks | 12+ event types, command/HTTP/prompt | 🟢 better | Roo has none. |
| Skills (callable Markdown procedures) | `~/.copilot/skills/<name>/SKILL.md` + `.github/skills/` | 🟢 better | Closest Roo analogue: prompt files (planned, not present). |
| BYOK / local model | `COPILOT_PROVIDER_*` env vars (openai / azure / anthropic) | 🟢 better than Chat | **Resolves Q-030 for the CLI path** — Ollama via OpenAI-compat endpoint works. |
| Settings sync | `COPILOT_HOME` symlink + git-tracked `.github/copilot/settings.json` | 🟢 1:1 | Vault-friendly. |
| Org policies | Repo-level `settings.json` (allowlisted keys only) + Enterprise-tier server policies | 🟢 better | Cleaner than Roo. |
| Vault portability (Q-008) | `COPILOT_HOME` env var or `--config-dir` flag | 🟢 resolved | **Resolves Q-008 for the CLI path** — no per-profile-id quirks. |

**Summary:** **22 of 25 axes are 🟢 (1:1 or better); 2 are 🟡 (minor/nuance); 2 are 🔴 (per-mode `fileRegex`, per-mode rules folder)** — the **same two blockers** as the Chat path. The CLI **adds material wins** in headless scripting, hooks, skills, sessions, and BYOK; it **loses** the webview UI affordances entirely.

---

## 9. MCP Support (Phase 5b-i)

### Sources

- [`docs.github.com — add-mcp-servers`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers). Accessed 2026-04-26.
- [`docs.github.com — cli-command-reference § MCP server configuration`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#mcp-server-configuration). Accessed 2026-04-26.
- [`docs.github.com — cli-command-reference § Slash commands`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#slash-commands-in-the-interactive-interface). Accessed 2026-04-26.
- [`docs.github.com — cli-command-reference § Migrating from .vscode/mcp.json`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#migrating-from-vscodemcpjson). Accessed 2026-04-26.
- [`40-copilot-chat-research.md` § MCP Support (4c)](40-copilot-chat-research.md#mcp-support) — Chat-side schema for the side-by-side. Accessed 2026-04-26.
- [`../squad/.copilot/mcp-config.json`](../../../../squad/.copilot/mcp-config.json) — squad's user-format file used at project scope.

### Findings (2026-04-26)

#### 9.1 Canonical config locations & precedence — resolves Q-031

The CLI loads MCP servers from **three** layers, namespaced by source:

| Scope | Path | Schema | Notes |
|---|---|---|---|
| **User** | `~/.copilot/mcp-config.json` (Windows: `%USERPROFILE%\.copilot\mcp-config.json`) | `{ "mcpServers": { … } }` | Created/updated by `/mcp add` and `copilot mcp add`. Follows `COPILOT_HOME`. |
| **Repository** | `.github/mcp.json` | Same `{ "mcpServers": { … } }` | Trust level "Medium — Recommended review" per the CLI command reference. |
| **Workspace** | `.mcp.json` (repo root) | Same | Equal trust to `.github/mcp.json`; convenience for projects that don't use `.github/`. |
| **Per-invocation** | `--additional-mcp-config=JSON\|@file` | Same | Augments user config; *overrides any installed server with the same name*. |

> "Configure persistent servers in `~/.copilot/mcp-config.json`. Use `--additional-mcp-config` to add servers for a single session." — [cli-command-reference § MCP server configuration](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#mcp-server-configuration)

**Precedence:** servers are merged across layers; on name collision, **`--additional-mcp-config` > workspace/repo > user**. Built-in servers (`github-mcp-server`, `playwright`, `fetch`, `time`) are highest trust and always available unless disabled with `--disable-builtin-mcps` or `--disable-mcp-server <name>`.

> ⚠️ **Squad's `.copilot/mcp-config.json` is non-canonical (resolves Q-031).** The CLI's own documentation does **not** list `.copilot/mcp-config.json` at the project root as a discovery location. Squad relies on its launcher implicitly setting `COPILOT_HOME` to the project's `.copilot/` directory, which redirects the **user** layer to that path. Any user who runs bare `copilot` from a squad-shaped project (without the squad launcher) will **not** load that file. **Recommendation for the vault:** prefer the documented `.github/mcp.json` for project-scope MCP and reserve `~/.copilot/mcp-config.json` (via `COPILOT_HOME`) for the vault-symlinked user layer.

The legacy `.vscode/mcp.json` is **not** read by the CLI; an explicit migration is documented (`jq '{mcpServers: .servers}' .vscode/mcp.json > .mcp.json`) — confirming the schema fork below.

#### 9.2 Schema vs Copilot Chat's `.vscode/mcp.json` — side-by-side

| Axis | Copilot CLI (`mcp-config.json` / `.mcp.json` / `.github/mcp.json`) | Copilot Chat (`.vscode/mcp.json`) |
|---|---|---|
| **Top-level key** | `mcpServers` (object map) | `servers` (object map) + optional top-level `inputs` array |
| **Transport names** | `local` / `stdio` (alias), `http`, `sse` | `stdio`, `http`, `sse` (no `local` alias) |
| **Stdio fields** | `command`, `args`, `env`, `cwd`, `tools`, `timeout`, `type` | `command`, `args`, `env`, `envFile`, `sandbox`/`sandboxEnabled` (mac/linux), `type` |
| **HTTP fields** | `type`, `url`, `headers`, `tools`, `oauthClientId`, `oauthPublicClient`, `oidc`, `timeout` | `type`, `url`, `headers` |
| **Per-server tool filter** | `tools: ["*"]` / `["tool_a","tool_b"]` (required field) | No equivalent in `mcp.json`; tool filtering is via `.agent.md` `tools:` only |
| **Secret substitution** | `${VAR}`, `$VAR`, `${VAR:-default}` from **process env** (no Credential-Manager prompt) | `${input:id}` resolved from top-level `inputs:` array → first-run prompt → **Windows Credential Manager** |
| **CLI-only fields** | `tools`, `timeout`, `oidc`, `oauthClientId`, `oauthPublicClient`, `filterMapping` | n/a |
| **VS-Code-only fields** | n/a | `inputs`, `envFile`, `sandbox*`, top-level `gallery`/`dev` UX hints |
| **Disable mechanism** | `/mcp disable <name>` (per-session); `--disable-mcp-server` (per-invocation); deletion via `/mcp delete` | UI toggle in the Chat MCP picker; per-server `disabled: true` |

> "If your project uses `.vscode/mcp.json` (VS Code's MCP configuration format), migrate to `.mcp.json` for GitHub Copilot CLI. The migration remaps the `servers` key to `mcpServers`." — [cli-command-reference](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#migrating-from-vscodemcpjson)

#### 9.3 Auth & secrets on Windows — resolves Q-033

The CLI's secret model is **process-env substitution only**. Per the field reference: `env … Supports $VAR, ${VAR}, and ${VAR:-default} expansion.` There is **no** equivalent of Chat's `${input:…}` first-run prompt, and the OS keychain is **only** used for the user's GitHub auth token, **not** for MCP-server secrets.

**Recommended Windows pattern for the vault:**

```powershell
# Persist a secret in user-scope env (survives reboots; visible to all GUI apps).
[Environment]::SetEnvironmentVariable("TRELLO_API_KEY", "tk_…", "User")
[Environment]::SetEnvironmentVariable("TRELLO_TOKEN",   "ATTAxxx", "User")
# Then any mcp-config.json with "env": { "TRELLO_API_KEY": "${TRELLO_API_KEY}" } resolves transparently.
```

For projects that prefer file-based secrets, wrap `copilot` in a launcher that loads `.copilot/.env` (gitignored) and exports each `KEY=VAL` to the child process before exec — this is exactly the pattern squad's launcher uses. Windows Credential Manager is **not** the default path on the CLI side (vs Chat); using it requires a wrapper script that calls `[Microsoft.Win32.Credentials]` to read the entry and re-exports the value as an env var before invoking `copilot`.

> ⚠️ **No shared secret-handling story across Chat and CLI (Q-033 confirmed).** A given MCP server requires *two* configs — `${input:KEY}` for `.vscode/mcp.json` and `${KEY}` (or hardcoded) for `mcp-config.json`. Vault playbook (Phase 8) must pick one canonical source of truth and generate the other.

#### 9.4 Per-agent MCP filtering

Filtering is performed at **two** layers and the CLI's behaviour matches Chat exactly for the agent layer:

1. **`.agent.md` frontmatter `tools:`** — array of bare tool names, `<server>/<tool>` pairs, or `<server>/*` wildcards. This is the same syntax documented for VS Code (Q-002 resolved earlier). Default is `["*"]` (all tools).
2. **`.agent.md` frontmatter `mcp-servers:`** — an object that **inlines** an additional MCP-config map scoped to that agent only (uses the same `mcpServers` schema). This is a CLI extension over Chat's `.agent.md` schema — Chat agents reference servers but cannot define new ones inline.

Combined with Roo's empty-array semantic (Q-009 resolved), the vault's per-mode `allowedMcpServers: ["github"]` translates 1:1 to `tools: ["github-mcp-server/*"]` plus the same in `mcp-servers:` if the project wants the server scoped to that agent only.

#### 9.5 `/mcp` REPL slash commands

Per [cli-command-reference § Slash commands](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#slash-commands-in-the-interactive-interface):

> `/mcp [show|add|edit|delete|disable|enable|auth|reload] [SERVER-NAME]` — Manage the MCP server configuration.

| Slash | Effect |
|---|---|
| `/mcp show` | List all configured servers and their connection status (a known UX gap: no inline disable button — see [`copilot-cli#2956`](https://github.com/github/copilot-cli/issues/2956)). |
| `/mcp show <name>` | Detailed status + tool inventory for one server. |
| `/mcp add` | Interactive form (Tab-navigated) for name/type/command/url/env/headers/tools. Hot-reloads — no restart. |
| `/mcp edit <name>` | Edit an existing server. |
| `/mcp delete <name>` | Remove a server from the user config. |
| `/mcp disable <name>` | Keep config; skip server for the rest of the session. |
| `/mcp enable <name>` | Re-enable a previously disabled server. |
| `/mcp auth <name>` | Trigger fresh OAuth flow for a remote server in `needs-auth` state (browser-based). |
| `/mcp reload` | Re-read configs from disk (pick up changes made outside the REPL). |

There is also a non-interactive twin: `copilot mcp [list|get|add|remove]` runs the same operations from the parent shell without entering a session ([CLI command reference § `copilot mcp`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#copilot-mcp-subcommand)).

---

## 10. Hooks (Phase 5b-i — headline section)

### Sources

- [`docs.github.com — use-hooks (CLI how-to)`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks). Accessed 2026-04-26.
- [`docs.github.com — Hooks configuration (reference)`](https://docs.github.com/en/copilot/reference/hooks-configuration). Accessed 2026-04-26.
- [`docs.github.com — Use hooks with Copilot CLI (tutorial)`](https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks). Accessed 2026-04-26 — **primary source for the PowerShell example** in § 10.4.
- [`docs.github.com — cli-command-reference § Hooks reference`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#hooks-reference). Accessed 2026-04-26.
- [`docs.github.com — cli-command-reference § Configuration file settings`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#configuration-file-settings) — `disableAllHooks` semantics.
- [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) — preToolUse not enforced in subagents (active bug; affects verdict).
- [`copilot-cli#2540`](https://github.com/github/copilot-cli/issues/2540) — plugin-defined preToolUse hooks don't fire (active bug).
- [`copilot-cli#2893`](https://github.com/github/copilot-cli/issues/2893) — preToolUse silently bypassed under parallel tool calls (timeout race; active bug).
- [`copilot-cli#2013`](https://github.com/github/copilot-cli/issues/2013) — `hookSpecificOutput.updatedInput` ignored (CLI does not honour the VS Code-style `modifiedArgs` even though docs list it).

### Findings (2026-04-26)

#### 10.1 Storage paths & precedence

Hooks live in **three** layers; all matching layers' hooks **execute in series, repository hooks after user hooks** (per the repo-settings `hooks` merge rule "Concatenated — repository hooks run after user hooks").

| Scope | Path(s) | Format |
|---|---|---|
| **User** | `~/.copilot/config.json` (`hooks` key inline) **and/or** any `~/.copilot/hooks/*.json` file ⚠️ uncertain — Q-036 | JSON object, version 1 |
| **Repository** | `.github/hooks/*.json` (one or more files; *.json filename is free-form) | JSON object, version 1 |
| **Repository, alternate** | `.github/copilot/settings.json` `hooks` key (committed; allowlisted) | Inline object |

> "Hook configuration files are loaded automatically from `.github/hooks/*.json` in your repository." — [cli-command-reference § Hooks reference](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#hooks-reference)

Discovery follows `COPILOT_HOME`, so a vault-redirected `~/.copilot/` works the same way.

#### 10.2 Hook events — full enumeration (13 events × ≥2 payload shapes)

The CLI's hook event registry, grouped by category. Two payload shapes are emitted depending on whether the event is configured under its **camelCase** name (native) or its **PascalCase** alias (VS Code Copilot extension compatible — fields shift to snake_case and gain `hook_event_name`).

**Session lifecycle:**

| Event (camelCase / PascalCase) | Trigger | Key fields | Output processed |
|---|---|---|---|
| `sessionStart` / `SessionStart` | New session begins or one is resumed (`source: "new" \| "resume" \| "startup"`) | `sessionId`, `timestamp`, `cwd`, `source`, `initialPrompt` | No (output ignored) |
| `sessionEnd` / `SessionEnd` | Session terminates | `sessionId`, `timestamp`, `cwd`, `reason: "complete" \| "error" \| "abort" \| "timeout" \| "user_exit"` | No |
| `userPromptSubmitted` / `UserPromptSubmit` | Each user prompt is submitted | `sessionId`, `timestamp`, `cwd`, `prompt` | No (cannot mutate the prompt — confirmed in [hooks-configuration § userPromptSubmitted](https://docs.github.com/en/copilot/reference/hooks-configuration#user-prompt-submitted-hook): *"prompt modification not currently supported in customer hooks"*) |
| `agentStop` / `Stop` | Main agent finishes a turn | `sessionId`, `cwd`, `transcriptPath`, `stopReason: "end_turn"` | Yes — `{decision:"block", reason}` forces another turn |

**Tool lifecycle:**

| Event | Trigger | Key fields | Output processed |
|---|---|---|---|
| `preToolUse` / `PreToolUse` | Before each tool runs | `toolName`, `toolArgs` (JSON string of tool args; `tool_input` parsed in PascalCase mode) | **Yes — allow / deny / (claimed) modifiedArgs** |
| `postToolUse` / `PostToolUse` | After successful tool completion | `toolName`, `toolArgs`, `toolResult: { resultType:"success", textResultForLlm }` | Yes (SDK only — command hooks ignored) |
| `postToolUseFailure` / `PostToolUseFailure` | After tool fails | `toolName`, `toolArgs`, `error` | Yes — exit code `2` causes stderr to be returned as recovery guidance for the LLM |

**Sub-agent lifecycle:**

| Event | Trigger | Key fields | Output processed |
|---|---|---|---|
| `subagentStart` | Just before a sub-agent runs | `agentName`, `agentDisplayName`, `agentDescription`, `transcriptPath` | Returns `additionalContext` prepended to the sub-agent's prompt |
| `subagentStop` / `SubagentStop` | Sub-agent completes | `agentName`, `transcriptPath`, `stopReason` | Same `{decision:"block", reason}` semantics as `agentStop` |

**Other:**

| Event | Trigger | Key fields | Output processed |
|---|---|---|---|
| `preCompact` / `PreCompact` | Before manual or auto context compaction | `transcriptPath`, `trigger:"manual"\|"auto"`, `customInstructions` | No (notification only) |
| `permissionRequest` | About to show user a permission dialog (after rule-based checks miss) | regex `matcher` on `toolName` | Yes — `{behavior:"allow"\|"deny", message, interrupt?}`; exit code `2` ≡ deny |
| `errorOccurred` / `ErrorOccurred` | Any execution error | `error{message,name,stack}`, `errorContext`, `recoverable` | No |
| `notification` | Async system notification (shell completed, agent idle, permission prompt, elicitation) | `notification_type`, `message`, `title` | Optional `additionalContext` injection |

**Exit-code conventions (command hooks):** the documented contract from the references is sparse but consistent:

- **`preToolUse`**: emit JSON to stdout (`{permissionDecision:"deny", permissionDecisionReason:"…"}`) to block; emit empty/`{}` or `{permissionDecision:"allow"}` to allow. Exit code itself is *not* the primary deny signal; the JSON payload is. Non-zero exit + no JSON ≡ allow with the failure logged ("Hook failures (non-zero exit codes or timeouts) are logged and skipped — they never block agent execution" — [cli-command-reference § Hooks reference](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#hooks-reference)).
- **`permissionRequest`**: exit code `2` ≡ deny; JSON output also accepted.
- **`postToolUseFailure`**: exit code `2` triggers `stderr → additionalContext` for recovery.
- **All others**: exit code is informational; failures are logged and never block.

Default per-hook timeout is **30 seconds** (`timeoutSec` overrides; max not documented — `⚠️ uncertain — Q-036`).

#### 10.3 Hook formats: command vs prompt (no separate "JSON config-pointing-to-command" type)

The reference documents **two** hook types — not three:

1. **`command`** (all events): runs a shell script with both Bash and PowerShell commands declared on the same hook entry (the CLI picks the right one for the host OS):
   ```json
   { "type": "command",
     "bash": "./scripts/policy.sh",
     "powershell": "./scripts/policy.ps1",
     "cwd": ".github/hooks",
     "env": { "MY_VAR": "value" },
     "timeoutSec": 30 }
   ```
   The **JSON config file *is* the script-pointer**: the schema does not separate "config" from "script" — every hook entry is a JSON object that points at a command. Inline scripts are not supported; the command must reference an executable on disk or a one-liner like `pwsh -NoProfile -Command "…"`.

2. **`prompt`** (`sessionStart` only): auto-submits text as if the user typed it (natural language or `/slash-command`), running before any `--prompt`-passed initial prompt. Useful for "always start in plan mode" or "always run /init" defaults.
   ```json
   { "type": "prompt", "prompt": "/plan Always begin by reading AGENTS.md." }
   ```

> ⚠️ **No `http` hook type on the CLI side (correction to the Phase-5a stub).** The Phase-5a placeholder claimed three hook types (`command`, `http`, `prompt`) and an HTTPS-required model for `preToolUse`/`permissionRequest`. The reference documents **only** `command` and `prompt`. The earlier note conflated the **Cloud-agent** hook surface (which does support HTTPS endpoints and an SSRF allowlist) with the **CLI** hook surface (local commands only). Filed as **Q-038** for confirmation against the SDK's `Hook` interface.

#### 10.4 `preToolUse` deep-dive — the `fileRegex` substitute

This hook is the **headline finding** because it is the only first-class CLI mechanism that can replace Roo's per-mode `fileRegex` edit restriction. Payload (camelCase form):

```text
sessionId  : string
timestamp  : number    # Unix ms
cwd        : string    # absolute working dir
toolName   : string    # "edit" | "create" | "apply_patch" | "bash" | "powershell" | "view" | "web_fetch" | "task" | <mcp-server tool>
toolArgs   : string    # JSON-stringified tool arguments — must be parsed
```

Key facts that determine whether `preToolUse` substitutes for `fileRegex`:

- For **`edit`** / **`create`** / **`apply_patch`**, `toolArgs` (after parse) contains a `path` field (relative or absolute). This is the field a `fileRegex` policy must match against.
- The active **agent name is not in the payload**. Agent identity must be threaded in via an env var that the CLI sets when launching the hook, or via a wrapper that records the active agent in a sidecar file. ⚠️ **uncertain — Q-037: which env vars (if any) does the CLI export to spawned hook processes that identify the active `--agent` and current sub-agent depth?** The squad-style approach is to write the agent name to `~/.copilot/state/active-agent.txt` from a `subagentStart` hook and have `preToolUse` read it back.
- The hook's working directory is whatever the CLI was launched from unless `cwd` overrides it (relative paths resolve from there).

**Concrete Windows PowerShell example** — mimics Roo's `fileRegex: "\\.md$"` for the `edit` tool, restricted to a `docs-writer` agent. Cited primary source for the deny-output JSON shape and the `[Console]::In.ReadToEnd() | ConvertFrom-Json` reading pattern: [tutorial step 5](https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks#5-enforce-policies-with-pretooluse) and [hooks-configuration § Pre-tool use hook](https://docs.github.com/en/copilot/reference/hooks-configuration#pre-tool-use-hook).

`.github/hooks/file-regex.policy.json`:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "powershell": "pwsh -NoProfile -ExecutionPolicy Bypass -File ./.github/hooks/scripts/enforce-file-regex.ps1",
        "bash": "./.github/hooks/scripts/enforce-file-regex.sh",
        "timeoutSec": 5
      }
    ]
  }
}
```

`.github/hooks/scripts/enforce-file-regex.ps1`:

```powershell
$ErrorActionPreference = 'Stop'

# 1. Read the JSON payload from stdin (CLI feeds it here per hooks-configuration ref).
$inputObj = [Console]::In.ReadToEnd() | ConvertFrom-Json

$toolName = $inputObj.toolName
# Only restrict file-mutation tools.
if ($toolName -notin @('edit', 'create', 'apply_patch')) { exit 0 }

# 2. toolArgs is a JSON STRING — must be parsed again.
$toolArgs = $null
try { $toolArgs = $inputObj.toolArgs | ConvertFrom-Json } catch { exit 0 }
$path = $toolArgs.path
if (-not $path) { exit 0 }

# 3. Determine active agent. The CLI does not yet expose this in payload (Q-037),
#    so the convention is: subagentStart writes the name into this state file.
$activeAgent = ''
$stateFile = Join-Path $env:USERPROFILE '.copilot\state\active-agent.txt'
if (Test-Path $stateFile) { $activeAgent = (Get-Content $stateFile -Raw).Trim() }

# 4. Per-agent fileRegex policy table (mirror of .roomodes "groups[].fileRegex").
$policy = @{
    'docs-writer'    = '\.md$'
    'translate'      = '(locales|i18n)[\\/].*\.(json|md)$'
    'devops'         = '\.(ya?ml|tf|hcl|dockerfile|ps1|sh)$'
}

if ($policy.ContainsKey($activeAgent)) {
    $regex = $policy[$activeAgent]
    if ($path -notmatch $regex) {
        # 5. Emit deny verdict per hooks-configuration § Pre-tool use hook.
        @{
            permissionDecision       = 'deny'
            permissionDecisionReason = "Agent '$activeAgent' may only edit files matching /$regex/. Refusing to modify '$path'."
        } | ConvertTo-Json -Compress
        exit 0
    }
}

exit 0   # allow by default
```

**Verified payload-shape claims** against the primary doc:

> "**Input JSON:** `{ "timestamp": …, "cwd": …, "toolName": "bash", "toolArgs": "{\"command\":\"rm -rf dist\",…}" }` … **Fields:** `toolArgs`: JSON string containing the tool's arguments." — [hooks-configuration § Pre-tool use hook](https://docs.github.com/en/copilot/reference/hooks-configuration#pre-tool-use-hook)

> "**Output fields:** `permissionDecision`: Either `"allow"`, `"deny"`, or `"ask"` (only `"deny"` is currently processed). `permissionDecisionReason`: Human-readable explanation for the decision." — *ibid.*

The tutorial's enforce-file-permissions example ([same page](https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks#5-enforce-policies-with-pretooluse)) confirms the parse-and-match-on-`path` pattern verbatim:
> *"if [ "$TOOL_NAME" = "edit" ]; then PATH_ARG=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.path'); if [[ ! "$PATH_ARG" =~ ^(src/|test/) ]]; then echo '{"permissionDecision":"deny", …}'."*

**Known unknowns the example carries (tracked as Q-035 follow-ups):**

- **Latency:** `pwsh -NoProfile -Command …` cold-start on Windows is ~150–400 ms per invocation; uncached PowerShell module loads can push that to >1 s. With a 30 s hook timeout this is comfortably safe per call but adds visible lag on tool-heavy turns. Filed as **Q-039** for empirical measurement on the user's box.
- **Env-var inheritance:** the CLI's hook process inherits the user-shell environment by default; setting `env: { … }` in the hook entry adds/overrides. Whether `${env:VAR}` expansion works inside the entry's `env` map (it works in MCP `env`) is `⚠️ uncertain — Q-040`.
- **Sub-agent enforcement gap (CRITICAL — affects verdict):** [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) — *"`preToolUse` hooks configured in config.json are correctly enforced on the main agent, but are not enforced on subagents spawned via the `task` tool."* As of the issue's last update this is **unresolved**. A `task`-dispatched sub-agent invoking `edit("README.md")` will bypass the policy. The vault's orchestrator pattern dispatches frequently; this materially weakens the workaround.
- **Parallel-call race (CRITICAL):** [`copilot-cli#2893`](https://github.com/github/copilot-cli/issues/2893) — *"`preToolUse` hooks are silently bypassed under parallel tool calls because `timeoutSec` does not terminate the hook process — when a hook takes [longer], the tool call proceeds anyway."* Multi-tool turns can leak past the policy.
- **Plugin hooks broken:** [`copilot-cli#2540`](https://github.com/github/copilot-cli/issues/2540) — `preToolUse` hooks defined in a *plugin's* `hooks.json` do not fire at all; only repo + user hooks are reliable today.
- **`modifiedArgs` not honoured:** [`copilot-cli#2013`](https://github.com/github/copilot-cli/issues/2013) — the docs list a `modifiedArgs` output field for `preToolUse`, but the CLI ignores it. Mutating the proposed write path (e.g., re-routing edits to a quarantine dir) is **not** an option today.

#### 10.5 `disableAllHooks` kill-switch — resolves Q-032

`disableAllHooks: true` is one of only six keys honoured at the **repository** layer (`.github/copilot/settings.json`); it disables every user, repo, and plugin hook for sessions started in that repo (per [cli-command-reference § Repository settings](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#repository-settings-githubcopilotsettingsjson)). It is also honoured at the user layer.

> ⚠️ **Safety note.** Because the kill-switch lives in a *committed* repository file, anyone with write access to a project can disable that project's enforcement by adding one boolean to `.github/copilot/settings.json`. For policy-critical environments, gate the file behind branch protection / required code review, or pin the policy at the **user** layer (which the repo can't override) and accept the loss of per-repo opt-out.

This **partially resolves Q-032** (repo settings allowlist scope): per-project `allowedTools` / `deniedTools` / `systemPrompt` are still ignored at the repo layer (Q-032 stands), but `disableAllHooks` and `hooks` themselves *are* committed-honour-able — which is exactly what the vault needs to ship per-project enforcement.

#### 10.6 Verdict — does `preToolUse` realistically replace Roo's `fileRegex`?

**Yes-with-caveats.** For the **main agent** on serial tool calls, `preToolUse` mechanically substitutes for `fileRegex`: the payload exposes `toolName` + parsed `toolArgs.path`, and the `{permissionDecision:"deny", permissionDecisionReason}` JSON output blocks the call exactly the way Roo's pre-edit check does. The PowerShell example above is a working drop-in for Roo's `fileRegex: "\\.md$"`.

**The caveats are non-trivial and must be accepted explicitly:**

1. **Sub-agent bypass ([#2392](https://github.com/github/copilot-cli/issues/2392)) is the binding constraint.** The vault's orchestrator delegates to specialists via `task(agent="…")`; if those sub-agents bypass `preToolUse`, the per-agent file restriction is **not enforced** on the most common path. Mitigation: until the bug is fixed, restrict orchestrator-style work to `--agent <name>` boot mode rather than `task`-dispatched sub-agents, or explicitly forbid sub-agent dispatch in agent bodies that need file-regex enforcement.
2. **Parallel-call race ([#2893](https://github.com/github/copilot-cli/issues/2893)) leaks under load.** Mitigation: keep hook scripts under ~50 ms of work and pre-compile (avoid module imports inside the hot path).
3. **Active-agent identity not in the payload (Q-037).** Requires a sidecar file written from `subagentStart` to thread agent name through. Workable but adds moving parts.
4. **Plugin-hook bug ([#2540](https://github.com/github/copilot-cli/issues/2540)).** Don't ship the policy as a plugin; ship it as a repo or user hook.

**Bottom line for Path-B (CLI-first):** `preToolUse` **does close the G-1 blocker for serial main-agent flows** (which is most of Roo's actual `fileRegex` usage in the vault — the per-mode "docs-writer can only edit `.md`" pattern), but it **does not close it for orchestrator/sub-agent flows** until #2392 ships. That makes G-1 a 🟠 *major* on the CLI path rather than a 🔴 *blocker* — a meaningful improvement over the Chat path (which has no hook surface at all and stays 🔴), but not a clean parity win. Phase 6 should record G-1 as **🟠 major (CLI)** and **🔴 blocker (Chat)** when the Gap Catalog is unified.

---

## 11. Skills (Phase 5b-ii-A)

### Sources

- [`docs.github.com — Adding agent skills for GitHub Copilot CLI`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) — canonical CLI how-to (path was renamed from `/use-skills` to `/add-skills`). Accessed 2026-04-26.
- [`docs.github.com — About agent skills`](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) — concepts page. Accessed 2026-04-26.
- [`docs.github.com — Custom skills (SDK)`](https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/custom-skills) — SDK-side counterpart. Accessed 2026-04-26.
- [`agentskills.io`](https://agentskills.io/) — open Agent Skills standard the format implements (cross-tool with Claude Code, Cursor, Gemini CLI, Codex CLI). Accessed 2026-04-26.
- [`microsoft/vscode-copilot-release#14131`](https://github.com/microsoft/vscode-copilot-release/issues/14131) — VS Code SKILL.md frontmatter validator does not recognise `allowed-tools` (active bug). Accessed 2026-04-26.
- [`copilot-cli#978`](https://github.com/github/copilot-cli/issues/978) — Skills not auto-triggered unless explicitly named in prompt (reported regression). Accessed 2026-04-26.
- [`anthropics/claude-code#18737`](https://github.com/anthropics/claude-code/issues/18737) — `allowed-tools` only honoured by the Claude CLI, not by Skills running under Claude on the API/Plugins surface (cross-tool portability caveat). Accessed 2026-04-26.
- [`../squad/.copilot/skills/`](../../../../squad/.copilot/skills) — Squad's actual project-skills directory (23 `SKILL.md` files at investigation time). Accessed 2026-04-26.

### Findings (2026-04-26)

#### 11.1 What a skill is

> "Agent skills are folders of instructions, scripts, and resources that Copilot can load when relevant to improve its performance in specialized tasks." — [add-skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)

A skill is a **directory** (not a single file) containing one mandatory `SKILL.md` plus optional sibling resources (helper Markdown files, shell/PowerShell scripts, JSON examples, …). When the agent invokes the skill, the **entire directory contents are made available alongside the `SKILL.md` instructions** — so a skill can ship its own enforcement script, sample data, or templates and reference them by relative path from the `SKILL.md` body. This is the load-bearing mechanism that turns a skill into an *executable* Markdown procedure rather than just additional prose.

Skills implement the open [Agent Skills standard](https://agentskills.io/), which means a directory written for Copilot CLI is also discovered (with caveats — see § 11.5) by Claude Code, Cursor, Gemini CLI, and Codex CLI. This is one of the few customization surfaces in Copilot that is genuinely cross-tool by design.

#### 11.2 File format & frontmatter

`SKILL.md` is YAML-frontmatter Markdown. Filename is **literal** — `SKILL.md` only; `skill.md`/`Skill.md` will be ignored.

```markdown
---
name: github-actions-failure-debugging
description: Guide for debugging failing GitHub Actions workflows. Use this when asked to debug failing GitHub Actions workflows.
license: MIT
allowed-tools: shell
---

When asked to debug a failing GitHub Actions run:

1. Use `list_workflow_runs` (GitHub MCP) to find recent runs.
2. Use `summarize_job_log_failures` to AI-summarise failed jobs.
3. If still ambiguous, fall through to `get_job_logs` for the raw logs.
4. Reproduce locally; commit the fix.
```

Frontmatter fields documented for the **Copilot CLI flavour**:

| Field | Required | Purpose |
|---|---|---|
| `name` | ✅ | Lowercase, hyphen-separated, ≤ 64 chars; typically matches the directory name. Acts as the slash-command name (`/<name>`). |
| `description` | ✅ | The autonomous-trigger string. Copilot loads the skill into context when a user prompt aligns with this description — write it like a search-engine snippet (verbs + concrete trigger phrases + technologies). Vague descriptions silently fail to trigger ([copilot-cli#978](https://github.com/github/copilot-cli/issues/978)). |
| `license` | ⬜ | Free-text license note (e.g., `MIT`). Informational only. |
| `allowed-tools` | ⬜ | Pre-approval list to skip per-call confirmation prompts. The official guidance is explicit: ⚠️ *"Only pre-approve the `shell` or `bash` tools if you have reviewed this skill and any referenced scripts, and you fully trust their source."* Note: the VS Code Copilot extension's frontmatter validator currently warns on `allowed-tools` even though the CLI accepts it ([vscode-copilot-release#14131](https://github.com/microsoft/vscode-copilot-release/issues/14131)). |

> ⚠️ **Cross-tool fields not in the CLI flavour.** The Anthropic / Claude Code skill spec also defines `user-invocable` and `disable-model-invocation` to control slash-menu visibility and to prevent autonomous use respectively. These fields are **not documented for the Copilot CLI** and are silently ignored when present (filed as **Q-041**). Authors targeting both runtimes must accept that the model-invocation policy is essentially "always autonomous-eligible" on Copilot.

#### 11.3 Storage paths & precedence

Per the canonical doc, the CLI scans two scope tiers, each with three brand-equivalent aliases (so existing Claude / Anthropic skill libraries drop in without renames):

| Scope | Default path(s) | Notes |
|---|---|---|
| **User** (cross-project) | `~/.copilot/skills/<name>/SKILL.md`, `~/.claude/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md` | Follows `COPILOT_HOME` for the `.copilot/` variant; the `.claude/` and `.agents/` variants are scanned at the literal home path. Vault recommendation: redirect `~/.copilot/skills/` via `COPILOT_HOME` and skip the other two for clarity. |
| **Project** (per-repo) | `.github/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md` | Repo-relative. The canonical Copilot location is `.github/skills/`. |

Precedence: project beats user when names collide (same as agents and instructions). Plugins can also bundle skills, which appear at lowest priority and can be overridden by either tier.

#### 11.4 Invocation model — autonomous + explicit slash + REPL management

Copilot loads a skill in **three** distinct ways:

1. **Autonomous (description-driven).** Copilot indexes every discovered skill's `name` + `description` at session start; when a user prompt's intent aligns with the description, Copilot loads `SKILL.md` plus the directory contents into the agent's context for that turn. This is the path the docs lead with and is the reason the description must be specific. (Active complaint that this is unreliable in practice: [copilot-cli#978](https://github.com/github/copilot-cli/issues/978).)
2. **Explicit slash invocation in a prompt.** Reference the skill by name with a leading slash anywhere in the prompt: `Use the /frontend-design skill to create a responsive navigation bar in React.` This bypasses the description-matching heuristic and forces the load.
3. **Interactive REPL management** via the `/skills` slash family:
   - `/skills list` (or the natural-language *"What skills do you have?"*) — enumerate.
   - `/skills info [SKILL-NAME]` — show description, location, and which plugin (if any) shipped it.
   - `/skills` (no arg) — interactive enable/disable picker (arrow keys + space).
   - `/skills reload` — re-scan disk after adding a new skill mid-session.
   - `/skills add <path>` — register an additional skills root.
   - `/skills remove <skill-dir>` — delete a user-installed skill (plugin-shipped skills must be removed via the plugin).

#### 11.5 Squad ground-truth (project-scope, 23 SKILL.md files)

Squad ships project-scope skills under [`../squad/.copilot/skills/`](../../../../squad/.copilot/skills) — note the **non-canonical location** (`.copilot/skills/`, not `.github/skills/`); these are loaded only because squad's launcher implicitly redirects `COPILOT_HOME` to the project's `.copilot/` directory (same convention pattern documented as Q-031 for MCP). At investigation time there are **23 SKILL.md files** (the original brief estimated 24; the directory was re-scanned and 23 is the true count).

Representative skills (sample — not exhaustive) drawn from the directory listing only, one-line purposes inferred from the directory names per the task brief's no-deep-read instruction:

| Skill | Inferred purpose |
|---|---|
| `agent-collaboration/` | How agents hand off work to each other within a squad. |
| `agent-conduct/` | Behavioural norms for agent output (tone, refusals, escalation). |
| `architectural-proposals/` | Procedure for drafting and circulating architecture proposals. |
| `cli-wiring/` | How squad agents invoke the Copilot CLI (`-p`, `--agent-cmd`, model selection). |
| `git-workflow/` | Branching, commit-message, and PR conventions. |
| `init-mode/` | First-run scaffolding for a new squad-enabled repo. |
| `pr-lifecycle/` | Open → review → merge → close pull-request playbook. |
| `protected-files/` | Guard rails preventing edits to sensitive paths (analogue to Roo's `fileRegex`). |
| `secret-handling/` | Never-log / env-var-only patterns for credentials. |
| `windows-compatibility/` | PowerShell-equivalent commands for skills authored Bash-first. |
| `distributed-mesh/` | (ships extra resources: `mesh.json.example`, `sync-mesh.ps1`, `sync-mesh.sh`) Multi-machine squad coordination. |

Other skills present (names only): `architectural-review`, `ci-validation-gates`, `client-compatibility`, `github-multi-account`, `history-hygiene`, `model-selection`, `release-process`, `reskill`, `reviewer-protocol`, `security-review`, `squad-conventions`. The `distributed-mesh/` directory is the clearest example of the *"skill = directory of resources"* model — its `SKILL.md` references both a Bash and a PowerShell sync script, the cross-platform pattern Squad apparently adopts everywhere it ships scripts.

The practical takeaway for the vault: **skills are the natural home for Roo's per-mode "way of working" prose** that today lives in `roleDefinition` / `customInstructions` / `.roo/rules-<mode>/`. A skill bundle (`SKILL.md` + helper script) maps cleanly onto the *"only edit `.md` files"* + *"format with prettier afterwards"* + *"emit a Conventional-Commits message"* triplet that a vault docs-writer mode wants.

#### 11.6 Roo comparison — additive over Roo

Roo has **no first-class skills concept**. The closest analogues each cover only part of what a skill does:

| Roo construct | What it provides | What skills add over it |
|---|---|---|
| `.roo/rules-<mode>/*.md` | Per-mode declarative instruction files (always-on while that mode is active). | Skills are **executable** (can include shell scripts the agent runs), and they are **dynamically loaded on-demand** by description-matching, not always-on — which keeps the system prompt small. |
| Orchestrator's `new_task(mode, prompt)` boomerang | Model-driven dispatch of a sub-agent that runs and returns. | Skills compose *without* spawning a new agent; the same agent picks the skill up mid-turn. Skills are also reusable across modes/agents, whereas a `new_task` payload is per-invocation. |
| Mode `customInstructions` | Per-mode prose appended to the system prompt. | Same scope (per-task instructions) but skills can also bundle **resources** (sample files, scripts) and are loaded *only* when relevant — `customInstructions` are paid for on every turn in that mode. |

**Net assessment: skills are a strict additive capability over Roo, particularly relevant for Path-B (CLI-first) playbook design.** They give the vault a place to encode the procedural memory ("when about to publish a release, run `release-checks.ps1` and …") that today lives scattered across rule files, custom instructions, and tribal knowledge. They are also **the most natural CLI counterpart to VS Code Copilot Chat's `*.prompt.md` files** — both are reusable Markdown procedures with frontmatter, the difference being that prompts are user-invoked (`/promptname`) whereas skills are model-invoked-by-description (`/skillname` is the override path, not the primary one).

#### 11.7 Cross-platform note (Windows-first vault concern)

The official skill examples ship Bash-first scripts (`./convert-svg-to-png.sh`, `./scripts/policy.sh`); the doc's tutorial uses `if [ "$TOOL_NAME" = "edit" ]; then …` Bash syntax verbatim. **A skill that calls a `.sh` script will fail silently on Windows when `pwsh`/`bash` is not on PATH** unless the skill ships a parallel `.ps1` and the `SKILL.md` body branches on platform. Squad's `distributed-mesh/` skill is the working pattern: it ships both `sync-mesh.sh` and `sync-mesh.ps1` and presumably tells the agent in the `SKILL.md` body to choose by `$IsWindows` / `uname`. The vault's Phase-8 playbook should adopt this dual-shipping pattern as a hard rule for any skill that exposes a script — and any skill that pre-approves `bash` via `allowed-tools` should also pre-approve `shell` (the PowerShell tool family on Windows) or it will prompt-storm the user on every Windows invocation.

---

## 12. Scripting / automation (Phase 5b-ii-A)

### Sources

- [`docs.github.com — Quickstart for automating with GitHub Copilot CLI`](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/quickstart). Accessed 2026-04-26.
- [`docs.github.com — Running GitHub Copilot CLI programmatically`](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically). Accessed 2026-04-26.
- [`docs.github.com — CLI command reference § Command-line options`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#command-line-options). Accessed 2026-04-26.
- [`docs.github.com — CLI programmatic reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference). Accessed 2026-04-26.
- [`docs.github.com — Automating tasks with Copilot CLI and GitHub Actions`](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/automate-with-actions). Accessed 2026-04-26.
- [`docs.github.com — SDK and CLI compatibility`](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/sdk-and-cli-compatibility). Accessed 2026-04-26.
- [`docs.github.com — OpenTelemetry (SDK observability)`](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry). Accessed 2026-04-26.
- [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) — open feature request: structured-output flags (`--output-format json` / `stream-json`). **Confirms the CLI does *not* yet support structured event-stream output.** Accessed 2026-04-26.
- [`../squad/README.md` § Watch Mode — Ralph's Automated Polling](../../../../squad/README.md) — Ralph daemon docs. Accessed 2026-04-26.
- [`apps/cli/src/agent/json-event-emitter.ts`](../../../apps/cli/src/agent/json-event-emitter.ts) — Roo's CLI event-stream implementation for the comparison. Accessed 2026-04-26.

### Findings (2026-04-26)

#### 12.1 ⚠️ Correction to Phase-5a stub: structured JSON output is NOT shipped

The Phase-5a § 3.4 table claimed `--output-format=text|json` emits NDJSON events. **Re-verified against the canonical [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference) and the [quickstart](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/quickstart): no `--output-format` / `--json` / `--jsonl` flag is documented for the CLI today.** The standing feature request is [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) (still open at access time), which explicitly references Claude Code's `--output-format stream-json` and Codex CLI's `--json` as the prior art being requested.

The CLI's headless output today is **plain text** (the model's final answer prose) plus session-chrome on stderr. Programmatic consumers are expected to either:
1. Strip chrome with `-s`/`--silent` and treat the prose as the result (as in the canonical quickstart's `result=$(copilot -p '…' -s)` pattern), or
2. Use `--share=PATH` to dump a Markdown transcript and parse that, or
3. Adopt the **SDK** (`@github/copilot-sdk`) and subscribe to its `streaming-events` channel for structured events — see [SDK streaming events doc](https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/streaming-events). The SDK is the only first-party path to a structured event stream right now.

**Filed as Q-042** (track [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52); update Phase-6 Gap Catalog when it ships). For the Phase-7 path-selection decision, this is **a meaningful CLI minus**: any CI consumer that wants per-event hooks, per-tool latency metrics, or live progress streaming must drop down to the SDK rather than wrap the binary.

#### 12.2 Headless flags — full catalogue (verified)

Sourced from the [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference), the [command reference § Command-line options](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#command-line-options), and the [run-cli-programmatically how-to](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically):

| Flag | Purpose | Notes |
|---|---|---|
| `-p, --prompt <text>` | One-shot prompt; CLI exits after the model completes. | If a prompt is also piped on stdin, **stdin is ignored** (`-p` wins). |
| `-s, --silent` | Suppress session metadata and chrome; emit only the final answer. | Required for clean variable capture in scripts. |
| `--no-ask-user` | Disable the `ask_user` interactive tool so the model cannot stall waiting for input. | Recommended for any unattended invocation. |
| `--allow-tool=PATTERN` | Repeatable; expand allowed-tool set using the `Kind(arg)` syntax (e.g., `shell(git:*)`, `write(./src/**)`, `url(github.com)`). | The narrow-permission pattern the docs lead with. |
| `--allow-url=URL` | Pre-approve specific URL targets. | Convenience over `--allow-tool='url(…)'`. |
| `--deny-tool=PATTERN` | Repeatable; expand denied-tool set. | **Deny wins over allow** when both match. |
| `--allow-all-tools` | ⚠️ Allow every tool, including `shell(*)`. | Sandbox-only. |
| `--allow-all-paths` | Loosen path scope. | Pair with `--allow-tool='write'`. |
| `--allow-all-urls` | Loosen URL scope. | Disables the SSRF allowlist. |
| `--yolo` | Equivalent to all three "all" flags. | Not for CI. |
| `--mode=plan\|interactive\|autopilot` | Pin a mode. | Defaults to `interactive`. |
| `--max-autopilot-continues=N` | Cap auto-iterations in autopilot mode (default ~25). | Roo has no equivalent. |
| `--model=<name>` | Override default model (`claude-sonnet-4.5`). | `auto`, `claude-opus-4.7`, `gpt-5`, `gpt-5.2-codex` documented. |
| `--agent=<name>` | Boot the session under a specific custom agent. | See § 5. |
| `--config-dir=<path>` | Per-invocation `COPILOT_HOME` override. | The portability hook. |
| `--additional-mcp-config=JSON\|@file` | Session-only MCP server definitions. | See § 9. |
| `--add-dir=<path>` | Add a workspace root (multi-repo). | Repeatable. |
| `--cwd=<path>` | Run as if invoked from a different directory. | Useful in CI to avoid `cd && copilot` chains. |
| `--resume <id\|name>` | Non-interactive resume of a previous session. | Pairs with the FTS5 session index from § 3.5. |
| `--continue` | Resume the most recent session in the current cwd. | Sugar for `--resume <last>`. |
| `--share=PATH` | Export the session transcript to Markdown after non-interactive completion. | Default file: `./copilot-session-<ID>.md`. |
| `--share-gist` | Publish the transcript as a secret GitHub gist. | ⚠️ Not available to Enterprise Managed Users or `*.ghe.com` data-residency tenants. |
| `--disable-builtin-mcps` | Disable all built-in MCP servers (`github-mcp-server`, `playwright`, `fetch`, `time`). | See § 9. |
| `--disable-mcp-server <name>` | Disable a single MCP server. | Repeatable. |
| `--no-color` | Strip ANSI from chrome (chrome is on stderr). | Pairs with `-s` for log-friendly output. |
| `-h, --help` / `--version` | Standard. | `--version` prints CLI + bundled SDK + Node versions. |

> ⚠️ Two options claimed in the Phase-5a § 3.4 stub were **not** confirmable in the current canonical reference at access time and are flagged for re-verification against the live `copilot --help` output: `--output-format=…` (definitively absent — see § 12.1) and the long form `--silent` (the docs use only `-s` and `--silent` interchangeably; both work). All other flags above survive verification.

#### 12.3 Exit codes

The canonical references treat exit codes briefly. Confirmed semantics from the [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference) plus the [run-cli-programmatically conditional examples](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically#use-in-a-conditional):

| Exit code | Meaning |
|---|---|
| `0` | Success — the model produced a final answer (note: *the answer's correctness is not verified by the CLI*; downstream `grep`/`jq` is the user's responsibility). |
| `non-zero` | Authentication failure, tool-permission denial under `--no-ask-user`, network/MCP failure, context-cap exceeded with no producible answer, or signal-terminated. |

The granular non-zero space (e.g., distinguishing auth-fail from permission-deny) is **not documented**. CI consumers that need to distinguish should parse stderr or rely on the `--share=PATH` Markdown transcript, since exit code 1 is overloaded. **Filed as Q-043.**

#### 12.4 Long-running daemon patterns — Squad's Ralph

Squad's Ralph daemon is the production-tested example of a long-running CLI driver, documented in [`../squad/README.md` § Watch Mode](../../../../squad/README.md). The CLI primitives that make Ralph possible are **a small, well-defined set**:

1. **`-p <text>` (or `-p <file>` via shell substitution).** Ralph builds a context snapshot Markdown file per round (issue list, squad state, recent decisions) and feeds it as the prompt. > "Ralph builds a context snapshot … writes this context to a temp file using the `-p <path>` flag … invokes the agent with that file: `gh copilot -p context.md`" — squad README.
2. **`--agent` (custom-agent boot).** Ralph defaults to the squad coordinator (`copilot --agent squad`); the `--agent-cmd` shell-level swap allows the user to point at any binary that accepts `-p`.
3. **Per-invocation isolation via fresh sessions.** Each Ralph round launches a brand-new `copilot` process (no `--resume`); state lives in `.squad/log/` and `.squad/agents/<name>/history.md` rather than in the CLI's session store. This avoids the "session got too big" failure mode that auto-compaction would otherwise eventually hit.
4. **Sentinel-file shutdown.** Ralph watches for `.squad/ralph-stop`; on detection it finishes the current round and exits. The CLI does not need to know about the sentinel — process-level wrapping is sufficient.

> ⚠️ **Important nuance.** Ralph's **default `--agent-cmd` is `gh copilot`** — the legacy GitHub CLI extension, not the agentic `@github/copilot` CLI that is the migration target. Squad's docs predate the GA of the new CLI and rely on the user passing `--agent-cmd "copilot"` to actually invoke the agentic binary. For vault adoption, document this explicitly: `squad watch --execute --agent-cmd "copilot" --copilot-flags "--allow-all-tools --no-ask-user --agent squad"`.

The takeaway: the CLI does **not** need a daemon mode of its own — the user's process-supervisor (Ralph here, but also `pm2`, `systemd`, a Windows Scheduled Task, or a GitHub Actions cron workflow) does the watching and re-launches `copilot -p …` per work item. The CLI's job is only to be cheap to spawn and to respect `--no-ask-user` so it never blocks indefinitely.

#### 12.5 CI recipes

**A. GitHub Actions step.** From the [run-cli-programmatically doc § CI/CD integration](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically#cicd-integration):

```yaml
- name: Generate test coverage report
  env:
    COPILOT_GITHUB_TOKEN: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
  run: |
    copilot -p "Run the test suite and produce a coverage summary" \
      -s --allow-tool='shell(npm:*), write' --no-ask-user
```

The `automate-with-actions` doc also documents the `github/copilot-cli-action` reusable action for one-line setup. **Authentication note:** the action expects either `COPILOT_GITHUB_TOKEN` (fine-grained PAT with the `Copilot Requests` permission) or a federated OIDC token; the default `${{ secrets.GITHUB_TOKEN }}` is *not* sufficient for Copilot CLI auth (different permission scope).

**B. Pre-commit hook (review staged diff).** A `.git/hooks/pre-commit` (or [`pre-commit`](https://pre-commit.com/) framework) snippet:

```bash
#!/usr/bin/env bash
diff=$(git diff --cached)
[ -z "$diff" ] && exit 0
verdict=$(printf '%s' "$diff" | copilot -p 'Review the staged diff for obvious bugs or security issues. \
  Reply only OK or ISSUES with one-line summary.' -s --no-ask-user --allow-tool='read')
echo "$verdict"
echo "$verdict" | grep -qi '^OK' || { echo "Refusing commit: $verdict"; exit 1; }
```

The Windows / `pwsh` equivalent works the same way against `git diff --cached | copilot …`.

**C. Watch-mode for issue triage (Ralph-style, pure Bash).** The minimal recipe behind Ralph, no Squad required:

```bash
#!/usr/bin/env bash
while true; do
  gh issue list --label 'triage' --json number,title \
    | copilot -p 'For each issue, classify as bug/feature/docs and suggest the right label. Apply labels via gh issue edit.' \
        --allow-tool='shell(gh:*), read' --no-ask-user -s
  sleep 300   # 5-minute poll
  [ -f ./ralph-stop ] && exit 0
done
```

#### 12.6 Comparison to Roo's `apps/cli` event emitter

Roo's CLI ([`apps/cli/`](../../../apps/cli)) is **architecturally distinct** from Copilot's: it spawns a headless VS Code extension host, IPCs to it, and re-emits the extension's `ClineMessage` stream as a structured NDJSON or final-JSON envelope via [`apps/cli/src/agent/json-event-emitter.ts`](../../../apps/cli/src/agent/json-event-emitter.ts) (905 lines; `JsonEventEmitter` class). Concretely:

| Axis | Roo `apps/cli` | Copilot CLI |
|---|---|---|
| **Process model** | Headless extension host + IPC client | Self-contained Node binary (no extension host) |
| **Output modes** | `"json"` (single accumulated envelope) and `"stream-json"` (NDJSON deltas) — see [`json-event-emitter.ts:7-15`](../../../apps/cli/src/agent/json-event-emitter.ts:7) | Plain text only today; structured-output flag is open feature request [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) |
| **Event types emitted** | `system:init`, `assistant`, `thinking`, `user`, `tool_use` (sub: `tool`/`command`/`mcp`), `tool_result`, `error`, `result`, `control`, `queue`. Schema versioned via `schemaVersion` + `protocol` fields in `system:init` (see [`json-event-emitter.ts:158-166`](../../../apps/cli/src/agent/json-event-emitter.ts:158)). Delta-aware: `previousContent` map computes per-message append-only deltas (`computeDelta`, [`:231-240`](../../../apps/cli/src/agent/json-event-emitter.ts:231)) and structured deltas for tool-use snapshots (`computeStructuredDelta`, [`:250-294`](../../../apps/cli/src/agent/json-event-emitter.ts:250)). | None as a binary surface; the **SDK** exposes streaming events ([Streaming events doc](https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/streaming-events)) but the binary does not pipe them. |
| **Sequence guarantees** | Stream-mode: `done: true` flag closes a logical message; reasoning streams use a `+1_000_000_000` key offset to avoid collision with text deltas ([`:91-92`](../../../apps/cli/src/agent/json-event-emitter.ts:91)); cost summary attached to terminal `result` event ([`:780-802`](../../../apps/cli/src/agent/json-event-emitter.ts:780)). | n/a (no event stream); transcripts are post-hoc Markdown via `--share`. |
| **Cost / token reporting per call** | Yes, parsed from `api_req_started` and attached to `result` events. | No (only the user's account-level dashboard). |
| **Headless invocation idiom** | `node ./apps/cli/dist <task-id> --json` (or `--stream-json`) | `copilot -p "…" -s --allow-tool='…' --no-ask-user` |

**Migration implication for the vault:** any vault automation today that invokes `node ./apps/cli/dist …` and parses NDJSON events must, on the CLI side, **either** (a) drop down to `@github/copilot-sdk` for equivalent structured streaming, or (b) accept text-only `copilot -p` output and lose per-tool / per-token telemetry. This is the **single largest CLI scripting gap** versus Roo: Roo's `apps/cli` was purpose-built for programmatic consumption; Copilot CLI's `-p` mode prioritises human-readable terminal output and treats automation as the secondary use case. **Filed as Q-042 (above) and updates the CLI gap catalog: G-6 (no structured event stream) is a new 🟠 *major* gap on the CLI path that Phase 6 should adopt.**

#### 12.7 OpenTelemetry / observability

Per the [CLI command reference](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference) and the [SDK observability doc](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry):

> "Copilot CLI can export traces and metrics via OpenTelemetry (OTel), giving you visibility into agent interactions, LLM calls, tool executions, and token usage." — CLI command reference

OTLP export is configured via the standard env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, etc.); no CLI-specific flag is documented. This is a strict win versus Roo's `apps/cli`, which has no OTel surface — and it partially mitigates G-6 (§ 12.6) for users who only need *aggregate* metrics rather than raw event streams.

---

## 13. Limits / known gaps relative to Roo (CLI Gap Catalog — Phase 5b-ii-B-2)

### Sources

- All sections above (§§ 0–12). No new external research; this is a pure synthesis closing Phase 5.
- Phase-4 Gap Catalog in [`40-copilot-chat-research.md` § 8](40-copilot-chat-research.md#8-limits--known-gaps) for format mirroring and G-/W- ID reuse.

### Findings (2026-04-26) — CLI Gap Catalog

Format mirrors the Phase-4 Gap Catalog. **G-** / **W-** IDs reuse Chat-side identifiers when a gap/win carries over. **CG-** / **CW-** IDs are new and CLI-specific. Severity legend: 🔴 blocker · 🟠 major · 🟡 minor · ✅ closed-on-CLI · 🟢 net win.

#### Part A — Inherited from Chat (cross-reference G-1…G-14)

| ID | Title | CLI severity | Chat severity (ref) | Why it carries over / how the CLI mitigates |
|---|---|---|---|---|
| **G-1** | Per-mode file-glob edit restriction (`fileRegex`) | **🟠 major** | 🔴 blocker | The `.agent.md` schema still has no `fileRegex`/`applyTo` for `edit`. **§ 10.6 verdict:** the CLI's `preToolUse` hook closes G-1 for **serial main-agent flows** (working PowerShell drop-in in § 10.4) but **not for `task`-dispatched sub-agents** ([`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392)) and leaks under parallel calls ([`copilot-cli#2893`](https://github.com/github/copilot-cli/issues/2893)). Demoted from blocker to major on the CLI; remains blocker on Chat. |
| **G-2** | Per-mode rules folder (`.roo/rules-<mode>/`) | 🟠 major | 🟠 major | Same root cause as Chat (instructions are file-glob-scoped via `applyTo:`, not agent-scoped). Same workaround: inline into the `.agent.md` body, or Markdown-link `.instructions.md` files from the body (§ 4.3). |
| **G-3** | Workspace-scoped tool sets (`*.toolsets.jsonc`) | **N/A** | 🟠 major | The CLI has no toolsets concept; per-agent tool allowlisting is done directly in `.agent.md` `tools:` (workspace-scoped via `.github/agents/`). The Chat-only blocker disappears entirely. |
| **G-4** | Sequential-only `new_task` orchestration | 🟡 minor | 🟡 minor | Same as Chat: `task` sub-agents are parallel-capable; sequential-only is prose-discipline only (§ 3.7, § 8 mapping row). |
| **G-5** | Native webview UI | 🟠 major | 🟡 minor | Worse on the CLI: there is **no GUI at all** for mode/MCP/rule editing (TTY only). See CG-1 below — the CLI accepts this trade-off intentionally. |
| **G-6** | Multi-thread chat sessions per workspace | ✅ better | ✅ better | The CLI ships `--continue` / `--resume` / `--resume <id>` plus FTS5 session search (§ 3.5). Comparable-or-better to Chat's multi-session UX, just terminal-driven. |
| **G-7** | 128-tool-per-request hard cap | 🟡 minor | 🟡 minor | Carries over (CLI uses the same model-side tool-count limit). Per-agent `tools:` allowlists keep counts low; same mitigation as Chat. |
| **G-8** | Settings Sync coverage gaps | **✅ closed** | 🟡 minor | The CLI uses files under `~/.copilot/` (or wherever `COPILOT_HOME` points). Vault portability via `COPILOT_HOME` (Q-008) sidesteps Settings Sync entirely. |
| **G-9** | Chat-history portability / export | 🟡 minor | 🟠 major | The CLI's `session-state/<id>/` is plain JSONL + Markdown plan + checkpoints — trivially backed up with `xcopy`/`tar`. Materially better than Chat's profile-scoped DB (§ 2.2). |
| **G-10** | Custom approval policies per tool / MCP | ✅ better | ✅ better | The CLI's `Kind(arg)` allow/deny grammar (§ 3.3) plus per-invocation `--allow-tool`/`--deny-tool` is already first-class; both surfaces "win". |
| **G-11** | Multi-profile vault automation | **✅ closed** | 🟡 minor | The CLI has no "profile" concept; `COPILOT_HOME` (single env var) replaces the Chat profile-id symlink dance entirely. |
| **G-12** | Sub-agent return is a structured payload | 🟡 minor | 🟡 minor | Same as Chat: `task` returns the sub-agent's final assistant message as free-form text. Workaround: prompt sub-agent to return a JSON block. |
| **G-13** | Local model providers (per-key BYOK) | **✅ closed** | 🟠 major | **Resolved on the CLI path** (§ 7.2 / § 8): `COPILOT_PROVIDER_BASE_URL` / `COPILOT_PROVIDER_TYPE` (openai/azure/anthropic) / `COPILOT_PROVIDER_API_KEY` / `COPILOT_MODEL`. Ollama via OpenAI-compat endpoint works. |
| **G-14** | Sandboxing on Windows | 🟡 minor | 🟡 minor | The CLI inherits the same Windows-platform limitation (no `sandbox`/`sandboxEnabled` honoured); no regression vs Roo. |

**Inherited tally (CLI):** G-1 demoted to 🟠; G-2 / G-5 / G-9 stay 🟠 (G-5 worse, G-9 better); G-3 / G-8 / G-11 / G-13 either N/A or **closed**; the rest stay 🟡 / ✅. Net: **2 of the Chat catalog's 4 majors are erased on the CLI**, and **the lone 🔴 is demoted to 🟠** (with caveats).

#### Part B — CLI-specific gaps (CG-1…CG-15)

| ID | Title | Severity | Description / workaround |
|---|---|---|---|
| **CG-1** | No webview UI for mode/MCP/rule CRUD | 🟠 | Mode and MCP editing is *file editing + slash commands* (`/agent`, `/mcp`, `/skills`, `/instructions`). UX regression vs Roo's `ModesView.tsx` for non-terminal-comfortable users; acceptable for the target audience. Cross-reference G-5 (worse on CLI). |
| **CG-2** | Process-env-only secrets for MCP | 🟡 | No keychain integration like Chat's `${input:…}` Credential-Manager prompt; the OS keychain is reserved for the GitHub auth token (§ 9.3, Q-033). Recommended Windows pattern: `[Environment]::SetEnvironmentVariable("KEY","val","User")`. |
| **CG-3** | `mcpServers` vs `servers` schema fork | 🟡 | A given MCP server requires two configs — one for `.vscode/mcp.json` (`servers:` + `inputs:`) and one for `mcp-config.json`/`.github/mcp.json` (`mcpServers:` + `${VAR}`). Documented one-line `jq` migration in § 9.1; vault must pick a canonical source and generate the other. |
| **CG-4** | Repo-layer `settings.json` 6-key allowlist | 🟠 | Only `companyAnnouncements`, `disableAllHooks`, `enabledPlugins`, `extraKnownMarketplaces`, `hooks`, `mergeStrategy` are honoured at repo scope; vault `allowedTools` / `deniedTools` / `systemPrompt` overrides are silently dropped (§ 10.5, Q-032). Mitigated by user-scope settings or per-invocation flags / per-agent inlining. |
| **CG-5** | Sub-agent depth & concurrency caps | 🟡 | Default sub-agent depth = 6, concurrency = 32 (§ 5.1). Likely sufficient for vault patterns (single-level + sequential), but nested orchestrators must be tested before production (Q-034). |
| **CG-6** | Windows hook latency unknown | 🟡 | `pwsh -NoProfile -Command …` cold-start is ~150–400 ms typical, >1 s with module loads (§ 10.4). Adds visible lag on tool-heavy turns; needs empirical measurement on the user's box (Q-039) before recommending hook-heavy policies. |
| **CG-7** | No structured `--output-format=json` / `stream-json` | 🟠 | Confirmed absent ([`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52); § 12.1, § 12.6, Q-042). Roo's `apps/cli` emits 28+ typed NDJSON event types via [`json-event-emitter.ts`](../../../apps/cli/src/agent/json-event-emitter.ts); Copilot CLI is plain-text only. **Mitigated** by (a) `@github/copilot-sdk` streaming events for code-driven consumers and (b) OTel for aggregate metrics. The single largest scripting gap vs Roo. |
| **CG-8** | SDK is 0.x alpha with ~monthly minor breaks | 🟠 | 54 versions in ~5 months; *"minor breaking changes may still occur between releases"* (§ 7.6, Q-046). Squad ships an ESM patcher and an adapter mirror layer to survive the churn; any Path-D VSIX consuming the SDK directly inherits the same maintenance burden. |
| **CG-9** | Skill `allowed-tools: shell` security risk | 🟡 | Skills can pre-approve `shell` / `bash` to skip per-call confirmation (§ 11.2). Bypasses the approval flow that is otherwise the CLI's primary safety net. Policy: **never enable for unreviewed third-party skills**; document in vault Phase-8 playbook. |
| **CG-10** | No GUI for `/mcp` / `/agent` / `/skills` / `/instructions` | 🟡 | Slash-command-only management; intentional CLI design choice but a real gap vs Roo's webview pickers. Cross-references CG-1; severity is split because slash commands are cheap to learn even when no GUI exists. |
| **CG-11** | Sub-agent `preToolUse` bypass | 🟠 | [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) — `task`-dispatched sub-agents leak past hook policies. **The binding constraint on G-1's CLI mitigation** (§ 10.6). Mitigated today by using `--agent` boot mode for restriction-sensitive workflows and explicitly forbidding sub-agent dispatch in agent bodies that need file-regex enforcement. |
| **CG-12** | Squad alpha v0.9.1 production risk | 🟠 (Path-C only) | Squad pin is `^0.1.32` of `@github/copilot-sdk` (3 minors behind current 0.3.0); Squad itself is alpha (Q-011). Material production risk if you build on Squad's orchestration layer; **N/A** for Path-A (Chat) or Path-B (CLI built-ins only). |
| **CG-13** | Active agent name not in hook payload | 🟡 | `preToolUse` payload has `toolName`, `toolArgs`, `cwd`, `sessionId`, `timestamp` — no `agentName` / sub-agent depth (Q-037). Per-mode `fileRegex`-equivalent must thread the agent identity via a sidecar state file written from `subagentStart`; reference impl in § 10.4. |
| **CG-14** | Plugin-defined `preToolUse` hooks don't fire | 🟡 | [`copilot-cli#2540`](https://github.com/github/copilot-cli/issues/2540) — only repo + user hooks reliably fire; plugin-shipped hooks are silently dropped. Mitigation: ship the vault's `fileRegex`-equivalent as a repo or user hook, never as a plugin. |
| **CG-15** | `modifiedArgs` / `updatedInput` not honoured | 🟡 | [`copilot-cli#2013`](https://github.com/github/copilot-cli/issues/2013) — docs list a `modifiedArgs` output field for `preToolUse`, but the CLI ignores it. Hooks can only allow/deny, not rewrite (e.g., re-route writes to a quarantine dir). Pure deny-or-allow policy semantics on the CLI today. |

**CG- tally:** 5 × 🟠, 9 × 🟡, 1 × 🟠 (Path-C-only). Notably **zero 🔴 blockers** — every CLI-specific gap has a documented workaround.

#### Part C — CLI-specific wins (CW-1…CW-12)

| ID | Title | Severity | One-line summary |
|---|---|---|---|
| **CW-1** | `preToolUse` hook = the only ergonomic place to enforce `fileRegex` | 🟢 | Closes G-1's worst-case impact for serial main-agent flows; § 10.4 PowerShell drop-in is the reference impl. |
| **CW-2** | BYOK provider env vars (Ollama / Anthropic / Azure) | 🟢 | Closes G-13 entirely — the Chat path's 🟠 major becomes ✅ on the CLI. |
| **CW-3** | Headless `-p` + OpenTelemetry for CI/CD | 🟢 | Even without `--output-format=json`, OTel gives traces / metrics / token-usage observability that Roo's `apps/cli` does not have (§ 12.7). |
| **CW-4** | `--resume` with FTS5 session search | 🟢 | Durable conversational memory across invocations; full-text search across events and plan files (§ 3.5). |
| **CW-5** | Skills as executable Markdown | 🟢 | Strict additive over Roo's mode/rule split — a skill bundle (`SKILL.md` + helper script) is reusable across agents and loaded on-demand (§ 11.6). |
| **CW-6** | `COPILOT_HOME` portability | 🟢 | Single env var redirects all CLI state (settings, agents, skills, instructions, hooks, MCP, sessions). Vault portability becomes trivial vs Chat's per-profile-id symlink dance (resolves Q-008; closes G-11). |
| **CW-7** | Squad rides natively here | 🟢 (Path-C) | If the user wants parallel orchestration / Ralph daemon, the CLI is the only path — Squad has no `vscode.lm` dependency (Q-010). |
| **CW-8** | `defineTool` in `@github/copilot-sdk` | 🟢 | Zod-typed custom tools without writing a VSIX — Path-D-lite for Node-script users (§ 7.2). |
| **CW-9** | Programmatic `SessionHooks` in the SDK | 🟢 | Six lifecycle callbacks (`onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`, `onSessionStart`, `onSessionEnd`, `onErrorOccurred`) for CI/CD orchestrators — file-based hook parity, in-process (§ 7.2). |
| **CW-10** | Lower per-invocation latency than VS Code Chat | 🟢 | No extension-host startup; `copilot -p …` is a single Node spawn — measurably faster cold-start for one-shot CI work. |
| **CW-11** | Auto-compaction at ~95% context | 🟢 | "Infinite sessions" — no manual `/clear` ever required (§ 3.5); Roo has no equivalent. |
| **CW-12** | First-class permission grammar (`Kind(arg)` allow/deny) | 🟢 | `--allow-tool='shell(git:*)'`, `--deny-tool='shell(git push)'`, deny-wins semantics (§ 3.3). Finer-grained and more pinnable than anything Roo or Chat ships out of the box. |

**CW- tally:** 12 wins (10 universal + 2 path-specific). Compares to Chat's W-1…W-12 (12 wins) — **the CLI matches Chat's win count while closing 3 of Chat's gaps outright** (G-3 / G-11 / G-13) and **demoting the lone Chat blocker** (G-1 🔴 → 🟠).

#### Part D — Net verdict

**Headline severity tally.** CLI-side gaps total **5 × 🟠 + 10 × 🟡** (including G-2/G-5 inherited and CG-1…CG-15), with **zero 🔴 blockers**. Chat-side, by contrast, carried **1 × 🔴 + 4 × 🟠 + ~6 × 🟡** (Phase 4d net assessment). Adjusting for the items the CLI actually closes — G-3 (N/A), G-8 / G-11 / G-13 (✅) — **the CLI eliminates one blocker and three majors that Chat carries**, while introducing four new majors of its own (CG-1 webview-UI loss, CG-4 repo-allowlist scope, CG-7 no structured output, CG-8 SDK churn, CG-11 sub-agent hook bypass). On wins, both paths ship 12 entries; the CLI's CW-1 through CW-6 are *materially harder to replicate on Chat* (hook enforcement, BYOK, OTel, skills, portability) while Chat's W-1 through W-12 are mostly UX-and-marketplace conveniences that the CLI deliberately forgoes. **Net structural severity is lower on the CLI path** — fewer absolute blockers, fewer dependency-blocking unknowns, and a clearer escape hatch for every remaining major (hooks for G-1, env vars for G-13, file backups for G-9, slash commands for CG-1).

**Path-specific recommendation preview (feeds Phase 7).** The CLI is the natural choice for **DevOps, CI-heavy, parallel-orchestration, and BYOK-dependent users** — anyone who scripts agentic work, runs Ralph-style watch loops, hosts non-Copilot models locally, or values vault portability via `COPILOT_HOME` over Chat's profile-id machinery. The **interactive coding, multi-profile, and GUI-comfortable audiences** are still better served by Chat — `ModesView`-style affordances, checkpoint UX, fork-conversation, and the unified chat panel have no CLI counterparts and never will. **The two paths are complementary, not competing** — Phase 7 should preserve the option to run both in parallel (same `.agent.md` files work in both, same `AGENTS.md`, same MCP servers via the documented schema fork) and let the user pick the surface per workflow. Squad (Path C) layers on top of the CLI only and is gated on accepting CG-12's alpha-stability risk; Path D (vault-as-VSIX) is 🟡 embeddable but inherits CG-8's monthly SDK-churn tax (§ 7.5).

**Open risks worth tracking upstream.** The three highest-leverage issues to file/test/track before committing to a CLI-first migration:

1. **[`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) — sub-agent `preToolUse` bypass (CG-11).** This is the single biggest threat to the G-1 mitigation. Until it ships, the vault must avoid `task`-dispatched sub-agents in restriction-sensitive workflows or accept that `fileRegex` is unenforced once the orchestrator delegates.
2. **[`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) — structured `--output-format=json` / `stream-json` (CG-7, Q-042).** When this lands, the CLI matches Roo's `apps/cli` for CI integration and the SDK fall-back becomes optional rather than required. Phase-6 Gap Catalog should be revisited.
3. **Q-039 — empirical `pwsh` cold-start latency on the user's Windows 11 box (CG-6).** Trivial to measure (`Measure-Command { 1..20 | % { pwsh -NoProfile -Command 'exit 0' } }`), but it sizes the cost ceiling for the entire hook-based G-1 mitigation. Worth running before Phase 8 commits to a hook-heavy playbook.

Honourable mentions tracked but lower-leverage: [`copilot-cli#2893`](https://github.com/github/copilot-cli/issues/2893) (parallel-call hook race), [`copilot-cli#2540`](https://github.com/github/copilot-cli/issues/2540) (plugin hook bug, CG-14), [`copilot-cli#2013`](https://github.com/github/copilot-cli/issues/2013) (`modifiedArgs` ignored, CG-15), and Q-046 (CLI binary bundling for Path-D VSIX).

---

## Cross-links

- [`00-plan.md`](00-plan.md) · [`30-squad-inventory.md`](30-squad-inventory.md) · [`40-copilot-chat-research.md`](40-copilot-chat-research.md) · [`60-gap-analysis.md`](60-gap-analysis.md) · [`90-decision-log.md`](90-decision-log.md) · [`99-open-questions.md`](99-open-questions.md)
