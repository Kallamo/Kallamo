# System Architecture

> Technical reference for the internal design of Kallamo — the AI orchestration platform.

---

## Table of Contents

- [Process Model](#process-model)
- [Database Schema](#database-schema)
- [Hybrid RAG Engine](#hybrid-rag-engine)
- [Agentic RAG Loop](#agentic-rag-loop)
- [Context Archiving & Auto-Summarization](#context-archiving--auto-summarization)
- [API Engine & Provider Matrix](#api-engine--provider-matrix)
- [Security Model](#security-model)

---

## Process Model

Kallamo runs on Electron's two-process architecture with strict context isolation enabled.

### Main Process (`src/main.js`)

The Node.js backend handles all privileged operations:

| Module | File | Responsibility |
|--------|------|----------------|
| **Entry Point** | `main.js` | Window creation, custom `app-file://` protocol registration, dev/prod URL routing |
| **Database** | `main/database.js` | Schema definition, WAL mode, migrations, `safeStorage` encryption helpers |
| **IPC Handlers** | `main/ipc-handlers.js` | 50+ `ipcMain.handle()` endpoints for CRUD, file indexing, import/export |
| **Workflow Runner** | `main/workflow-runner.js` | Linear chain orchestration, error recovery modals, context overflow detection |
| **RAG Service** | `main/rag-service.js` | Text chunking, embedding generation, hybrid search, memory persistence |
| **API Engine** | `main/features/llm/llm.service.js` | Multi-provider HTTP client, streaming, payload limits, dynamic variable resolution |
| **Feature Modules** | `main/features/` | Retrieval ranking and planner (`knowledge/`), Tagger and name tags (`world-index/`), Worldbuild fields and updates (`worldbuild/`), live history (`chat/`) |
| **Writing Desk** | `main/writing-desk-invocation.js` | Select and invoke requests for the Writing Desk |

### Renderer Process (`src/renderer/`)

A React 19 application built with Vite 8 and Tailwind CSS v4:

| Module | File | Responsibility |
|--------|------|----------------|
| **App Shell** | `App.jsx` | Global layout, tooltip engine, toast system, modal orchestration |
| **State** | `context/AppContext.jsx` | Centralized React Context with all application state |
| **Views** | `components/DashboardView.jsx`, `LibraryView.jsx`, `ChatWorkspaceView.jsx`, `WorldbuildView.jsx`, `WritingDeskView.jsx` | Main navigation panels |
| **Modals** | `components/modals/` | Settings, workflow errors, context overflow prompts |

### IPC Bridge (`src/preload.js`)

The preload script uses Electron's `contextBridge` to expose a controlled `window.electronAPI` object. The renderer never has direct access to Node.js APIs or the filesystem.

```
Renderer (React)
    ↓ window.electronAPI.someMethod(args)
Preload (contextBridge)
    ↓ ipcRenderer.invoke('some-method', args)
Main Process (ipcMain.handle)
    ↓ database / RAG / API operations
    ↑ return result
```

---

## Database Schema

Kallamo uses `better-sqlite3` in WAL (Write-Ahead Logging) mode for concurrent read performance. The database file is stored at:

```
%APPDATA%/Kallamo/kallamo.db        (Windows)
~/Library/Application Support/Kallamo/kallamo.db  (macOS)
~/.local/share/Kallamo/kallamo.db   (Linux)
```

### Core Tables

#### `api_profiles`

Stores API provider credentials. Keys are encrypted via Electron `safeStorage`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `name` | TEXT | Display name |
| `provider` | TEXT | `openai`, `anthropic`, `google ai`, `vertex ai`, `aws bedrock`, `openrouter`, `local` |
| `baseUrl` | TEXT | Custom endpoint override |
| `apiKey` | TEXT | Encrypted API key (prefixed `safe:` + base64) |
| `customConfig` | TEXT | Encrypted JSON for provider-specific config (GCP project, AWS region, etc.) |
| `models` | TEXT | JSON array of available model names |
| `contextWindow` | INTEGER | Optional context window of the model behind the connection; `NULL` means no connection limit |

#### `writing_profiles`

AI persona definitions with associated knowledge bases.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `name` | TEXT | Profile display name |
| `description` | TEXT | Optional description |
| `color` | TEXT | HEX color for UI identification |
| `apiProfileId` | TEXT | FK → `api_profiles.id` |
| `model` | TEXT | Model identifier string |
| `temperature` | REAL | Sampling temperature (0.0–2.0) |
| `maxTokens` | INTEGER | Max output tokens |
| `systemPrompt` | TEXT | System instruction for the AI |
| `knowledgeFiles` | TEXT | JSON array of file metadata objects |
| `manualMode` | INTEGER | Boolean flag: inject raw JSON into API payload |
| `manualJson` | TEXT | Raw JSON override string |
| `isAgentic` | INTEGER | Boolean flag: enable Agentic RAG loop |
| `agenticPrompt` | TEXT | Custom instructions for the agentic researcher |

#### `chats`

Chat workspace configuration and state.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `title` | TEXT | Workspace title |
| `description` | TEXT | Optional description |
| `maxContext` | INTEGER | Maximum context window in tokens (default: 128,000) |
| `archiveThreshold` | INTEGER | Token count that triggers auto-summarization (default: 60,000) |
| `summarizedIndex` | INTEGER | Derived legacy marker: how many messages from the start are out of live history. Kept in sync for older readers and exported packages; coverage is the source of truth |
| `activeProfiles` | TEXT | JSON array of active profile IDs |
| `activeWorkflows` | TEXT | JSON array of active workflow IDs |
| `knowledgeFiles` | TEXT | JSON array of chat-scoped knowledge file metadata |
| `memoryBlocks` | TEXT | JSON array of archived memory block objects |
| `autoSummarize` | INTEGER | Boolean flag: enable automatic context archiving |
| `backgroundImage` | TEXT | Path to custom background image |
| `backdropOpacity` | INTEGER | Background overlay opacity (0–100) |

#### `messages`

Individual chat messages with AI attribution.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `chatId` | TEXT FK | Reference to `chats.id` (CASCADE delete) |
| `role` | TEXT | `user` or `ai` |
| `content` | TEXT | Message body (Markdown supported) |
| `aiName` | TEXT | Name of the AI profile that generated this message |
| `aiColor` | TEXT | HEX color of the generating profile |
| `debugNotice` | TEXT | JSON blob with token usage and context diagnostics; retrieved text is kept only while the RAG or Agentic debug option is on |
| `attachedFiles` | TEXT | JSON array of file attachment metadata |
| `alternatives` | TEXT | JSON array of alternative AI responses (regenerations) |
| `excluded` | INTEGER | Boolean flag: message is dropped from every payload while staying in the log |

#### `workflows`

Multi-step prompt chain definitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `name` | TEXT | Workflow display name |
| `entryProfileId` | TEXT | Default entry point profile |
| `steps` | TEXT | JSON array of step objects |

Each step object:
```json
{
  "profileId": "profile_abc123",
  "prompt": "Additional instruction for this step",
  "includeContext": true
}
```

#### `knowledge_chunks`

Vectorized text chunks for both profile and chat knowledge bases.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique chunk identifier |
| `ownerId` | TEXT | Profile ID or Chat ID |
| `ownerType` | TEXT | `profile_kb`, `chat_kb`, `chat_memory`, or `document` (Writing Desk chapters) |
| `source` | TEXT | Original filename or memory block title |
| `text` | TEXT | Enriched text (`Document: <name>\nContent: <text>`) |
| `vector` | TEXT | JSON-serialized float array (384 dimensions for multilingual-e5-small) |
| `createdAt` | INTEGER | Unix timestamp in milliseconds |

**Index:** `idx_knowledge_chunks_owner` on `(ownerId, ownerType)`.

#### `knowledge_chunks_fts` (Virtual Table)

FTS5 full-text search index on chunk text for sparse keyword retrieval.

| Column | Type | Description |
|--------|------|-------------|
| `chunkId` | TEXT | FK → `knowledge_chunks.id` |
| `text` | TEXT | Searchable text content |

#### `variables`

User-defined dynamic variables resolved at runtime in prompts via `{{key}}` syntax.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `name` | TEXT | Display name |
| `key` | TEXT UNIQUE | Template key (used as `{{key}}` in prompts) |
| `value` | TEXT | Resolved value |
| `description` | TEXT | Optional description |

#### `token_calibration`

How much more each model counts than the local token estimate, learned from provider-reported usage (see [Token Estimation](#token-estimation)).

| Column | Type | Description |
|--------|------|-------------|
| `apiProfileId` | TEXT PK | API connection |
| `model` | TEXT PK | Model identifier |
| `protocol` | TEXT PK | `text` or `native` (native tool definitions add their own framing) |
| `ratio` | REAL | Reported input tokens divided by the local estimate, at least 1 |
| `updatedAt` | INTEGER | Unix timestamp in milliseconds |

### Sync Infrastructure

All mutable tables (`chats`, `messages`, `writing_profiles`, `variables`) include:
- `last_modified` (INTEGER) — auto-updated via SQLite triggers on INSERT/UPDATE.
- `syncToCloud` (INTEGER) — flag for cloud sync eligibility.

A `deleted_records` table tracks soft-deleted record IDs for sync conflict resolution.

### Migrations

The database self-migrates on startup:
1. **Schema migrations** — `ALTER TABLE ADD COLUMN` for new fields, guarded by `PRAGMA table_info()` checks.
2. **Data migrations** — JSON-file-to-SQLite migration from the legacy filesystem-based storage.
3. **Vector migrations** — Scans `vector_db.json` files from legacy profile/chat directories and inserts them into `knowledge_chunks`.
4. **Encryption migrations** — Encrypts any plaintext API keys found in `api_profiles` using `safeStorage`.
5. **Branding migrations** — Auto-renames old data directories (`AI Writer Companion` → `Kalamo` → `Kallamo`).
6. **One-time data passes**: trim oversized debug records and tag existing passages by entity name. Each records a key in `settings`, so it runs once.

---

## Hybrid RAG Engine

The RAG pipeline uses a **magnitude-aware weighted fusion** to merge two independent retrieval signals — dense semantic similarity and sparse BM25 keyword relevance — ranking by how close each chunk actually is to the query rather than by its rank position alone.

### Ingestion Pipeline

```
Source File (.pdf, .docx, .txt)
    ↓ extractTextFromFile()
Raw Text
    ↓ chunkText(text, maxChunkSize=500)
Text Chunks (paragraph-aware; long paragraphs split at sentence ends; 15% overlap; low-information chunks dropped)
    ↓ vectorizeChunks()
    ↓ Enrich: "Document: <filename>\nTags: <keywords>\nContent: <chunk>"
    ↓ generateEmbeddingVector() → Xenova/multilingual-e5-small (384-dim, quantized, query:/passage: prefixed)
Vectors + Text
    ↓ insertChunksToDb()
    ↓ INSERT INTO knowledge_chunks (vector as JSON text)
    ↓ INSERT INTO knowledge_chunks_fts (full-text index)
    ↓ Tag registered entity names written in each chunk (chunk_tags, origin 'name')
SQLite
```

### Retrieval Pipeline

At query time, `executeHybridSearch()` runs both retrieval strategies in parallel against the same chunk corpus:

#### 1. Dense Search (Semantic)

```
Query text → generateEmbeddingVector(query) → 384-dim vector
    ↓
For each chunk in knowledge_chunks WHERE ownerId = ? AND ownerType = ?:
    cosine = cosine_similarity(query_vector, chunk_vector)
```

The dense set defines membership: the owner-scoped chunks are the only candidates, so a sparse-only hit belonging to another owner never enters the results. The cosine similarity is computed as a raw dot product since `multilingual-e5-small` produces L2-normalized vectors:

```
similarity(A, B) = Σ(Aᵢ × Bᵢ)
```

**Strictness floor.** Normalized e5 cosines live in a narrow high band — even unrelated text rarely scores below ~0.70 — so a raw 0–1 threshold is meaningless. The **Retrieval Strictness** dial (`0–1`, default `0.3`) is instead mapped onto that real band and used as a hard cutoff applied during fusion:

```
cosineFloor = 0.70 + strictness × (0.88 − 0.70)
keep chunk only if denseScore >= cosineFloor
```

The low end of the dial trims only obvious off-topic noise; the high end keeps near-exact matches.

#### 2. Sparse Search (Keyword)

```
Query text → buildFtsMatchQuery(query)
    ↓ every word of 3+ letters is quoted and joined with OR;
    ↓ words of 5 to 24 letters also match as a prefix (their last 2 letters removed)
SELECT chunkId, bm25(knowledge_chunks_fts) as rank
FROM knowledge_chunks_fts JOIN knowledge_chunks
WHERE MATCH ? AND ownerType = ? AND ownerId IN (searched owners)
LIMIT 500
    ↓
relevance = −bm25(rank)          (SQLite bm25() is negative; more negative = more relevant)
    ↓
min-max normalize relevance into [0,1] within the result set
```

Quoting every word keeps punctuation from breaking the FTS5 syntax, and the prefix match reaches other forms of a word without a stemmer or a word list, in any language. Restricting the query to the searched owners keeps other workspaces from shaping the normalization. If the query still fails, keyword search contributes nothing and dense search continues alone. Normalizing the BM25 relevance into `[0,1]` makes it directly comparable in magnitude to the dense cosine, which is what enables weighted fusion instead of rank-only fusion.

#### 3. Magnitude-Aware Weighted Fusion

The dense candidates and the normalized sparse map are merged in a single scoring pass (`fuseAndRank`). Dense is the trustworthy signal and carries most of the weight (`ALPHA_DENSE = 0.7`); sparse mainly breaks ties and rescues exact keyword matches:

```
For each dense candidate chunk:
    cosine     = dense cosine similarity              (drives membership)
    sparseNorm = normalized BM25 relevance, or 0 if absent
    evidence   = share of the query's entity name evidence it carries, 0..1   (see below)

    fusionScore = 0.7 × cosine + 0.3 × sparseNorm + 0.05 × evidence

Discard any chunk whose cosine is below its floor (cosineFloor, lowered by evidence).
Sort by descending fusionScore, truncate to k.
```

`k` is the user's Top-K (default 5 for knowledge bases, 8 for chat memory), raised by `retrievalTopK` up to 20 when the retrieval budget can hold more passages. It is never lowered.

The strictness floor is checked against the raw `cosine`, not the fused score, so a strong keyword or tag match can reorder results but can never rescue a semantically off-topic chunk.

**Entity evidence (living-world index).** Chunks carry tags for the Worldbuild entities and world variables they mention. The entity names written in the query are found with the Tagger's own matcher, so name boundaries hold in every script. Each chunk gets the share of that name evidence it carries, weighted by how rare each name is in the workspace: a name written across much of the archive counts for little, because it cannot tell passages apart. That share scales a small bonus (`TAG_BOOST = 0.05`), deliberately small relative to the cosine band, so it reorders within the surviving set without swamping semantic similarity.

The same share lowers the chunk's floor, down to `cosineFloor × 0.7` for full evidence. Carrying a rare entity the query names is explicit evidence rather than a guess, so a character named in a few lines of a long scene is not cut before the bonus can apply.

This single `fuseAndRank` path is shared by single-owner search, multi-owner cross-chapter search, and the in-memory volatile-chapter search in the Writing Desk.

### Knowledge File Strategies

Each file in a profile's knowledge base has a `strategy` field:

| Strategy | Behavior |
|----------|----------|
| `constant` / `full_context` | Entire file content injected into every prompt as system context |
| `rag_search` | File is chunked, vectorized, and retrieved only when semantically relevant |

Constant files and full reads during agentic retrieval rebuild the text from its stored chunks, in their original order and without the overlap between neighbors.

### Embedding Engine Options

| Mode | Provider | Model | Dimensions |
|------|----------|-------|------------|
| **Local** (default) | `@huggingface/transformers` | `Xenova/multilingual-e5-small` (quantized) | 384 |
| **External (OpenAI)** | OpenAI API | `text-embedding-3-small` (configurable) | 1536 |
| **External (Google AI)** | Google AI API | `text-embedding-004` (configurable) | 768 |

---

## Agentic RAG Loop

When a profile has `isAgentic = 1` and a Retrieval Planner is available, the workflow runner can hand retrieval to a planner model before the main generation call. The full design, with every budget and threshold, is in [Agentic Retrieval](agentic-retrieval.md). In short:

- **Gate.** A deterministic check on the user's own message skips the planner when the message names no known entity, asks no question and is short. A skipped message runs the ordinary hybrid search. The Plan every message setting turns the gate off.
- **Pre-search.** Before turn 1 the loop runs `search_kb` and `search_memories` on the user's request, so everything the ordinary search finds is already in the context.
- **Tools.** Defined once in `features/knowledge/planner-tools.js` and offered as native function calls where the provider supports them, or as a tag-based text protocol, with automatic fallback to text.

| Tool | Purpose |
|------|---------|
| `search_kb` | Hybrid search across profile and workspace knowledge bases |
| `search_memories` | Search archived memory, custom memory and manual tags |
| `read_file` | Read the full text of a knowledge file |
| `lookup_entity` | The passages tagged with a known Worldbuild entity that are most relevant to the request (at most 12), plus its related entities |
| `read_lore` | The most relevant passages of an entity's linked lore document |
| `expand` | Read the full text of a result shown as a snippet |
| `finish` | End the research, citing the result handles that were relevant |

- **Turns.** Up to the profile's turn budget (default 3, clamped 1 to 5), at temperature 0.1. A repeated query is refused, and a query that found nothing is remembered per workspace for 20 minutes.
- **Budget.** Search width follows the writer's retrieval budget, while everything the planner reads is sized by its own connection's context window. A single file or lore read takes at most 60% of the retrieval budget.
- **Citations.** Results cited in `finish` keep their priority; uncited results are ranked lower, never dropped. Everything gathered is packed by tier and score into the retrieval budget.

---

## Context Archiving & Auto-Summarization

Kallamo manages long conversations through an automatic archiving system that converts old messages into searchable vector memory.

### Live History

Which messages a workspace still sends is derived from the summary blocks themselves,
not from a position marker. Each block stores the message ids it covers, so live history
is every message no block claims and the user has not dropped:

```
covered = union of block.messages ids across chat.memoryBlocks
live    = messages where id not in covered and excluded !== 1
```

A single number could not describe a gap, so any operation that produced one (deleting a
summary, archiving a non-contiguous selection, deleting a message) used to leave the old
`summarizedIndex` disagreeing with the blocks. Deriving coverage makes those states valid
and self-repairing. `summarizedIndex` is still written, as a derived value, for older
readers and exported packages.

The logic is pure and lives in `features/chat/archive-coverage.js`, mirrored in the
renderer so the number the user sees is the number the payload uses.

### Token Estimation

Tokens are counted with the `gpt-tokenizer` BPE tokenizer (`encode(text).length`), with a `Math.ceil(text.length / 4)` heuristic as a fallback if encoding fails.

Models count the same text differently, and the local count can fall well short of a model's own. After each chat reply and research turn, the input tokens the provider reports are compared with the local estimate for that request, per connection, model and protocol (`features/llm/token-calibration.js`, stored in `token_calibration`). Payload limits are divided by the learned ratio. A higher ratio is adopted at once and a lower one is blended in; the ratio never drops below 1, and a model that has not reported usage is not corrected. Small requests, requests with images, Manual JSON or response schemas, and counts that fill a declared context window are never used as samples.

### Auto-Summarization Trigger

After each AI response, the workflow runner checks:

```
active_tokens = sum of estimateTokens(message.content)
                for selectActiveMessages(messages, memoryBlocks)

if (chat.autoSummarize === 1 AND active_tokens > chat.archiveThreshold):
    trigger summarization flow
```

Default threshold: **60,000 tokens**.

### Archiving Pipeline

```
Selected messages for archival
    ↓
1. Concatenate: "ROLE: content" for each message, reasoning removed
    ↓
2. Chunk the concatenated text (chunkSize = 800)
    ↓
3. Vectorize chunks → embedding vectors
    ↓
4. Persist:
   a. Insert vectors into knowledge_chunks (ownerType = 'chat_memory'), tagging entity names
   b. Append the memory block to chat.memoryBlocks JSON (recap and tagging pending)
   c. Re-derive chat.summarizedIndex from what the blocks now cover
    ↓
5. In the background:
   a. Recap (when archive summaries are on): a 3-word title and two sentences;
      a transcript too long for the Summarizer is recapped in segments, then merged
   b. Tagging: the Tagger handles only what entity names could not settle
```

Step 5 runs after the block is stored, so the archive window closes as soon as
the history is safe. `recapStatus` and `taggingStatus` track them independently: a
tagging failure never costs a recap that was written, and finishing a block again only
redoes the part that is missing.

### Memory Block Structure

```json
{
  "id": "block_1718000000000",
  "title": "Dragon Encounter Arc",
  "summary": "The protagonist first meets the dragon in chapter 3...",
  "type": "summarized",
  "messages": [ /* original archived messages */ ],
  "recapStatus": "ready",
  "taggingStatus": "ready"
}
```

`recapStatus` and `taggingStatus` are each `pending`, `ready`, `failed`, or `skipped`.
A block left `pending` by a closed app is marked on startup and can be finished later.

Memory blocks can also be `type: "manual"` — user-created snippets with custom tags that are vectorized and searchable alongside summarized history.

### Chat History Windowing

During generation, live history (see above: not covered by a summary, not dropped) shares the payload limit with retrieval:

```
available   = room under the limit after the fixed prompt and the response reserve
historyNeed = live messages, newest first, that fit in available
retrieval   = max(40% of available, available − historyNeed)
    ↓ retrieved items are packed by tier and score into retrieval
history     = live messages, newest first, that fit in what the compiled prompt leaves
```

History is measured first, so retrieval cannot push the conversation out, and retrieval always keeps at least 40% of the room. The window is contiguous: it stops at the first message that does not fit. Messages cut here are unarchived, so no memory chunk can retrieve them, and the chat header marks the overflow.

---

## API Engine & Provider Matrix

The API engine normalizes request/response formats across 7 providers.

### Supported Providers

| Provider | Auth Method | Chat Endpoint | Embedding Support |
|----------|------------|---------------|-------------------|
| **OpenAI** | Bearer token | `/v1/chat/completions` | ✅ `/v1/embeddings` |
| **Anthropic** | `x-api-key` header | `/v1/messages` | ❌ (not offered) |
| **Google AI** | API key in URL | `generateContent` | ✅ `embedContent` |
| **Vertex AI** | GCP OAuth2 (RS256 JWT) | `generateContent` | ❌ (use Google AI) |
| **AWS Bedrock** | SigV4 signed requests | `/model/{id}/invoke` | ❌ (use OpenAI) |
| **OpenRouter** | Bearer token | `/api/v1/chat/completions` | ✅ `/api/v1/embeddings` |
| **Local** (Ollama, LM Studio) | Bearer token | Custom `baseUrl` | ✅ Custom `baseUrl` |

### Role Normalization

All internal message roles are stored as `user` or `ai`. Before API calls, `ai` is mapped to the provider-expected role:

| Provider | Internal `ai` → | System Prompt Format |
|----------|-----------------|---------------------|
| OpenAI / OpenRouter / Local | `assistant` | `{ role: "system", content: "..." }` |
| Anthropic | `assistant` | Top-level `system` field |
| Google AI / Vertex AI | `model` | `system_instruction.parts` |
| AWS Bedrock (Claude) | `assistant` | Top-level `system` field |
| AWS Bedrock (Llama) | embedded in prompt | `<\|start_header_id\|>system` template |

### Dynamic Variables

Before a request is measured or sent, every `{{variable}}` template in its prompts is resolved against the `variables` table (`createPromptVariableResolver`). The key is escaped inside the pattern and the value is inserted through a replacer function, so a value containing `$` patterns is inserted literally:

```javascript
const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(variable.key)}\\s*\\}\\}`, 'g');
result = result.replace(regex, () => variable.value);
```

### Payload Limits

Every request is checked before it is sent, against a limit resolved per connection and model (`resolvePayloadLimit`):

```
configured = the smaller of the connection's Model Context Window and the workspace's MAX API Payload
limit      = configured / measured token ratio        (see Token Estimation)
```

The fixed part (instructions, constant knowledge, attachments and the response reserve) is checked first. History and retrieval are then sized to what it leaves, and the final request is checked against the same limit, keeping a safety margin that scales with it. A request that still does not fit is stopped before contacting the provider: the error says how much came from instructions, retrieved context and history, notes when the limit was reduced by a measured ratio, and does not offer Retry.

### Manual JSON Override

When a profile has `manualMode = 1`, the contents of `manualJson` are parsed and spread over the request body after all standard fields are set. This allows injecting provider-specific parameters (e.g., `top_p`, `frequency_penalty`, `stop` sequences) without modifying the engine code.

---

## Security Model

### API Key Encryption

All API keys and custom configurations are encrypted at rest using Electron's `safeStorage` API:

```
Encryption: plaintext → safeStorage.encryptString() → base64 → "safe:" prefix → stored in SQLite
Decryption: "safe:" prefix → base64 decode → safeStorage.decryptString() → plaintext
```

`safeStorage` uses the OS keychain (Windows DPAPI, macOS Keychain, Linux libsecret) to protect the encryption key.

### Process Isolation

- `nodeIntegration: false` — The renderer has no access to Node.js APIs.
- `contextIsolation: true` — The preload script runs in a separate JavaScript context.
- `contextBridge` — Only explicitly defined methods are exposed to `window.electronAPI`.

### Custom Protocol

A custom `app-file://` protocol is registered for serving local filesystem resources (images, backgrounds) to the renderer without exposing raw `file://` paths. The protocol handler validates file existence and serves appropriate MIME types.
