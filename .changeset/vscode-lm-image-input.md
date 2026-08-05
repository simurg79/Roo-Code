---
"roo-cline": minor
---

Add image input support to the VS Code Language Model (vscode-lm) provider. Base64 image blocks are now sent as native `LanguageModelDataPart` image parts instead of text placeholders, and image capability is reported from the curated model family table. This raises the minimum supported VS Code version to 1.106.0, the first release where `LanguageModelDataPart` is available in the stable API.
