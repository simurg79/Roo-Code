# Squad vs. Roo-Code — Comparative Analysis

A side-by-side architectural and feature comparison of two AI agent systems sitting in adjacent corners of the developer-tooling space:

- **Squad** (`@bradygaster/squad`) — a CLI + SDK that orchestrates multi-agent "teams" on top of GitHub Copilot.
- **Roo-Code** (`roo-cline`) — a VS Code extension descended from Cline that ships a fully self-contained AI coding agent with its own provider layer.

All paths in this report are repo-relative. Squad paths are rooted at `c:/git/squad`; Roo-Code paths are rooted at `c:/git/Roo-Code`.

---

## 1. Project Overview & Purpose

### Squad

Squad bills itself as **"human-led AI agent teams for any project"** and explicitly targets GitHub Copilot as its execution substrate. From [`README.md`](../../README.md:1) (Squad):

> Squad gives you a human-directed AI development team through GitHub Copilot. … Each team member runs in its own context, reads only its own knowledge, and writes back what it learned so the work stays inspectable.

It is distributed as two npm packages — [`@bradygaster/squad-sdk`](../../packages/squad-sdk/package.json:2) and [`@bradygaster/squad-cli`](../../packages/squad-cli/package.json:2) (both currently `0.9.1`, alpha) — installed globally and driven from the terminal (`squad init`, `squad triage`, `copilot --agent squad`). State for a team lives in a committed `.squad/` directory of markdown files (charters, history, decisions, routing).

- **License:** MIT
- **Target audience:** developers already using GitHub Copilot who want a persistent, file-backed multi-agent layer on top of it
- **Distribution:** npm CLI + SDK; agents are markdown definitions living in the user's repo
- **Lineage:** original work by `@bradygaster`; not a fork of Roo or Cline

### Roo-Code

Roo-Code is a **VS Code extension** providing an autonomous AI coding agent. From [`src/package.json`](../src/package.json:2) it publishes as `roo-cline` (publisher `RooVeterinaryInc`, version `3.52.1`). The README and historical naming make clear it is a **fork/derivative of Cline** that has diverged substantially: deep settings UI, modes system, model marketplace, evals harness, cloud telemetry, etc.

- **License:** see [`LICENSE`](../../LICENSE) (Apache 2.0-style, project specific)
- **Target audience:** VS Code users who want an in-IDE autonomous coding agent with broad provider choice
- **Distribution:** `.vsix` published to the VS Code Marketplace and OpenVSX; nightly variant via [`apps/vscode-nightly`](../../apps/vscode-nightly)
- **Lineage:** fork of Cline (the codebase still uses `roo-cline` and `cline` terminology in many places, e.g. [`src/__tests__/removeClineFromStack-delegation.spec.ts`](../../src/__tests__/removeClineFromStack-delegation.spec.ts:1))

The two projects are **not related by fork**. They occupy adjacent niches: Squad delegates execution to Copilot and focuses on team orchestration; Roo-Code owns its own model loop and focuses on a single in-IDE agent (with sub-agent "modes").

---

## 2. Repository Structure

### Squad — npm-workspaces monorepo

[`package.json`](../../package.json:7) declares `workspaces: ["packages/*"]` with two packages:

```
packages/
├── squad-sdk/    → @bradygaster/squad-sdk (the runtime library)
└── squad-cli/    → @bradygaster/squad-cli (the binary)
```

Top-level layout (from `list_files c:/git/squad`):

- [`packages/squad-sdk/src/`](../../packages/squad-sdk/src) — **the bulk of the codebase**: ~30 subsystems (agents, casting, coordinator, ralph, runtime, marketplace, sharing, platform, storage, streams, …)
- [`packages/squad-cli/src/`](../../packages/squad-cli/src) — `cli/`, `shell/`, `commands/`, plus a `remote-ui/`
- [`templates/`](../../templates) — markdown templates copied into a user's `.squad/` directory on `squad init` (charters, ceremonies, routing, ralph-triage, etc.)
- [`samples/`](../../samples) — eight sample projects
- [`docs/`](../../docs) — Astro-based documentation site (`astro.config.mjs`, `pagefind.yml`, Playwright tests)
- [`test/`](../../test) — flat directory with **~200 test files** (vitest)
- [`.changeset/`](../../.changeset) — independent versioning per package

Tooling: TypeScript 5.7, ESLint 10, vitest 3, Playwright, markdownlint, cspell, esbuild for the CLI bundle (`cli.js`). Build pipeline is plain `tsc` per package plus a postbuild copy step.

### Roo-Code — pnpm + Turbo monorepo

The root [`package.json`](../package.json:2) uses `pnpm@10.8.1` and Turbo for task orchestration. [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) declares multiple workspaces:

- [`src/`](../src) — the **VS Code extension itself** (`roo-cline`), with subsystems under [`src/core/`](../src/core) (assistant-message, tools, prompts, task, condense, checkpoints, mentions, message-queue, …), [`src/api/providers/`](../src/api/providers), [`src/services/`](../src/services), [`src/integrations/`](../src/integrations), [`src/i18n/`](../src/i18n)
- [`webview-ui/`](../webview-ui) — React + Vite app rendered in the extension's webview
- [`apps/`](../apps) — peripheral apps: [`apps/cli`](../apps/cli), [`apps/vscode-e2e`](../apps/vscode-e2e), [`apps/vscode-nightly`](../apps/vscode-nightly), [`apps/web-evals`](../apps/web-evals), [`apps/web-roo-code`](../apps/web-roo-code)
- [`packages/`](../packages) — shared libs: [`packages/types`](../packages/types), [`packages/cloud`](../packages/cloud), [`packages/telemetry`](../packages/telemetry), [`packages/ipc`](../packages/ipc), [`packages/evals`](../packages/evals), [`packages/build`](../packages/build), [`packages/vscode-shim`](../packages/vscode-shim), config-* packages
- [`locales/`](../locales) and [`src/i18n/`](../src/i18n) — 14+ localized README/CONTRIBUTING and runtime translation files
- [`.changeset/`](../.changeset) — also uses changesets

Build/packaging tooling: Turbo + esbuild ([`src/esbuild.mjs`](../src/esbuild.mjs)), `@vscode/vsce`, `ovsx`. Bundling produces a `.vsix` rather than an npm tarball.

**Net:** Squad is a "two-package SDK + CLI" monorepo of moderate size. Roo-Code is a **much larger** product monorepo containing the extension, a webview SPA, multiple supporting apps, and a docker-based evals harness.

---

## 3. Tech Stack & Dependencies

| Dimension | Squad | Roo-Code |
|---|---|---|
| Languages | TypeScript (strict, ESM) | TypeScript (mix CJS/ESM, extension is CJS) |
| Node | `>=22.5.0` ([`package.json`](../../package.json:27)) | `20.19.2` (pinned, [`package.json`](../package.json:5)) |
| Package mgr | npm workspaces | pnpm + Turbo |
| Test | vitest 3, Playwright | vitest, Playwright (e2e), `@vscode/test-electron` |
| Build | `tsc` + esbuild bundle | esbuild + Turbo + `vsce`/`ovsx` |
| Lint | ESLint 10 + `tsc --noEmit` | ESLint 9 + Turbo `check-types` |
| Docs lint | markdownlint-cli2 + cspell | prettier + lint-staged |
| UI runtime | **Ink + React 19** (terminal UI, [`squad-cli/package.json`](../../packages/squad-cli/package.json:185)) | **React 18** in a VS Code webview (`webview-ui/`) |
| Core LLM dep | `@github/copilot-sdk` ^0.1.32 ([`squad-sdk/package.json`](../../packages/squad-sdk/package.json:235)) | ~30+ provider SDKs (see §4) |
| Telemetry | OpenTelemetry (optional deps for grpc exporters, traces, metrics) | Custom + PostHog via [`packages/telemetry`](../packages/telemetry) |
| Storage | Pluggable: fs / in-memory / sql.js ([`squad-sdk/src/storage/`](../../packages/squad-sdk/src/storage)) | VS Code globalState + workspace files; checkpoints via shadow git |

The starkest dependency contrast: **Squad has essentially one model dependency** (`@github/copilot-sdk`) plus optional OpenTelemetry. **Roo-Code has direct integrations with ~30 model providers** (see [`src/api/providers/`](../src/api/providers)) — Anthropic, OpenAI, OpenAI-Codex, Bedrock, Vertex, Gemini, DeepSeek, Mistral, Moonshot, Fireworks, Groq, OpenRouter, Requesty, Unbound, Vercel AI Gateway, LM Studio, Ollama, LiteLLM, Baseten, SambaNova, Poe, Qwen-Code, MiniMax, xAI, Z.AI, VS Code LM API, plus a `roo` first-party gateway.

---

## 4. Core Architecture

### 4a. Host architecture & entry points

- **Squad** is a **Node CLI** binary ([`packages/squad-cli/src/cli-entry.ts`](../../packages/squad-cli/src/cli-entry.ts)). Its primary "agent execution" path is to **shell out to the GitHub Copilot CLI** (`gh copilot` / `copilot --agent squad`) with a context file. There is no IDE host. An optional Ink-based interactive shell is shipped but marked deprecated in favor of the Copilot CLI.
- **Roo-Code** activates inside a VS Code extension host ([`src/extension.ts`](../src/extension.ts)) and renders its UI in a webview (`webview-ui/`). The extension owns its own task/agent execution loop entirely in-process.

### 4b. Task / agent execution loop

- **Squad** implements a **coordinator + fan-out** pattern, with explicit tier-based response selection:
  - [`packages/squad-sdk/src/coordinator/coordinator.ts`](../../packages/squad-sdk/src/coordinator/coordinator.ts) — primary coordinator
  - [`packages/squad-sdk/src/coordinator/fan-out.ts`](../../packages/squad-sdk/src/coordinator/fan-out.ts) — parallel agent dispatch
  - [`packages/squad-sdk/src/coordinator/response-tiers.ts`](../../packages/squad-sdk/src/coordinator/response-tiers.ts) — model tiering
  - Long-running automation lives under [`packages/squad-sdk/src/ralph/`](../../packages/squad-sdk/src/ralph) ("Ralph" = the watch/triage daemon with rate limiting, capabilities, polling)
- **Roo-Code** runs a single in-process agent loop centered on the `Task` (formerly `Cline`) class under [`src/core/task/`](../src/core/task), with a tightly woven set of subsystems for assistant-message parsing, message queueing, context management, condense (auto-summarization), checkpoints, and tool invocation. Sub-agents are spawned via the `new_task` tool and tracked in a stack ([`src/__tests__/nested-delegation-resume.spec.ts`](../src/__tests__/nested-delegation-resume.spec.ts)).

### 4c. Provider / model abstraction

- **Squad** does not abstract over multiple models in the Roo sense — it delegates to Copilot. Model selection is a **policy** ([`config/models.ts`](../../packages/squad-sdk/src/config/models.ts), [`agents/model-selector.ts`](../../packages/squad-sdk/src/agents/model-selector.ts)) about which Copilot-available model tier ("haiku-4.5", "sonnet-4", etc.) a given role/task should use.
- **Roo-Code** has a first-class provider abstraction in [`src/api/providers/`](../src/api/providers) with a [`base-provider.ts`](../src/api/providers/base-provider.ts) and [`base-openai-compatible-provider.ts`](../src/api/providers/base-openai-compatible-provider.ts), each concrete provider implementing model listing, streaming, function calling, and cost accounting. ~30 providers are shipped.

### 4d. Prompt construction

- **Squad** prompts are largely **markdown documents** authored by the user (per-agent `charter.md`, `history.md`, team `routing.md`, plus templates under [`templates/`](../../templates)). The runtime composes them via the charter compiler ([`agents/charter-compiler.ts`](../../packages/squad-sdk/src/agents/charter-compiler.ts)).
- **Roo-Code** has a **programmatic prompt system** under [`src/core/prompts/`](../src/core/prompts) — [`system.ts`](../src/core/prompts/system.ts) assembles the system prompt from per-mode templates, tool descriptions ([`tools/native-tools/`](../src/core/prompts/tools/native-tools) and the legacy XML tool descriptions), capability sections, and i18n strings.

### 4e. Tool system

- **Squad** exposes a `tools/` module ([`packages/squad-sdk/src/tools/index.ts`](../../packages/squad-sdk/src/tools/index.ts)) and a `hooks/` module for custom tool plumbing. Because actual execution happens through the Copilot agent runner, "tools" in Squad are largely SDK-side primitives: file-write guards, PII scrubbing, reviewer lockout (per [`README.md`](../../README.md:478)).
- **Roo-Code** has a **rich, dual-format tool surface** under [`src/core/tools/`](../src/core/tools) and [`src/core/prompts/tools/`](../src/core/prompts/tools) — read_file, apply_diff, write_to_file, execute_command, browser_action, search_files, list_files, codebase_search, new_task, switch_mode, ask_followup_question, attempt_completion, plus MCP tool/resource invocations. It supports both XML-style tool calls (legacy/Cline) and provider-native function calling (e.g. [`src/core/prompts/tools/native-tools/`](../src/core/prompts/tools/native-tools)).

### 4f. MCP support

- **Squad** has only lightweight MCP **configuration** awareness — see [`templates/mcp-config.md`](../../templates/mcp-config.md) and [`test/mcp-config.test.cjs`](../../test/mcp-config.test.cjs). MCP servers are passed *through* to Copilot via flags; Squad does not host the MCP client itself.
- **Roo-Code** is a **first-class MCP client host**. It manages MCP server lifecycle, exposes server tools/resources to the agent, surfaces a Settings UI for them, and supports per-mode allow-listing of servers (see [`docs/design/per-mode-mcp-settings.md`](../design/per-mode-mcp-settings.md), [`src/core/prompts/tools/native-tools/mcp_server.ts`](../../src/core/prompts/tools/native-tools/mcp_server.ts), [`packages/types/src/__tests__/mode-allowedMcpServers.spec.ts`](../../packages/types/src/__tests__/mode-allowedMcpServers.spec.ts), [`webview-ui/src/components/modes/McpServerRestriction.tsx`](../../webview-ui/src/components/modes/McpServerRestriction.tsx)).

### 4g. Modes / personas / agents

This is the most direct conceptual overlap, but the implementations differ.

- **Squad agents** are **persistent, named team members** ("Edie", "McManus", "Keaton" — drawn from a casting registry in [`packages/squad-sdk/src/casting/`](../../packages/squad-sdk/src/casting)). Each has a `charter.md`, an evolving `history.md`, and a role from a catalog ([`roles/catalog.ts`](../../packages/squad-sdk/src/roles/catalog.ts)). Agents are intended to *learn* (write back to `history.md`) and persist across sessions in git.
- **Roo-Code modes** are **stateless personas** keyed by slug (`code`, `architect`, `ask`, `debug`, `orchestrator`, plus user customs). Defined in [`packages/types/src/mode.ts`](../../packages/types/src/mode.ts) and configured via [`.roomodes`](../../.roomodes) (per-project) and `custom_modes.yaml` (per-user). Each mode has tool restrictions, file regex restrictions, role definition, and (recently) `allowedMcpServers`.

### 4h. State & persistence

- **Squad** writes state into the **working tree's `.squad/`** (or, optionally, externalizes it via `squad externalize`). State backends include git-notes and orphan branches for the watch loop ([`packages/squad-sdk/src/state-backend.ts`](../../packages/squad-sdk/src/state-backend.ts)). Storage providers are pluggable: fs, in-memory, sql.js ([`packages/squad-sdk/src/storage/`](../../packages/squad-sdk/src/storage)).
- **Roo-Code** persists in VS Code `globalState`/`workspaceState` and on disk under the extension's storage, plus shadow-git **checkpoints** ([`src/core/checkpoints/`](../src/core/checkpoints)) for diff-style rollback inside a task.

### 4i. Internationalization

- **Squad** has a runtime i18n module ([`packages/squad-sdk/src/runtime/i18n.ts`](../../packages/squad-sdk/src/runtime/i18n.ts)) and Chinese README ([`README.zh.md`](../../README.zh.md)), but the project is largely English-only.
- **Roo-Code** ships a **deep i18n system**: 14+ locales for both extension strings ([`src/i18n/locales/`](../src/i18n)) and webview strings ([`webview-ui/src/i18n/locales/`](../webview-ui/src/i18n)), localized `package.nls.*.json`, and 14+ fully-translated `README.md` / `CONTRIBUTING.md` under [`locales/`](../locales).

### 4j. Parallel agent execution ⚡

This is one of the most consequential architectural divergences and deserves its own section. **Squad treats parallelism as a first-class primitive at every layer; Roo-Code is sequential by deliberate design.**

#### Squad — parallel by default

| Layer | Squad implementation | File |
|---|---|---|
| **Routing** | Coordinator returns `parallel: true/false` per request and emits OTel spans for it | [`packages/squad-sdk/src/coordinator/index.ts`](../../packages/squad-sdk/src/coordinator/index.ts) |
| **Fan-out spawn** | Multi-agent dispatch via `Promise.allSettled` for max throughput | [`packages/squad-sdk/src/coordinator/fan-out.ts`](../../packages/squad-sdk/src/coordinator/fan-out.ts) |
| **Session pool** | Lifecycle manager for concurrent agent sessions with concurrency limits | [`packages/squad-sdk/src/client/session-pool.ts`](../../packages/squad-sdk/src/client/session-pool.ts) |
| **User syntax** | `@Agent1 @Agent2 message` triggers parallel dispatch from the interactive shell | [`packages/squad-cli/src/cli/shell/index.ts`](../../packages/squad-cli/src/cli/shell/index.ts) |
| **Wave dispatch** | `--wave-dispatch` flag for parallel sub-task execution *within* a single issue | [`packages/squad-cli/src/cli/commands/watch/capabilities/wave-dispatch.ts`](../../packages/squad-cli/src/cli/commands/watch/capabilities/wave-dispatch.ts) |
| **Fleet dispatch** | Batches read-heavy issues into one parallel `/fleet` Copilot session | [`packages/squad-cli/src/cli/commands/watch/capabilities/fleet-dispatch.ts`](../../packages/squad-cli/src/cli/commands/watch/capabilities/fleet-dispatch.ts) |
| **Watch daemon** | Ralph exposes `--max-concurrent N` for parallel issue triage | [`packages/squad-cli/src/cli-entry.ts`](../../packages/squad-cli/src/cli-entry.ts) |
| **Memory writes** | History-shadow serializes writes per file but parallelizes across agents | [`packages/squad-sdk/src/agents/history-shadow.ts`](../../packages/squad-sdk/src/agents/history-shadow.ts) |

Squad even ships a marketed docs page (`features/parallel-execution`) and a concept page (`concepts/parallel-work`) — it is a positioned, end-user-visible capability.

#### Roo-Code — sequential by design

- [`src/core/task/__tests__/new-task-isolation.spec.ts`](../src/core/task/__tests__/new-task-isolation.spec.ts) **enforces** that if the model emits multiple `new_task` tool uses in one turn, only the first survives — the rest are truncated and rejected with an injected error result. The named test: *"should only consider the first new_task if multiple exist"*.
- [`Task.startSubtask()`](../src/core/task/Task.ts:2380) delegates to a single child via `delegateParentAndOpenChild`; the parent **pauses** while the child runs. Parent ↔ child is strictly serial.
- The Orchestrator mode chains subtasks one at a time. There is no fan-out primitive in the product runtime.
- The only place Roo runs work in parallel is its **evals harness** ([`packages/evals/src/cli/runEvals.ts`](../packages/evals/src/cli/runEvals.ts) uses `PQueue({ concurrency })`) — but that's for benchmarking the agent, not for end-user workflows.

#### Why this matters: the unlimited-tokens regime

Once token cost is no longer the bottleneck (Copilot Enterprise seat, internal LLM, generous corporate budget), the scarce resource becomes **wall-clock time**. Parallelism is exactly the lever that converts spare token budget into faster wall-clock results:

| Scenario | Sequential (Roo) | Parallel (Squad) |
|---|---|---|
| Triage 20 open issues overnight | 20 × ~5 min ≈ 1.7 hr | `--max-concurrent 5` ≈ ~20 min |
| "Refactor parsers across 8 packages" | One package at a time | `team` route fans out, all 8 concurrently |
| Mixed read-only research across a repo | Sequential `read_file` × N | `fleet-dispatch` batches reads into one parallel `/fleet` session |
| Issue with 6 sub-tasks (tests, docs, types, changelog, migrations, README) | 6 sequential subtasks | `wave-dispatch` runs the wave concurrently |

#### Caveats

1. **Parallel agents writing to the same workspace can conflict.** Squad mitigates this for memory files via per-path serialization in [`history-shadow.ts`](../../packages/squad-sdk/src/agents/history-shadow.ts), but for source-code edits the burden is on the operator to scope agents to non-overlapping areas (one per package, one per service).
2. **Parallelism amplifies bad prompts.** A confused agent run sequentially wastes one slot of time; ten confused agents in parallel waste ten. Squad's circuit breakers in Ralph help but don't eliminate this.
3. **Roo's serial design is a deliberate safety choice**, not a technical limitation — it keeps every change reviewable. The truncation rule in [`new-task-isolation.spec.ts`](../src/core/task/__tests__/new-task-isolation.spec.ts) could in principle be relaxed, but as of this writing it is enforced.

---

## 5. Features Comparison

### Roo-Code has, Squad lacks

- **In-IDE webview UI** (chat, history, settings, marketplace, modes editor, MCP server panel) — none of Squad's UI is graphical
- **Multi-provider model layer** with cost tracking, model lists, image support, prompt caching
- **Full MCP host** with per-mode allow-listing, marketplace
- **Auto-approval system** ([`src/core/auto-approval/`](../src/core/auto-approval))
- **Codebase indexing** and `codebase_search` semantic search ([`src/services/code-index/`](../src/services/code-index))
- **Checkpoints** (shadow-git rollback per task)
- **Browser automation** tool
- **Deep i18n** (14+ languages)
- **Cloud features** ([`packages/cloud`](../packages/cloud)) — sign-in, sharing, telemetry
- **Evals harness** ([`packages/evals`](../packages/evals), [`apps/web-evals`](../apps/web-evals)) — Docker-based benchmark runner

### Squad has, Roo-Code lacks

- **Team-as-files** — every agent's identity (charter), memory (history), and team decisions are committed into the user's repo so that "anyone who clones the repo gets the team"
- **Casting system** — persistent, thematic naming registry across sessions ([`packages/squad-sdk/src/casting/`](../../packages/squad-sdk/src/casting))
- **Watch / Ralph daemon** — a long-running polling loop that monitors GitHub issues, dispatches Copilot agents, with circuit-breaker and 4-tier escalation ([`packages/squad-sdk/src/ralph/`](../../packages/squad-sdk/src/ralph))
- **Cross-squad / multi-squad federation** ([`packages/squad-sdk/src/multi-squad.ts`](../../packages/squad-sdk/src/multi-squad.ts), [`runtime/cross-squad.ts`](../../packages/squad-sdk/src/runtime/cross-squad.ts)) — squads in different repos can discover and delegate work to each other
- **Plugin marketplace and upstream sync** for sharing agents/skills/templates ([`marketplace/`](../../packages/squad-sdk/src/marketplace), [`upstream/`](../../packages/squad-sdk/src/upstream))
- **OpenTelemetry-native instrumentation** with grpc exporters, agent traces, coordinator traces, metric wiring
- **Aspire dashboard integration** (`squad aspire`) for observability
- **Cost tracker, scheduler, benchmarks, rework rate** as runtime modules
- **Email scrubbing** (`squad scrub-emails`) and PII guards baked into the SDK
- **GitHub Issues / Azure DevOps / Teams comms backends** ([`platform/`](../../packages/squad-sdk/src/platform))
- **SDK-First mode** — define a team in TypeScript with builder functions and compile to markdown ([`builders/`](../../packages/squad-sdk/src/builders))

### Settings / configuration surface

- **Squad** is configured via markdown files in `.squad/`, an optional [`squad.config.ts`](../../squad.config.ts), CLI flags, and env vars. There is no GUI.
- **Roo-Code** has a sprawling Settings webview with tabs for Providers, Modes, MCP, Auto-Approval, Context, Checkpoints, Notifications, Browser, Terminal, Experiments, Cloud — backed by a `cachedState` buffer (see [`AGENTS.md`](../../AGENTS.md:5)).

### CLI capabilities

- **Squad** is **CLI-first** with 17 commands ([`README.md`](../../README.md:99)): `init`, `upgrade`, `triage`/`watch`, `copilot`, `doctor`, `link`, `externalize`, `internalize`, `export`, `import`, `nap`, `aspire`, `scrub-emails`, `plugin marketplace`, `upstream`, etc.
- **Roo-Code** has [`apps/cli`](../apps/cli) but it is a peripheral / experimental surface; the extension is the primary product.

---

## 6. Code Quality & Engineering Practices

### Testing

- **Squad** ships **~200 vitest test files** under a flat [`test/`](../../test) directory plus subdirs (`acceptance/`, `ci/`, `cli/`, `helpers/`, `sdk/`, `state/`). Notable: extensive "human-journey" tests ([`test/journey-*.test.ts`](../../test/journey-first-conversation.test.ts)), feature-parity gates, OTel integration tests, hostile-integration tests, stress tests, Playwright smoke tests for docs.
- **Roo-Code** uses vitest with strict workspace isolation rules (per [`.roo/rules/rules.md`](../.roo/rules/rules.md): "Backend tests: `cd src && npx vitest run …`; UI tests: `cd webview-ui && npx vitest run …`"). E2E lives in [`apps/vscode-e2e`](../apps/vscode-e2e). Coverage spans extension, webview, and supporting packages.

### Lint / format / type-check

- Squad: ESLint 10, `tsc --noEmit` per package, markdownlint-cli2, cspell. ESM-only.
- Roo-Code: ESLint 9 (shared via [`packages/config-eslint`](../packages/config-eslint)), Turbo orchestrates lint/check-types/test/format, prettier, husky + lint-staged.

### CI/CD

- Squad: [`.github/workflows/`](../../.github/workflows) plus a [`.copilot/`](../../.copilot) directory and `copilot-instructions.md` indicating Copilot-native development.
- Roo-Code: [`.github/workflows/`](../.github/workflows) plus shared [`.github/actions/`](../.github/actions), CODEOWNERS, dependabot. Releases use changesets.

### Documentation

- Squad: full Astro docs site under [`docs/`](../../docs), README in en/zh, [`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`SECURITY.md`](../../SECURITY.md), CONTRIBUTORS, samples README.
- Roo-Code: lighter top-level docs ([`README.md`](../README.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`AGENTS.md`](../AGENTS.md), [`PRIVACY.md`](../PRIVACY.md), [`SECURITY.md`](../SECURITY.md)) plus 14 localized variants in [`locales/`](../locales). Design docs live under [`docs/design/`](../design). The user-facing product documentation is hosted off-repo.

### Conventions

Both use **changesets** for versioning. Squad publishes to npm; Roo-Code publishes to the VS Code Marketplace and OpenVSX.

---

## 7. Notable Divergences & Innovations

**Where Squad innovates beyond Roo-Code:**

- **File-backed, persistent multi-agent identity.** Roo's modes are stateless presets; Squad agents accrete project-specific knowledge in `history.md`, recorded in git, replayable and inspectable.
- **Watch/Ralph autonomy.** A polling daemon that auto-triages and dispatches Copilot work, with rate limiting, capability gating, circuit breakers, and overnight quiet hours. Roo-Code has no equivalent autonomous out-of-IDE worker.
- **Cross-squad federation.** Squads in separate repos can discover each other and delegate issues across repository boundaries.
- **OpenTelemetry-first runtime.** First-party traces, metrics, agent and coordinator spans; Aspire dashboard integration.
- **SDK-first programmable team definition.** [`squad.config.ts`](../../squad.config.ts) compiles to the markdown team layout.
- **Pluggable storage providers** including sql.js.

**Where Roo-Code innovates beyond Squad:**

- **Provider breadth.** ~30 LLM providers with a uniform abstraction, prompt caching, image support, model lists, and live cost tracking.
- **MCP host depth.** Roo runs MCP servers itself; Squad only configures Copilot's MCP usage.
- **Per-mode tool/file/MCP restrictions** baked into the prompt assembly pipeline.
- **Codebase semantic indexing** ([`src/services/code-index`](../src/services/code-index)) feeding `codebase_search`.
- **Shadow-git checkpoints** for in-task rollback.
- **Webview product surface** with deep settings, marketplace, history, share/sign-in.
- **Evals harness** with Docker compose runner ([`packages/evals/docker-compose.yml`](../packages/evals)).
- **Localization** at near-product-grade depth.

**Roadmap signals:**

- Squad's [`README.md`](../../README.md:399) flags SDK-First mode as experimental and the interactive shell as deprecated in favor of `copilot --agent squad`. The `0.9.x` line and the alpha banner imply rapid evolution toward an SDK + watch story.
- Roo-Code's open work (visible from [`docs/design/per-mode-mcp-settings.md`](../design/per-mode-mcp-settings.md) and the open editor tabs around per-mode MCP scoping) signals continued focus on **fine-grained mode capabilities** and tool surface refinement.

---

## 8. Summary Table

| Attribute | Squad | Roo-Code |
|---|---|---|
| Primary distribution | npm CLI + SDK | VS Code extension (.vsix) |
| Lineage | Original (`@bradygaster`) | Fork of Cline |
| License | MIT | Apache-style (project-specific) |
| Monorepo tooling | npm workspaces | pnpm + Turbo |
| Node engine | `>=22.5.0` | `20.19.2` (pinned) |
| Packages | 2 (`squad-sdk`, `squad-cli`) | 9+ (types, cloud, evals, telemetry, ipc, build, …) |
| Apps in repo | docs site, samples | cli, vscode-e2e, vscode-nightly, web-evals, web-roo-code |
| LLM substrate | GitHub Copilot only | ~30 providers (Anthropic, OpenAI, Bedrock, Vertex, OpenRouter, Ollama, …) |
| Tool surface | SDK tool primitives + hooks | Native + XML tools (read/write/diff/exec/browser/MCP/sub-task) |
| MCP role | Configures Copilot's MCP | Hosts MCP client; per-mode allow-list |
| Agent model | Persistent, named, file-backed agents with `history.md` | Stateless modes with slug + role definition + tool/file/mcp restrictions |
| Sub-agents | Coordinator + fan-out (parallel agents) | `new_task` stack of nested tasks |
| **Parallel execution** ⚡ | **First-class**: fan-out, session pool, `@A @B` syntax, `--max-concurrent`, wave/fleet dispatch | **Sequential by design**: `new_task` isolation enforced; only one subtask at a time |
| Persistence | `.squad/` in git; pluggable storage (fs/in-memory/sql.js); state-backends (git-notes, orphan branch) | VS Code global/workspace state + shadow-git checkpoints |
| Long-running automation | **Ralph watch** (issue triage + dispatch daemon) | None |
| Federation | Cross-squad discovery & delegation | None |
| Marketplace | Plugin marketplace + upstream sync | MCP marketplace |
| Telemetry | OpenTelemetry-native (traces, metrics, exporters) | Custom + PostHog |
| UI | Ink terminal shell (deprecated) + remote-ui; **no product web portal** (Astro site is docs-only, Playwright tests target the docs UX) | Full React 18 webview SPA |
| Settings UI | None (markdown + CLI) | Deep webview settings (Providers, Modes, MCP, …) |
| Cost tracking | Runtime module | Per-provider, per-task |
| Codebase search | No | Semantic index + `codebase_search` |
| Checkpoints | No | Shadow git per task |
| i18n | Light (en + zh README, runtime i18n module) | Deep (14+ locales, both runtime & docs) |
| Evals | benchmarks module | Docker-compose evals harness |
| Versioning | changesets, independent per package | changesets |
| Tests | ~200 vitest files | vitest + Playwright + vscode-e2e across packages |

---

## 9. Conclusions & Recommendations

### Recommendation by user profile

| Profile | Recommendation | Why |
|---|---|---|
| Solo dev, **metered** API costs, interactive flow | **Roo-Code primary** | Per-step review, multi-provider, lowest cost-per-task |
| Solo dev, **unlimited Copilot**, wants overnight throughput | **Squad primary** (Roo for interactive sessions) | Parallelism + Ralph turn spare token budget into faster wall-clock results |
| Team with **unlimited Copilot**, GitHub-issue-driven workflow | **Squad primary** | Fan-out + Ralph + `--max-concurrent` + cross-repo federation are uniquely valuable |
| Team needing **diff-by-diff human review** on every change | **Roo-Code** | Squad's parallelism makes per-step review impractical |
| Compliance-sensitive org standardized on Copilot | **Squad** | Inherits Copilot's billing/audit posture for free |
| Org needing **provider portability** (Anthropic, local, Bedrock, …) | **Roo-Code** | ~30 providers vs Squad's Copilot-only |

### Choose Squad when:

- You're committed to GitHub Copilot as your model substrate and want to add team-style orchestration on top of it
- You have **effectively unlimited tokens** and want to trade them for **wall-clock speedup via parallel agents** (Squad's standout architectural advantage — see §4j)
- You want **persistent, in-repo, file-backed agents** that other contributors inherit by cloning
- You need **autonomous issue triage and dispatch** (Ralph) running outside an IDE, possibly across repositories
- Observability via OpenTelemetry / Aspire is a hard requirement
- Your workflow is CLI-first or headless (CI runners, devcontainers, remote machines)

### Choose Roo-Code when:

- You want a **single-developer, in-IDE coding agent** with a polished UI and per-step diff review
- You need **provider portability** (Anthropic, OpenAI, local Ollama, Bedrock, Vertex, …) rather than Copilot lock-in
- You rely on **MCP servers** as first-class capabilities (running, scoping per mode, surfacing tools)
- You value semantic codebase search, in-task rollback (checkpoints), and fine-grained per-mode tool/file/MCP restrictions
- You need broad localization
- You prefer **safety-via-serialization** — one change at a time, fully reviewable

### The "unlimited tokens" lens

For a developer or team with **uncapped token budget** (Copilot Enterprise, internal LLM, generous corporate plan), the calculus shifts meaningfully toward Squad. The bottleneck is no longer dollars per token but **hours per task**, and parallelism is the only architectural feature that directly addresses that. Roo's serial design is a safety win when humans review every step, but a throughput loss when they don't need to. Concretely (see §4j): an overnight 20-issue triage that takes Roo ~1.7 hours can finish in ~20 minutes under Squad with `--max-concurrent 5`.

This does **not** make Squad a wholesale replacement — Roo's interactive UX, multi-provider abstraction, MCP host depth, and per-step reviewability remain best-in-class. Many teams should reasonably run **both**: Roo for interactive coding sessions, Squad/Ralph for autonomous overnight throughput on the same repo.

### Cross-pollination opportunities

**Things Roo-Code could borrow from Squad:**
1. **Parallel `new_task` fan-out (opt-in).** The hardest-hitting borrow. Relax the [`new-task-isolation`](../src/core/task/__tests__/new-task-isolation.spec.ts) rule behind an explicit per-mode/per-task flag (e.g. `parallelSubtasks: true`) and add a session-pool with concurrency limits modeled on Squad's [`session-pool.ts`](../../packages/squad-sdk/src/client/session-pool.ts) and [`fan-out.ts`](../../packages/squad-sdk/src/coordinator/fan-out.ts). Keeps the safe default; unlocks throughput for users who want it.
2. **Persistent agent memory committed to the repo.** A "mode `history.md`" pattern — appended after each task — would give Roo modes longitudinal project knowledge, not just the volatile context window. Pairs naturally with Roo's existing condense system.
3. **Watch/Ralph daemon.** A headless Roo runner that polls GitHub issues / a queue and dispatches modes on a schedule, with circuit-breaker and overnight quiet hours, would extend Roo from an IDE companion to a background teammate. The piece exists conceptually in [`apps/cli`](../apps/cli) but lacks the maturity of Squad's [`packages/squad-sdk/src/ralph/`](../../packages/squad-sdk/src/ralph).
4. **OpenTelemetry-native traces and metrics.** Replace bespoke telemetry with OTel spans for tasks, tool calls, and provider requests, mirroring Squad's [`runtime/otel-*.ts`](../../packages/squad-sdk/src/runtime).

**Things Squad could borrow from Roo-Code:**
1. **Provider abstraction layer.** Even keeping Copilot as the default, decoupling the agent execution path from `@github/copilot-sdk` (mirroring Roo's [`base-provider.ts`](../src/api/providers/base-provider.ts)) would unlock Anthropic/OpenAI/local model use cases.
2. **First-class MCP host.** Today Squad relies on Copilot's MCP plumbing; promoting MCP servers to citizens of the SDK (like Roo's per-mode allowlist in [`webview-ui/src/components/modes/McpServerRestriction.tsx`](../../webview-ui/src/components/modes/McpServerRestriction.tsx)) would let Squad agents have well-scoped tool capabilities independent of the Copilot agent.
3. **Per-mode/per-agent tool & file restrictions** with regex-driven file gating, as Roo enforces during tool-call validation. Squad has reviewer-lockout and write-guards but not the richer mode-as-policy model.

Both projects address the same long-term need — making AI agents reliable collaborators on real codebases — from opposite ends. Roo is a **vertically integrated single-agent product**; Squad is a **horizontally integrated multi-agent runtime**. The most interesting future-state for either project lies precisely where each is weakest today.
