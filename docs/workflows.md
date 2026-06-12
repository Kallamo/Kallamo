# Workflows & Data Packaging

> Guide to multi-step AI workflows and the Kallamo profile/knowledge base packaging format.

---

## Table of Contents

- [Multi-Step Workflows](#multi-step-workflows)
- [Workflow Execution Flow](#workflow-execution-flow)
- [Error Recovery & Context Overflow](#error-recovery--context-overflow)
- [Profile Packaging (.klp)](#profile-packaging-klp)
- [Knowledge Base Packaging (.klkb)](#knowledge-base-packaging-klkb)
- [Workflow Packaging (.klw)](#workflow-packaging-klw)
- [Knowledge File Indexing](#knowledge-file-indexing)

---

## Multi-Step Workflows

A workflow in Kallamo is a **linear chain of AI profile steps** where the output of each step becomes the input of the next. This allows complex writing pipelines such as:

```
Brainstorm → Outline → Draft → Edit → Polish
```

Each step runs an independent AI profile with its own system prompt, model, temperature, knowledge base, and RAG configuration.

### Workflow Definition

Workflows are stored in the `workflows` table with a `steps` column containing a JSON array:

```json
{
  "id": "wf_abc123",
  "name": "Creative Writing Pipeline",
  "entryProfileId": "profile_brainstorm",
  "steps": [
    {
      "profileId": "profile_brainstorm",
      "prompt": "Generate 5 creative angles for the topic.",
      "includeContext": true
    },
    {
      "profileId": "profile_drafter",
      "prompt": "Write a first draft based on the best angle above.",
      "includeContext": true
    },
    {
      "profileId": "profile_editor",
      "prompt": "Edit for clarity, pacing, and voice consistency.",
      "includeContext": false
    }
  ]
}
```

### Step Fields

| Field | Type | Description |
|-------|------|-------------|
| `profileId` | string | The AI profile to use for this step |
| `prompt` | string | Additional instruction appended to the profile's system prompt |
| `includeContext` | boolean | Whether to search knowledge bases and chat memories for this step |

### Single-Profile Fallback

When a user sends a message targeting a single AI profile (not a workflow), the runner wraps it into a one-step workflow internally:

```javascript
steps = [{ profileId: targetId, prompt: '', includeContext: true }];
```

This ensures the same execution pipeline handles both workflows and individual profile messages.

---

## Workflow Execution Flow

The workflow runner (`workflow-runner.js`) processes steps sequentially with the following pipeline for each step:

```
Step N
  ↓
1. CONTEXT SEARCH PHASE
   ├── Load constant knowledge files (strategy: "constant" / "full_context")
   ├── Load chat-scoped constant files (filtered by profile permissions)
   ├── If profile.isAgentic:
   │   └── Execute Agentic RAG Loop (see architecture.md)
   ├── Else if includeContext:
   │   ├── searchKnowledgeBase(query, profileId)    → profile KB chunks
   │   ├── searchChatKnowledgeBase(query, chatId)   → chat KB chunks
   │   └── searchChatMemories(query, chatId)        → memory blocks
   └── Append attached file contents
  ↓
2. SYSTEM PROMPT COMPILATION
   ├── Base: profile.systemPrompt
   ├── + Step-specific prompt (if any)
   └── + All context blocks (constant + retrieved + attachments)
  ↓
3. HISTORY WINDOWING
   ├── Calculate remaining token budget
   │   budget = maxContext - systemPrompt_tokens - userInput_tokens
   └── Load active messages (newest first) until budget exhausted
  ↓
4. API CALL
   ├── Send to provider via api-engine.js
   ├── On success: capture output
   └── On failure: trigger error recovery modal
  ↓
5. CONTEXT OVERFLOW CHECK (non-final steps only)
   ├── If output > 4,000 tokens:
   │   └── Show overflow modal → user can edit or send as-is
  ↓
6. CHAIN OUTPUT
   └── currentInput = stepOutput → feed to Step N+1
```

### Progress Notifications

The runner sends real-time progress events to the renderer via `webContents.send()`:

| Event | Payload | When |
|-------|---------|------|
| `workflow-progress` | `{ step, totalSteps, profileName, status }` | Each phase transition |
| `workflow-error` | `{ step, profileName, errorMessage }` | API call failure |
| `workflow-context-overflow` | `{ step, profileName, outputText }` | Large intermediate output |

### Token Diagnostics

After the final step, a debug object is saved with the AI message:

```json
{
  "workflowStatus": "Workflow complete (3 steps)",
  "agenticRagResponse": "...",
  "agenticRagContextGathered": "...",
  "tokens": {
    "profileKb": 2450,
    "chatKb": 1200,
    "chatHistory": 8500,
    "totalInput": 14200,
    "output": 3100
  }
}
```

This is accessible in the chat UI via the debug panel on each AI message.

---

## Error Recovery & Context Overflow

### Error Recovery Modal

When an API call fails during workflow execution, the runner pauses and presents three options to the user:

| Action | Behavior |
|--------|----------|
| **Retry** | Re-execute the same API call with identical parameters |
| **Skip** | Use the previous step's output (or original user input) as this step's output |
| **Interrupt** | Abort the workflow; save partial output if any previous steps completed |

The error modal is implemented as a deferred Promise that blocks the workflow runner until the user responds:

```javascript
const decision = await new Promise((resolve) => {
    errorDeferred = { resolve };
});
// decision: 'retry' | 'skip' | 'interrupt'
```

### Context Overflow Modal

If an intermediate step produces output exceeding ~4,000 tokens (16,000 characters), a context overflow modal allows the user to:

| Action | Behavior |
|--------|----------|
| **Send as-is** | Pass the full output to the next step unchanged |
| **Edit and send** | User manually trims or modifies the output before it's passed forward |

This prevents token budget explosion in downstream steps.

---

## Profile Packaging (.klp)

Kallamo uses a custom `.klp` (Kallamo Profile Package) format for exporting and importing complete AI profiles.

### Package Structure

A `.klp` file is a standard ZIP archive containing:

```
profile_name.klp (ZIP)
├── profile.json          # Profile settings (API references stripped)
├── manual_blocks.json    # Manual knowledge snippets with keywords
└── files/                # Raw knowledge base files
    ├── worldbuilding.pdf
    ├── character_sheet.docx
    └── style_guide.txt
```

### Export Process

1. **Sanitize** — `apiProfileId` and `model` are set to empty strings (credentials are never exported).
2. **Compile profile.json** — Serialize all profile settings except API credentials.
3. **Extract manual blocks** — Query `knowledge_chunks` for chunks with IDs starting with `mem_` or `manual_`, strip the `Document:` / `Content:` enrichment headers, and extract `Tags:` keywords.
4. **Copy files** — Read raw file bytes from `internalPath` and add to the `files/` directory in the ZIP.
5. **Write ZIP** — Save to the user-selected path with `.klp` extension.

### Import Process

1. **Read ZIP** — Extract `profile.json` from the archive.
2. **Collision detection** — Check if the profile ID or name already exists in the database.
   - If collision: generate a new ID and append ` - Imported` to the name.
3. **Extract files** — Write raw files from `files/` to the profile's local `KnowledgeBase/` directory.
4. **Re-vectorize manual blocks** — Each manual snippet is vectorized fresh using the local embedding engine, preserving its keywords/tags.
5. **Insert profile** — Save to `writing_profiles` with `apiProfileId` and `model` empty (user must configure).
6. **Background indexing** — If knowledge files exist, trigger async RAG indexing.

### Progress Events

Both import and export send progress events:

```javascript
event.sender.send('export-progress', { progress: 85, status: 'Compressing...' });
event.sender.send('import-progress', { progress: 70, status: 'Vectorizing...' });
```

---

## Knowledge Base Packaging (.klkb)

A `.klkb` (Kallamo Knowledge Base Package) exports only the knowledge base of a profile, without the profile settings.

### Package Structure

```
profile_kb.klkb (ZIP)
├── manual_blocks.json    # Manual snippets with keywords
└── files/                # Raw knowledge base files
    ├── lore_document.pdf
    └── reference.txt
```

### Use Cases

- Share a curated knowledge base between multiple profiles.
- Back up a knowledge base independently of profile configuration.
- Distribute reference material (world-building documents, style guides) to collaborators.

---

## Workflow Packaging (.klw)

A `.klw` (Kallamo Workflow Package) exports a complete workflow chain — including all referenced profiles, their knowledge bases, and manual snippets — as a single distributable file.

### Package Structure

```
workflow_name.klw (ZIP)
├── workflow.json             # Workflow definition (name, steps)
├── profiles/
│   ├── profile_brainstorm/
│   │   ├── profile.json      # Profile settings (API refs stripped)
│   │   ├── manual_blocks.json
│   │   └── files/
│   │       └── reference.pdf
│   └── profile_editor/
│       ├── profile.json
│       ├── manual_blocks.json
│       └── files/
```

### Export Process

1. **Serialize workflow** — Export the workflow definition (name, description, steps array) into `workflow.json`.
2. **Bundle referenced profiles** — For each `profileId` in the steps array, export the full profile and its knowledge base into a `profiles/<profileId>/` subdirectory following the same structure as `.klp` packages.
3. **Sanitize** — All `apiProfileId` and `model` fields are stripped to ensure no credentials are included.
4. **Write ZIP** — Save to the user-selected path with `.klw` extension.

### Import Process

1. **Read ZIP** — Extract `workflow.json` and the `profiles/` directory.
2. **Collision detection** — Check each profile and the workflow for ID/name conflicts.
   - If collision: generate new IDs and append ` - Imported` to names.
3. **Import profiles** — Each profile is imported using the same pipeline as `.klp` imports (file extraction, re-vectorization, background indexing).
4. **Remap step references** — Update the workflow's `steps` array to point to the newly generated profile IDs.
5. **Insert workflow** — Save the remapped workflow to the `workflows` table.

### Use Cases

- Share a complete multi-step pipeline (e.g., "Research → Draft → Edit") as a single file.
- Distribute team-standard workflows with pre-configured profiles and knowledge bases.
- Back up and restore entire workflow chains across machines.

---

## Knowledge File Indexing

### Indexing Lifecycle

When a profile's `knowledgeFiles` array is updated, the background indexer (`indexProfileKnowledgeBase` / `indexChatKnowledgeBase`) runs the following pipeline:

```
1. GARBAGE COLLECTION
   ├── Identify chunks in DB whose source file is no longer in knowledgeFiles
   ├── Identify chunks whose file strategy changed from "rag_search" to "constant"
   └── DELETE orphaned chunks from knowledge_chunks + knowledge_chunks_fts

2. CHANGE DETECTION
   For each file with strategy = "rag_search":
   ├── Compare file.lastIndexedMtime vs current fs.statSync().mtimeMs
   ├── If unchanged AND chunks exist in DB → SKIP
   └── If changed or no chunks → proceed to re-index

3. RE-INDEXING
   ├── Delete old chunks for this source
   ├── extractTextFromFile() → raw text
   ├── chunkText(text, chunkSize) → text segments
   ├── vectorizeChunks() → embedding vectors
   ├── insertChunksToDb() → SQLite + FTS5
   └── Update file.lastIndexedMtime in profile metadata
```

### Chat Knowledge Base Scoping

Chat-scoped knowledge files support per-profile access control via a `profiles` field:

```json
{
  "name": "world_lore.pdf",
  "strategy": "rag_search",
  "profiles": ["profile_narrator", "profile_worldbuilder"]
}
```

If `profiles` is empty or absent, the file is accessible to all profiles. If populated, only the listed profiles will receive chunks from this file during retrieval.

### Supported File Formats

| Format | Library | Extraction Method |
|--------|---------|-------------------|
| `.pdf` | `unpdf` | `extractText()` from binary buffer |
| `.docx` | `mammoth` | `extractRawText()` from binary buffer |
| `.txt` / other | Node.js `fs` | `readFileSync(path, 'utf-8')` |

### Chunk Size Configuration

The chunk size (in characters) is configurable via the Settings panel and stored in the `settings` table under the `advanced` key:

```json
{
  "chunkSize": 500,
  "similarity": 0.3,
  "topKKB": 5,
  "topKMemory": 5
}
```

These parameters control:
- **chunkSize** — Maximum characters per text chunk during ingestion (default: 500).
- **similarity** — Minimum cosine similarity threshold for dense search (default: 0.3).
- **topKKB** — Number of top results returned from knowledge base search (default: 5).
- **topKMemory** — Number of top results returned from memory search (default: 5).
