# Changelog

All notable changes to Kallamo are documented in this file. This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - Unreleased

### Added
- **Retrieval Strictness** (Settings → Advanced): a single control over how strictly retrieved knowledge must match your query, with guidance text that adapts to the selected level and recommended ranges highlighted. It replaces the previous "Similarity Threshold," which only affected part of the results.

### Changed
- Knowledge base and memory retrieval is noticeably more accurate. Results are now ranked by how semantically close they actually are to your query instead of by rank position alone, so strong matches clearly rise to the top and weak or unrelated content scores low. To take full effect on existing knowledge, re-upload the affected documents so they are re-indexed.
- Helper and description text throughout the app is now more legible and visually consistent. It is also sized relative to your **Interface → Font Size** setting, so it scales together with the rest of the interface instead of staying fixed at a tiny size.
- In the AI Profile creation flow, the knowledge step is now labeled simply **"Knowledge Base"** (the separate post-creation tool remains the "Knowledge Base Manager").

### Fixed
- Empty or low-information sections (e.g. blank form/skeleton blocks) no longer pollute retrieval results and crowd out relevant content.
- The relevance cutoff now applies to all retrieved results, including keyword (BM25) matches, instead of only the semantic ones — so poorly matching keyword-only chunks no longer slip into the context.

## [1.0.6] - 2026-06-22

### Added
- Token visibility across the Knowledge Base Manager and Workspace Memory: every document, custom memory, and memory block now shows an approximate token count. Each view also summarizes your **Always-on** context (injected into every prompt) versus your **Searchable** knowledge (retrieved on demand), with a color warning as the always-on total approaches or exceeds the model's context window — so you can see at a glance how much of the context window your setup uses.

### Changed
- Kallamo's download and install size is roughly a third smaller. The local embedding engine is now downloaded automatically in the background on first launch instead of being bundled with the app, shown with a discreet progress indicator — the way you use Kallamo doesn't change.
- The first launch is now seamless, without a separate setup step.
- Renamed "Custom Snippets" to "Custom Memory" for clarity.

### Fixed
- Profiles whose always-on (constant / full-context) knowledge alone exceeds the context window now show a clear, actionable message before sending, instead of dispatching a request that's guaranteed to fail. This prevents wasted tokens and the heavy slowdown or freeze that very large profiles could cause.
- Adding a profile to a chat (or otherwise saving it) no longer needlessly re-indexes every knowledge file in that chat.
- Adding a custom memory no longer switches the active filter tab away from your current view.
- Reasoning / "thinking" output from local models that return it in a separate field (e.g. reasoning models via LM Studio) is now correctly shown in its own collapsible block. This completes the partial fix from 1.0.4.
- Fixed the current message being duplicated in the request sent to the model.
- The RAG diagnostics toggles (Agentic and Token breakdown) no longer switch themselves off when you adjust a Knowledge Base or chunk slider; your debug preferences now persist correctly.
- Bulk delete in Workspace Memory now works on knowledge files: files show a selection checkbox like other blocks, and selecting them (including via Select All) removes the file and all of its searchable chunks instead of silently skipping them.

## [1.0.4] - 2026-06-17

### Added
- Workspace restore: import a previously exported backup (.db) to fully replace your current data. Kallamo validates the file, saves a safety snapshot of your existing workspace first, and restarts to apply the restore safely.
- Update notifications for macOS and Linux (.deb): these platforms don't support in-app auto-updates, so Kallamo now checks for new releases and lets you know when one is available, with a direct download link.

### Changed
- Upgraded the default local embedding model to a multilingual one (multilingual-e5-small), substantially improving knowledge base and memory retrieval — especially for non-English languages. After updating, Kallamo automatically re-indexes your existing knowledge bases once, shown with a progress screen.
- Knowledge retrieval now keeps a small overlap between chunks, so facts that fall on a chunk boundary are easier to find.
- Workspace backups are now created as consistent snapshots, so an exported backup always reflects your latest data.
- Trimmed the package by removing unused runtime and locale files.

### Fixed
- Deleting an AI profile now also removes its knowledge base content and search-index entries instead of leaving orphaned data behind. A one-time cleanup removes any orphans left by previously deleted profiles and rebuilds the search index (fixing duplicate entries).
- Reasoning / "thinking" output from local models (e.g. Gemma, DeepSeek, QwQ via LM Studio) is now detected and shown in its own collapsible block instead of bleeding into the response — supporting both the `<think>` tag and the separate reasoning field.
- The automatic knowledge re-indexing is now resilient: it never marks itself complete unless every item succeeds, preventing silent retrieval problems.

## [1.0.3] - 2026-06-15

### Fixed
- Fixed an issue in the Knowledge Base Manager where newly added searchable (RAG) files would not appear in the blocks list or counts and were not searchable.
- Disabled Electron's built-in spellchecker to prevent red correction lines on non-English texts.

## [1.0.2] - 2026-06-14

### Security
- Rendered chat markdown now sanitizes image and link URLs and escapes AI-generated or imported content, preventing script injection (XSS) — including from shared `.klp` profiles.
- Packaged builds now enforce a strict Content-Security-Policy.
- The internal file protocol is restricted to an allowlist of viewable file types, so it can no longer be used to read arbitrary files from disk.

### Changed
- Fonts and code-highlighting themes are now bundled with the app instead of loaded from a CDN. Kallamo no longer makes third-party network requests for assets, loads them offline, and starts faster.

### Fixed
- AWS Bedrock requests now include the required SigV4 content-hash header.
- OpenRouter requests now report the correct app attribution.
- Dynamic variables containing special characters (e.g. `{{price(1)}}`) are now substituted correctly.
- Context budgeting and auto-archiving now use a real BPE token counter for more accurate token estimates across providers.

## [1.0.1] - 2026-06-13

### Fixed
- Resolved an `ENOTDIR` error in the embedding model cache.
- The About modal now reads the app version dynamically.
- Added a custom-memory notice in onboarding step 2.

## [1.0.0] - 2026-06-12

- Initial public release.
