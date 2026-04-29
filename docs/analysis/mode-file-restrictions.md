# How Roo limits the files a mode can read or edit

Roo enforces per-mode file access through a layered system: **tool groups** decide *which tools* a mode can call, and an optional **`fileRegex`** on the `edit` group narrows *which files those edit tools may touch*. There is **no built-in regex restriction for read tools** — read access is gated only by group membership and by the workspace-wide `.rooignore` mechanism.

## 1. Where restrictions are declared

Each mode's capabilities live in its `groups` array. A group entry is either:

- A bare group name: `"read"`, `"edit"`, `"command"`, `"mcp"`, `"browser"`
- Or a tuple `[groupName, options]` where `options` may include a `fileRegex` and `description`

Schema in [packages/types/src/mode.ts](packages/types/src/mode.ts#L9-L39):

```ts
export const groupOptionsSchema = z.object({
  fileRegex: z.string().optional().refine(/* validates it's a valid RegExp */),
  description: z.string().optional(),
})

export const groupEntrySchema = z.union([
  toolGroupsSchema,
  z.tuple([toolGroupsSchema, groupOptionsSchema]),
])
```

The built-in **Architect** mode is the canonical example — it can read anything but only edit Markdown:

```ts
groups: ["read", ["edit", { fileRegex: "\\.md$", description: "Markdown files only" }], "mcp"]
```

(See [packages/types/src/mode.ts](packages/types/src/mode.ts#L178).)

Custom modes declared in `.roomodes` use the same shape and are validated by the same Zod schema.

## 2. The two enforcement points

### a) Tool availability — `isToolAllowedForMode`

Lives in [src/core/tools/validateToolUse.ts](src/core/tools/validateToolUse.ts#L120). Called from `validateToolUse` before any tool dispatch and also when assembling the system prompt (so the LLM only sees tools it's allowed to use).

Logic, in order:

1. **Resolve aliases** (`search_and_replace`, `apply_diff`, `write_to_file`, `apply_patch`, etc. all map to the canonical `edit` tool).
2. **Tool-level disable** via `toolRequirements` short-circuits everything (used by `disabledTools`).
3. **Always-available tools** (`ask_followup_question`, `attempt_completion`, `new_task`, `switch_mode`, `update_todo_list`, etc.) bypass group checks. These cannot be restricted by mode configuration.
4. **Custom tools** registered through the experimental registry are allowed in any mode.
5. **Dynamic MCP tools** (`mcp_<server>_<tool>`) are allowed iff the mode has the `mcp` group.
6. **Walk the mode's `groups`**: for each entry, look up its tool list in `TOOL_GROUPS`. If the requested tool isn't in any allowed group, deny.
7. If the matching group has **no options**, allow.
8. If the matching group is `edit` *and* has a `fileRegex`, run the file-path check (next section).

### b) File-path matching — only on `edit`

When the matched group is `edit` with a `fileRegex`, the validator extracts the target path from the tool params:

```ts
const filePath = toolParams?.path || toolParams?.file_path
const isEditOperation = EDIT_OPERATION_PARAMS.some((param) => toolParams?.[param])
```

`EDIT_OPERATION_PARAMS` is the set of params that signal an actual write (not a streaming preamble): `diff`, `content`, `operations`, `search`, `replace`, `args`, `line`, `patch`, `old_string`, `new_string`. This avoids false positives while the LLM is still streaming a `<path>` tag with no body yet.

If the file fails the regex, the validator throws a `FileRestrictionError` (defined in [src/shared/modes.ts](src/shared/modes.ts#L135-L142)):

```
Tool 'write_to_file' in mode 'Architect' can only edit files matching pattern: \.md$ (Markdown files only). Got: src/foo.ts
```

The error is surfaced back to the LLM as a tool failure, so it can correct course (typically by switching modes via `switch_mode` or delegating via `new_task`).

#### Special case: `apply_patch`

Patch content can touch multiple files in one call. The validator parses the patch headers (`*** Add File:`, `*** Delete File:`, `*** Update File:`) via `extractFilePathsFromPatch` and validates **every** path against the regex. One bad file fails the whole patch.

## 3. What this *doesn't* do

- **No regex for `read`.** A `read` group entry currently ignores `fileRegex` — there's no per-mode read restriction in the validator. Read access is controlled purely by whether the mode has the `read` group at all.
- **No directory ACLs.** It's a single regex; if you need "src/ but not src/secrets/", encode it as a negative lookahead in the regex itself.
- **Doesn't override `.rooignore`.** Even if a mode's `fileRegex` allows a path, `.rooignore` (enforced by `RooIgnoreController`) still blocks it for both reads and writes. The two systems compose.
- **Doesn't override file protection.** Sensitive files (`.rooignore`, `.roo/*`, etc.) are also gated by the protected-files system, which can require explicit user approval regardless of mode.
- **Always-available tools cannot be restricted.** `attempt_completion`, `ask_followup_question`, `new_task`, `switch_mode`, `update_todo_list`, etc. work in every mode by design.

## 4. End-to-end flow when the LLM tries to edit a file

```
LLM emits write_to_file { path: "src/foo.ts", content: "..." }
        │
        ▼
presentAssistantMessage (assistant-message/)
        │
        ▼
validateToolUse (core/tools/validateToolUse.ts)
        │
        ├─ isValidToolName?              → no  → "Unknown tool" error
        ├─ isToolAllowedForMode?
        │     ├─ tool requirements / disabled?           → deny
        │     ├─ ALWAYS_AVAILABLE_TOOLS?                 → allow
        │     ├─ walk mode.groups for the canonical tool
        │     │     match found → has fileRegex?
        │     │           yes → doesFileMatchRegex(path)?
        │     │                   no  → throw FileRestrictionError
        │     │                   yes → allow
        │     │           no  → allow
        │     └─ no group matched                         → deny
        ▼
EditFileTool / ApplyDiffTool / WriteToFileTool
        ▼
RooIgnoreController.validateAccess(path)   ← second gate (.rooignore)
        ▼
Protected-files check (e.g., .roo/*)        ← third gate (may require approval)
        ▼
DiffViewProvider / FS write
```

## 5. Practical patterns

| Goal | Configuration |
| --- | --- |
| Mode that can only edit Markdown (docs writer) | `groups: ["read", ["edit", { fileRegex: "\\.md$", description: "Markdown files only" }]]` |
| Mode that can only touch tests | `groups: ["read", ["edit", { fileRegex: "(^|/)__tests__/|\\.spec\\.[tj]sx?$|\\.test\\.[tj]sx?$" }]]` |
| Mode confined to a folder | `groups: ["read", ["edit", { fileRegex: "^src/agent/" }]]` |
| Read-only review mode | `groups: ["read", "mcp"]` (omit `edit` entirely) |
| Pure planner (cannot read or edit) | `groups: []` — same approach Orchestrator uses |
| Allow edits everywhere except secrets | `groups: ["read", ["edit", { fileRegex: "^(?!.*secrets/).*$" }]]` |

## 6. UI surface

The Modes view ([webview-ui/src/components/modes/ModesView.tsx](webview-ui/src/components/modes/ModesView.tsx#L1174-L1220)) reads the same tuple structure to render badges like "Markdown files only" next to the `edit` group, and the mode editor lets users supply the regex + description directly. The Zod schema in `packages/types` validates input on save, so an invalid regex is rejected at the form layer.

## 7. Key files

- [packages/types/src/mode.ts](packages/types/src/mode.ts) — `groupOptionsSchema`, `groupEntrySchema`, built-in modes, `fileRegex` field.
- [src/core/tools/validateToolUse.ts](src/core/tools/validateToolUse.ts) — `isToolAllowedForMode`, `doesFileMatchRegex`, `extractFilePathsFromPatch`, alias resolution.
- [src/shared/modes.ts](src/shared/modes.ts#L135) — `FileRestrictionError`.
- [src/shared/tools.ts](src/shared/tools.ts) — `TOOL_GROUPS` (which tools belong to `read` / `edit` / `command` / `mcp` / `browser`), `ALWAYS_AVAILABLE_TOOLS`, `TOOL_ALIASES`.
- [src/shared/__tests__/modes.spec.ts](src/shared/__tests__/modes.spec.ts) — behavioral tests for `fileRegex` enforcement (good reference for edge cases).
- `RooIgnoreController` (under `src/core/ignore/`) — orthogonal `.rooignore` enforcement layered on top.
