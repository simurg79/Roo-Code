---
phase: all
status: closed
owner: architect-phase-10
last_updated: 2026-04-30
sources:
    - docs/investigation/roo-to-copilot/35-paw-inventory.md
    - docs/investigation/roo-to-copilot/60-gap-analysis.md
    - docs/investigation/roo-to-copilot/70-migration-paths.md
---

# Decision Log (append-only)

> Parent plan: [`00-plan.md`](00-plan.md) · Index: [`README.md`](README.md)

**Rules:**

- Append-only. Never edit or delete prior entries; supersede with a new dated entry that links back.
- One decision per entry.
- Use the heading format `## YYYY-MM-DD HH:MM — <decision title>` (UTC or local with offset noted).
- Required subsections: **Context · Decision · Rationale · Consequences · Status**.
- `Status` is one of: `proposed`, `accepted`, `superseded by <link>`, `rejected`.

---

## 2026-04-26 13:52 — Investigation kicked off; memory scaffolding created

**Context**

The user wants to leave Roo-Code and recreate the same experience using GitHub Copilot Chat and/or Copilot CLI, possibly via Squad as an intermediary. To support a long-running, multi-session investigation, persistent memory files are required so future agents/sessions can resume work without re-deriving context.

**Decision**

Create the memory-file scaffold under [`docs/investigation/roo-to-copilot/`](.) with:

- [`README.md`](README.md) — index and usage rules.
- [`00-plan.md`](00-plan.md) — 9-phase investigation plan and methodology.
- [`10-roo-inventory.md`](10-roo-inventory.md), [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md), [`30-squad-inventory.md`](30-squad-inventory.md) — Phase 1–3 templates.
- [`40-copilot-chat-research.md`](40-copilot-chat-research.md), [`50-copilot-cli-research.md`](50-copilot-cli-research.md) — Phase 4–5 templates.
- [`60-gap-analysis.md`](60-gap-analysis.md), [`70-migration-paths.md`](70-migration-paths.md), [`80-migration-playbook.md`](80-migration-playbook.md) — Phase 6–8 templates.
- [`90-decision-log.md`](90-decision-log.md) — this log.
- [`99-open-questions.md`](99-open-questions.md) — running unresolved questions, pre-seeded.

No findings have been pre-filled. Every templated file carries YAML front-matter (`phase`, `status: not-started`, `owner: tbd`, `last_updated: 2026-04-26`, `sources: []`) and per-section "What goes here" guidance.

**Rationale**

- A fixed file taxonomy prevents future agents from reorganizing mid-investigation.
- Append-only decision log + dated open-questions list preserve history under multi-session work.
- Phase numbering (10/20/…/90) leaves room for inserts (e.g. `15-`, `45-`) without renumbering.
- Methodology rules (cite, quote primary docs, mark uncertainty) are codified up front so they apply to all future entries.

**Consequences**

- Future subtasks should pick up at Phase 1 ([`10-roo-inventory.md`](10-roo-inventory.md)) and proceed in numeric order, updating front-matter and the status table in [`README.md`](README.md) as they go.
- Any deviation from the plan in [`00-plan.md`](00-plan.md) requires a new decision-log entry.

**Status**

`accepted`

---

## 2026-04-26 14:05 — Phase 1 (Roo-Code inventory) complete

**Context**

Phase 1 of the investigation requires a workspace-only inventory of Roo-Code features that need to be replicated when migrating off Roo. No web research was used; only files under `c:/git/Roo-Code` and the user's VS Code globalStorage settings were inspected.

**Decision**

Populate [`10-roo-inventory.md`](10-roo-inventory.md) with concrete findings covering: 5 built-in modes ([`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts)), the layered custom-mode mechanism ([`.roomodes`](../../../.roomodes) + global [`custom_modes.yaml`](../../../../../Users/bertanari/AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/custom_modes.yaml)), orchestrator behavior, MCP integration with per-mode `allowedMcpServers` allowlists ([`docs/design/per-mode-mcp-settings.md`](../../design/per-mode-mcp-settings.md)), rules/custom-prompts loading ([`src/core/prompts/sections/custom-instructions.ts`](../../../src/core/prompts/sections/custom-instructions.ts)), the 22-tool native tool surface ([`src/core/prompts/tools/native-tools/`](../../../src/core/prompts/tools/native-tools)), Windows settings storage paths, and webview UI features.

**Rationale**

- The inventory is required as the baseline against which Copilot Chat (Phase 4) and Copilot CLI (Phase 5) will be measured.
- Limiting to local sources keeps findings reproducible and citable; no external links to age out.

**Consequences**

- **Headline finding:** Roo's "experience" is the composition of (a) layered modes (built-in → global YAML → project `.roomodes`), (b) per-mode tool-group + file-regex restrictions, (c) per-mode MCP allowlist, (d) layered rules from `~/.roo/`, project `.roo/`, `AGENTS.md`, and (e) sequential `new_task` orchestrator boomerang — replicating it requires parity on all five axes, not just "modes".
- Roo's global rules directory is `~/.roo` (homedir, see [`src/services/roo-config/`](../../../src/services/roo-config)), distinct from VS Code globalStorage which only holds `custom_modes.yaml` and `mcp_settings.json`.

**Status**

`accepted`

---

## 2026-04-26 14:06 — Phase 2 (roo-vault inventory) complete

**Context**

Phase 2 catalogs the user's personal `c:/git/roo-vault` repository, which centralizes shared Roo-Code configuration across multiple projects via symlinks. Only local files were inspected; secrets in MCP settings were redacted.

**Decision**

Populate [`20-roo-vault-inventory.md`](20-roo-vault-inventory.md) with the vault's layered composition model documented in [`../roo-vault/README.md`](../../../../roo-vault/README.md), the 17 modes in [`../roo-vault/global-settings/custom_modes.yaml`](../../../../roo-vault/global-settings/custom_modes.yaml), the 7 MCP servers in [`../roo-vault/global-settings/mcp_settings.json`](../../../../roo-vault/global-settings/mcp_settings.json) (4 enabled, 3 disabled, secrets redacted), per-project `.roomodes` overrides under `../roo-vault/projects/`, and the symlink bootstrap in [`../roo-vault/setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1).

**Rationale**

- The vault — not the Roo extension — is the actual surface area the user must migrate. A successful migration must preserve the multi-project layered composition, not just the modes themselves.
- The user's task brief referenced `setup/setup_dev_box.ps1`; on inspection that script is a dev-box bootstrap (Chocolatey/WSL/Docker/Qdrant/LiteLLM). The actual vault wiring script is `setup-vault.ps1` at the repo root. Both are documented to avoid future confusion.

**Consequences**

- **Headline finding:** The vault uses **directory symlinks** to share `global-settings/`, `.roo/`, `.roomodes`, `.clinerules`, and per-project `myplans/` into each project. Any migration target must offer an equivalent "one settings tree, many projects" composition or the user loses the multi-project parity that makes the vault valuable.
- 17 vault modes vs 5 Roo built-ins — most modes are user-authored (docs-writer, security, design-reviewer, review-addresser, code-reviewer, task-filer, builder, tester, pull-requestor, devops, etc.) and are the real migration unit.

**Status**

`accepted`

---

## 2026-04-26 14:43 — Phase 4a (Copilot custom agents + custom instructions) complete

**Context**

Phase 4 of the investigation requires researching GitHub Copilot Chat in VS Code as a candidate replacement for Roo. Phase 4a covers two of the four sub-areas: **custom chat modes** (now renamed by Microsoft to **custom agents** / `.agent.md`) and **custom instructions** (`copilot-instructions.md`, `.instructions.md`, `AGENTS.md`, settings-based keys). Phases 4b (prompt files), 4c (MCP, tool sets, agent mode), and 4d (chat participants, storage, limits) remain pending.

**Decision**

Populate the **Custom Chat Modes** and **Custom Instructions** sections of [`40-copilot-chat-research.md`](40-copilot-chat-research.md) with primary-source findings cited to [`code.visualstudio.com/docs/copilot/customization/custom-chat-modes`](https://code.visualstudio.com/docs/copilot/customization/custom-chat-modes), [`code.visualstudio.com/docs/copilot/customization/custom-instructions`](https://code.visualstudio.com/docs/copilot/customization/custom-instructions), and the GitHub-side [`docs.github.com .../add-repository-instructions`](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions). Set the file's status to `in-progress` (not `complete`) and add a `<!-- 4a complete; 4b/4c/4d pending -->` marker.

**Rationale**

- Microsoft renamed `.chatmode.md` → `.agent.md` and `.github/chatmodes/` → `.github/agents/`; failing to capture this would have left the playbook (Phase 8) pointing at obsolete file paths.
- The two Copilot capabilities that block-or-unblock the largest chunks of Roo parity (per-mode tool/MCP allowlists, sub-agents, AGENTS.md ingestion) all live in these two sections, so resolving them early de-risks the remaining gap analysis.

**Consequences**

- **Headline finding (chatmodes/agents):** Copilot custom agents **match Roo on per-mode tool & MCP allowlists** (`tools: ['mcpserver/*']`) and **partially match Roo's orchestrator** via the `agent` tool + `agents:` frontmatter + handoff buttons, but offer **no equivalent to Roo's `fileRegex` per-tool-group file-edit restriction** — that capability is lost in any Path-A migration and must be enforced via prose instructions.
- **Headline finding (instructions):** `AGENTS.md` is **natively supported in VS Code Copilot Chat** (toggled by `chat.useAgentsMdFile`, default on), Copilot's precedence is **Personal > Repository > Organization** with all matching files concatenated within a tier, and Roo's per-mode rules folder (`.roo/rules-<mode>/`) has **no first-class equivalent** — it must be inlined into each agent body or composed via Markdown-linked `.instructions.md` files.
- Open questions Q-002, Q-003, Q-004 are now resolved; Q-005 is partially resolved with a documented lossy-fields list. Three new questions (Q-015 user-data path discrepancy, Q-016 release-version provenance for the rename, Q-017 instructions size cap, Q-018 per-mode rules folder mapping) opened in [`99-open-questions.md`](99-open-questions.md).
- Phase 4 status badge in [`README.md`](README.md) advanced from `not-started` to `in-progress (4a done)`.

**Status**

`accepted`

---

## 2026-04-26 14:54 — Phase 4b (Copilot prompt files + tool sets) complete

**Context**

Phase 4b populates the **Prompt files** and **Tool sets** sections of [`40-copilot-chat-research.md`](40-copilot-chat-research.md) with primary-source findings, leaving 4c (MCP, agent mode) and 4d (chat participants, storage, limits) for follow-up subtasks.

**Decision**

Cite the canonical VS Code docs ([`prompt-files`](https://code.visualstudio.com/docs/copilot/customization/prompt-files), [`agent-tools`](https://code.visualstudio.com/docs/copilot/agents/agent-tools), [`concepts/tools`](https://code.visualstudio.com/docs/copilot/concepts/tools)) plus GitHub issues confirming Windows storage paths and limits ([`microsoft/vscode#251603`](https://github.com/microsoft/vscode/issues/251603), [`microsoft/vscode#251515`](https://github.com/microsoft/vscode/issues/251515), [`vscode-copilot-release#13065`](https://github.com/microsoft/vscode-copilot-release/issues/13065), [`vscode-copilot-release#12853`](https://github.com/microsoft/vscode-copilot-release/issues/12853)). Update the file's marker comment to `4a + 4b complete`, advance the README Phase-4 badge accordingly.

**Rationale**

- Tool sets are **the closest analogue to Roo's per-mode `groups` + `allowedMcpServers`** allowlist; nailing down their schema, location, and limits unlocks the converter design in Phase 8 and the gap matrix in Phase 6.
- Prompt files are largely additive over Roo (Roo has no first-class equivalent), but they materially affect how user-facing slash commands / templated subtasks should be emitted by any `.roomodes`-to-Copilot converter.

**Consequences**

- **Headline finding (prompt files):** prompt files (`*.prompt.md`) are workspace-scoped at `.github/prompts/` and user-scoped at `%APPDATA%\Code\User\prompts\` on Windows (same folder as `.instructions.md`, user-scope `.agent.md`, and `*.toolsets.jsonc`). Frontmatter has `agent` (not `mode`) — used to bind the prompt to a built-in or custom `.agent.md`; when both prompt and agent declare `tools`, **prompt-file `tools` win** (widening, not narrowing, the agent's allowlist). Parameterization is **free-text-after-slash only** (`/promptname formName=Foo`); no documented `${input:name}` substitution; sub-prompt composition is via Markdown links to other prompt files. Prompt files are still in **public preview** and **not** picked up by Copilot CLI.
- **Headline finding (tool sets):** `*.toolsets.jsonc` files are **user-scope only** today (`%APPDATA%\Code\User\prompts\` on Windows; workspace storage tracked in [`microsoft/vscode#251515`](https://github.com/microsoft/vscode/issues/251515) but **not yet shipped**). Schema is `{ "<setname>": { tools, description, icon } }`. Sets are referenced from `.agent.md` / `.prompt.md` `tools:` arrays as bare names alongside built-in tools and `mcpserver/*` wildcards. **Tool sets + agent `tools:` array fully replicate Roo's `groups` + `allowedMcpServers`** _except_ for (a) `fileRegex` per-tool-group restrictions (still no equivalent — restated from 4a) and (b) workspace-scoped reusable tool-set **files** (workaround: inline tool lists in `.github/agents/*.agent.md`). The 128-tool-per-request hard cap is still enforced ([`vscode-copilot-release#13065`](https://github.com/microsoft/vscode-copilot-release/issues/13065)) and applies to the flattened total, not the number of tool-set references.
- New questions Q-019 (prompt-file keybinding args), Q-020 (variable substitution), Q-021 (workspace-scoped toolsets), Q-022 (wildcard-in-toolset), Q-023 (toolset nesting), Q-024 (toolsets in Settings Sync) opened in [`99-open-questions.md`](99-open-questions.md). Q-002 and Q-005 were already partially or fully resolved in 4a; this section adds further confirmation but does not change their status.
- Phase 4 status badge in [`README.md`](README.md) advanced from `in-progress (4a done)` to `in-progress (4a + 4b done)`.

**Status**

`accepted`

---

## 2026-04-26 15:09 — Phase 4c (Copilot MCP support + Windows storage paths) complete

**Context**

Phase 4c populates the **MCP support** and **Storage Locations (Windows)** sections of [`40-copilot-chat-research.md`](40-copilot-chat-research.md), leaving 4d (Agent mode, Chat participants/Extension API, Limits/known gaps) for a follow-up subtask.

**Decision**

Cite the canonical VS Code docs ([`docs/copilot/customization/mcp-servers`](https://code.visualstudio.com/docs/copilot/customization/mcp-servers), [`docs/copilot/reference/mcp-configuration`](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration), [`api/extension-guides/ai/mcp`](https://code.visualstudio.com/api/extension-guides/ai/mcp)), the GitHub-side companion ([`docs.github.com — extending Copilot Chat with MCP`](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-chat-with-mcp)), the auto-approve / trust UX ([`microsoft/vscode#253039`](https://github.com/microsoft/vscode/issues/253039), [`docs/copilot/agents/agent-tools`](https://code.visualstudio.com/docs/copilot/agents/agent-tools)), and the Windows `npx`/`.cmd` quirk ([`modelcontextprotocol/servers#3460`](https://github.com/modelcontextprotocol/servers/issues/3460)). Document the consolidated Storage-Locations table with profile-aware paths. Update the file's marker comment to `4a + 4b + 4c complete; 4d pending`, advance the README Phase-4 badge accordingly.

**Rationale**

- MCP is the highest-leverage Roo feature surface (per-mode tool restriction + cross-project tool reuse via the vault), and a clear `mcp.json` schema map plus a `${input:…}` secret-prompt pattern unlocks the vault commit-safe migration in Phase 8.
- Resolving the **profile-scoping question** for `mcp.json` (yes, profile-scoped) vs the `prompts/` folder (no, global) was a prerequisite for designing the Phase-8 symlink scheme, since the user's vault depends on `mklink /D` automation.

**Consequences**

- **Headline finding (`.vscode/mcp.json`):** schema is `{ servers: { … }, inputs: [ … ] }`. Per-server fields differ by transport — stdio (`type`/`command`/`args`/`env`/`envFile`/`sandboxEnabled`/`sandbox`) and HTTP/SSE (`type`/`url`/`headers`). Sandboxing is **macOS/Linux only** (silently ignored on Windows). Three transports: `stdio`, `http` (Streamable HTTP), `sse` (legacy). VS Code falls back from `http` to `sse`. There is **no top-level `gallery` or `dev` key** — the gallery is a UX surface; `dev` is per-server.
- **Headline finding (secret pattern):** the `${input:id}` placeholder + `inputs: [{ type: "promptString", id, description, password }]` array is the **commit-safe** pattern. VS Code prompts at first-run, stores the value in Windows Credential Manager, and re-uses it silently. **`.vscode/mcp.json` should be committed** (with placeholders), per explicit doc guidance: _"Avoid hardcoding sensitive information like API keys. Use input variables or environment files instead."_ This collapses Roo's two-file split (gitignored `mcp_settings.json` + committed `.roo/mcp.json`) into one.
- **Headline finding (per-agent filtering):** **There is no separate `allowedMcpServers` setting** — restriction is performed entirely via `.agent.md` `tools: ["server/*"]` (Phase 4a) and `*.toolsets.jsonc` `tools: [...]` (Phase 4b). Roo's `allowedMcpServers: ["github"]` ↔ Copilot's `tools: ["github/*"]` is a direct 1:1.
- **Headline finding (auto-import):** `chat.mcp.discovery.enabled` (off by default) imports MCP server configs from other clients — Claude Desktop confirmed; Cursor/Continue/Windsurf inferred from community reports (filed as Q-025). Useful for migration **from** other AI clients but not strictly needed for the Roo→Copilot path.
- **Headline finding (storage):** consolidated Windows path table now lives in [`40-copilot-chat-research.md` § Storage Locations (Windows)](40-copilot-chat-research.md#storage-locations-windows). Key insight: **`mcp.json` and `settings.json` are profile-scoped** (`%APPDATA%\Code\User\profiles\<profile-id>\…`); the **`prompts/` folder** (covering agents, prompts, instructions, tool sets) is **global** (`%APPDATA%\Code\User\prompts\`). The vault symlink scheme works as-is for the global folder; per-profile `mcp.json` requires a small Phase-8 PowerShell helper (filed as Q-026).
- **Headline finding (Windows quirks):** `npx`-based stdio servers can fail when launched from VS Code if `nvm-windows` hides `npx.cmd` from the launched-from-shortcut env; workaround is absolute path or `cmd /c`. `mcp.json` does **not** expand literal `%APPDATA%`; use `${env:APPDATA}` or `${userHome}`. Docker stdio servers must not use `-d` (detach).
- **Roo→Copilot MCP migration sketch (4 steps):**
    1. Move `~/AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` → `%APPDATA%\Code\User\mcp.json` (rename `mcpServers` → `servers`).
    2. Move project `.roo/mcp.json` → `.vscode/mcp.json` (same rename).
    3. Replace inline tokens with `${input:…}` placeholders; declare each placeholder in the top-level `inputs` array with `password: true`.
    4. Restrict per-agent access via `.github/agents/<mode>.agent.md` `tools: ["servername/*"]` instead of `.roomodes` `allowedMcpServers`.
- Open questions resolved: **Q-009** (empty `allowedMcpServers` array means "no MCP"), **Q-015** (partial — `mcp.json` profile-scoped, `prompts/` global), **Q-008** (partial — symlink portability confirmed for Copilot Chat). New questions opened: **Q-025** (residual MCP unknowns), **Q-026** (multi-profile vault symlink automation).
- Phase 4 status badge in [`README.md`](README.md) advanced from `in-progress (4a + 4b done)` to `in-progress (4a + 4b + 4c done — agents/instructions, prompt files, tool sets, MCP, Windows storage paths)`.

**Status**

`accepted`

---

## 2026-04-26 14:07 — Phase 3 (Squad inventory) complete

**Context**

Phase 3 inventories Squad at `c:/git/squad` to determine what it actually is and how it relates to GitHub Copilot and Roo-Code. Findings sourced from the Squad README, package manifests, `.copilot/` config, and the pre-existing analysis at [`docs/analysis/squad-vs-roo-comparison.md`](../../analysis/squad-vs-roo-comparison.md).

**Decision**

Populate [`30-squad-inventory.md`](30-squad-inventory.md) with: Squad's identity as a Node CLI + SDK monorepo (npm `@bradygaster/squad-cli` + `@bradygaster/squad-sdk` v0.9.1, alpha), its dependency on `@github/copilot-sdk` ([`../squad/packages/squad-sdk/package.json`](../../../../squad/packages/squad-sdk/package.json)), its invocation pattern via `copilot --agent squad`, the 17 CLI commands documented in [`../squad/README.md`](../../../../squad/README.md), parallel orchestration primitives (fan-out, session-pool, wave-dispatch, fleet-dispatch), Ralph watch-mode automation, persistent named agents from a casting registry, `.squad/` markdown state, and `.copilot/mcp-config.json` MCP pass-through.

**Rationale**

- Squad does not replace Copilot — it **drives** Copilot CLI via `@github/copilot-sdk`. Evaluating it in isolation would be wrong; it is one of the candidate orchestration layers for Path C/D.
- The pre-existing comparison doc already enumerates feature deltas with file citations and was leveraged rather than duplicated.

**Consequences**

- **Headline finding:** Squad is a **parallel-by-default** Copilot CLI orchestrator with persistent named agents and committed markdown state. Roo is **sequential-by-design** with isolated `new_task` boomerangs. They occupy adjacent but distinct niches: Squad supplies parallel fan-out + Copilot integration that Roo lacks, but offers no Roo-style per-mode tool/file-regex/MCP restrictions, no webview UI, and no layered rules system. Squad is alpha (v0.9.1) — production migration risk is non-trivial.
- Phase 7 (migration paths) must consider Squad as a _supplement_ to Copilot Chat/CLI rather than a peer alternative.

**Status**

`accepted`

---

## 2026-04-26 15:30 — Phase 4d (Agent mode + Chat participants/Extension API + Limits/Gap Catalog) complete; Phase 4 closed

**Context**

Phase 4d was the final sub-phase of the Copilot Chat research stream. It covered three remaining surfaces from the [`00-plan.md`](00-plan.md) Phase-4 outline: (a) agent mode and sub-agents (`runSubagent`, `agents:` allowlist, recursion, handoffs, max-iterations, terminal auto-approve, background tasks), (b) chat participants and the chat-extension API (`vscode.chat.createChatParticipant`, Language Model Tools API, Agent Plugins Preview channel), and (c) a synthesised Gap Catalog with severities feeding directly into Phase 6.

**Decision**

Close Phase 4 with all four sub-phases (4a + 4b + 4c + 4d) complete. Headline conclusions captured in [`40-copilot-chat-research.md`](40-copilot-chat-research.md):

- **Agent mode parity is high.** `chat.agent.maxRequests` defaults to 25; the tool-calling loop, working set, checkpoints, and per-tool approval policies (Default Approvals / Bypass Approvals / Autopilot) collectively cover Roo's `new_task` boomerang plus add capabilities Roo does not have (parallel sub-agent dispatch, multi-model consensus, fork-conversation, edit-previous-request).
- **Sub-agents resolve Q-013.** `runSubagent` is parallel-by-default; sequential semantics are achievable only by prose discipline in the parent agent's body. Recursion is supported up to depth 5 via `chat.subagents.allowInvocationsFromSubagents`. Handoffs (`handoffs:` frontmatter) are user-mediated next-step buttons, not model-driven returns — that is, similar in spirit to Roo's boomerang but interactive rather than automatic.
- **Chat extension API supports Plan-B.** A 3rd-party extension can ship a Roo-equivalent declarative experience via Agent Plugins (Preview, gated by `chat.agentPlugins.enabled`); the stable surfaces are `vscode.chat.createChatParticipant` + the Language Model Tools API + `contributes.languageModelTools`. Reference exemplar: [`microsoft/vscode-extension-samples/chat-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample). Vault-as-VSIX (Path D in Phase 7) is technically viable.
- **Gap Catalog: 1 blocker, 3 major, ≥6 minor, ≥12 wins.** Only 🔴 G-1 (per-mode `fileRegex` edit restrictions) has no first-class equivalent and is the sole genuine migration blocker. 🟠 majors: per-mode rules folder (G-2), workspace-scoped `*.toolsets.jsonc` (G-3), chat history export (G-9), local model providers (G-13). Multiple Copilot-only wins (W-1..W-12) — model selection, .agent.md via VSIX, .prompt.md slash commands, MCP secret hygiene, AGENTS.md cross-tool, cloud-agent reuse, parallel sub-agents, checkpoints, URL approval pre/post, org policies, unified panel, agent-type hand-off — net upside from a Copilot migration.

Bookkeeping completed in this entry's pass:

- Frontmatter on [`40-copilot-chat-research.md`](40-copilot-chat-research.md) flipped to `status: complete`; Phase-4d source URLs appended to `sources:`; marker comment updated to `<!-- Phase 4 complete (4a + 4b + 4c + 4d) 2026-04-26 -->`.
- [`README.md`](README.md) Phase-4 badge flipped from 🟡 in-progress to ✅ complete.
- [`99-open-questions.md`](99-open-questions.md): **Q-013** marked RESOLVED (parallel-by-default sub-agents); **Q-014** marked PARTIALLY RESOLVED (unified panel; user-input still needed); added **Q-027** (extension manifest path outside Agent Plugins Preview), **Q-028** (org-management story for Agent Plugins), **Q-029** (chat-sessions JSON portability), **Q-030** (vault dependence on non-Copilot model providers).

**Rationale**

Phase 4 is the load-bearing research stream — it determines whether VS Code Copilot Chat alone can carry the vault, or whether Squad / a custom VSIX is required. With one blocker, three majors, and a clear set of wins, the migration is **justified**: a Copilot-Chat-first path is viable provided G-1 (per-mode file-regex) is addressed by either (i) accepting the loss, (ii) wrapping with hand-rolled `applyTo`-glob instructions per agent, or (iii) shipping a thin VSIX that reads `.roomodes`-style restrictions. Phase 6 will turn the Gap Catalog into a per-feature decision matrix, and Phase 7 will weigh Paths A (Copilot Chat only) / B (Copilot Chat + Squad) / C (Copilot CLI only) / D (vault-as-VSIX) using these severities.

**Consequences**

- Phase 5 (Copilot CLI research) is unblocked and is the next active phase per the [`00-plan.md`](00-plan.md) ordering.
- Phase 6 (gap analysis) inherits the Gap Catalog from § Limits / Known Gaps in [`40-copilot-chat-research.md`](40-copilot-chat-research.md) as its starting matrix.
- Phase 7 (migration paths) gains the Plan-B viability finding (extension-shipped agents) and must explicitly evaluate Path D against Q-027 / Q-028.
- Phase 8 (playbook) inherits Q-029 (sessions portability) and Q-026 (multi-profile `mcp.json` symlink helper) as concrete script-writing tasks.
- The user must answer Q-030 (does the vault use a non-Copilot model today?) before Phase 7 path selection.

**Status**

`accepted`

---

## 2026-04-26 15:42 — Phase 5a (Copilot CLI identity/install + agent loop + customization + Squad cross-ref + Roo↔CLI mapping) complete

**Context**

Phase 5 of the investigation researches the GitHub Copilot CLI as a candidate replacement for Roo. Phase 5a covers five of the file's planned sub-areas: (1) **Identity & disambiguation** (`@github/copilot` standalone CLI vs the legacy `gh copilot` extension — they are different products), (2) **Install & authentication** on Windows 11, (3) **Storage locations** under `%USERPROFILE%\.copilot\`, (4) **Agent loop** (modes, permissions, headless flags, sessions, built-in tools), (5) **Customization** (custom instructions cascade + custom agents + `--agent` precedence), plus a **Squad cross-reference** that resolves Q-010 and a complete **Roo ↔ Copilot CLI mapping table** across 25 axes. Phase 5b (deep MCP, hooks, skills, exhaustive SDK surface, full Gap Catalog) remains pending.

**Decision**

Populate [`50-copilot-cli-research.md`](50-copilot-cli-research.md) with primary-source findings cited to:

- [`npmjs.com/package/@github/copilot`](https://www.npmjs.com/package/@github/copilot) (CLI v1.0.36) and [`npmjs.com/package/@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) (SDK v0.3.0) — package identity, install methods, system requirements.
- [`docs.github.com — about-copilot-cli`](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli) — concepts, modes, BYOK.
- [`docs.github.com — install-copilot-cli`](https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli) and [`cli-best-practices`](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices) — install + auth + best practices.
- [`docs.github.com — cli-config-dir-reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) — full directory layout, settings cascade, `COPILOT_HOME` semantics.
- [`docs.github.com — cli-command-reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) and [`run-cli-programmatically`](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically) — slash commands, flags, headless patterns, exit codes.
- [`docs.github.com — use-custom-instructions`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-custom-instructions) and [`use-custom-agents`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-custom-agents) — instruction cascade + agent discovery + frontmatter.
- [`../squad/.copilot/mcp-config.json`](../../../../squad/.copilot/mcp-config.json) and [`../squad/packages/squad-sdk/package.json`](../../../../squad/packages/squad-sdk/package.json) — squad's actual config and SDK dependency.

Set the file's status to `in-progress` (not `complete`) with marker comment `<!-- Phase 5a complete (Identity/install + Agent loop + Customization + Squad cross-reference + Roo↔CLI mapping); 5b pending (MCP deep-dive, hooks/skills, SDK exhaustive surface, Limits/Gap Catalog) — 2026-04-26 -->`. Advance the README Phase-5 badge to 🟡 in-progress with the same sub-phase summary.

**Rationale**

- The 5a sub-areas are the load-bearing surfaces for Phase-7 path selection: install/auth determines whether the user can run the CLI at all on the dev box; storage/`COPILOT_HOME` determines whether the vault's symlink-and-commit pattern survives; the agent loop + customization + mapping determine whether the vault's 17 modes can be migrated 1:1.
- Resolving the **identity question first** (`gh copilot` extension is **not** the migration target) prevents the rest of the document — and the eventual playbook — from being written against an obsolete product.
- The **Roo↔CLI mapping table** in § 8 (25 axes; 22 🟢 / 2 🟡 / 2 🔴) is the direct input to Phase 6's gap matrix and Phase 7's path selection. Producing it in 5a (rather than deferring to 5b) accelerates the next two phases.
- Squad cross-reference (§ 6) had to land in 5a because three downstream questions (Q-010, Q-031 squad's non-standard MCP location, vault-on-CLI bootstrap) all depend on knowing what squad actually does on top of the CLI.

**Consequences**

- **Headline finding (identity):** **The `@github/copilot` npm package is the migration target; the legacy `gh copilot` extension is not.** They have different binaries (`copilot` vs `gh copilot`), different config dirs, different model surfaces, and different agentic capabilities. Any prior thinking that conflated them is invalid; the playbook must be explicit.
- **Headline finding (portability — resolves Q-008):** **`COPILOT_HOME` is the load-bearing primitive.** A single env var (or per-invocation `--config-dir` flag) redirects every config sub-path — settings, agents, skills, instructions, hooks, MCP, sessions. The vault bootstrap collapses to `[Environment]::SetEnvironmentVariable("COPILOT_HOME", "<vault>/global-settings/copilot", "User")`. No per-profile-id complexity (cf. Chat-side Q-026). This is materially **simpler** than the Chat-side symlink scheme.
- **Headline finding (squad — resolves Q-010):** **Squad has zero `vscode.lm` / `vscode` / `@vscode/*` dependencies.** It is strictly external CLI-driven via `@github/copilot-sdk`. Squad therefore cannot be embedded into a VS Code extension as-is; Path-D (vault-as-VSIX) cannot reuse squad without re-implementing its orchestration on top of `vscode.lm`. Path-C (CLI-only) and Path-B (Chat + CLI) can both adopt squad as an external layer.
- **Headline finding (mapping — 25 axes):** Of 25 Roo features, **22 are 🟢 (1:1 or better) on the CLI, 2 🟡 (minor nuance), 2 🔴 (per-mode `fileRegex` and per-mode rules folder).** The two 🔴s are the **same blockers** as the Chat path (G-1, G-2). Net: **the CLI does not introduce new blockers** versus Chat. The CLI **adds** wins in headless scripting, hooks, skills, sessions, BYOK provider, and `COPILOT_HOME` portability; it **loses** the webview UI affordances entirely.
- **Headline finding (CLI-G-1 hook workaround):** Unlike Chat (which has no hook surface and therefore must enforce per-mode file restrictions via prose only), **the CLI can enforce `fileRegex`-equivalent rules via a `preToolUse` hook** on the `write` family. This is a strict CLI advantage over Chat for the single 🔴 blocker. (Filed as Q-035 for the reference-implementation work.)
- **Headline finding (BYOK — partial Q-030 resolution for the CLI):** The CLI honours `COPILOT_PROVIDER_BASE_URL` / `COPILOT_PROVIDER_TYPE` (openai/azure/anthropic) / `COPILOT_PROVIDER_API_KEY` / `COPILOT_MODEL`. Ollama via OpenAI-compat endpoint works. **The CLI removes the Chat-side G-13 (local-model) blocker** — relevant if the vault depends on local models.
- Open questions resolved or advanced: **Q-008 RESOLVED**, **Q-010 RESOLVED**, **Q-030 PARTIALLY RESOLVED** (CLI path). **Five new questions opened**: Q-031 (squad's `.copilot/mcp-config.json` non-standard location), Q-032 (repo `settings.json` 6-key allowlist constrains vault portability), Q-033 (no shared secret-substitution story between Chat `${input:…}` and CLI `${VAR}`), Q-034 (sub-agent depth/concurrency caps for nested orchestrator patterns), Q-035 (Windows reference implementation for `preToolUse` hook as `fileRegex` substitute).
- Phase 5 status badge in [`README.md`](README.md) advanced from ⬜ not-started to 🟡 in-progress (5a done; 5b pending).
- Phase 5b is now scoped to: (a) full MCP sectional treatment with squad-style vs canonical layouts side-by-side, (b) full hooks treatment (13 events × 3 hook types × 2 payload shapes; SSRF model; HTTPS-required cases), (c) full skills treatment, (d) exhaustive `@github/copilot-sdk` export catalogue, (e) the unified Gap Catalog with severities feeding Phase 6.
- **Phase-6 input ready early.** The mapping table in § 8 is structurally compatible with the Phase-4 Gap Catalog; Phase 6 can begin its merged matrix immediately rather than waiting for 5b.

**Status**

`accepted`

---

## 2026-04-26 17:39 — Phase 5b-i (Copilot CLI MCP deep-dive + Hooks deep-dive incl. preToolUse/fileRegex verdict) complete

**Context**

Phase 5b-i was a narrowly scoped follow-up to 5a, populating only two sections of [`50-copilot-cli-research.md`](50-copilot-cli-research.md): § 9 **MCP Support** and § 10 **Hooks** (the headline section — the candidate `fileRegex` mitigation for CLI-G-1). Skills, Scripting/automation, full SDK exports, and the unified Gap Catalog remain deferred to Phase 5b-ii.

**Decision**

Populate the MCP and Hooks sections of [`50-copilot-cli-research.md`](50-copilot-cli-research.md) with primary-source findings cited to:

- [`docs.github.com — add-mcp-servers (CLI how-to)`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) — canonical `mcpServers` schema, `/mcp add` form, server-management slashes.
- [`docs.github.com — Hooks configuration (reference)`](https://docs.github.com/en/copilot/reference/hooks-configuration) — input/output JSON for every event including the verbatim `preToolUse` payload + `permissionDecision` output contract.
- [`docs.github.com — Use hooks with Copilot CLI (tutorial)`](https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks) — primary source for the `[Console]::In.ReadToEnd() | ConvertFrom-Json` PowerShell hook pattern and the cross-OS `bash`+`powershell` hook entry shape.
- [`docs.github.com — cli-command-reference`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference) — full slash-command list, MCP server schema fields, hook event registry (camelCase + PascalCase aliases), repo-layer settings allowlist (six keys including `disableAllHooks` and `hooks`), `.vscode/mcp.json` → `.mcp.json` migration recipe.
- Active CLI bugs that bound the verdict: [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) (sub-agent bypass), [`#2540`](https://github.com/github/copilot-cli/issues/2540) (plugin hooks don't fire), [`#2893`](https://github.com/github/copilot-cli/issues/2893) (parallel-call race), [`#2013`](https://github.com/github/copilot-cli/issues/2013) (`modifiedArgs` ignored).

Set the file's marker comment to `<!-- 5a + 5b-i complete 2026-04-26; 5b-ii pending (Skills/Scripting/SDK/Gaps) -->`. Advance the README Phase-5 badge to `🟡 in-progress (5a + 5b-i done — …; 5b-ii pending — Skills, Scripting/automation, full SDK surface, Gap Catalog)`.

**Rationale**

- Phase 5b-i's narrow scope was deliberate: the **`preToolUse`-as-`fileRegex`-substitute verdict** is the single highest-leverage finding remaining in the entire investigation because it determines whether the CLI path (Path-B) closes the only 🔴 blocker (G-1) shared with the Chat path (Path-A). Resolving it required (a) the full `preToolUse` payload schema, (b) the deny-output JSON contract, (c) a runnable Windows PowerShell reference, and (d) a survey of active bugs that bound the workaround. Splitting Skills / SDK / Gaps off into 5b-ii prevents the scope from sprawling and produces a polished verdict on the load-bearing question.
- The MCP section was bundled because it shares the same primary-doc surface (`cli-command-reference`) and resolves three open questions (Q-031 squad's non-canonical MCP location, Q-033 the Chat-vs-CLI secret-substitution fork, partial Q-032 on the repo-settings allowlist) that the Hooks section would otherwise have had to re-derive.

**Consequences — Headline findings**

- **Headline finding (verdict — `preToolUse` vs `fileRegex`):** **Yes-with-caveats.** The CLI's `preToolUse` hook **does** mechanically substitute for Roo's per-mode `fileRegex` for the **main agent on serial tool calls** — `toolName`, `toolArgs.path` (after JSON parse), and the `{permissionDecision:"deny",permissionDecisionReason}` output contract are all there, and a working Windows PowerShell reference is in [§ 10.4](50-copilot-cli-research.md#104-pretooluse-deep-dive--the-fileregex-substitute). **It does not** close the gap for `task`-dispatched sub-agents ([`#2392`](https://github.com/github/copilot-cli/issues/2392)), parallel tool calls ([`#2893`](https://github.com/github/copilot-cli/issues/2893)), plugin-shipped policies ([`#2540`](https://github.com/github/copilot-cli/issues/2540)), or write-path mutation ([`#2013`](https://github.com/github/copilot-cli/issues/2013)). **Net for the unified Gap Matrix:** G-1 stays 🔴 _blocker_ on the Chat path (no hook surface) but downgrades to **🟠 _major_** on the CLI path. This is a meaningful Path-B advantage but **not a clean parity win** — the vault must accept the sub-agent caveat or restructure orchestrator flows to use `--agent` boot mode rather than `task` dispatch.
- **Headline finding (CLI MCP — schema fork):** CLI `mcp-config.json` uses **`mcpServers`** at top level; Chat `.vscode/mcp.json` uses **`servers`** + a top-level **`inputs`** array. Migration is a one-liner (`jq '{mcpServers: .servers}'`) but **secrets do not migrate** — see next finding.
- **Headline finding (CLI MCP — secrets model on Windows, resolves Q-033):** CLI uses **process-env substitution only** (`$VAR` / `${VAR}` / `${VAR:-default}`); there is **no** `${input:…}` Credential-Manager prompt as on the Chat side, and the OS keychain is reserved for the GitHub auth token. Vault recommendation: persist secrets via `[Environment]::SetEnvironmentVariable("KEY","val","User")` and let the same `${KEY}` resolve in both layers (Chat side via env-fallback, CLI side natively). **No shared secret-handling story exists between Chat and CLI** — same logical secret needs two configs.
- **Headline finding (CLI MCP — slash commands):** Full set documented: `/mcp [show|add|edit|delete|disable|enable|auth|reload] [SERVER-NAME]`, plus the non-interactive `copilot mcp [list|get|add|remove]` for shell automation. Hot-reload is supported (no session restart on add/edit).
- **Headline finding (Squad's `.copilot/mcp-config.json` — resolves Q-031):** Non-canonical. The CLI's documented project-scope MCP location is `.github/mcp.json` (or `.mcp.json`). Squad's pattern relies on the squad launcher implicitly setting `COPILOT_HOME`; bare `copilot` from a squad-shaped project would not load it. Vault should prefer `.github/mcp.json` for project scope and `~/.copilot/mcp-config.json` (via `COPILOT_HOME`) for the user/vault layer.
- **Headline finding (Hooks — registry):** **13 events** confirmed (`sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `agentStop`, `subagentStart`, `subagentStop`, `preCompact`, `permissionRequest`, `errorOccurred`, `notification`) × **2 payload shapes** (camelCase native / PascalCase VS-Code-compatible with snake_case fields) × **2 hook types** (`command` and `prompt`). The Phase-5a stub claimed three hook types including `http`; **correction**: `http` hooks exist on the **Cloud agent** surface but **not** on the CLI — filed as Q-038 for SDK confirmation.
- **Headline finding (`disableAllHooks` kill-switch — partial Q-032):** Honoured at both user and repo layers (`disableAllHooks` and `hooks` are 2 of the 6 keys the repo-layer allowlist accepts). Vault **can** ship per-project hook policy via committed `.github/copilot/settings.json` or `.github/hooks/*.json`. Safety caveat: the kill-switch is a committed file, so anyone with write access can disable enforcement with one boolean — gate behind branch protection for policy-critical environments.
- Open questions resolved: **Q-031** (squad MCP location), **Q-033** (secret-substitution fork). Partially resolved: **Q-032** (hooks-allowlist scope confirmed; tool-allowlist scope still open), **Q-035** (`preToolUse` mechanism + verdict landed; Windows latency / env / sub-agent bypass concerns split into Q-039 / Q-040 / kept under Q-035 verdict). New questions opened: **Q-036** (user-scope hook discovery — `~/.copilot/hooks/*.json` vs inline `config.json`), **Q-037** (active-agent name not in hook payload), **Q-038** (CLI hook-type set: `command` + `prompt` only, no `http`?), **Q-039** (`pwsh` cold-start latency on user box), **Q-040** (`${env:VAR}` expansion in hook entry `env` map).
- **Phase 5b-ii is now scoped to:** Skills (§ 11), Scripting/automation deep-dive (§ 3.4 expansion), full `@github/copilot-sdk` export catalogue (§ 7), and the unified CLI Gap Catalog (§ 12) — all of which can now reference the resolved Hooks/MCP findings rather than re-derive them.

**Status**

`accepted`

---

## 2026-04-26 17:50 — Phase 5b-ii-A (Copilot CLI Skills + Scripting/automation incl. Roo `apps/cli` event-emitter comparison) complete

**Context**

Phase 5b-ii-A was a narrowly scoped follow-up to 5b-i, populating only two sections of [`50-copilot-cli-research.md`](50-copilot-cli-research.md): § 11 **Skills** and the new § 12 **Scripting / automation** (the existing Limits/Gap Catalog stub was renumbered to § 13 without content changes). The full `@github/copilot-sdk` export catalogue and the unified CLI Gap Catalog remain deferred to Phase 5b-ii-B.

**Decision**

Populate the Skills and Scripting/automation sections of [`50-copilot-cli-research.md`](50-copilot-cli-research.md) with primary-source findings cited to:

- [`docs.github.com — Adding agent skills for Copilot CLI`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) — canonical SKILL.md schema, storage paths, invocation model, `/skills` slash family.
- [`docs.github.com — Quickstart for automating with Copilot CLI`](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/quickstart) and [`run-cli-programmatically`](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically) — full headless-flag catalogue and CI examples.
- [`docs.github.com — CLI command reference § Command-line options`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference#command-line-options) — flag verification (and OTel statement).
- [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) — open feature request **confirming the CLI does not yet support `--output-format json` / `stream-json`** (Phase-5a § 3.4 stub overstated this; corrected in § 12.1).
- [`apps/cli/src/agent/json-event-emitter.ts`](../../../apps/cli/src/agent/json-event-emitter.ts) — Roo's CLI event-stream implementation read in full for the side-by-side in § 12.6.
- [`../squad/.copilot/skills/`](../../../../squad/.copilot/skills) directory listing — 23 SKILL.md files (the brief estimated 24; actual count is 23).
- [`../squad/README.md` § Watch Mode](../../../../squad/README.md) — Ralph daemon primitives + the nuance that Ralph's default `--agent-cmd "gh copilot"` invokes the **legacy** CLI extension, not `@github/copilot`.

Set the file's marker comment to `<!-- 5a + 5b-i + 5b-ii-A complete 2026-04-26; 5b-ii-B pending (SDK exports + CLI Gap Catalog) -->`. Advance the README Phase-5 badge accordingly.

**Rationale**

Phase 5b-ii-A's narrow scope was deliberate: Skills and Scripting/automation are the two surfaces that determine whether the CLI path can carry the vault's _automation_ workload — not just interactive coding. Resolving them together let the same primary-doc surface (the [add-skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) and [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference) docs) be cited cleanly, and produced the **single most consequential correction** in the investigation so far: the structured-event-stream gap (G-6) that the Phase-5a stub had hidden.

**Consequences — Headline findings**

- **Headline finding (Skills — what they are):** A skill is a _directory_ (not a file) with `SKILL.md` + arbitrary sibling resources (scripts, samples). The whole directory is loaded into the agent's context when the skill activates. Skills implement the open [Agent Skills standard](https://agentskills.io/) so a Copilot-flavoured `SKILL.md` is also discoverable by Claude Code, Cursor, Gemini CLI, Codex CLI — a rare cross-tool surface for this investigation.
- **Headline finding (Skills — frontmatter):** Required `name` (slash-command name) + `description` (autonomous-trigger string — must be specific or skills silently fail to fire per [`copilot-cli#978`](https://github.com/github/copilot-cli/issues/978)). Optional `license` + `allowed-tools`. **`user-invocable` and `disable-model-invocation` are NOT documented for the Copilot CLI** even though the cross-tool standard defines them — silently ignored (filed as Q-041).
- **Headline finding (Skills — storage):** Scope tiers `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/` (user) and `.github/skills/`, `.claude/skills/`, `.agents/skills/` (project). Project beats user; plugins lowest. Squad's `.copilot/skills/` (23 files at investigation time) is **non-canonical** and works only via launcher-set `COPILOT_HOME` — same Q-031 pattern as MCP.
- **Headline finding (Skills — invocation):** Three modes: autonomous (description-driven), explicit `/<name>` slash in prompt, REPL `/skills [list|info|reload|add|remove]`. Autonomous mode is unreliable in practice ([`#978`](https://github.com/github/copilot-cli/issues/978)) — the explicit slash is the production-reliable path.
- **Headline finding (Skills — vs Roo):** Strict additive capability. The closest Roo analogues (`.roo/rules-<mode>/`, orchestrator `new_task`, mode `customInstructions`) each cover only part of what a skill does. Skills are dynamically loaded by description, are reusable across agents, and can ship executable resources. Net for Path-B (CLI) playbook: skills are the natural home for the procedural memory currently scattered across Roo rules + custom instructions.
- **Headline finding (Skills — Windows-first concern):** Official examples are Bash-first; Windows users must dual-ship `.sh` + `.ps1` (squad's `distributed-mesh/` skill is the working pattern) and pre-approve both `bash` and `shell` in `allowed-tools` to avoid prompt-storms.
- **Headline finding (Scripting — corrected misclaim):** **The CLI does NOT yet emit structured JSON events.** Phase-5a § 3.4 claimed `--output-format=text|json` exists; verified-against-canonical: it does not. [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) is the open feature request. Until shipped, automation requiring structured events must use `@github/copilot-sdk` (streaming-events channel). **This adds a new 🟠 G-6 gap to the CLI catalog** that Phase 6 must integrate.
- **Headline finding (Scripting — flag set):** Full verified catalogue in § 12.2 — 22 flags including `-p`, `-s`, `--no-ask-user`, `--allow-tool=PATTERN` (the workhorse), `--model`, `--agent`, `--config-dir`, `--resume`, `--share[-gist]`, `--additional-mcp-config`, `--cwd`, `--no-color`, `--mode=plan|interactive|autopilot`, `--max-autopilot-continues`. Permission patterns use `Kind(arg)` form: `shell(git:*)`, `write(./src/**)`, `url(github.com)`. Deny wins over allow. Exit codes: `0` success / non-zero overloaded (G-7, filed as Q-043).
- **Headline finding (Scripting — Ralph daemon):** Squad's Ralph proves the CLI does not need its own daemon mode — process supervision (Ralph here, but also `pm2`/Scheduled Tasks/Actions cron) is sufficient when the CLI is cheap to spawn and respects `--no-ask-user`. **Important nuance: Ralph's default `--agent-cmd "gh copilot"` invokes the LEGACY CLI extension; vault adoption must override to `--agent-cmd "copilot"`** to use the agentic `@github/copilot` binary that is the actual migration target.
- **Headline finding (Scripting — Roo `apps/cli` comparison):** Roo's `apps/cli` is architecturally distinct (extension-host harness with rich NDJSON event stream via [`json-event-emitter.ts`](../../../apps/cli/src/agent/json-event-emitter.ts) — `system:init` / `assistant` / `thinking` / `tool_use` / `tool_result` / `result` / `cost`, with delta tracking, schema versioning, sequence guarantees). Copilot CLI today emits plain text. **Migration implication:** any vault automation parsing Roo's NDJSON must either drop down to the SDK or accept text-only output and lose per-tool/per-token telemetry. Single largest CLI scripting gap versus Roo.
- **Headline finding (Scripting — OTel):** CLI supports OpenTelemetry trace+metric export via standard OTLP env vars (per CLI command reference). Strict win versus Roo's `apps/cli` (no OTel) and partial mitigation for G-6 if aggregate metrics suffice.
- **Open questions** added: **Q-041** (CLI's silent ignore of `user-invocable`/`disable-model-invocation`), **Q-042** (track [`#52`](https://github.com/github/copilot-cli/issues/52) until structured output ships), **Q-043** (granular exit codes). No prior open questions resolved by this sub-phase (the resolutions in 5a/5b-i remain).
- **Phase 5b-ii-B is now scoped to:** the exhaustive `@github/copilot-sdk` export catalogue (§ 7 expansion) + the unified CLI Gap Catalog (§ 13) that integrates G-1..G-7 with the headline findings from 5a, 5b-i, and 5b-ii-A — with G-6 (no structured event stream) and G-7 (overloaded exit codes) as the new entries this sub-phase contributed.

**Status**

`accepted`

---

## 2026-04-26 17:58 — Phase 5b-ii-B-1: `@github/copilot-sdk` exports catalogued; Path-D embeddability = 🟡 with shim

**Context**

Phase 5b-ii-B-1 replaced the § 7 SDK headline stub in [`50-copilot-cli-research.md`](50-copilot-cli-research.md#7-sdk-githubcopilot-sdk--full-export-catalogue-phase-5b-ii-b-1) with a full export catalogue of `@github/copilot-sdk@0.3.0`, cross-referenced against Squad's actual SDK consumption (`squad-sdk/src/adapter/client.ts`, `adapter/types.ts`, `tools/index.ts`, `build/bundle.ts`, `squad-cli/src/cli-entry.ts`). Goal: produce a defensible **Path-D (vault-as-VSIX) embeddability verdict** and finalise the SDK surface knowledge needed for Phase 6 / Phase 7 path scoring. CLI Gap Catalog (5b-ii-B-2) deliberately deferred.

**Decision**

Record the **Path-D embeddability verdict** as **🟡 embeddable with shim** and adopt it as a Phase-7 input.

**Rationale — Headline findings**

- **Headline (identity):** `@github/copilot-sdk` is **MIT, public preview (0.x)**, v0.3.0 at access, 54 versions in ~5 months, 134 dependents, runtime deps = 3 (lean), Node 20+. The SDK is a **transport wrapper** over the CLI binary (JSON-RPC via `vscode-jsonrpc`); **it contains no model client of its own**. This anchors all downstream architecture decisions.
- **Headline (top exports):** `CopilotClient` (lifecycle + session admin + `listModels`/`ping`/`getStatus`/`getAuthStatus`), `CopilotSession` (`send`/`sendAndWait`/`abort`/`getMessages`/typed `on`/`disconnect`), `defineTool` (Zod-typed custom tools), `approveAll` (test helper), in-process `SessionHooks` (`onPreToolUse`/`onPostToolUse`/`onUserPromptSubmitted`/`onSessionStart`/`onSessionEnd`/`onErrorOccurred`), `ProviderConfig` (BYOK: openai/azure/anthropic + env-var fallback), elicitation/user-input/permission handlers. Event types are dotted (`assistant.message_delta`, `tool.execution_start`, `session.shutdown`).
- **Headline (Squad's actual usage corrects 5a stub):** Squad has **exactly one** value-level SDK import — `CopilotClient` in `adapter/client.ts:10`. Squad's `defineTool` at `tools/index.ts:116` is a **re-implementation, not a re-export**; the stub claim that Squad uses `defineTool` from the SDK was wrong. Squad insulates the rest of its codebase via `Squad*` mirror types in `adapter/types.ts` (explicit comment: _"All Squad code should import types from this adapter layer, never directly from the Copilot SDK."_). Squad pin is `^0.1.32` — three minor versions behind current `0.3.0`; drift absorbed by `as Parameters<typeof …>[N]` casts.
- **Headline (Squad as cautionary tale for SDK consumers):** Squad ships a runtime ESM patcher ([`squad-cli/src/cli-entry.ts:25`](../squad/packages/squad-cli/src/cli-entry.ts:25)) for `@github/copilot-sdk@0.1.32`'s broken `vscode-jsonrpc/node` import, plus a `doctor` command that re-validates the patch. This is the cost of consuming a 0.x SDK with monthly minor bumps. Vault automation must budget for similar maintenance.
- **Headline (BYOK reaffirmed):** SDK supports the same `provider: { type: "openai"|"azure"|"anthropic", baseUrl, apiKey }` configuration as the CLI's env vars; Ollama-via-OpenAI-compat works. Resolves the SDK side of Q-030 in addition to the CLI side already resolved in 5a § 7.
- **Headline (Path-D verdict — 🟡 embeddable with shim):** SDK can run in the **VS Code extension host** (full Node, supports `child_process` and `vscode-jsonrpc`). It **cannot** run in webviews (sandboxed, no `child_process`). A Path-D VSIX therefore must (a) require user-installed `@github/copilot` CLI on `PATH` or bundle the CLI in the VSIX (size + signing concerns), (b) keep all SDK calls in the extension-host process, (c) accept process-spawn cost per session, (d) re-architect Roo's webview-driven UX as either a chat-participant UI or an extension-host ↔ webview `postMessage` bridge. **This nullifies the "trivially embed Squad" hope from Q-010** — both Squad and the SDK are structurally CLI-driver libraries, not embeddable model clients. Path D remains feasible but is _not_ a free win; cost is ~1 engineer-month of extension-host harness work plus ongoing 0.x SDK maintenance.
- **Headline (license/versioning risk):** MIT ✅; preview 0.x carries breaking-change risk per minor (e.g., `autoRestart` removal already happened). Mitigation patterns observable in Squad: adapter-mirror types, `as Parameters<typeof …>[N]` casts, runtime patcher, doctor command. Vault should adopt the same pattern if it depends on the SDK directly.

**Consequences**

- Path A (Chat-only) and Path B (CLI-only) are unaffected — the SDK is optional for them.
- Path C (Squad-mediated) is reaffirmed as feasible but inherits the SDK's 0.x churn cost.
- Path D (vault-as-VSIX) is now **scored 🟡 (not 🟢)** — it works but is not architecturally trivial; Phase 7 must compare its cost-to-value against Path A/B.
- **New open questions opened: Q-044, Q-045, Q-046** (see [`99-open-questions.md`](99-open-questions.md)).
- Resolves: **Q-010 sharpened** (Squad has zero `vscode.lm` deps **and** the SDK it depends on is itself a CLI-driver, so embedding requires extension-host shim). **Q-038 partially advanced** (SDK exposes `SessionHooks` interface — six lifecycle callbacks, `command` and `prompt` are file-hook-only; `http` not present at the SDK layer either, so the CLI most likely lacks it as well). Phase-5a stub claim that Squad uses SDK's `defineTool` corrected.
- Phase 5b-ii-B-2 (CLI Gap Catalog) remains the only outstanding sub-phase.

**Status**

`accepted`

---

## 2026-04-26 18:05 — Phase 5 closed; ready for Phase 6 synthesis

**Context**

Phase 5b-ii-B-2 was the only outstanding sub-phase of Copilot CLI research. With the unified CLI Gap Catalog now populated in [`50-copilot-cli-research.md` § 13](50-copilot-cli-research.md#13-limits--known-gaps-relative-to-roo-cli-gap-catalog--phase-5b-ii-b-2), all of Phases 1–5 (inventory, Squad cross-ref, Chat research, CLI research) are complete. The investigation can now move to Phase 6 (cross-cutting gap analysis) with both Chat and CLI Gap Catalogs in matching G-/W- + CG-/CW- format ready to merge.

**Decision**

Flip Phase 5 to ✅ complete. Proceed to Phase 6 next.

**Rationale — CG-/CW- tally summary**

- **Inherited Chat gaps under CLI severities (Part A, 14 IDs):**
    - 🟠 major (4): G-1 (demoted from 🔴), G-2, G-5 (worse on CLI), G-9 (better-but-still-major elsewhere — minor here).
    - 🟡 minor (5): G-4, G-7, G-12, G-14, G-9 (CLI-side rating).
    - ✅ closed-on-CLI (4): G-3 (N/A), G-8, G-11, G-13.
    - ✅ better (2): G-6, G-10.
- **CLI-specific gaps (Part B, CG-1…CG-15, 15 IDs):**
    - 🟠 major (5): CG-1 (webview-UI loss), CG-4 (repo-allowlist scope), CG-7 (no structured output), CG-8 (SDK churn), CG-11 (sub-agent hook bypass).
    - 🟠 (Path-C-only): CG-12 (Squad alpha).
    - 🟡 minor (9): CG-2, CG-3, CG-5, CG-6, CG-9, CG-10, CG-13, CG-14, CG-15.
    - 🔴 blockers: **0** — every CLI-specific gap has a documented workaround.
- **CLI-specific wins (Part C, CW-1…CW-12, 12 IDs):** all 🟢. Match Chat's W-1…W-12 count; CW-1/CW-2/CW-3/CW-6 close Chat-side gaps outright (G-1 mitigation, G-13, observability, G-11).

**Net headline:** CLI carries **0 × 🔴 + 9 × 🟠 + 14 × 🟡** vs Chat's **1 × 🔴 + ~4 × 🟠 + ~6 × 🟡**. CLI eliminates Chat's lone blocker (with the CG-11 sub-agent caveat) and three of Chat's four majors, at the cost of four new CLI-only majors centred on observability, SDK churn, and the sub-agent hook bypass.

**Consequences**

- Phase 5 marked ✅ complete in [`README.md`](README.md); [`50-copilot-cli-research.md`](50-copilot-cli-research.md) front-matter flipped to `status: complete`; final marker comment updated.
- Phase 6 (gap analysis) is now unblocked and is the next subtask: it should merge the Chat G-/W- catalog (40 § 8) with the CLI G-/W-/CG-/CW- catalog (50 § 13) into a single matrix, then score each row against the vault's actual usage to produce per-axis path recommendations.
- **Top 3 upstream risks tracked:** [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) (sub-agent hook bypass — CG-11), [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52) (structured output — CG-7 / Q-042), Q-039 (empirical `pwsh` cold-start latency — CG-6).
- **Resolved questions this round:** Q-031, Q-033 (already resolved earlier in Phase 5b-i, now formally cited in the CLI Gap Catalog); Q-035 stays partially-resolved with explicit caveats now codified as CG-11 / CG-13 / CG-14 / CG-15.
- **New open questions:** Q-047 (severity-tally consistency check vs vault's actual `fileRegex` usage in Phase 6) — see [`99-open-questions.md`](99-open-questions.md).
- The Phase-5 file template's original "preview" Gap Catalog placeholder has been replaced in full; § 13 is now the canonical source.

**Status**

`accepted`

---

## 2026-04-26 18:16 — Phase 6 (unified gap analysis) complete; ready for path-selection synthesis (Phase 7)

**Context**

Phase 6 was the synthesis phase that merged the Chat-side Gap Catalog (G-1..G-14 + W-1..W-12, from [`40-copilot-chat-research.md` § Limits/Known Gaps](40-copilot-chat-research.md#limits--known-gaps)) and the CLI-side Gap Catalog (CG-1..CG-15 + CW-1..CW-12, from [`50-copilot-cli-research.md` § 13](50-copilot-cli-research.md#13-limits--known-gaps-relative-to-roo-cli-gap-catalog--phase-5b-ii-b-2)) into a single feature-axis matrix. No new web research was performed; all rows trace back to citations established in Phases 1–5. The Squad column was framed as **"what Squad adds on top of the CLI"** (per the task brief), not as a third independent path.

**Decision**

Populate [`60-gap-analysis.md`](60-gap-analysis.md) with: methodology header (dual-severity convention `Chat <icon> / CLI <icon>` for divergent rows; single-icon when both paths agree), 12 grouped sections (B.1 modes/agents, B.2 tool restrictions, B.3 prompts/rules, B.4 MCP, B.5 orchestrator, B.6 native tools, B.7 webview, B.8 CLI/scripting, B.9 settings/portability, B.10 model selection, B.11 sessions, B.12 approval/safety) totalling ~70 matrix rows with columns `Roo feature | Chat | CLI | Squad | Gap severity | Workaround | Notes`, severity tally table (§ C), top-10 most-important rows (§ D), Squad-column interpretation note (§ E), and Phase 7/8 handoff (§ F) including two newly opened questions. Flip front-matter `status: complete`, populate `sources:` with the 6 input files, advance README Phase-6 badge to ✅.

**Rationale — severity tally (synthesis output)**

- **Chat path:** **2 × 🔴 blocker · 8 × 🟠 major · 12 × 🟡 minor · 22 × ✅ parity · 4 × ➕ additive.** Blockers: G-1 (per-mode `fileRegex` edit restrictions) and G-2 (per-mode rules folder `.roo/rules-<mode>/`) — both are doc-prose-workaroundable but not first-class.
- **CLI path:** **0 × 🔴 blocker · 7 × 🟠 major · 11 × 🟡 minor · 27 × ✅ parity · 8 × ➕ additive.** The CLI eliminates Chat's lone hard-blocker via the `preToolUse` hook (G-1 → 🟠 with the CG-11 sub-agent caveat from [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392)) and downgrades G-13 (local models) and G-11 (cloud-agent reuse) to ✅ via `COPILOT_PROVIDER_*` BYOK env vars and shareable sessions. Net 4 majors are CLI-specific: CG-1 (webview-UI loss), CG-7 (no structured event stream — [`copilot-cli#52`](https://github.com/github/copilot-cli/issues/52)), CG-8 (SDK 0.x churn), CG-11 (sub-agent hook bypass).
- **Squad overlay (additive only):** **+7 × ➕ wins** when layered on the CLI — parallel fan-out (`fleet`/`wave`), persistent named agents from a casting registry, Ralph daemon for watch-mode automation, committed `.squad/` markdown state, batch sub-agent dispatch with concurrency caps, and a typed adapter layer that insulates from SDK churn. Squad introduces zero new gaps but inherits all CLI gaps + adds CG-12 (alpha v0.9.1 maturity risk) when chosen as the orchestration layer.

**Headline finding (the 3 path-determining rows)**

1. **B.2 / G-1 (per-mode `fileRegex`)** — Chat 🔴 (no hook surface, prose-only enforcement); CLI 🟠 (preToolUse closes it for boot-agent serial calls; sub-agent dispatch via `task` still bypasses per [`#2392`](https://github.com/github/copilot-cli/issues/2392)). **This row alone tilts the choice toward the CLI for any vault that depends on edit-scope safety.**
2. **B.7 / CG-1 (webview UI loss on CLI)** — Chat ✅ (full webview parity via VS Code chat panel); CLI 🟠 (terminal-only, no settings UI, no diff preview, no MCP marketplace). **This row alone tilts the choice back toward Chat for any user who values the in-IDE GUI.**
3. **B.8 / CW-3 (headless scripting + hooks + sessions)** — Chat ➕ (chat history, no headless mode); CLI ➕➕ (`--no-ask-user`, `--allow-tool=PATTERN`, `--share[-gist]`, `COPILOT_HOME` portability, OTel export, full hook suite). **The CLI is strictly required for any automation-heavy workload regardless of the Chat-vs-CLI primary choice — it is realistically a both-paths story.**

**Resolved / advanced questions** — None resolved cleanly by Phase 6 (no new evidence, only synthesis); **Q-047** advanced (the severity-tally consistency check is now embedded as the dual-severity convention in B.2 row G-1 and is owned by the user's Phase-7 vault audit, not by further documentation work).

**New questions opened (synthesis-discovered)**

- **Q-048** — `AGENTS.local.md` gitignored-personal-overrides convention (added to [`99-open-questions.md`](99-open-questions.md) and surfaced in [`60-gap-analysis.md` § F.4](60-gap-analysis.md)).
- **Q-049** — Roo's `update_todo_list` re-injection has no documented Copilot equivalent (added to [`99-open-questions.md`](99-open-questions.md) and surfaced in [`60-gap-analysis.md` § F.4](60-gap-analysis.md)).

**Consequences**

- Phase 7 (migration paths) is unblocked. The matrix's three path-determining rows + severity tallies + Squad-as-overlay framing collectively produce a structured path-scoring input: Path-A (Chat-only) carries 2 blockers; Path-B (CLI-only) carries 0 blockers but loses the webview UX; Path-C (Chat + CLI hybrid, optionally with Squad overlay) carries 0 blockers and recovers the UX at the cost of dual-config maintenance. Path-D (vault-as-VSIX) re-enters as the only architecture that closes G-1/G-2 cleanly without the CLI's CG-11 caveat — at the cost flagged in Q-046.
- Phase 8 (playbook) inherits the matrix as its per-feature migration checklist; Q-048 and Q-049 are new playbook concerns; the existing Q-026 (multi-profile `mcp.json` symlink helper) and Q-029 (sessions portability) join them as concrete script-writing tasks.
- README Phase-6 badge flipped from ⬜ not-started to ✅ complete. Overall index status remains "Phases 1–6 done; Phases 7–9 remain" — README header `status: in-progress` is appropriate until Phase 9.
- No row was deferred (the brief allowed `⏭ deferred` if the matrix exceeded 100 rows; final count is ~70, so all rows landed in-band).

**Status**

`accepted`

---

## 2026-04-26 18:27 — Phase 7 (migration paths) complete; **recommendation = Path Hybrid (Chat + CLI)**

**Context**

Phase 7 was the path-selection synthesis phase. It scored the four candidate paths from [`00-plan.md`](00-plan.md) (A Chat-only, B CLI-only, C CLI+Squad, D Vault-as-VSIX) plus a Hybrid (Chat + CLI sharing `.agent.md`/`AGENTS.md`) against an 8-criterion weighted framework derived from the user's documented context (Windows 11 + 17-mode vault + IDE-centric + automation-aware) and the unified Gap Matrix in [`60-gap-analysis.md`](60-gap-analysis.md). No new web research was performed; all citations resolve to Phases 1–6.

**Decision**

**Adopt Path Hybrid as the primary migration path.** Use Copilot Chat for interactive IDE work + Copilot CLI for automation, hook-based `fileRegex` policy enforcement, and BYOK. Share `.agent.md` files via symlink between `.github/agents/` and `~/.copilot/agents/`; share one `AGENTS.md` per project read natively by both surfaces; generate the two MCP file shapes from one canonical source (Q-050 owns the choice) via a Phase-8 converter.

**Rationale — score table**

| Criterion              |       Wt |        A |        B |        C |        D | **Hybrid** |
| ---------------------- | -------: | -------: | -------: | -------: | -------: | ---------: |
| C1 Capability fidelity |      30% |        2 |        4 |        4 |        5 |      **4** |
| C2 Effort              |      20% |        4 |        3 |        2 |        1 |      **3** |
| C3 Operational risk    |      15% |        4 |        3 |        2 |        2 |      **3** |
| C4 Day-to-day UX       |      10% |        5 |        2 |        2 |        5 |      **4** |
| C5 Automation / CI     |      10% |        1 |        5 |        5 |        3 |      **5** |
| C6 Vault portability   |       5% |        3 |        5 |        4 |        4 |      **5** |
| C7 Reversibility       |       5% |        4 |        5 |        3 |        2 |      **5** |
| C8 Cost                |       5% |        3 |        5 |        5 |        3 |      **5** |
| **Weighted total**     | **100%** | **3.10** | **3.70** | **3.20** | **3.25** |   **3.90** |

Three-bullet justification:

- **Hybrid scores highest (3.90)** and is the only path with no score below 3 on any criterion. It closes G-1 where it matters (the CLI surface enforces `preToolUse` for the vault's regex-bound modes — architect, translate, docs-extractor — confirmed in [`20 § Global Settings`](20-roo-vault-inventory.md)) without forcing the user out of the IDE for the modes that don't need it.
- **Effort is bounded** at 1–2 weeks first-project / <1 day per new project — comparable to Path A alone, materially less than Path C (2–4 weeks + alpha tax) or Path D (~1 engineer-month per [50 § 7](50-copilot-cli-research.md#7-sdk-githubcopilot-sdk--full-export-catalogue-phase-5b-ii-b-1) verdict).
- **Maximum reversibility** because `.agent.md` and `AGENTS.md` are cross-tool standards (Claude Code, Cursor, Codex, Gemini CLI all read at least one); only the MCP layer genuinely duplicates per the [CG-3 schema fork](50-copilot-cli-research.md#13-limits--known-gaps-relative-to-roo-cli-gap-catalog--phase-5b-ii-b-2).

**Conditions that would flip the recommendation** (top three from § 4.2):

1. If the vault's `fileRegex` audit (Q-047) returns zero rules → Path A (3.10 → 3.70) becomes acceptable; drop the CLI side if also no automation.
2. If user has no automation/CI/cron workflows planned → Path A becomes acceptable (C5's weight is wasted in Hybrid).
3. If the user has a demonstrated parallel-orchestration workload → escalate to Path C (Hybrid + Squad on the CLI side).

**Consequences**

- Phase 8 (migration playbook) is unblocked. Primary scope: Path Hybrid; Appendix scope: Path B-only mapping for the user who later prefers terminal-first workflows. Detailed hand-off in [`70-migration-paths.md` § 7](70-migration-paths.md).
- Phasing recommendation in [`70-migration-paths.md` § 4.4`](70-migration-paths.md): Stage 1 (week 1) Path A scaffold; Stage 2 (week 2) add CLI for the gaps; Stage 3 (later, conditional) escalate to C or D only if specific triggers fire.
- Path C and Path D are explicitly **NOT recommended** as starting points for the user's current vault. Both remain documented as Stage-3 escalations.
- Two new open questions surfaced: **Q-050** (canonical-source for dual-format MCP under Hybrid), **Q-051** (`AGENTS.md` ↔ `AGENTS.local.md` dual-surface read order). Existing Q-047 (`fileRegex` audit), Q-030 (vault BYOK usage), Q-024 (`*.toolsets.jsonc` Settings Sync) flagged as "resolve before Phase 8 execution".
- README Phase-7 badge flipped from ⬜ not-started to ✅ complete. Phase-8 status remains ⬜ not-started.
- Ready for [`80-migration-playbook.md`](80-migration-playbook.md) to begin.

**Status**

`accepted`

---

## 2026-04-26 18:35 — Phase 8a complete: shared assets + Chat-side playbook delivered

**Context**

Phase 7 ([`70-migration-paths.md`](70-migration-paths.md)) recommended **Path Hybrid** (Chat + CLI, weighted score 3.90). Phase 8 was split into 8a (shared core + Chat side) and 8b (CLI side + MCP schema fork + automation + validation + rollback) so the user can begin Stage-1 (Chat scaffold) work immediately while the more involved CLI hook authoring is queued for a separate subtask.

**Decision**

Populated the first half of [`80-migration-playbook.md`](80-migration-playbook.md) with six sections:

- **§ 0 — Overview & scope.** Path Hybrid context, architecture sketch (shared `.agent.md` + `AGENTS.md`; MCP duplicated per CG-3), full map of which sections are 8a vs 8b vs appendix, ✅/⏭/❌/⚠ badge convention.
- **§ 1 — Pre-migration checklist.** 7 numbered steps the user runs before touching config: vault `fileRegex` audit (Q-047 with `Select-String` command), canonical MCP source decision (Q-050 with three options + recommendation = "Chat-as-truth + jq generator"), subscription tier verification (table mapping features to tiers), `node -v` verification, dated backup script, Roo-extension disable (don't uninstall), upstream-issue watch list (`copilot-cli#52`, `#2392`, `vscode#251515`, `#251603`).
- **§ 2 — Shared assets.** Three sub-sections covering files that work on both surfaces: § 2.1 `AGENTS.md` (cross-tool standard, with `AGENTS.local.md` verification recipe per Q-051); § 2.2 `.agent.md` schema (canonical frontmatter, fully-worked architect-mode conversion side-by-side, asymmetric user-scope symlink helper, complete Roo→`.agent.md` field-mapping table); § 2.3 `.github/instructions/*.instructions.md` with `applyTo` glob (frontmatter schema, migration script, per-mode rules-folder ⏭ deferred to 8b).
- **§ 3 — Chat-side configuration.** Four sub-sections: § 3.1 `.vscode/mcp.json` (workspace, side-by-side conversion + `${input:…}` semantics + commit safety); § 3.2 `%APPDATA%\Code\User\mcp.json` (user/profile, profile-aware path note, fully-worked target with 4 enabled vault servers); § 3.3 `*.toolsets.jsonc` (G-3 workaround = inline `tools:` per agent, optional user-scope toolset example, Q-024 sync caveat); § 3.4 `.github/copilot-instructions.md` decision matrix vs `AGENTS.md` vs `.instructions.md`.
- **§ 4 — 17-mode mapping table.** One row per vault mode (slug, target tools allowlist, `Has fileRegex?`, target filename, notes). Best-effort tools column derived from [20 § Global Settings](20-roo-vault-inventory.md); user re-runs § 1 step 1 to confirm. Hook coverage list explicit at the bottom: 4 modes (`docs-writer`, `translate`, `docs-extractor`, `architect`) need Phase 8b `preToolUse` enforcement.
- **§ 5 — Step-by-step Phase 8a execution.** 8 numbered runnable PowerShell commands (directory creation, mode-loop sketch, AGENTS.md, rules conversion, MCP rewrite, user MCP, reload + verify, first-run secret prompt validation).
- **§ 6 — Hand-off to Phase 8b.** Cross-references the 4 hook-required rows from § 4, the Q-050 generator recommendation, and the pending Q-047/Q-051 user-executable verifications.

CLI-specific sections (§ 7–§ 12 + Appendix B) left as stubs in § 0's section map with `⏭ deferred to 8b` markers. File status remains `in-progress` per the brief; marker comment `<!-- Phase 8a complete 2026-04-26; Phase 8b pending … -->` added to the file head.

**Rationale**

- **Splitting 8 into 8a/8b unlocks parallel work** — the user can start Stage-1 (Chat scaffold per [`70 § 4.4`](70-migration-paths.md#-44--phasing-suggestion)) immediately with everything 8a delivers; 8b can be authored as a separate subtask without blocking.
- **Synthesis only — no web research required.** Every claim in 8a is sourced from existing memory files (10/20/40/60/70/99); inline cross-references (with section anchors) make the audit trail explicit.
- **Directly executable bias.** PowerShell commands, frontmatter snippets, side-by-side YAML→Markdown conversions, and the 4 enabled-MCP-server target file are paste-ready. The architect-mode worked example doubles as a template for the remaining 16 modes.
- **17-mode table is skeleton-with-audit-command, not fabricated values.** Where `tools:` or `fileRegex` data is uncertain without re-running the audit, the column is filled best-effort from [20 § Global Settings](20-roo-vault-inventory.md) and § 1 step 1 provides the exact `Select-String` command for user confirmation.

**Consequences**

- The user can begin Stage-1 (per [`70 § 4.4`](70-migration-paths.md#-44--phasing-suggestion)) using only the 8a sections.
- Phase 8b is unblocked and scoped: hook coverage = 4 modes (named in § 4); MCP generator design = Chat-as-truth + `jq` (per § 1 step 2); CLI mirror config = parallel to § 3 with the schema-fork rename.
- README's Phase-8 badge flipped from ⬜ not-started to 🟡 in-progress (8a complete).
- Two new questions surfaced: **Q-052** (precise group→tools expansion table for non-`read`/`edit`/`mcp` Roo groups) and **Q-053** (whether `.agent.md` `agents:` allowlist accepts emoji-prefixed display names or requires the kebab-case slug). See [`99-open-questions.md`](99-open-questions.md).
- The pending Q-047 audit (vault `fileRegex` blast radius) and Q-051 dual-surface verification of `AGENTS.local.md` are explicitly hand-listed in § 6 as user-executable prerequisites for 8b.

**Status**

`accepted`

---

## 2026-04-26 18:45 — Phase 8b-i: Chat-as-truth MCP generator chosen (Q-050) and CG-11 sub-agent bypass mitigation locked in

**Context**

Phase 8a left two cliff-edges to resolve before Stage-2 (CLI rollout) could proceed: (1) Q-050 — the dual-format MCP fork (Chat `servers:` vs CLI `mcpServers:`, CG-3) needed a canonical-source decision so users wouldn't have to hand-edit two files; (2) CG-11 — the sub-agent `preToolUse` bypass bug ([`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392)) threatened to re-escalate G-1 from 🟠 back to 🔴 on the CLI path because the vault's orchestrator pattern dispatches frequently. Phase 8b-i had to commit to a stance on both before authoring §§ 7–9 of [`80-migration-playbook.md`](80-migration-playbook.md).

**Decision**

1. **Q-050 — Chat (`.vscode/mcp.json`) is the source of truth; CLI `mcp-config.json` is generated.** Adopt option (a) from § 1 step 2 of the playbook. Ship a PowerShell generator script ([`80 § 9.1`](80-migration-playbook.md#-91--generator-script--scriptsgenerate-cli-mcppspowershell)) that:
    - Reads `.vscode/mcp.json` (or `%APPDATA%\Code\User\mcp.json` for user-scope).
    - Renames top-level `servers` → `mcpServers`.
    - Rewrites every `${input:id}` placeholder to `${ENV_VAR_NAME}` using a 5-row mapping table covering the 4 secret-bearing vault MCP servers (`github` → `GITHUB_PAT`, `tavily` → `TAVILY_API_KEY`, `context7` → `CONTEXT7_API_KEY`, `ado` → `ADO_PAT`, `brave-search` → `BRAVE_API_KEY` for future re-enablement).
    - Defaults missing per-server `tools` arrays to `["*"]` (with Q-055 filed to revisit).
    - Writes `$env:COPILOT_HOME\mcp-config.json` (or `~/.copilot/mcp-config.json` if `COPILOT_HOME` is unset).
    - Supports `-DryRun` for previewing.
2. **CG-11 — accept the sub-agent bypass as a known limitation; mitigate by avoiding sub-agent dispatch for the 4 restricted modes.** Document the limitation in 3 places: (a) every restricted agent's body warns against being invoked via `task` ([`80 § 7.7`](80-migration-playbook.md#-77--worked-example-architect-mode--cli-agentmd) example); (b) the orchestrator agent's body forbids delegating restricted work; (c) [`80 § 8.6`](80-migration-playbook.md#-86--caveats--known-limitations) names the bug, links the issue, and pins it as a § 1 step 7 watch item. When [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) ships, the caveat is dropped wholesale and G-1 is fully closed on the CLI path.

Both decisions are baked into the appended §§ 7–9 of [`80-migration-playbook.md`](80-migration-playbook.md). The playbook marker comment is updated to `<!-- Phase 8a + 8b-i complete 2026-04-26; Phase 8b-ii pending (automation, validation, rollback, Path B appendix) -->`.

**Rationale**

- **Chat-as-truth (option a) wins on IDE ergonomics for this vault.** The user lives in VS Code; `.vscode/mcp.json` is what the "MCP: Open Workspace Configuration" command edits, so day-to-day MCP changes naturally land in the canonical file. Option (c) (third canonical YAML + two generators) adds an extra file no tool reads natively and is only worth it if dev-container / `.envrc` MCP configs are also being generated — they aren't, here. Option (b) (CLI-as-truth) loses the Credential-Manager-backed `${input:…}` first-run prompt UX, which is the single best secret-handling affordance on the Chat side.
- **One-way generation is simpler than round-tripping.** A round-trip generator must preserve unknowable Chat-specific fields (`inputs:` array, profile-state) on the way back from CLI; one-way avoids that. The trade-off is that any hand-edit of `mcp-config.json` is overwritten next regen — documented in [`80 § 9.4`](80-migration-playbook.md#-94--when-not-to-use-the-generator) (when NOT to use the generator).
- **CG-11 mitigation by convention is acceptable for Phase 8b-i.** The 4 restricted modes (`docs-writer`, `translate`, `docs-extractor`, `architect`) are typically used as **boot agents**, not as sub-agents in orchestrator fan-outs (per the vault's actual usage pattern noted in [Q-047](99-open-questions.md)). The risk surface is therefore narrower than the bug's worst-case description. The playbook explicitly forbids sub-agent dispatch of restricted modes in agent bodies, so the constraint is enforceable via prose discipline even though it cannot be enforced by the runtime.
- **Defers full structural enforcement to upstream.** When [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) ships, the convention can be relaxed and `task`-dispatched sub-agents will inherit the policy. No vault-side rework needed; just delete the warning paragraphs.

**Consequences**

- [`80-migration-playbook.md`](80-migration-playbook.md) gains §§ 7 (CLI-side config, ~9 sub-sections), 8 (preToolUse hook with full PowerShell ref impl + JSON policy table for the 4 modes + 3-place CG-11 mitigation), 9 (MCP generator + 7-row env-var mapping table). File status remains `in-progress`; marker comment updated. README Phase-8 status badge updated to reflect 8a + 8b-i complete; 8b-ii pending.
- Vault setup gets two new mandatory pieces before Stage-2: (a) the PowerShell hook script + JSON policy table at `$COPILOT_HOME/{hooks,state}/`; (b) the `generate-cli-mcp.ps1` script in `scripts/` plus 4 User-scope env vars (`GITHUB_PAT`, `TAVILY_API_KEY`, `CONTEXT7_API_KEY`, `ADO_PAT`).
- Two new open questions filed: **Q-054** (does the CLI export `$env:COPILOT_AGENT` to hook subprocesses? — would let § 8.3 drop the wrapper) and **Q-055** (per-server `tools` field round-tripping through the generator — affects security posture for high-blast-radius MCP servers).
- **Phase 8b-ii scope explicitly preserved and untouched**: no symlink/setup automation scripts, no validation matrix, no rollback plan, no Path B appendix, no executive summary. Each is named in inline `<!-- TODO Phase 8b-ii: … -->` markers throughout the new sections to make hand-off boundaries explicit.
- The Chat path remains the only surface where G-1 stays 🔴 (no hook substrate); the CLI path continues to enjoy the 🟠 demotion documented in [`50 § 13`](50-copilot-cli-research.md#13-limits--known-gaps-relative-to-roo-cli-gap-catalog--phase-5b-ii-b-2). Hybrid users get the better outcome on the surface where the work happens (CLI for restricted modes) while still using Chat for unrestricted interactive work.

**Status**

`accepted`

---

## 2026-04-26 18:52 — Phase 8b-ii: symlink-not-copy for setup automation; 24-row table-driven validation matrix; Path B kept as a one-page appendix

**Context**

Phase 8b-i closed the CLI configuration cliff-edges (Q-050 + CG-11 mitigation). Phase 8b-ii had to land the four remaining sections (§§ 10–12 + Appendix B) and flip the playbook to `status: complete`. Three implementation choices were unresolved at the start of 8b-ii: (1) whether per-machine setup automation should **copy** the vault into `%USERPROFILE%\.copilot\` or **symlink** it; (2) what shape the validation matrix should take (prose runbook vs table-driven smoke tests vs scripted assertions); (3) how much depth Appendix B (Path B fallback) should carry given Path Hybrid won decisively in Phase 7.

**Decision**

1. **Symlink, do not copy, for both vault and user-scope consumer paths.** [`80 § 10.1`](80-migration-playbook.md#-101--scriptssetup-copilot-vaultps1-user-scope-one-time) and [`§ 10.2`](80-migration-playbook.md#-102--scriptssetup-copilot-projectps1-per-project-bootstrap) standardize on `New-Item -ItemType SymbolicLink` for everything that is "vault → consumer" (user-scope agents, instructions, hooks, state, mcp-config). Per-project `.github/` assets are **copied**, not symlinked, because they live in the project repo and must be reviewable in PRs. Symlink capability is gated by an Administrator OR Developer Mode pre-flight check (`Test-CanSymlink`) with a clear error message when neither is satisfied.
2. **Validation matrix is table-driven with copy-pasteable commands, organised in 4 buckets** (Chat / CLI / Hooks / Cross-cutting). Each row carries an ID prefixed `T-` plus a gap-ID suffix where applicable. [`80 § 11`](80-migration-playbook.md#-11--validation-matrix-phase-8b-ii) ships **24 tests** total: 8 Chat + 4 CLI core + 8 hook tests (positive + negative for each of the 4 restricted modes) + 5 cross-cutting (incl. the Q-039 latency probe and pre-commit verification). The matrix closes the `<!-- TODO Phase 8b-ii: smoke-test runbook -->` from § 8.6 and exceeds the ≥20-test target.
3. **Appendix B is one page (5 sub-sections), not a parallel playbook.** Sub-sections cover triggers, diff vs Hybrid, section-by-section delta list, ½–1 day Hybrid → B migration estimate, and ~1 day reverse migration. References §§ 7–8 + 11.2 of the main playbook rather than re-deriving CLI content.

Playbook frontmatter flipped `status: in-progress` → `status: complete`; marker comment updated to `<!-- Phase 8 complete 2026-04-26 (8a + 8b-i + 8b-ii); Phase 9 (executive summary) pending -->`.

**Rationale**

- **Symlinks beat copy on every Phase-7 criterion the vault weights.** (a) Single-source-of-truth — eliminates the "did I update both?" failure mode that plagues copy-based approaches. (b) Multi-machine portability — `setup-copilot-vault.ps1` running on a second machine recreates symlinks pointing at the (presumably synced) vault, no migration. (c) Mirrors the existing `roo-vault\setup-vault.ps1` pattern the user already trusts (per [20 § Global Settings](20-roo-vault-inventory.md)). The downside (admin/Developer-Mode requirement) is a one-time cost detected by `Test-CanSymlink` rather than failing silently mid-script. The exception — per-project `.github/` assets — are copied because they're code-review artifacts that benefit from being inside the repo's diff.
- **Table-driven validation maximises hand-off readability.** A prose runbook hides the test count and makes coverage gaps invisible; scripted assertions buy precision but lock the user into a specific test framework. A table with copy-paste `cmd` + `expected` columns lets a future operator (or LLM) execute one row at a time, cite the row ID in failure reports, and re-run subsets after focused edits. The 4-bucket organization (§ 11.4) makes the "when to run what" decision mechanical: edit a `.agent.md` → run T-CHAT-01 + T-CLI-01 only; edit `mode-policies.json` → run all T-HOOK-\*.
- **Appendix B's depth is bounded by Hybrid's decisive win.** Path B scored 3.70 vs Hybrid's 3.90; the gap is small enough that Path B remains a credible fallback but large enough that re-publishing 12 sections of CLI content is wasteful. The trigger conditions (B.1) are deliberately objective — "audit chat history monthly; >2 violations over 30 days" — so the switch decision is mechanical, not subjective. The reverse migration path (B.5) is documented to keep the option open if Chat catches up upstream.

**Consequences**

- [`80-migration-playbook.md`](80-migration-playbook.md) gains §§ 10 (3 scripts: `setup-copilot-vault.ps1`, `setup-copilot-project.ps1`, pre-commit stub), 11 (24-row validation matrix in 4 buckets + coverage summary + "when to run what"), 12 (full + 4 partial rollback scenarios + data-preservation procedure + 7-point sign-off checklist), Appendix B (5 sub-sections, ~1 page). Frontmatter status flipped to `complete`; map-of-contents (§ 0) updated to mark all 8b-ii sections ✅.
- README Phase-8 badge flipped from 🟡 in-progress to ✅ complete with the new sub-bullet enumeration.
- Three new open questions filed: **Q-056** (vault `project-templates/` subtree needs to be populated before `setup-copilot-project.ps1` is useful), **Q-057** (Q-039 latency baseline still owed; T-X-05 in the matrix is the probe), **Q-058** (symlink behaviour under OneDrive / corporate redirected profiles needs validation before enterprise rollout).
- **Phase 9 (executive summary) is the last remaining phase.** The investigation is now feature-complete — every claim made in §§ 0–10 has at least one validation row in § 11; every rollback scenario has a checklist; every fallback path is documented. Phase 9 should be a synthesis pass that distills §§ 0–12 into a 2–4 page summary for stakeholders and references the playbook for execution detail.
- **Operational ready:** a user can now (a) run `setup-copilot-vault.ps1` once, (b) run `setup-copilot-project.ps1` per repo, (c) execute the § 11 matrix to validate, (d) follow § 12 to roll back if needed, (e) switch to Appendix B if Chat proves unsuitable — without further architect-mode design work.

**Status**

`accepted`

---

## 2026-04-26 19:00 — Phase 9 (executive summary) complete; investigation closed

**Context**

Phase 9 was the synthesis pass that distilled the eight prior phases into a single self-contained reader-facing document at [`00-executive-summary.md`](00-executive-summary.md). With Phase 9 shipped, every section of [`00-plan.md`](00-plan.md) has a corresponding deliverable; no open work remains in the investigation scope. This entry retrospectively closes the log.

**Decision**

Flip [`90-decision-log.md`](90-decision-log.md) front-matter `status: seeded` → `status: closed`. Mark the investigation feature-complete. Surface [`00-executive-summary.md`](00-executive-summary.md) as the new "START HERE" entry point in [`README.md`](README.md), demoting [`00-plan.md`](00-plan.md) to historical. No new open questions surfaced during synthesis (the memory files were internally consistent).

Phase 9 verification:

- [`00-executive-summary.md`](00-executive-summary.md) created with all 14 required sections (TL;DR through File Map appendix); ~370 lines; frontmatter `status: complete, phase: 9`; cites every prior phase inline.
- [`README.md`](README.md) updated: prominent "START HERE" callout above the Purpose heading; file map row inserted for `00-executive-summary.md`; Phase-9 status badge flipped 🟡 → ✅; index `status` flipped `in-progress` → `complete`.
- No edits required to [`99-open-questions.md`](99-open-questions.md) — synthesis surfaced no contradictions between memory files.

**Rationale — what went well · what would be done differently**

- **What went well: small subtask decomposition after early failures.** The investigation scaled past the model's single-context limit only after Phase 4 was split into 4a/b/c/d, Phase 5 into 5a/5b-i/5b-ii-A/5b-ii-B-1/5b-ii-B-2, and Phase 8 into 8a/8b-i/8b-ii. Each sub-phase was sized to fit a single subtask context with room for citations, and each closed with an explicit hand-off paragraph naming the next sub-phase's scope. This let later sub-phases reference earlier findings without re-deriving them, and kept the decision log's audit trail fine-grained enough to recover from any single bad turn. The Gap Catalog (G-/W- + CG-/CW-) standardised across Phase 4d and Phase 5b-ii-B-2 paid off enormously in Phase 6's merge.
- **What would be done differently: front-load the user-input questions.** Q-047 (vault `fileRegex` audit), Q-030 (BYOK usage), and Q-024 (Settings Sync) all required user execution, and all three landed late enough that Phase 7 / Phase 8 had to ship with conditional language ("if Q-047 returns…"). A Phase-0.5 user-questionnaire pass (5 minutes of the user's time) would have removed three layers of conditionals from the playbook and let the recommendation be more decisive on the first pass. Future similar investigations should bake a "user inputs needed before Phase N" checkpoint into [`00-plan.md`](00-plan.md) explicitly.

**Consequences**

- Investigation officially closed. Future memory-file edits (e.g., when [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) ships and CG-11 closes) should be filed as new dated entries in this log under a re-opened status, not as in-place edits.
- The user can begin execution against [`80-migration-playbook.md`](80-migration-playbook.md) immediately; everything they need fits in [`00-executive-summary.md`](00-executive-summary.md) §§ 9 + 12 (migration plan + next steps).
- README's index `status` is now `complete` — the next reader sees green badges across all 9 phases.

**Status**

`accepted` · investigation `closed`

---

## 2026-04-30 01:35 — Investigation re-opened: Phase 10a (PAW inventory) complete

**Context**

The user introduced a new candidate, **PAW (Phased Agent Workflow)** at `c:/git/phased-agent-workflow`, after the investigation closed at the end of Phase 9. Phase 10 was scoped as a 3-step extension (10a inventory → 10b gap-matrix folding → 10c re-score) without disturbing Phases 1–9. This entry covers Phase 10a only.

**Decision**

Re-open the investigation. Flip [`90-decision-log.md`](90-decision-log.md) front-matter `status: closed` → `status: re-opened`. Flip [`README.md`](README.md) front-matter `status: complete` → `status: in-progress`. Mark Path Hybrid (3.90 winner from Phase 7) as the **standing** recommendation pending Phase 10c re-score; do **not** retract the recommendation today.

Phase 10a deliverable: created [`35-paw-inventory.md`](35-paw-inventory.md) modelled on the structure of [`30-squad-inventory.md`](30-squad-inventory.md). 13 sections (Identity / Architecture / Mode-Agent-Phase System / Tool Access / MCP / Rules / Orchestration / UI / Model & Provider / Setup / Maturity / Gap Catalog / Open Questions). Frontmatter `status: complete, phase: 10a, date: 2026-04-30`. Preliminary Gap Catalog landed with **0 × 🔴 + 4 × 🟠 + 12 × 🟡 = 16 entries** (P-1..P-11 plus PW-1..PW-5). Six new open questions filed as **Q-059..Q-064** in [`99-open-questions.md`](99-open-questions.md).

Bookkeeping: [`README.md`](README.md) updated with (a) `35-paw-inventory.md` file-map row, (b) status-table rows for 10a ✅ / 10b ⬜ / 10c ⬜, (c) a new "Phase 10 — PAW evaluation (re-opened 2026-04-30)" section explaining the sub-phase split.

**Rationale — first impressions of PAW**

PAW is **structurally a third category** distinct from anything investigated in Phases 1–9. It is not an extension that owns an agent loop (like Roo), not a CLI wrapper that drives Copilot programmatically (like Squad), not a chat host (like Copilot Chat), and not a binary (like Copilot CLI). PAW is a **two-agent prompt-and-skill bundle plus distribution wrappers**: it ships two `.agent.md` orchestrators (`PAW`, `PAW-Review`), ~30 `SKILL.md` skill packages, a 1113-line normative specification, a 310-line VS Code extension that installs the agent files into `~/.copilot/agents/`, a Node ESM CLI installer (`@paw-workflow/cli`) that does the same for Copilot CLI / Claude Code, and a Copilot CLI plugin manifest (`plugin.json` v0.3.0) that publishes the same bundle as a first-class plugin. **Zero runtime dependencies** outside `vscode` — no `@github/copilot-sdk`, no `@anthropic-ai/sdk`, no `@modelcontextprotocol/sdk`. The closest analog among prior investigations is **Squad's `.copilot/skills/` + `.github/agents/squad.agent.md` pattern**, but PAW (a) has no SDK runtime layer at all (Squad has `CopilotClient` via `@github/copilot-sdk`), (b) imposes a strict phased workflow state machine (Squad is parallel-by-default, PAW is serial-by-design with explicit transition gates), and (c) targets _three_ hosts (Copilot CLI, Copilot Chat, Claude Code) via the same Markdown bundle, where Squad targets the Copilot CLI primarily.

Stage maturity: components at 0.0.1 (NPM CLI) / 0.0.2-dev (extension) / 0.3.0 (Copilot CLI plugin); 1113-line normative spec; ~20 integration tests with a real LLM-as-judge harness; very active dogfooding (25+ in-flight `.paw/work/<id>/` directories). It reads as more mature than its version numbers suggest, and lower-risk to adopt than Squad-on-Copilot-SDK because there is no transitive SDK churn surface.

**Consequences**

- Phase 10b is unblocked and is the next subtask: fold the P-/PW- entries from § 12 of [`35-paw-inventory.md`](35-paw-inventory.md) into the unified matrix in [`60-gap-analysis.md`](60-gap-analysis.md), define Path E (Hybrid + PAW overlay), and assign per-axis severities. Q-059..Q-061 in particular need answers before Path E severities can be finalised (`allowed-tools` intent, MCP filtering plans, project-level customisation story).
- Phase 10c is unblocked once 10b lands: re-run the weighted scoring from [`70-migration-paths.md`](70-migration-paths.md) with Path E added; if Path E ≥ Path Hybrid's 3.90 the recommendation flips and [`00-executive-summary.md`](00-executive-summary.md) needs an addendum.
- No Phase 1–9 deliverables modified. Path Hybrid remains the standing recommendation until 10c completes.
- The user can begin reading [`35-paw-inventory.md`](35-paw-inventory.md) immediately if they want a self-contained 13-section description of PAW; nothing in 1–9 needs to be re-read first.

**Status**

`accepted` · investigation `re-opened`

---

## 2026-04-30 02:05 — Phase 10b complete: Path E (PAW alone) = 2.60; Path Hybrid+PAW = 3.85; Hybrid 3.90 standing recommendation unchanged

**Context**

Phase 10b's task was to fold the preliminary PAW gap catalog (P-1..P-11 / PW-1..PW-5 from [`35-paw-inventory.md` § 12](35-paw-inventory.md#12-paw-gap-catalog-preliminary)) into the unified gap matrix at [`60-gap-analysis.md`](60-gap-analysis.md), define Path E (and the canonical composition Hybrid+PAW), and re-score with the Phase-7 rubric. Open at start of phase: standing recommendation = Path Hybrid (3.90) from Phase 7. Question: does adding PAW change that?

**Decision**

1. **Add a PAW column to all 12 sub-tables** in [`60-gap-analysis.md`](60-gap-analysis.md) §§ B.1–B.12 expressing PAW's per-row delta against the host (`inherits` for parity, `+ <feature>` for additive PAW wins, severity icons for PAW-specific gaps). PAW column convention documented in § A. Add new § G "PAW Surface Summary" with per-section severity tally (**0 × 🔴 · 5 × 🟠 · 6 × 🟡 · 9 × ➕ PAW-specific deltas**), three headline strengths (serial workflow state machine, artifact-based persistence at `.paw/work/`, multi-model planning + SoT review), three headline gaps PAW does _not_ fix (G-1 unchanged via P-1, G-2 _worse_ via P-9, no webview), and a composability matrix.
2. **Define two new candidate paths** in [`70-migration-paths.md`](70-migration-paths.md):
    - **Path E (PAW alone on top of one host).** Section § 2.F. Rubric-scored against the same 8 weighted criteria. **Score: 2.60 (worst of any path investigated).** Driven by C1=2 (17 vault modes collapse to 2 PAW agents — substantial vault rewrite), C2=2 (2–4 weeks first project + per-work-item Spec/Research/Plan overhead), C5=3 (no PAW-side headless invocation; `paw_new_session` is fire-and-forget).
    - **Path Hybrid+PAW (Hybrid substrate + PAW layer).** Section § 2.G. Canonical composition: Hybrid as host substrate + PAW installed as both Copilot CLI plugin and VS Code extension. **Score: 3.85.** Drops 0.05 below plain Hybrid entirely on C7 (Reversibility 5 → 4) because adopting PAW creates a vault subtree (`.paw/work/`, `WorkflowContext.md`) that doesn't trivially port to Roo / Squad / vanilla Copilot. Every other criterion unchanged from plain Hybrid.
3. **Standing recommendation unchanged: plain Hybrid (3.90).** Update §§ 4.1, 4.2, 4.5, 6 with PAW context. Add § 4.1.1 "When to layer PAW on top" listing four trigger conditions for adopting Hybrid+PAW as a Stage-3 escalation (analogous to Squad on Path C). Update side-by-side comparison table to include both new paths; ranks: 1st Hybrid (3.90), 2nd Hybrid+PAW (3.85), 3rd B (3.70), 4th D (3.25), 5th C (3.20), 6th A (3.10), 7th E (2.60).
4. **File two new open questions** in [`99-open-questions.md`](99-open-questions.md): **Q-065** (PAW install vs vault `~/.copilot/agents/` symlink interaction — affects Hybrid+PAW first-project setup), **Q-066** (`paw-init` template-honour vs interactive-prompt — affects whether the vault can ship a default `WorkflowContext.md` preset).
5. **Phase 10b status flipped** from ⬜ to ✅ in [`README.md`](README.md). Phase 10c remains ⬜ pending — its scope contracts to "update the executive summary with the Phase 10b finding (recommendation does **not** flip)".

**Rationale — why PAW didn't move the needle on the rubric**

PAW's three structural wins are real and meaningful (the strict serial workflow state machine is the only off-the-shelf G-4 closure investigated in any of Phases 1–10; `.paw/work/` artifact persistence is _strictly better_ than every other path's session model; multi-model planning + Society-of-Thought review are richer than Squad's `model-selection` skill or Roo's per-mode `apiConfigId`). But they are **not what the Phase-7 rubric measures**:

- **C1 (Capability fidelity, 30%) measures Phase-6 surviving 🔴/🟠 row count after migration.** PAW closes none of those rows — P-1 leaves G-1 unchanged, P-9 makes G-2 _worse_ than Path A/B by deprecating `.paw/instructions/`, and no PAW capability restores any vault feature lost on plain Hybrid. PAW's wins land in a column the rubric doesn't have.
- **C2 (Effort, 20%) is _worse_ under Hybrid+PAW** because the per-work-item Spec/Research/Plan/Plan-Review overhead is a recurring cost on top of Hybrid's 1–2 week setup. The rubric counts effort as bad-when-high; PAW's workflow-discipline overhead reads as effort, not as value, by the rubric's design.
- **C7 (Reversibility, 5%) drops 1 point** because PAW-managed work items create a vault subtree that needs PAW to read meaningfully.

**The honest framing** is that Phase 10b confirmed Phase 7's recommendation through the rubric _and_ surfaced that the rubric doesn't capture PAW's wins. § 6 sensitivity analysis added two new triggers: (a) hypothetical C9 criterion at 10% weight for "workflow discipline / artifact code-reviewability" would push Hybrid+PAW (3.85 → ~3.97) above plain Hybrid (3.90 → ~3.71); (b) PAW reaching 1.0 stable would close the C3 0.x-cadence gap and tie Hybrid+PAW to plain Hybrid at ~4.00. Phase 10c's executive-summary update should mention this so future readers don't mistake "rubric says Hybrid wins" for "PAW is wrong for everyone".

**The recommendation framing** in § 4.1.1 is therefore: _plain Hybrid is the default_; _Hybrid+PAW is a Stage-3 escalation_ for users whose workflow is dominated by spec-driven feature PRs or who value workflow discipline highly enough to absorb the C7 lock-in cost. This mirrors how Path C (Squad) is treated — a real value prop for a narrow workload.

**Consequences**

- [`60-gap-analysis.md`](60-gap-analysis.md) gains a PAW column on every sub-table (~70 row-cells annotated) plus a new § G PAW Surface Summary (~5 sub-sections including composability matrix). Frontmatter `last_updated` flipped 2026-04-26 → 2026-04-30; a Phase-10b banner comment added at the top.
- [`70-migration-paths.md`](70-migration-paths.md) gains §§ 2.F (Path E, ~10 sub-sections + score table) and 2.G (Path Hybrid+PAW, ~10 sub-sections + score table). § 3 side-by-side table extended to 7 paths; § 4.1 prefaced with "Path Hybrid (3.90) remains the primary recommendation"; new § 4.1.1 "When to layer PAW on top" with four trigger conditions; §§ 4.2 / 4.5 / 6 updated with PAW context; § 7 hand-off open-questions list updated with Q-059..Q-066.
- [`README.md`](README.md) Phase-10b status flipped ⬜ → ✅; status table updated to enumerate the two new sections in 60/70; the Phase-10 narrative paragraph updated to record that the recommendation **did not flip** as a result of Phase 10b.
- [`99-open-questions.md`](99-open-questions.md) gains **Q-065** and **Q-066** in a new "Added during Phase 10b" section. Q-059..Q-064 (filed in Phase 10a) are retained as still-open; their answers don't change Phase 10b's score (P-1 stays 🟠 regardless of Q-059's resolution, etc.) but they do affect Hybrid+PAW first-project setup (Q-065/Q-066 specifically).
- **Phase 10c is unblocked and is the last remaining phase.** Its scope is now narrow: update [`00-executive-summary.md`](00-executive-summary.md) with one paragraph noting that PAW was evaluated, scored 2.60 standalone / 3.85 layered, and is documented as a Stage-3 escalation in [`70 § 4.1.1`](70-migration-paths.md#-411--when-to-layer-paw-on-top-added-phase-10b). The headline 10-step rollout plan does **not** change. The executive-summary file map should add `35-paw-inventory.md`. No re-derivation of Phases 1–9 needed.
- The user can begin reading [`70-migration-paths.md`](70-migration-paths.md) §§ 2.F / 2.G immediately if they want a self-contained 10-section description of either Path E or Hybrid+PAW; the [`60 § G`](60-gap-analysis.md#g-paw-surface-summary-added-phase-10b--2026-04-30) summary is a 1-page distillation suitable as a stakeholder briefing.

**Status**

`accepted` · standing recommendation: **Path Hybrid (3.90)** unchanged · investigation `re-opened` (Phase 10c pending)

---

## 2026-04-30 02:30 — Investigation re-closed after Phase 10 PAW evaluation

**Context**

Phase 10c was the final synthesis pass after the Phase 10 PAW re-opening. Phase 10b had already produced the load-bearing finding (Path E = 2.60; Hybrid+PAW = 3.85; plain Hybrid 3.90 unchanged) and updated [`60-gap-analysis.md`](60-gap-analysis.md), [`70-migration-paths.md`](70-migration-paths.md), and [`99-open-questions.md`](99-open-questions.md). Phase 10c's narrow scope was to thread that finding into [`00-executive-summary.md`](00-executive-summary.md) and re-close the index — without disturbing the playbook ([`80-migration-playbook.md`](80-migration-playbook.md)) or any Phase 1–9 deliverables.

**Decision**

Re-close the investigation. Flip [`90-decision-log.md`](90-decision-log.md) front-matter `status: re-opened` → `status: closed`. Flip [`README.md`](README.md) front-matter `status: in-progress` → `status: complete`; mark Phase 10c ✅. Apply targeted edits to six sections of [`00-executive-summary.md`](00-executive-summary.md):

- **§ 1 TL;DR** — appended one sentence pointing to § 7.1 for the PAW addendum.
- **§ 6** — renamed "Five Migration Paths" → "Six Migration Paths"; added Path E (2.60) and Hybrid+PAW (3.85) rows; restated the Hybrid > Hybrid+PAW > B > D > C > A > E ranking.
- **§ 7.1 PAW Evaluation (new sub-section)** — ~15-line addendum quoting [`35-paw-inventory.md`](35-paw-inventory.md) for the PAW one-sentence definition, explaining why Path E scored worst (vault-rewrite cost), why Hybrid+PAW scored 3.85 not higher (C7 lock-in via `.paw/work/` subtree, dual-tool overhead, 0.x dependency cadence), the four trigger conditions for Stage-3 escalation, and the honest framing that PAW's three structural wins (serial state machine, artifact persistence, multi-model SoT review) live in a column the Phase-7 rubric doesn't have — a rubric limitation, not a PAW deficiency.
- **§ 12** — added step **10b** for conditional PAW re-evaluation as a Stage-3 escalation if any of the four [`70 § 4.1.1`](70-migration-paths.md#-411--when-to-layer-paw-on-top-added-phase-10b) trigger conditions become true (~½ day re-score effort).
- **§ 13** — appended a 6th decision row mirroring this entry.
- **§ 14 File Map** — added `35-paw-inventory.md` row (~640 lines); refreshed line-count estimates for the four files modified by Phase 10b (60-gap-analysis ~340; 70-migration-paths ~685; 90-decision-log ~810; 99-open-questions ~145); bumped `00-executive-summary.md` to ~400 to reflect the addendum.

Frontmatter on [`00-executive-summary.md`](00-executive-summary.md): added `phase_10_addendum: complete`, bumped `last_updated` to 2026-04-30, kept `status: complete`. No new open questions surfaced — the Phase 10b deliverables and the addendum are internally consistent (Q-067+ slot remains unused).

**Rationale — what the Phase 10 addendum revealed**

The PAW addendum surfaced a **rubric blind spot for spec-driven workflows**. Phase 7's 8-criterion weighted rubric was designed against the vault's 17-mode pattern and measures capability fidelity (rows surviving from the unified gap matrix), effort, operational risk, day-to-day UX, automation, portability, reversibility, and cost. None of these criteria capture **workflow discipline** (serial state machine), **artifact code-reviewability** (committed Markdown specs/plans), or **multi-perspective deliberation** (Society-of-Thought review) — PAW's three structural strengths. The rubric correctly judged plain Hybrid the right default for the current vault, but the "PAW is wrong for everyone" misreading is something this entry (and § 7.1) is at pains to forestall. Future similar evaluations against spec-driven candidates should consider adding a C9 criterion for workflow discipline if that workload becomes a meaningful slice of the user's day.

**Forward-looking note — when to re-open again**

Re-open the investigation when **any** of the following hold:

- One or more of the four [`70 § 4.1.1`](70-migration-paths.md#-411--when-to-layer-paw-on-top-added-phase-10b) trigger conditions becomes true (spec-driven PR cadence dominates daily work, cross-machine `.paw/work/` artifact persistence becomes valuable, multi-model SoT review demand emerges, or the user begins actively dogfooding PAW).
- **PAW reaches 1.0 stable** — closes the C3 0.x-cadence operational-risk gap and would re-tilt Hybrid+PAW toward parity with plain Hybrid (~4.00 each per the [Phase 10b sensitivity analysis](90-decision-log.md#2026-04-30-0205--phase-10b-complete-path-e-paw-alone--260-path-hybridpaw--385-hybrid-390-standing-recommendation-unchanged)).
- [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) (sub-agent hook bypass) ships — closes CG-11 and pushes plain Hybrid to ~4.05, widening the gap over Hybrid+PAW.
- A new candidate enters the field that the existing rubric doesn't measure well (the same lesson Phase 10 surfaced).

**Consequences**

- Investigation officially **re-closed** as of 2026-04-30 02:30. The user can begin execution against [`80-migration-playbook.md`](80-migration-playbook.md) immediately; the unchanged 10-step rollout in [`00-executive-summary.md` § 12](00-executive-summary.md#-12--recommended-next-steps) remains the canonical action list, with new conditional step 10b for the PAW re-evaluation watch.
- No edits to Phases 1–9 deliverables beyond bookkeeping ([`README.md`](README.md), this log, [`00-executive-summary.md`](00-executive-summary.md)). [`80-migration-playbook.md`](80-migration-playbook.md) is **deliberately untouched** — Hybrid+PAW execution detail is deferred to Stage-3 escalation, not added to the current playbook.
- README's index `status` is now `complete` again — the next reader sees green badges across all 9 phases plus 10a/10b/10c.
- Future memory-file edits (e.g., when [`copilot-cli#2392`](https://github.com/github/copilot-cli/issues/2392) ships and CG-11 closes, or PAW reaches 1.0) should be filed as new dated entries in this log under a re-opened status, not as in-place edits — the same convention from the Phase 9 close.

**Status**

`accepted` · standing recommendation: **Path Hybrid (3.90)** unchanged · investigation `closed` (PAW documented as Stage-3 escalation; re-evaluate per § "Forward-looking note" above)
