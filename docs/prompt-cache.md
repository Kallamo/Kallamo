# Prompt caching

How Kallamo lays out a request so a provider can reuse what it already processed, for every
provider the app offers, and the rules that decide when asking for that reuse pays. The code lives in
`src/main/features/llm/prompt-cache.js`, `buildRequest` and `sendAgentRequest`
(`src/main/features/llm/llm.service.js`), `src/main/features/llm/response-metadata.js` and
`src/main/features/chat/history-window.js`.

## The rule

**Caching is a prefix match.** Every provider that caches reuses the leading tokens of a request
only while they are identical to an earlier request. What differs between providers is who decides
where the reusable prefix ends, the shortest prefix worth caching, and the price.

So the layout work below helps every provider, and markers are only an extra for the routes that
need them. A route that caches on its own still pays nothing for a prefix that moves every turn.

## Providers

| Provider | How it caches | What Kallamo does |
|---|---|---|
| Anthropic | Markers (`cache_control`) | Places them: stable system head, anchored history, research transcript |
| AWS Bedrock, Claude | Markers on the same blocks; Bedrock also tries an automatic match | Places them, never the top-level field |
| AWS Bedrock, other models | Automatic where the model card offers it (OpenAI models, Nova); otherwise none | Stable layout only. Kimi, DeepSeek, Qwen and Llama report no cache today |
| OpenRouter, Claude and Gemini | Markers on content parts (only the last counts for Gemini) | Places them, the transcript included, plus the routing key |
| OpenRouter, other models | Automatic (OpenAI, DeepSeek, Grok, Moonshot, Groq's Kimi) | Stable layout, plus the routing key |
| OpenAI | Automatic from 1,024 tokens; `prompt_cache_key` routes repeated prefixes together | Stable layout, plus a hashed key per conversation and role on the official endpoint |
| Google AI, Vertex AI | Automatic (implicit) on Gemini 2.5 and later | Stable layout only |
| Local or compatible | The server's own prefix reuse (llama.cpp, LM Studio) | Stable layout only; no extra fields, since a strict server may reject them |

`cacheModeFor` names each route `explicit` (Kallamo marks) or `automatic` (the provider decides).
Either way the response reports what was read, and that report is what the app shows.

### Shortest prefix

A prefix under the model's minimum is processed uncached, without an error. `cacheMinimumTokens`
keeps the providers' tables (October 2026), so a marker is not spent on a prefix the model ignores:

| Minimum | Models |
|---|---|
| 512 | Claude 5 family (Opus 5, Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable, Mythos) |
| 1,024 | Claude Sonnet 5, Sonnet 4.6 and 4.5, Opus 4.8, older Sonnet; OpenAI; unknown models |
| 2,048 | Claude Opus 4.7, Haiku 3.5; Gemini 2.5 |
| 4,096 | Claude Opus 4.6 and 4.5, Haiku 4.5; Gemini 3 and later |

The check uses a rough character estimate, since its only failure mode is an ignored marker.

### Price

| Route | Read | Write |
|---|---|---|
| Marked (Anthropic, Claude on Bedrock or OpenRouter) | about 0.1x input (lower on the newest Claude) | 1.25x for five minutes, 2x for an hour |
| OpenAI GPT-5.6 and later | 0.1x | 1.25x (30 minutes), 2.5x (12 hours) |
| Other automatic routes | a model-specific discount | free |

A marked prefix pays for itself as soon as two requests reuse it within its lifetime; a mark on
content that changes every turn is a pure surcharge.

## Stable head, volatile tail

The system prompt is assembled in two halves:

| Stable head (holds still across turns) | Volatile tail (moves with the turn) |
|---|---|
| Profile instructions and voice | Story clock |
| Narration policy, workflow instruction | Retrieved context |
| Constant knowledge the user pinned | Attachments |

Constant knowledge is reference material, not a per-turn lookup, so it joins the head. A single
moving block placed early would invalidate every stable byte after it, on every provider.

The full system prompt stays the authority for the payload budget and for routes without markers.
The two segments only tell the request layer where the reusable half ends.

## Placement

`placement` decides where the volatile context goes:

- **`system`**: at the end of the system prompt. Only the head can be reused, because the tail
  precedes the history and rewrites it every turn.
- **`turn`** (the default): behind the history, in front of the user's message. This is the only arrangement where
  the history itself becomes a reusable prefix, so only here is a history marker placed. Automatic
  routes gain from it the same way, without the marker.

Turning prompt caching off restores the plain request byte for byte: no markers, no cache key and no
anchored window.

## Cache key

A cache lives where it was written, so repeated requests must reach the same place. On the official
endpoints Kallamo sends `prompt_cache_key`, a hash of the conversation and the role (main
generation per profile, the retrieval planner, the Narrative State triage and analysis), so no
workspace id leaves the app:

- **OpenAI** routes requests with the same key to the same cache.
- **OpenRouter** takes it as the sticky routing key when no `session_id` is sent, so a conversation
  stays on the same upstream provider and finds its cache there. Without a key, sticky routing only
  starts after a first cache hit. A session expires after 10 minutes without requests, and an explicit
  provider order skips it.

A custom base URL never gets the key, since a compatible server or proxy may reject the field.

## What each part of a turn offers

- **Main generation**: the stable head and, with `turn` placement, the history.
- **Agentic retrieval**: the research transcript only grows, so each planner turn marks its end and
  reads the earlier turns back; the final turn reads without writing. See
  [agentic-retrieval.md](agentic-retrieval.md#prefix-reuse).
- **Narrative State**: the triage and the analysis each open with a fixed system prompt, offered
  for caching per workspace with the same pace and cooldown rules. Their payloads put what rarely
  changes first (calendar, time matrix, entities, rules, the places around) and the turn last, so an
  automatic cache keeps more of the prefix. The analysis prompt depends on the domains a turn
  selects, so it is reused between turns that select the same ones.
- **One-shot calls** (summaries, tagging, entity updates) never see their prefix again, so they are
  not marked.

## Lifetime follows the pace

A read renews an entry, so the right lifetime depends on how far apart turns start. The median of
the last few in-session gaps (a gap over two hours is a new session) decides:

- under about four minutes, five minutes stays warm on its own;
- up to about an hour, the hour-long entry is the one that survives to the next turn;
- slower than that, no lifetime pays and nothing is marked.

Without enough turns to measure, five minutes is the cheaper bet. A provider or model that refuses
the hour gets five minutes for the rest of the session, and every marker in one request shares a
lifetime. OpenRouter is not known to forward the hour, so it keeps five minutes. Automatic routes
keep the lifetime their provider sets.

## Cooldown

Every marked request reports what it read and wrote. A run of writes with no reads means the prefix
is not surviving to the next turn (long pauses, a prompt that keeps changing), so after three misses
marking pauses for a few requests and then probes again, instead of paying the surcharge forever.
Two reuses already beat the write cost, so the bar for giving up is deliberately high.

Cache state lives in memory: provider entries expire within minutes, so nothing is worth keeping
across a restart.

## History anchoring

A window that always takes the longest fitting suffix moves its first message whenever the budget
shifts, and the budget shifts every turn because retrieved context varies. That rewrites the message
prefix constantly, for every provider. With caching on, the window pins its first message and lets
go only when the pinned window stops fitting. It then releases a share of the budget at once (20%),
so the next several turns stay byte-identical instead of dropping one message per turn and missing
every time.

The budget measures history with the same planned window before retrieval runs, so the room it
reserves is the room the final window takes.

## What the app reports

Each response's usage is read in its provider's shape (`response-metadata.js`): Anthropic and Claude
on Bedrock report reads and writes beside the input, with the hour-long writes apart; OpenAI-style
routes report `cached_tokens` and, where writes are billed, `cache_write_tokens` inside the input;
Gemini reports `cachedContentTokenCount`.

The message diagnostics keep the cache per stage (main generation, agentic retrieval, Narrative
State) and say whether Kallamo marked it or the provider cached it. Savings are priced only where the
rates are known: marked reads at about a tenth of the input, writes at 1.25x (2x for an hour). Reads
from an automatic cache are shown but not priced, since their discount depends on the model.

## Wire shapes

| Style | Route | How the mark travels |
|---|---|---|
| `anthropic` | Anthropic | `system` as a block array, content blocks on messages, the top-level field for a transcript |
| `bedrock` | Claude on AWS Bedrock | explicit blocks on the same places, never the top-level field (a 400 on Bedrock) |
| `openai-parts` | OpenRouter, Claude and Gemini | `cache_control` on a text content part; tool results carry none, so a transcript marks the nearest earlier text |

A custom Anthropic base URL gets no transcript marker, since a proxy may accept neither form.
