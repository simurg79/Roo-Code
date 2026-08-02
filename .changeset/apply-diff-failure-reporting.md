---
"roo-cline": patch
---

Fix `apply_diff` error reporting so failed diffs are fixable in a single retry. When several diff blocks fail, all of them are now reported together (with per-block labels, the first few in full detail and the rest summarized) instead of only the last one. A mistyped start-line marker such as `:3` in place of `:start_line:3` is now called out as the likely cause, replacing the misleading "the file content may have changed" advice. When only some blocks apply, the response now says how many applied and asks for only the failed blocks to be resent, and includes the actual errors instead of an instruction that could not work.
