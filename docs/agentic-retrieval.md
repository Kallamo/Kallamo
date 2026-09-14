# Agentic retrieval

How the retrieval planner decides what to look for, what it is allowed to skip, and why each
turn has to earn its cost. The code lives in `executeAgenticRagLoop`
(`src/main/workflow-runner.js`) and in `src/main/features/knowledge/`.

## The rule

**A turn is only justified if it can change what enters the final context.**

Three kinds of turn cannot, and the design removes each one:

| Turn that cannot pay | What removes it |
|---|---|
| Repeating a query already executed | The repeat guard, in the loop and across chat turns |
| Giving up after an empty result | The pre-search floor and the empty-result directive |
| Planning a message that never needed research | The planner gate |

Two invariants sit above everything else:

1. **The deterministic path never changes.** A profile without agentic retrieval, or with the
   planner unavailable, runs exactly the code it ran before.
2. **The agentic path is never worse than the deterministic one.** The free search runs first
   and its results are already in the context before the planner is asked anything.

## The planner gate

`shouldRunPlanner` (`features/knowledge/agent-planner.js`) decides, without a model call,
whether a message deserves research. In order:

| Condition | Decision |
|---|---|
| The override is on (`advanced.agenticGate === 'always'`) | plan |
| Empty message | skip |
| The message writes a known entity name | plan |
| The message contains a question mark: `?`, `？`, `¿`, Arabic `؟`, Greek `;` (U+037E), Armenian `՞`, Ethiopic `፧` | plan |
| 12 words or more, or 60 characters or more | plan |
| The same, 24 characters, in a script written without spaces | plan |
| Anything else | skip |

The gate reads the **user's own message**, never the input of a workflow step: from step two on
that input is generated prose, which says nothing about whether the conversation needs research.

Shape decides, never a word list, so the gate behaves the same in every language. The threshold
is deliberately low: "continue", "ok", "e aí" are skipped, and almost anything else is planned.

**Cost of a wrong skip.** A skipped message still runs the deterministic retrieval, which is the
same search the loop would have seeded itself with. What is lost is the multi-hop reach, never
the context. That asymmetry is why the gate is allowed to decide alone. The path taken and the
reason are recorded on the message (`context.retrievalPath`, `context.retrievalGateReason`) and
shown in the Agentic RAG panel.

## The pre-search floor

Before turn 1, the loop runs `search_kb` and `search_memories` on the user's request through the
same tool path the planner uses. This costs one local embedding and no model tokens.

- Everything found is already in the final context, so an empty loop can never produce an empty
  context.
- The planner sees the five strongest results in full and the rest as snippets, with handles it
  can cite or `expand`, and is told the queries have already run. When the strongest results
  already answer the request, it is told to finish on turn 1 instead of spending a turn opening them.
- Those queries are in the repeat guard, so turn 1 cannot spend itself rediscovering them.

Seeded passages are marked. If the planner finishes without citing them they drop one tier, not
to the bottom: the deterministic path would have sent them, and the planner staying silent is
not evidence against them.

## The repeat guard

`queryKey(tool, query)` normalizes a query to its content terms, lower case, order insensitive,
dropping terms under three characters (the same floor the FTS index uses). "O fogo do Dragão"
and "dragão, FOGO" are one query.

- **Inside the loop**: a repeat never reaches the database. The planner is told the query already
  ran, with how many results it had and which handles carry them.
- **Across chat turns**: `features/knowledge/retrieval-ledger.js` remembers, per workspace, which
  queries ran and what they yielded. Only a query that found **nothing** may be answered from the
  ledger. A query that found passages has to run again, because its results are what fills this
  turn's context and the ledger does not store them.

The ledger is in process, capped at 120 queries per workspace, entries expire after 20 minutes,
and indexing or deleting passages clears the workspace (`rag-service.js` does this wherever
chunks are written or removed). A remembered "nothing found" must never outlive the corpus it
was measured on.

It composes with the in-loop coverage ledger rather than duplicating it: the in-loop one is the
truth inside a single loop and feeds `COVERED SO FAR`; the cross-turn one only seeds the repeat
guard and never hides a result.

## What the planner is asked for

Queries are natural-language questions, not keyword lists. Retrieval is 0.7 dense plus 0.3
sparse, and the dense model reads questions; keywords survive through the FTS side and the
entity evidence boost either way.

Measured on the annotated workspace set (`scripts/retrieval-eval.js`, 11 questions, real
database):

| Query style | hit@k | MRR |
|---|---|---|
| Full questions | 8/11 | 0.500 |
| Mild keyword reduction | 7/11 | 0.483 |
| Names plus three content words | 5/11 | 0.421 |

The misses are ranking misses, not similarity-floor misses: keywords do not fall below the
floor, they fall down the list and out of Top-K.

## Budget and width

The loop receives the retrieval budget the step computed and sizes its searches with it, exactly
like the deterministic path (`retrievalTopK`, three tiers). The user's Top-K stays the floor, so
a small context window keeps the cost it has today. On the annotated set, moving from k=5 to
k=20 takes the answering passage from 8/11 to 11/11 in context, at about 5.8K tokens.

Width is for the writing assistant, not for the planner: each call shows the planner the first
five results in full and the rest as snippets it can expand, while every result reaches the
final context.

## Tiers

`packContextItems` orders by tier, then score, then position.

| Tier | Content |
|---|---|
| 0 | Worldbuild facts (registry data, relations) |
| 1 | Files read in full |
| 2 | Search hits, linked lore, cited passages |
| 3 | Lookup-only passages, uncited seeded passages, uncited facts |
| 4 | Uncited passages the planner found and did not cite |

Nothing is deleted for lack of a citation. Registry facts are the most reliable data in the
pipeline, so a missing citation only lowers their priority.

## The planner's own window

The planner can run on another connection than the writing profile, often a smaller local
model. Everything the planner reads is measured against **its** connection
(`resolvePayloadLimit` with the planner's API connection), and `plannerWindowShape` divides that
window:

| Part | Share of the planner's window | Bounds |
|---|---|---|
| Reply reserve | 20% | 512 to 4,000 tokens |
| Conversation history | 20% | at most 6,000 tokens |
| Pre-search preview | 10% | the rest of the pre-search still reaches the writer |
| Known entities listed | one per 200 tokens | 10 to 60 |

On a 128K window the reply reserve, the history and the entity list keep their long-standing
limits. Search width (`toolK`) still follows the writer's budget, because the results feed the
writer, not the planner.

The local token count uses one fixed tokenizer, and models count the same text differently: it
fell 29% to 38% short of Claude Sonnet 4.6 on Portuguese text. `token-calibration.js` learns the
real ratio per connection, model and protocol from the input tokens each provider reports, in chat
replies and in every research turn, and stores it. `payloadLimitFor` divides the configured limit by
that ratio, so the planner's window checks compare the raw estimate with an already corrected limit
and nothing is corrected twice. A higher measurement is adopted at once and a lower one is blended
with earlier ones; the ratio never drops below 1, and an unmeasured model is not corrected.

Before every request the loop measures the whole transcript the same way `buildRequest` will.
If it does not fit, the oldest research turns collapse to their digest one at a time
(`downgradeUntilFits`). If even a fully collapsed transcript does not fit, the research stops
there, keeps everything already gathered, and records why in the trajectory. It never sends a
request it knows will be refused.

## Protocols

The planner speaks one of two protocols. Both read the same neutral transcript, so the loop
never branches on the provider.

**Native tool calling** (`features/llm/tool-conversation.js`). The tools are declared as
functions (`features/knowledge/planner-tools.js`) and the provider returns structured calls:

| Provider | Request | Reply |
|---|---|---|
| OpenAI, OpenRouter, Local (OpenAI-compatible) | `tools` of type `function`; results as `tool` messages | `message.tool_calls` |
| Anthropic, and Claude on AWS Bedrock | `tools` with `input_schema`; results as `tool_result` blocks | `tool_use` blocks |
| Google AI, Vertex AI | `functionDeclarations`; results as `functionResponse` parts | `functionCall` parts |
| Other Bedrock models | not available: they take one flat prompt | text protocol |

The provider's own assistant payload is replayed unchanged on the next turn, so thinking blocks
and thought signatures come back exactly as they were sent.

**Text protocol** (`features/knowledge/agent-output.js`). The tools are taught as tag syntax and
a tolerant parser reads them. It works with any model that can follow instructions, and it is
where every connection falls back to.

**Choosing.** Native is tried whenever the connection supports it and the Native tool calling
switch is on. It falls back to text by itself:

- a native request that fails before tools have worked once in the loop switches at once, and
  that connection and model stay on text for the rest of the session;
- a first reply that calls no tool also switches, but counts as one strike, since a capable model
  may simply have been done; two strikes keep that connection and model on text.

A fallback never consumes a research turn. After native tools have worked once in a loop, a
plain reply without calls is read as the model concluding.

**Reasoning is never read as an action.** Every reply is read with its reasoning removed, in both
protocols, including a thought cut off by the output limit. A search or finish written while the
model was only thinking does not run.

## Prefix reuse

Many providers reuse a prompt prefix they have already processed, which makes repeated input
cheaper or faster. That only works if the prefix does not change, so the transcript is built to
keep it stable on every provider:

- the instructions, history, entity list and pre-search come first and never change during a loop;
- each turn is appended as real conversation turns, never rewritten in place;
- an earlier turn collapses to its digest only when the planner's window requires it, because a
  rewrite invalidates prefix reuse from that point on for every provider.

Claude needs to be asked, and the form depends on where it runs (per the Anthropic documentation):

- **Anthropic's own endpoint:** top-level `cache_control: {type: "ephemeral"}`, which places the
  mark on the last block of every request.
- **Claude on AWS Bedrock:** Kallamo calls InvokeModel, whose integration rejects the top-level
  field with a 400 on Claude Opus 4.6, Sonnet 4.6 and earlier. The request instead carries an
  explicit `cache_control` on the last block of the last message, moved forward each turn.
- **A custom Anthropic base URL:** neither form, since a proxy may not accept them.

A prefix below the model's minimum (1,024 tokens on Sonnet 4.6, 512 to 4,096 depending on the
model) simply does not cache, with no error. Turn 1 writes the cache (`written to cache` in the
panel) and later turns read it (`read from cache`).

Whether and how much other providers reuse a prefix is theirs to decide and is not assumed here.
The trajectory records what each provider reports for every turn (input tokens and tokens read
from cache, where the provider reports them), and `agentic-eval` averages it, so the effect is
read from the provider instead of estimated.

## What is measured

- `scripts/retrieval-eval.js`: ranking and recall of the deterministic path, no model calls.
- `scripts/agentic-eval.js`: the loop itself, against a copy of the database. It packs the result
  into a real budget before scoring, reports which stage first retrieved the answer (pre-search,
  turn 1, turn 2, ...), counts empty and refused calls and unusable replies, reports the protocol
  used and any fallback, counts runs stopped by the planner window, averages provider-reported
  input and cache reads, and runs the deterministic baseline on the same questions. `--protocol
  text` forces the text protocol, so the two can be compared on the same model.

Run it once per model family the product supports. A result on one provider says nothing about
another.
