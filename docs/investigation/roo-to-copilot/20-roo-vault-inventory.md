---
phase: 2
status: complete
owner: architect-subtask
last_updated: 2026-04-26
sources:
  - ../../../../roo-vault/README.md
  - ../../../../roo-vault/setup-vault.ps1
  - ../../../../roo-vault/setup/setup_dev_box.ps1
  - ../../../../roo-vault/global-settings/custom_modes.yaml
  - ../../../../roo-vault/global-settings/mcp_settings.json
  - ../../../../roo-vault/projects/Roo-Code/.roomodes
  - ../../../../roo-vault/projects/Roo-Code/.roo/mcp.json
  - ../../../../roo-vault/projects/pgsql-orion/.roomodes
  - ../../../../roo-vault/plans/api-keys-known-risk.md
---

# Phase 2 — `roo-vault` Inventory

> Parent plan: [`00-plan.md`](00-plan.md) · Index: [`README.md`](README.md)

The user's "vault" lives at `c:/git/roo-vault` (sibling to `Roo-Code`). It is a checked-in personal mono-repo of Roo configuration that is **symlinked into VS Code's Roo settings directory** and into each project's `.roo/` so that one file edit propagates everywhere.

> All paths in this file are relative to the vault root unless noted. The clickable links use a `../../../../` prefix to escape the `Roo-Code/docs/investigation/roo-to-copilot/` location and reach the sibling `roo-vault/` directory.

## Top-Level Layout

Recursive listing of `c:/git/roo-vault` (top-level + first-level for project subdirs):

```
roo-vault/
├── .gitignore
├── README.md                              ← architecture overview
├── setup-vault.ps1                        ← per-project Windows setup script
├── setup-vault.sh                         ← per-project Linux/macOS setup script
│
├── global-settings/
│   ├── custom_modes.yaml                  ← 19 custom modes (symlinked to globalStorage)
│   └── mcp_settings.json                  ← gitignored; 7 MCP servers (3 enabled, 4 disabled)
│
├── shared-modes/                          ← long-form mode instruction bodies
│   ├── architect.md      code-reviewer.md      design-reviewer.md
│   ├── devops.md         docs-writer.md        pull-requestor.md
│   ├── review-addresser.md  security.md       task-filer.md
│
├── shared-rules/                          ← per-mode rule fragments
│   ├── rules-architect/         (2 files)
│   ├── rules-code/              (1 file: no-commit.md)
│   ├── rules-design-reviewer/   (1 file)
│   ├── rules-orchestrator/      (3 files)
│   ├── rules-pull-requestor/    (2 files)
│   └── rules-tester/            (1 file: testing-exemptions.md)
│
├── shared-skills/                         ← reusable SKILL.md packages
│   ├── archive-plan-doc/SKILL.md
│   ├── code-reviewer/SKILL.md
│   └── generate-plan-docs/SKILL.md
│
├── plans/                                 ← decision/audit/design memory
│   ├── api-keys-known-risk.md
│   ├── orchestrator-rules-audit-2026-04-14.md
│   └── archive/
│       ├── config-audit-2026-04-12.md
│       ├── config-audit-2026-04-13.md
│       ├── config-audit-remediation.md
│       └── mode-standardization-design.md
│
├── projects/
│   ├── argus/             ← scaffold only (.roo/, no .roomodes)
│   ├── hyper-v-mcp-server/
│   │   ├── .roomodes      (empty: customModes: [])
│   │   └── .roo/
│   ├── orcasql-breadth/
│   │   ├── .roomodes
│   │   └── .roo/
│   ├── pgsql-orion/
│   │   ├── .roomodes      (3 ADO-flavoured project modes)
│   │   └── .roo/
│   └── Roo-Code/
│       ├── .roomodes      (2 project overrides: devops, pr-fixer)
│       └── .roo/          (mcp.json + commands/ + rules-<slug>/ + skills/ + shared-modes/ + shared-rules/ + shared-skills/)
│
└── setup/
    ├── move_wsl_folder.ps1
    ├── setup_dev_box.ps1                  ← Windows dev-box bootstrap (NOT the vault setup)
    ├── setup_linux_box.sh
    ├── setup_ubuntu_box.sh
    └── tests/
```

Confirmed via `list_files` (recursive) on [`../../../../roo-vault`](../../../../roo-vault).

## Global Settings — `global-settings/custom_modes.yaml`

The vault's authoritative copy of the global custom modes is at [`../../../../roo-vault/global-settings/custom_modes.yaml`](../../../../roo-vault/global-settings/custom_modes.yaml:1). It contains **19 custom mode definitions**. Most use `customInstructions` of the form `Load and follow the shared … instructions from .roo/shared-modes/<slug>.md.` so the body lives once and is reused via the symlinked `shared-modes/`.

| # | Slug | Display name | Purpose | Groups | File restrictions | `allowedMcpServers` |
|---|---|---|---|---|---|---|
| 1 | `docs-writer` | 📝 Documentation Writer | Author/maintain README, API docs, ADRs | `read`, `edit`, `browser`, `command`, `mcp` | `edit` → `\.(md\|txt\|rst\|adoc)$` | (omitted → all) |
| 2 | `security` | 🔒 Security Analyst | Threat modelling, vulnerability review | `read`, `browser`, `command`, `mcp` | none | (omitted) |
| 3 | `design-reviewer` | 🏛️ Design Reviewer | Review designs / roadmaps; **never implements** | `read`, `browser`, `mcp` | none | (omitted) |
| 4 | `review-addresser` | 🔧 Review Addresser | Address PR feedback (scoped fixes) | `read`, `edit`, `command`, `mcp` | none | (omitted) |
| 5 | `code-reviewer` | 🔍 Code Reviewer | Formal code review; **READ-ONLY**, no edits | `read`, `command` | n/a (no edit group) | (omitted) |
| 6 | `task-filer` | 📋 Task Filer | File issues / work items into GitHub or ADO | `read`, `command`, `mcp` | none | (omitted) |
| 7 | `builder` | 🔨 Builder | Build system specialist | `read`, `edit`, `command`, `mcp` | none | (omitted) |
| 8 | `tester` | 🧪 Tester | Run / interpret tests across frameworks | `read`, `edit`, `command`, `mcp` | none | (omitted) |
| 9 | `translate` | 🌐 Translate | i18n / localisation file maintenance | `read`, `command`, `edit` (regex-restricted) | `edit` → `(.*\.(md\|ts\|tsx\|js\|jsx)$\|.*\.json$)` | (omitted) |
| 10 | `issue-fixer` | 🔧 Issue Fixer | Resolve GitHub issues end-to-end | `read`, `edit`, `command` | none | (omitted) |
| 11 | `merge-resolver` | 🔀 Merge Resolver | Resolve PR merge conflicts using git history | `read`, `edit`, `command`, `mcp` | none | (omitted) |
| 12 | `docs-extractor` | 📚 Docs Extractor | Extract raw facts for documentation | `read`, `edit` (regex), `command`, `mcp` | `edit` → `\.roo/extraction/.*\.(yaml\|json\|md)$` | (omitted) |
| 13 | `issue-investigator` | 🕵️ Issue Investigator | Triage GitHub issues; propose solutions | `read`, `command`, `mcp` | none | (omitted) |
| 14 | `issue-writer` | 📝 Issue Writer | Author well-formed GitHub issues | `read`, `command`, `mcp` | none | (omitted) |
| 15 | `code` | 💻 Code | **Override** of built-in `code` | `read`, `edit`, `command`, `mcp` | none | **`[]`** (empty → MCP disabled even though group is present) |
| 16 | `ask` | ❓ Ask | **Override** of built-in `ask` | `read`, `mcp` | none | `ado`, `context7`, `tavily`, `microsoft-learn` |
| 17 | `debug` | 🪲 Debug | **Override** of built-in `debug` | `read`, `edit`, `command`, `mcp` | none | `ado`, `git` |
| 18 | `architect` | 🏗️ Architect | **Override** of built-in `architect` | `read`, `edit` (regex), `mcp` | `edit` → `\.md$` | `git`, `context7`, `tavily`, `ado` |
| 19 | `pull-requestor` | 🚀 Pull Requestor | PR creation / management | `read`, `edit`, `command`, `mcp` | none | `ado`, `git` |
| 20 | `orchestrator` | 🪃 Orchestrator | **Override** of built-in `orchestrator` | `read` only | n/a | (omitted) |
| 21 | `devops` | ⚙️ DevOps Engineer | CI/CD, infra, containers, cloud | `read`, `edit`, `command`, `mcp` | none | `github`, `git` |

(Counted 21 entries in the YAML, not 19. The vault README mentions 14–15 modes; the file has grown.)

Cited at [`../../../../roo-vault/global-settings/custom_modes.yaml`](../../../../roo-vault/global-settings/custom_modes.yaml:1) (line ranges per mode visible in the file).

### Notable patterns in the global modes

- **Body indirection** — almost every mode's `customInstructions` says `Load and follow the shared … instructions from .roo/shared-modes/<slug>.md.`. The body lives in `shared-modes/<slug>.md` and is symlinked into each project's `.roo/shared-modes/`. This means changing one file updates every project's behaviour.
- **`code` is intentionally MCP-less** — `allowedMcpServers: []` ([`../../../../roo-vault/global-settings/custom_modes.yaml`](../../../../roo-vault/global-settings/custom_modes.yaml:271)) to keep raw coding sessions free of tool-schema bloat. Reasoning matches the design at [`docs/design/per-mode-mcp-settings.md`](../../design/per-mode-mcp-settings.md:6-10) (context bloat / 128-tool limit).
- **`code-reviewer` is `read+command` only** — explicit READ-ONLY enforcement so the agent cannot modify code under review.
- **`orchestrator` is `read` only** — the user's override demotes the built-in (which has `groups: []`) to `read`-only as a deliberate guardrail; all real work must go through `new_task` delegation.

## Per-Project Overrides

Per-project `<projectDir>/.roomodes` files **only contain modes that override or add to the global set**; for example [`../../../../roo-vault/projects/Roo-Code/.roomodes`](../../../../roo-vault/projects/Roo-Code/.roomodes:1) defines just `devops` and `pr-fixer`. The global `code`, `ask`, etc. apply unless project overrides them.

| Project | `.roomodes` overrides | `.roo/mcp.json` adds | Notes |
|---|---|---|---|
| `Roo-Code` | `devops`, `pr-fixer` (lines 1-22) | `ado` (Azure DevOps stdio) + `git` (mcp/git via Docker) | Project-level `.roo/` includes [`commands/`](../../../../roo-vault/projects/Roo-Code/.roo/commands), [`rules-<slug>/`](../../../../roo-vault/projects/Roo-Code/.roo) (XML rule packs per mode), [`skills/`](../../../../roo-vault/projects/Roo-Code/.roo/skills), and symlinks to `shared-modes/`, `shared-rules/`, `shared-skills/`. |
| `pgsql-orion` | `builder`, `tester`, `devops` (lines 1-121) | (project mcp.json adds `ado` for `msdata` ADO project + `git`) | Multi-language Postgres-fork project; `tester` mode declares 10 in-mode skill names (rust-tester, pytest-tester, dotnet-tester, …). `allowedMcpServers` set on `tester` to `[context7, git, microsoft-learn, tavily]`. |
| `hyper-v-mcp-server` | `customModes: []` (empty) | (per-project mcp.json) | Uses global modes only. Task filing routed to global `task-filer` + project `.roo/skills/file-task/SKILL.md`. |
| `orcasql-breadth` | `customModes: []` per the vault README | (per-project mcp.json with ADO config) | Same pattern as hyper-v-mcp-server but ADO backend. |
| `argus` | (no `.roomodes`) | (project `.roo/` scaffold) | Bare scaffold. |

### Convention: per-project `.roo/` structure

The convention (verified from [`../../../../roo-vault/projects/Roo-Code/.roo`](../../../../roo-vault/projects/Roo-Code/.roo)) is:

```
.roo/
├── mcp.json                                # project MCP servers
├── commands/                               # slash-command markdown files (cli-release.md, commit.md, release.md, …)
├── guidance/                               # long-form guidance docs (e.g. roo-translator.md)
├── plans/                                  # archived plans / design notes (this directory)
├── rules/                                  # generic rules: rules.md
├── rules-<modeSlug>/                       # per-mode rule packs (XML or .md)
│   ├── rules-architect/
│   ├── rules-code/                         # use-safeWriteJson.md
│   ├── rules-debug/                        # cli.md
│   ├── rules-docs-extractor/               # 1_extraction_workflow.xml, 2_verification_workflow.xml, 3_output_format.xml
│   ├── rules-issue-fixer/                  # 9 numbered .xml files
│   ├── rules-issue-investigator/           # 6 numbered .xml files
│   ├── rules-issue-writer/                 # 4 numbered .xml files
│   ├── rules-merge-resolver/               # 5 numbered .xml files
│   ├── rules-pr-fixer/                     # 5 numbered .xml files
│   └── rules-translate/                    # 001-general-rules.md + per-locale instructions
├── scripts/
├── shared-modes/        → symlink to roo-vault/shared-modes/        (vault setup)
├── shared-rules/        → symlink to roo-vault/shared-rules/         (vault setup)
├── shared-skills/       → symlink to roo-vault/shared-skills/        (vault setup)
└── skills/                                 # project-specific SKILL.md packages
    ├── evals-context/SKILL.md
    ├── roo-conflict-resolution/SKILL.md
    └── roo-translation/SKILL.md
```

Note the file `../../../../roo-vault/projects/Roo-Code/.roo/roomotes.yml` (sic — likely `.roomodes` typo) listed in the recursive listing.

## Setup Scripts

### `setup-vault.ps1` — the actual vault setup

The real vault wiring script is **not** at `setup/setup_dev_box.ps1` (that's a separate dev-box bootstrap). It lives at the vault root: [`../../../../roo-vault/setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:1) (Windows; companion `setup-vault.sh` for Linux/macOS).

Behaviour, per file inspection:

1. **Argument** — single positional `$ProjectName`; validated against `^[a-zA-Z0-9_-]+$` ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:33)). The project directory is computed as `(parent-of-vault)\<ProjectName>`, i.e. sibling to the vault ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:44)).
2. **Detect VS Code Roo settings path** — checks three candidates ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:60-64)):
   - `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline`
   - `%USERPROFILE%\.vscode-server\data\User\globalStorage\rooveterinaryinc.roo-cline`
   - `%APPDATA%\Code - Insiders\User\globalStorage\rooveterinaryinc.roo-cline`
3. **Symlink the entire `settings/` directory** under that VS Code path to point at `roo-vault/global-settings/` ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:163-175)). If a real `settings/` exists, it migrates (hash-compares) `mcp_settings.json`, `custom_modes.yaml`, and the legacy `cline_custom_modes.json` into the vault, then renames the original to `settings_backup_<unix-ts>` ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:127-154)).
4. **Build per-project `.roo/` blueprint inside the vault** at `roo-vault/projects/<ProjectName>/.roo/` with subdirs `skills/`, `rules/`, `rules-code/`, `rules-architect/`, `plans/`, `scripts/`, plus a default `{ "mcpServers": {} }` file ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:181-193)).
5. **Symlink `<projectDir>\.roo` → `roo-vault\projects\<ProjectName>\.roo`** ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:230-236)). If a real `.roo/` exists, it merges contents non-destructively (no overwrite) and renames the original to `.roo_backup_<unix-ts>`.
6. **Symlink `<projectDir>\myplans` → vault's `.roo/plans/`** for stable plan storage across branches ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:246-283)).
7. **Symlink `.roomodes` and `.clinerules`** at the project root if a vault copy exists ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:287-305)).
8. **Symlink shared content** — for each of `shared-modes`, `shared-rules`, `shared-skills`, create a symlink under the project's `.roo/` pointing back at the vault root's directory ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:311-333)).
9. **Update project `.gitignore`** with entries `.roo`, `.roomodes`, `.clinerules`, `myplans` and run `git rm --cached` to untrack any already-committed copies ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:346-375)).
10. **Init git in the vault** itself if needed, with a vault `.gitignore` that excludes `tasks/`, `.cline/`, `*.log`, `.DS_Store`, `.env`, and crucially `global-settings/mcp_settings.json` (because it contains API tokens) ([`setup-vault.ps1`](../../../../roo-vault/setup-vault.ps1:380-398)).

### `setup/setup_dev_box.ps1` — separate dev-box bootstrap

[`../../../../roo-vault/setup/setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:1) is a different script entirely — Windows dev-machine provisioning. It does **not** wire the vault; it installs:

- **WSL** + AzureLinux 3.0 distro (idempotent, optional drive relocation, `/etc/wsl.conf` systemd enable) ([`setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:144-240)).
- **Chocolatey** + tools: Git, VS Code, Python, Docker Desktop, NSSM, GitHub CLI, Azure CLI, Node.js LTS ([`setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:266-279)).
- **GitHub CLI extensions** `gh-copilot` and `gh-models` ([`setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:307-319)).
- **Azure CLI** `azure-devops` extension ([`setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:333-341)).
- **LiteLLM** Python package and a Windows service (`LiteLLMService`) via NSSM, listening on `localhost:4000` ([`setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:412-493)) — this is the local OpenAI-compatible proxy that Roo's codebase indexer talks to (see the final banner at [`setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:541-556)).
- **VS Code extensions** including `RooVeterinaryInc.roo-cline`, `GitHub.copilot`, plus language tools ([`setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:362-380)).
- **Docker + Qdrant** container for the codebase index vector store ([`setup_dev_box.ps1`](../../../../roo-vault/setup/setup_dev_box.ps1:495-535)).

Implication for the migration plan: the dev-box already has GitHub CLI + `gh-copilot` extension installed and authenticated, which is the foothold Phases 4–5 will build on.

## Memory / Notes Conventions

The vault's only "memory" surface beyond Roo's own conventions:

- [`../../../../roo-vault/plans/`](../../../../roo-vault/plans) — design / audit / decision documents:
  - [`api-keys-known-risk.md`](../../../../roo-vault/plans/api-keys-known-risk.md) — accepts the risk of committing free-tier MCP API keys.
  - [`orchestrator-rules-audit-2026-04-14.md`](../../../../roo-vault/plans/orchestrator-rules-audit-2026-04-14.md) — running audit of orchestrator delegation rules.
  - [`archive/`](../../../../roo-vault/plans/archive) — superseded plans (config audits, mode standardisation).
- Per-project `<vault>/projects/<name>/.roo/plans/` — symlinked back to `<projectDir>/myplans/` (see step 6 of `setup-vault.ps1`). This is where modes (especially architect) are instructed to drop plan markdown.
- No `memory/`, `notes/`, or `decisions/` top-level folder by name. The vault's collective state lives in `plans/` + per-project `.roo/plans/` + each agent's `update_todo_list` snapshot inside Roo's own globalState.

## MCP Server Inventory (Vault-wide)

Compiled from [`../../../../roo-vault/global-settings/mcp_settings.json`](../../../../roo-vault/global-settings/mcp_settings.json:1), [`../../../../roo-vault/projects/Roo-Code/.roo/mcp.json`](../../../../roo-vault/projects/Roo-Code/.roo/mcp.json:1), and the active workspace's [`.roo/mcp.json`](../../../.roo/mcp.json:1) (also vault-managed via the symlink chain). **All token / API-key values are redacted** as `***REDACTED***`.

| Server name | Scope | Transport | Command / URL | Purpose | Status |
|---|---|---|---|---|---|
| `github` | global | stdio | `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server` (env: `GITHUB_PERSONAL_ACCESS_TOKEN=***REDACTED***`) | GitHub Issues / PRs / repos / commits | Enabled |
| `context7` | global | streamable-http | `https://mcp.context7.com/mcp` (header: `CONTEXT7_API_KEY=***REDACTED***`) | Library-doc lookup (`resolve-library-id`, `query-docs`) | Enabled |
| `tavily` | global | stdio | `docker run -i --rm -e TAVILY_API_KEY mcp/tavily` (env: `TAVILY_API_KEY=***REDACTED***`) | Web search / extract / crawl / map / research | Enabled |
| `microsoft-learn` | global | streamable-http | `https://learn.microsoft.com/api/mcp` (no auth) | Microsoft / Azure docs search and fetch | Enabled |
| `memory` | global | stdio | `npx -y @modelcontextprotocol/server-memory` | Persistent knowledge graph (entities/relations/observations) | **Disabled** in config |
| `filesystem` | global | stdio | `npx -y @modelcontextprotocol/server-filesystem ${WORKSPACE_ROOT}` | Local FS access mirror | **Disabled** |
| `brave-search` | global | stdio | `npx -y @modelcontextprotocol/server-brave-search` (env: `BRAVE_API_KEY=***REDACTED***`) | Web search via Brave | **Disabled** (no API key set) |
| `ado` | per-project (Roo-Code, pgsql-orion) | stdio | `npx -y @azure-devops/mcp msdata` | Azure DevOps repos / pipelines / work items / boards | Enabled |
| `git` | per-project (Roo-Code) | stdio | `docker run --rm -i --mount type=bind,src=c:/git/Roo-Code,dst=/workspace mcp/git --repository /workspace` | Read-write Git over Docker (status, log, diff, commit, branch, …) | Enabled |

Dual-presence note: the project-level `.roo/mcp.json` for `Roo-Code` and the vault-level `projects/Roo-Code/.roo/mcp.json` are byte-identical because the project copy is a symlink to the vault copy.

## Cross-links

- [`00-plan.md`](00-plan.md) · [`10-roo-inventory.md`](10-roo-inventory.md) · [`80-migration-playbook.md`](80-migration-playbook.md)
- Vault home: [`../../../../roo-vault/README.md`](../../../../roo-vault/README.md)
