# Narrative State

What the analysis after each roleplay reply is allowed to write down, where it is kept, and how the
story clock moves. The code lives in `src/narrative/` (contracts, taxonomy, validation), in
`src/main/features/narrative/` (routing, quality gate, store, maintenance) with the story file under
its `umwelt/` folder, and the clock in `src/main/features/worldbuild/calendar-service.js`.

## The rule

**A record is only stored if it says something that will still matter after the scene.** Scene
chatter, momentary posture and repeated observations are not lost by being dropped: the live scene
and the chat history already carry them. Stored, every copy would reach the prompt again on every
relevant turn.

## A closed taxonomy, not a blocklist

Every record the interpreter writes declares what kind of thing it is, from a fixed list:

| Kind | Durable | Transient (dropped by name) |
|---|---|---|
| Knowledge | world-lore, identity, history, secret, capability, property, intent, bond | scene-state, small-talk |
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
- **property** is what a thing is made of, its present condition, or what examining or testing it
  showed. Without it such findings were filed as capability, and the narrator read an alloy's
  composition as something the object can do.

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

Polarity stays out of the identity on purpose: learning that something is not so is the same
statement changing, so it revises the record that held it was. The repeat check does compare
polarity and attitude, so a denial or a suspicion turned belief is written, not skipped.

Within one event, the same holder given the same statement twice keeps one holding: the interpreter
sometimes repeats a line it already wrote for that holder.

## Awareness and witnesses

- **Awareness is granted once.** Knowledge, a belief or a relationship about someone grants
  awareness of them only when the holder is not aware yet. A relationship that moves again never
  grants it a second time.
- **First contact between characters.** Two participants who heard each other speak in the turn
  (the triage's scene memory, `heard`) become aware of each other without a model call. Only the
  listener becomes aware when the speech went one way. Pairs with the player go through the
  introduction path, and someone only nearby is left out.
- **Witnesses.** Something seen first-hand (acquisition participant or witness) is given to every
  participant of the event who is also a participant of the scene, so one the interpreter forgot
  still holds it. Nearby characters and observers are never filled in this way: being in the room is
  not the same as following what happened.

## What waits for review

A secret, an identity, a belief and a rupture change what characters may say and do, so they wait
for a person. So do a lie someone was told, and any correction or ending of a record a person wrote.
Ordinary world lore extracted at high confidence does not: queueing it only trains the reviewer to
approve without reading. What the gate already refused never reaches the queue.

## Two passes

The analysis of a reply runs in two passes, because the next turn needs only one of them.

- **The scene pass** runs right after the reply, as before: the triage, then the mechanical domains
  (time, who is present, the place, resources, progression, inventory, new entities) applied at
  once. A turn whose triage finds only epistemic domains makes no scene call at all.
- **The story pass** records what lasts: knowledge, beliefs, memories, facts, relationships and
  awareness. It is queued in `narrative_story_jobs` with what the scene pass settled (who was present
  at the start and the end, who arrived or left, who was introduced) and runs right after the scene
  pass, in the background, oldest turn first, one at a time per chat. The next turn waits for the
  scene pass only. A story pass that finishes first writes into the turn's own draft, which
  regenerating or deleting the reply discards; one that finishes after the next turn opened its draft
  writes to the confirmed story and leaves that draft alone. A regeneration waits for a running story
  pass before it sets turns aside, and a reply removed mid-pass records nothing. A regenerated reply
  defers both passes until the player continues. "Update now" on a reply runs both.
- The story pass reads only the narration, never the narrator's reasoning, and gets the turn state
  from the scene pass instead of guessing it: someone who left before a line was spoken never hears
  it. It runs on the Narrative State model unless the AI Engine gives it one of its own.
- A dropped connection is asked again twice, a few seconds apart, before a narrative call fails; a
  provider's refusal is not. A failed story pass stays in the queue and runs again with later turns,
  up to three runs, so a short outage leaves no gap in the story. After that the turn shows in the
  roleplay panel until it is read again by hand, and its diagnostics say why it failed.

Each pass reports its own status and token use in the turn diagnostics. The context manifest keeps
every refusal with its reason except the ordinary one, a record held by someone else, which is kept
only as a count per character: it is refused for everyone on every turn, and listing it made each
manifest close to a megabyte.

## New things in a scene

A person, creature, race, place or unique item that appears in a scene, or is made, forged, copied,
split off or transformed into something new, is proposed in the scene pass. Without an entity of its
own, what the story learns about it is pinned to the nearest existing one: the facts about a replica
end up on the original.

- **What may be created is the workspace's call**, per kind, in Configuration (Narrative State,
  What the AI may create): characters, races, specific creatures, species groups, named items,
  ordinary items, spots, places, areas and regions, each Off, Review or Automatic
  (`src/shared/entity-creation-policy.ts`). The defaults let a scene make its own people, creatures,
  named items, rooms and places, ask about species, areas and regions, and leave races and ordinary
  items alone. Review everything turns every Automatic kind into Review; Manual creates nothing.
- **Review is provisional, not absent.** A proposal waiting for review is created at once as a
  proposed entity, so the story pass of the same turn, the scene and the inventory can refer to it.
  Approving confirms it; rejecting removes it and retires what the story said about it.
- **Off leaves facts unattached.** Nothing is created, and what the turn says about the thing is
  never pinned to something else.
- **One or a kind.** A Creature is one being or a species; an Item is unique or an ordinary kind. The
  interpreter decides this first and says when the narration leaves it open. A doubt, or a choice
  that contradicts what it said about the thing (an ordinary item with a name of its own), always
  waits for the user, who picks the reading on the review card. A doubtful one read as an Off kind
  still goes to review when its other reading is allowed.
- **References.** A new character or creature can name its race or species, written as an
  `is_race` link; a copy names what it was made from (`derivedFromId`), and its facts belong to it.
  A reference to something that does not exist or is of the wrong kind is dropped.
- **Places need a home.** A spot or place is created on its own only inside an area or place that
  already exists; without one it waits for review.

## Changing what is stored

The story pass reads the records of whoever could perceive the turn, and each knowledge, belief
and memory there carries a ref (`#1`, `#2`...). With a ref it can do what a plain new record cannot:

- **revise** it: the corrected record supersedes the old one under the same entry, so whatever
  points at the entry survives. A suspicion confirmed becomes a belief or knowledge this way;
- **end** it, saying how: forgotten, given up, disproved, taken back, or **settled**;
- name it as **what someone was told from**, or as **the premises** of an inference.

Refs are resolved in Kallamo (`story-refs.js`); ids never pass through the model, and a ref that
names nothing is dropped and reported. Ending or correcting a record a person wrote waits for review.

**An intent is not permanent.** A plan, condition, refusal, demand or open question that the scene
carried out, met, answered, dropped or overtook is ended as settled, under every holder that carries
a ref for it. Without this a refusal the scene already moved past kept reaching the narrator turn
after turn, and the character kept refusing. A new intent that replaces an old one revises it. A
memory cannot be settled.

## How something is held

Beyond a statement, a holding can say:

- **suspects**, weaker than believes;
- **not so** (`negated`): the holder holds that the statement is false;
- **the teller's intent**, honest or deceptive, as the narration shows it. Umwelt keeps it from the
  hearer's own reads, so a character never learns from the record that they were lied to; the trace
  shows it;
- **heard wrong**: the teller's record is named while the hearer's claim differs from it;
- **premises**: the records an inference rests on;
- **a secret's circle** (`sharedWith`): telling anyone outside it is reported as a breach;
- **second order** (`heldById`): what a character thinks another holds, written as an
  `umwelt:holds` claim. The engine answers whether that other really holds it.

Every reader shows these in words: the narrator's and the characters' context say "not so" and
"a suspicion", the Knowledge tab labels the entry, and an edit there changes the words, never how the
statement is held. A second-order record reads as a sentence about the other holder, so a reader that
knows nothing of second order still renders it correctly.

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
- **A newcomer** is read from the triage marking the entity domain, which also opens the scene and
  relationship domains; the English introduction pattern is only a backstop.
- **Leaving the place** is never read from `presentIds`: the triage tends to list only the people
  talking, and absence from that list would empty the room. A departure is the scene analysis's
  call, from what the narration says; the triage is told to mark the scene when someone leaves the
  conversation or the place, and to keep everyone who has not left in `presentIds`.

Participants matter beyond the cast list: only their perspectives travel in the writer's context,
and the retrieval planner's roleplay gate treats everyone else as outside the conversation.

## The story file

What the story holds now (facts, what each character knows, believes and remembers, who knows of
whom, how they feel about each other) lives in one Umwelt file per workspace,
`<data>/narrative/<workspace>.umw`, opened through `@kallamo/umwelt` in a worker thread. Kallamo keeps
the journal beside it: `narrative_events` with their participants, evidence and reviews, because the
review queue, the turn diagnostics and the deletion of a chat are Kallamo's own. Every applied
operation is written to both in one step, and `narrative_story_records` notes which turn or
occurrence wrote which record, so taking a turn back retires exactly what it wrote.

- **Nothing is deleted.** A revision supersedes the record before it; a retirement, a forgotten
  memory or a revoked awareness is a transition with its reason. Every read sees only what is current
  at the position asked for, and the trace can still walk the history.
- **Each turn writes into its own draft** (`turn-<message>`), promoted before the next turn or any
  other write. Deleting or regenerating the latest turn discards its draft and leaves nothing behind;
  a turn already confirmed has its records retracted instead. A regeneration that covers confirmed
  turns writes into a replacement draft and promotes it only when the new reply completes.
- **Two clocks.** The tick orders writes; the `story` axis holds the world calendar minute of each
  event, so the Knowledge tab can look back at what someone held by the end of a past day.
- **Who may know what is the engine's call.** Before a character's context is built,
  `context.admit` admits their own records and those of the factions they belong to and the places
  they are local to, and refuses the rest; the refusals show in the turn diagnostics. Group
  membership grants nothing inside the engine, so Kallamo names those groups itself, after the
  Knowledge audiences have already filtered what a group shares.
- **Checks.** A secret told to someone outside those allowed to hear it, and a telling with no record
  behind it in the teller's own knowledge, are reported under Story checks in the turn diagnostics.
  For a telling, `check.utterance` says what the teller holds instead (the opposite, something they
  cannot reach, nothing at all) and drops the finding when they hold the same claim in other words;
  Kallamo's own slot rule says whether canon agrees. They never block the turn: the author decides
  whether a leak was the point.
- **Beliefs are read against canon.** A belief in another value of a fact slot reads as
  contradicted; the same value as aligned.
- **Search.** See Retrieval from the story below.
- **Names follow Worldbuild.** An entity keeps its first name inside the story file, so a rename
  in Worldbuild is carried there, and to the names copied into known relationships.
- **Upgrading.** A workspace from an earlier 2.0 beta is replayed into its story file event by event
  on the first start (`narrative_story_import_v1`); turns already removed stay out, and the old
  record tables are dropped once the replay has run.

## Retrieval from the story

The context planner still brings in every record about the entities in focus. The story search adds
what the request is about without naming it:

- **Who is searched.** In roleplay, each character's own records (5 at most) and those of up to four
  factions and places they read (3 each); the faction audience rules still decide what reaches them.
  The narrator's view searches the Facts, in roleplay and outside it.
- **By words.** The engine joins the words of one text query with AND, so each word of the request
  (four letters or more, the six longest) is searched on its own, and a record needs two distinct
  words to count: one common word never decides.
- **By meaning.** Only with the local embedding model, whose vectors live in the story file. The model
  scores even unrelated story texts near 0.85, so a match needs 0.875 or more; the floor was measured
  on a long campaign and belongs to that model. A paid embedding API is never used.
- **Together.** The two rankings are fused by rank, so a record found both ways ranks first. It still
  ranks below a record about an entity in focus.
- **Earlier scenes.** Story events found the same way are offered to each character, and
  `context.admit` keeps only those the character witnessed. The latest 12 events are left out: the
  chat history still holds them.
- **Vectors.** Filled in the background after each analysis and when a turn starts, 16 texts at a
  time, from where the last run stopped (the engine's resume cursor), so a long backlog never holds
  up a turn.
- **One projection per plan.** Every perspective of a turn reads the same projected story; an
  occurrence's access check reads the memories already loaded instead of the whole story again.
- **Research tools.** The planner can call `recall_story`, `who_knows`, `compare_knowledge` and
  `how_they_know`, in every workspace. Their answers stay in the planner's reasoning, like the
  per-subject tools: the context planner still decides what the writer sees. `who_knows` searches
  every holder and costs one engine call per word per holder.
- **Writing Desk.** A rewrite or an analysis also gets the Facts and earlier scenes the passage is
  about, under Story canon, so prose does not contradict what the story established.

Reading the story as it stood at a scene's own date (a flashback) is not done: retrieval runs before
the reply, and only the analysis after it knows a scene is set in the past.

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
records. Cleanup is previewed and never deletes: a retired record stays in the story file's history
with its event and evidence, and stops being current through a retraction. The first copy of a
statement wins, so the record that established something keeps its place in the sequence.
