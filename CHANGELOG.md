# Changelog

All notable changes to Kallamo are documented in this file. This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-07

The first stable release of the Writing Desk and Worldbuild, giving Kallamo a place to write long-form work and a structured, living "bible" the AI keeps track of as your world grows.

### Added
- **Writing Desk**: a dedicated document-writing workspace with a full-featured writing surface, headings, fonts and font sizes, colors, page setup, and find & replace. You can import and export your work with faithful formatting, including whole-book folder export. An AI-assisted editing layer lets you select text and invoke a profile on it: the suggestion arrives as a non-destructive, inline block-level diff you can review and accept or discard, and it runs without blocking the editor. Chapters can be indexed on demand, so the AI can draw on context from across the whole book.
- **Writing Desk notes**: a persistent, per-chapter review panel in the right rail. You can turn an AI analysis into a durable note that keeps the excerpt, the profile, and the instruction, and jump back to the passage later.
- **Worldbuild**: a per-workspace registry of the entities in your world (characters, places, creatures, events, and more) and the relations between them, giving your story a structured bible the AI can consult. Entities carry rich fields: status tags, ownership modes, rarity, multiple locations, and one-way labeled relationships.
- **Worldbuild auto-fill and enrichment**: as your knowledge is tagged, Worldbuild can propose new entities it finds in the text, so your world bible fills itself in as you write. An "Update entities" action reviews existing entities and stages suggested changes for you, field by field (data, lore, relations, and chapter links), so you accept only what you want. A per-workspace policy lets you decide how active this assistance is.
- **Worldbuild in-text bridge**: select a name in the Writing Desk and, from the selection menu, link it to a Worldbuild entity or create one on the spot without leaving the page. Linked words are marked in the text and open the entity directly. Linking a name also teaches retrieval to recognize it, improving automatic tagging.
- **Portable Worldbuild packages (.klwb)**: export and import a whole Worldbuild, with imported entities arriving as reviewable proposals and a merge step that respects your existing data.
- **Living-world index**: knowledge is automatically tagged with the entities and world variables it mentions, and retrieval can follow those tags, looking an entity up, hopping to related entities, and pulling in linked lore, so the AI keeps track of who and what your knowledge is actually about. An **Index** button builds or refreshes this on demand, and a status pill on each chapter shows whether the AI's memory is current (never indexed, indexing, indexed, out of date, or error).
- **Guided first run**: new installs start with three ready-to-use, fully editable AI Profiles so you have something working out of the box, clear empty states point you to where an API key is needed, and one-time coach-marks point out entity linking and memory tagging the first time you reach them.
- **Memory switches**: every item in the Knowledge Base Manager and Workspace Memory now has an on/off toggle. Turning one off keeps the content but excludes it from the AI. It is no longer injected or retrieved, and it drops out of the **Always-on** and **Searchable** token totals, so you can park a document or custom memory without deleting it. Works for searchable files, constant files, and custom memories, in both AI Profiles and chat workspaces.
- **Retrieval Strictness** (Settings → Advanced): a single control over how strictly retrieved knowledge must match your query, with guidance text that adapts to the selected level and recommended ranges highlighted. It replaces the previous "Similarity Threshold," which only affected part of the results.
- **Durable chunk edits**: when you edit an individual searchable chunk of a file (in the Knowledge Base Manager or Workspace Memory), the edit is now marked with an **"edited"** badge and is preserved when knowledge is re-indexed, for example after an embedding-model upgrade, instead of being silently overwritten by a fresh split of the original file. Edited chunks also travel with the knowledge base when you export and import it, so a shared KB keeps your corrections and the receiver can see which chunks were hand-edited.
- **Unified memory tags**: a single tag input across memory and file chunks, with editable tags on file chunks and inline entity linking.

### Changed
- Knowledge base and memory retrieval is noticeably more accurate. Results are now ranked by how semantically close they actually are to your query instead of by rank position alone, so strong matches clearly rise to the top and weak or unrelated content scores low. To take full effect on existing knowledge, re-upload the affected documents so they are re-indexed.
- Agentic retrieval is more robust and can research across turns: it tolerates imperfect model output, can be tuned per profile, reads the Worldbuild registry directly by looking entities up by their canonical names and following relations, and now understands the entities and world variables behind your knowledge, so it finds the right context more reliably.
- Sending in a chat, entity tagging, and Worldbuild enrichment now clearly require a configured System AI, with in-context prompts pointing you to set one up instead of failing silently.
- Dropdowns and menus throughout the app (font pickers, profile menus, and more) no longer get clipped or hidden behind neighboring panels, and switching between adjacent menus now takes a single click.
- Helper and description text throughout the app is now more legible and visually consistent. It is also sized relative to your **Interface → Font Size** setting, so it scales together with the rest of the interface instead of staying fixed at a tiny size.
- In the AI Profile creation flow, the knowledge step is now labeled simply **"Knowledge Base"** (the separate post-creation tool remains the "Knowledge Base Manager").

### Fixed
- Retrieval dossiers now include an entity's structured fields, not just its lore, so facts you recorded in Worldbuild actually reach the AI.
- Writing Desk chapter indexing is now correctly scoped per document, so one chapter's memory no longer bleeds into another.
- Empty or low-information sections (e.g. blank form/skeleton blocks) no longer pollute retrieval results and crowd out relevant content.
- The relevance cutoff now applies to all retrieved results, including keyword (BM25) matches, instead of only the semantic ones, so poorly matching keyword-only chunks no longer slip into the context.

## [1.0.6] - 2026-06-23

### Added
- Token visibility across the Knowledge Base Manager and Workspace Memory: every document, custom memory, and memory block now shows an approximate token count. Each view also summarizes your **Always-on** context (injected into every prompt) versus your **Searchable** knowledge (retrieved on demand), with a color warning as the always-on total approaches or exceeds the model's context window — so you can see at a glance how much of the context window your setup uses.

### Changed
- Kallamo's download and install size is roughly a third smaller. The local embedding engine is now downloaded automatically in the background on first launch instead of being bundled with the app, shown with a discreet progress indicator — the way you use Kallamo doesn't change. If the download can't complete (for example, no internet on first launch), Kallamo shows a clear notification with an "Open Settings" button to check and install it manually, and reports connection problems in plain language.
- The first launch is now seamless, without a separate setup step.
- Renamed "Custom Snippets" to "Custom Memory" for clarity.
- Update checks on macOS and Linux (.deb) now read the GitHub Releases API directly instead of a separately maintained file, so new-version notifications can no longer fall out of sync and automatically ignore drafts and pre-releases.

### Fixed
- Profiles whose always-on (constant / full-context) knowledge alone exceeds the context window now show a clear, actionable message before sending, instead of dispatching a request that's guaranteed to fail. This prevents wasted tokens and the heavy slowdown or freeze that very large profiles could cause.
- Adding a profile to a chat (or otherwise saving it) no longer needlessly re-indexes every knowledge file in that chat.
- Adding a custom memory no longer switches the active filter tab away from your current view.
- Reasoning / "thinking" output from local models that return it in a separate field (e.g. reasoning models via LM Studio) is now correctly shown in its own collapsible block. This completes the partial fix from 1.0.4.
- Fixed the current message being duplicated in the request sent to the model.
- The RAG diagnostics toggles (Agentic and Token breakdown) no longer switch themselves off when you adjust a Knowledge Base or chunk slider; your debug preferences now persist correctly.
- Bulk delete in Workspace Memory now works on knowledge files: files show a selection checkbox like other blocks, and selecting them (including via Select All) removes the file and all of its searchable chunks instead of silently skipping them.
- Fixed data loss in Workspace Memory: renaming a custom memory's title or changing its profile scope could wipe every other custom memory added in the same session. These edits now update only the targeted block instead of overwriting the whole memory store from a stale copy. Renaming or rescoping also no longer clears a memory's tags or resets its retrieval strategy.
- Slow local generations no longer fail with a "fetch failed" error. Long responses from local models (e.g. large models running at a few tokens per second) that took more than five minutes were being cut off; they now have up to 30 minutes to complete. Cancelling a generation also reliably stops the local model mid-response, including during Agentic RAG research steps.

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
