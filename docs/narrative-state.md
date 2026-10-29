# Narrative State

What the analysis after each roleplay reply is allowed to write down, and how the story clock
moves. The code lives in `src/narrative/` (contracts, taxonomy, validation) and in
`src/main/features/narrative/` (routing, quality gate, store, maintenance), with the clock in
`src/main/features/worldbuild/calendar-service.js`.

## The rule

**A record is only stored if it says something that will still matter after the scene.** Scene
chatter, momentary posture and repeated observations are not lost by being dropped: the live scene
and the chat history already carry them. Stored, every copy would reach the prompt again on every
relevant turn.

## A closed taxonomy, not a blocklist

Every record the interpreter writes declares what kind of thing it is, from a fixed list:

| Kind | Durable | Transient (dropped by name) |
|---|---|---|
| Knowledge | world-lore, identity, history, secret, capability, intent, bond | scene-state, small-talk |
| Memory | formative, bond, loss, trauma, triumph, oath, revelation | routine |
| Relationship cause | betrayal, sacrifice, rescue, revelation, oath, cruelty, humiliation, forgiveness, shared-loss, sustained-trust, material-debt, first-impression, confidence-shared, affection, rejection, reliance | courtesy, banter, routine-cooperation, mood, compliance, instruction, presence |

- A list of forbidden predicate names cannot hold: the interpreter renames the predicate and the
  same scene walks through. Declaring a category inverts that.
- The list is part of the response schema, so a provider with structured output refuses an invented
  category at generation time instead of the runtime discarding the record afterwards.
- The transient values exist on purpose: momentary detail needs an honest place to be classified,
  so it can then be dropped by name instead of by guesswork.
- Relationships need a named cause. The closeness causes (confidence-shared, affection, rejection,
  reliance) exist so a campaign whose plot is a relationship can name what moved.
- A self-referential record is kept only for a secret, an identity or an intent. Anything else a
  character "knows about themselves" in the third person is a world fact and belongs in canon.

**Only the interpreter is held to the taxonomy.** Hand-authored entries, imports and Worldbuild
updates are deliberate acts by the author, and a world seeded before the taxonomy must not lose
records to it. Records without a category stay valid and read as unclassified.

## The quality gate

`reviewExtractedOperations` (`narrative-quality.ts`) runs before anything is fingerprinted or
written, so a turn whose only content was chatter never reaches the ledger, and a regenerated turn
that differs only in chatter fingerprints to the same event. On top of the category it refuses:

- **scene-state predicates** (`current-location`, `mood`, `holding`...), as a second check behind
  a category that may be misdeclared;
- **identifier debris**: a value still shaped like a raw key after names were resolved;
- **empty statements**: a lone word under a generic predicate (`statement: Something`). Under a
  specific predicate the same word is a value, so `gate-code: Dawnfall` is a complete claim.

Each refusal is reported in the turn diagnostics, so a campaign that stops recording says which
rule is doing it instead of going quiet. A per-kind budget is applied after the gate: a turn that
legitimately produces six pieces of lore keeps them, a runaway response that produces forty is cut.

## Statement identity

Two records are the same statement when they share whose perspective it is, who it is about and
what it says. For prose the sentence alone is the key, because the interpreter rewrites the
predicate and the acquisition between turns while the sentence stays word for word. For a
structured value (`has-hidden-route: true`) the predicate carries the claim, so it stays in the key.

The store skips an operation whose statement already exists; facts, which have no subject and are
never superseded, are checked the same way. The projection keys on the statement too, but a
retirement ends only its own record, never another that happens to say the same thing.

Hearsay keeps its teller: knowing who said something is what makes a rumour traceable and a lie
attributable. A first-hand record has no teller, and a subject is never its own informant.

## What waits for review

A secret, an identity, a belief and a rupture change what characters may say and do, so they wait
for a person. Ordinary world lore extracted at high confidence does not: queueing it only trains
the reviewer to approve without reading. What the gate already refused never reaches the queue.

## Routing

A local pattern may only decide the mechanical domains (an item moved, someone arrived, a value
changed): the evidence is in the words, and a miss is visible on the next turn. It may never force
the epistemic domains. Whether a line of dialogue produced lasting knowledge is a judgement about
consequence; letting a regular expression make it sent nearly every turn to the full analysis,
which then found nothing worth storing.

The local patterns are English, so in any other language they stay silent. Every rule that has to
hold in every language reads the triage instead, which judges by meaning:

- **Routing guards.** A resource marked in a world without resources also opens the inventory, and
  a turn about an item within reach opens it too (`resolveNarrativeRouting`).
- **A completed move.** A location change is kept when the triage marked the scene, not only when an
  English movement word appeared.
- **Who is in the conversation** (`resolveSceneCast`). Someone heard speaking in the scene memory
  joins the participants. A participant neither speaking nor involved (`aboutIds`) for two turns in a
  row steps back to nearby; the earlier turn comes from the previous reply's triage, kept in its
  diagnostics, and without it nobody steps back. These changes join the turn's scene change, so they
  wait for review where the workspace reviews, like any other.
- **Leaving the place** is never read from `presentIds`: the triage tends to list only the people
  talking, and absence from that list would empty the room. A departure is the scene analysis's
  call, from what the narration says; the triage is told to mark the scene when someone leaves the
  conversation or the place, and to keep everyone who has not left in `presentIds`.

Participants matter beyond the cast list: only their perspectives travel in the writer's context,
and the retrieval planner's roleplay gate treats everyone else as outside the conversation.

## The story clock

The interpreter estimates how long each turn took. A wrong estimate goes straight into the campaign
clock, and a hallucinated "three years" is both catastrophic and invisible. So:

- **An estimate is bounded to a week.** The requested duration is kept beside the applied one.
- **Confidence is not a gate.** The interpreter reports zero for ordinary advances, so refusing
  them only stops the clock.
- **The text authorizes long skips, in any language.** When the turn states a span, the interpreter
  returns it as `statedSpan`: the excerpt copied verbatim, the amount and unit, and whether it
  asserts time passing `now`, only `framing` a scene (a flashback reads the same), or recounting
  `history`. The span counts only when the excerpt is literally in the user message or the
  narrative, with the same tolerance as Tagger evidence, and when any number written in digits
  matches the amount. A verified span raises the ceiling to itself (capped at 100 years); asserted
  `now`, it is also a floor, so the skip lands even when the estimate was smaller. A number
  written in words cannot be checked, so the cited excerpt is shown beside the duration applied.
- **Without a cited span**, a few common English phrasings ("two years later", "after three
  months") are still read from the text as a fallback.
- **Every check is visible.** The turn's diagnostics show the cited excerpt under Time and place,
  or a warning when it was not trusted, and Recent changes in the roleplay panel repeats it.
- **A stated skip of a day or more outranks a time of day**, so "three months later, at two in the
  afternoon" does not collapse into an afternoon.
- **A journey costs at least what the world says.** When a turn ends somewhere else, the advance is
  raised to the Time Cost Matrix minimum for that move, read from the location graph. A move still
  waiting for approval does not charge the clock.
- **A date the narrative states is never bounded**: there the author said it.

## Cleanup

Worlds played before the gate still hold duplicates, scene chatter filed as knowledge and raw-key
records. Cleanup is previewed and never deletes: a retired record keeps its row, event and evidence,
and only its status changes to the value each projection already treats as not current. The first
copy of a statement wins, so the record that established something keeps its place in the sequence.
