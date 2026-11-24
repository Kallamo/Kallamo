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
for a person. A memory does not: one that matters little fades on its own, and any can be brought back. So do a lie someone was told, and any correction or ending of a record a person wrote.
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

A person, creature, race, faction, place or unique item that appears in a scene, or is made, forged, copied,
split off or transformed into something new, is proposed in the scene pass. Without an entity of its
own, what the story learns about it is pinned to the nearest existing one: the facts about a replica
end up on the original.

- **What may be created is the workspace's call**, per kind, in Configuration (Narrative State,
  What the AI may create): characters, races, specific creatures, species groups, named items,
  ordinary items, spots, places, areas, regions and factions, each Off, Review or Automatic
  (`src/shared/entity-creation-policy.ts`). The defaults let a scene make its own people, creatures,
  named items, rooms and places, ask about species, areas, regions and factions, and leave races and
  ordinary items alone. A faction needs a name of its own and members or a purpose the scene shows. Review everything turns every Automatic kind into Review; Manual creates nothing.
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
- **Filled at birth.** Right after a sheet is created (provisional or confirmed), one short call
  reads the turn that brought it in and fills the part of the sheet that says what it is, so the
  next turn already reads it (`features/worldbuild/first-fill.js`): a character's Identity (status,
  gender, age, the race the scene names if the world has it), a creature's Details, an item's
  Details and a location's Overview without the description, and for every type the user's fields
  placed in those sections or in none, each by its own AI guidance and options. Read-only and
  hidden fields are never written; a field still at its default counts as empty. What the scene
  states or plainly shows is filled (pronouns, an evident age, a role); what it gives no ground for
  stays empty. Level, attributes and skills come with the proposal's starting profile when the
  world has progression. Description, lore, appearance, personality and links to places wait for
  Update entities. The message diagnostics list what each new sheet got under `firstFill`.

## Changing what is stored

The story pass reads the records of whoever could perceive the turn, and each knowledge, belief
and memory there carries a ref (`#1`, `#2`...). With a ref it can do what a plain new record cannot:

- **revise** it: the corrected record supersedes the old one under the same entry, so whatever
  points at the entry survives;
- **confirm** it when the turn puts proof in front of the holder: seen or shown makes it certain
  knowledge, being told makes it firmer;
- **end** it, saying how: forgotten (out of reach for now), lost (for good), given up, disproved,
  taken back, or **settled**. Disproved means the holder saw it was false: a belief only the world
  contradicts stays, and the narrator plays it as irony;
- **recall** it: something in the turn brings back what was out of reach for now;
- **merge** several memories of one holder that tell the same experience into one;
- name it as **what someone was told from**, or as **the premises** of an inference.

Refs are resolved in Kallamo (`story-refs.js`); ids never pass through the model, and a ref that
names nothing is dropped and reported. Ending or correcting a record a person wrote waits for review.

**An intent is not permanent.** A plan, condition, refusal, demand or open question that the scene
carried out, met, answered, dropped or overtook is ended as settled, under every holder that carries
a ref for it. Without this a refusal the scene already moved past kept reaching the narrator turn
after turn, and the character kept refusing. A new intent that replaces an old one revises it. A
memory cannot be settled.

## How memory lives

What a character holds is meant to behave like a mind, not a file that only grows.

**Out of reach is not gone.** Forgetting keeps the record with its holder and changes its
accessibility, as the Knowledge tab names it: *suppressed* is out of reach for now (faded, or pushed
away), *inaccessible* is lost for good. Reads leave both out, so neither reaches what the
characters know; the narrator sees what is out of reach for now about the turn, under NARRATOR ONLY,
and may let the scene bring it back. Being told something again is learning, not remembering: it is
a new record with a teller.

**Relevance.** Every memory carries how much it matters to its holder, from 0 to 1: 0.9 and above
shapes who they are and never fades; 0.7 to 0.85 moves the plot or a relationship; 0.4 to 0.6 is
useful context of one moment; below 0.4 is not kept. Knowledge and beliefs take their category's
relevance (`memory-relevance.ts`). Secrets, identity, oaths, wounds, losses and what formed someone
never fade; an intent is settled, never faded. Relevance also orders what the context keeps first.

**Fading.** Unused for 7 days of story (relevance under 0.65) or 30 days (up to 0.9), a memory or a
piece of knowledge slips out of reach. Unused means the story did not draw on it: being corrected,
confirmed, recalled, gathered into another memory, told on or reasoned from counts
(`narrative_record_use`); appearing in a context does not. Only what the story pass wrote fades;
what a person wrote, and everything the player character holds, stays as it was.

**When a scene ends** (the place changes, or the clock jumps six hours or more), the story job of
that turn tidies what its people carry: fading is a fixed rule with no model, then one call settles
the intents the records show were overtaken and joins repeated memories. Every change is written on
the turn's own timeline, so taking the turn back takes it back too. The reply's diagnostics show it
under the story record.

**Why fading copies the record.** Umwelt's `holding.adjustBatch` writes its copy with the batch's
own provenance, which would drop the record's kind, category, entry and relevance. Kallamo commits a
whole copy with the new accessibility instead, superseding the original.

**The interpreter sees what ages worst.** Of the records it may change, open intents and what is
out of reach about the turn's topics come first, so neither falls past its limit however old.

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

A turn's context holds what the turn needs and nothing else. The payload limit is a ceiling the
context stays under, never a size to reach. The code is in `features/narrative/retrieval/`.

- **The core.** Always sent, never cut. In roleplay: the place and its chain, who is present, the
  player's sheet, the sheets of the people present (all of them in a scene of four or fewer, else
  those the turn or the last reply names; the rest get a card), cards for objects and the location,
  their resources, skills and inventory, how the people present stand toward each other, and the
  scene memory. Outside roleplay: the world date. Systems marked always in context go to the rules.
- **Who is not in the conversation.** Three parts of the core, built without any model, for the
  people who bear on the scene without being in it:
  - *Between them* also covers someone nearby the turn speaks to or about.
  - *Toward who is named*: for up to three people the turn or the last reply names who are not here,
    each present person's regard toward them and theirs back, by title and value only.
  - *Could come in*: who is nearby, who the place keeps (it is `led_by` them, or they are
    `connected_to`, `located_in` or `operates_in` it) and who took part in the latest scenes here
    and has not been seen elsewhere since. Four get a card (with every custom field, so a voice field
    goes too), when they were last seen and doing what, and their two strongest ties with those
    here; anyone else nearby is a mention. The dead are never offered.
  - *Last together*: for people who share at most two of the scenes the history still shows, the
    last scene they shared before those and each one's latest memory involving the other (under
    their name in what they know), six pairs at most. The player's own memories stay the user's.
  - *About each other*: what each person here holds about the others here, statements and the
    memories the other is part of, two per pair and twelve at most, ordered by how much they weigh
    on the holder, the pairs the turn names first. They stand under the holder's name in what they
    know. What the history still shows is left out, and so is what the player holds.
    Someone the turn has acting who is not in the scene yet (the planner's `acts`, or without a
    planner whoever the request names) brings what they hold about those here the same way, eight
    lines at most: the scene state follows the story a turn late.
  "Last seen" is the latest scene someone took part in up to now on the story clock, read back in
  widening spans (a day, a week, a month, four months); a thread played ahead of the clock is not
  the past yet. A need of kind `place` about a person answers where they were last seen.
- **Needs.** The names written in the request are the floor: each one is a need without any model.
  The Retrieval Planner then reads the turn once (a short JSON brief, no tools) and lists what else
  it needs: a rule used, an item in hand, a memory called back, what someone knows, who knows
  something, a relationship, a place, a document passage, a chronology, an open question. Without a
  planner (Smart search off), or if the brief fails, the turn is also searched by its own words: an
  open question on the story and the Chat Archive and, outside roleplay, the documents.
- **Finding what the turn does not name.** The planner has no tools, so it is shown what the tool loop
  used to find by reading: up to 30 entities one Worldbuild link away from what the turn and the last
  reply name and from who is here, items and people first ("Twin Fangs of the Dusk (Items, owned by
  Quill)"). A name also resolves by a distinctive part ("Duskvein" for "Duskvein Ore"):
  a word of a name no other name uses, five letters or more; in free text it must be written as a
  proper noun or be ten letters or more. Entities named in what the needs brought and not yet in the
  context come along as cards, three at most. The profile's search instructions reach the planner.
- **What the history already holds.** Scenes written by the last ten replies are not searched for:
  the narrator reads those replies whole.
- **One read per need.** Each kind of need is a filtered engine query: a holder's memories by meaning
  (`search` with `filter.holder`), what someone holds about an entity (`holdings` with `about`),
  `whoHolds`, `dispositions`, Facts about an entity (`search` with `filter.subject`), a chronology
  (`timeline` with `participant` and `range`). Each need is searched with its own short query and
  vector, never the whole turn.
- **By meaning.** Only with the local embedding model. A short query scores the whole page lower, so a
  hit is kept within 0.02 of the best one and never under 0.86.
- **Scenes.** An event is a scene when its type says so (`scene`, `occurrence`); events written before
  types named their nature are judged by the origin the journal kept. Sheet edits and awareness
  grants name no participants.
- **Flashbacks.** A recalled memory's story-axis position dates the knowledge read after it, so a
  character's knowledge is read as it stood then.
- **Memories about someone.** A memory is held about its holder, with the others in it as related
  or as participants, so a read about the other person never finds it. What someone holds about a
  named person or thing adds, beside up to three statements each, the two memories involving it
  that weigh most across everyone here.
- **Perspective.** What each character holds is written under their name; a statement everyone present
  holds, once. A member reads what their faction or area holds when the card's audience lets them.
  The Worldbuild Knowledge cards add which fields of a sheet each person knows. Secrets someone would
  give away to another person present, and beliefs that run against canon, go to the narrator only.
  `context.admit` confirms each character's records before they are sent.
- **Tiers.** An entity is a sheet when the turn uses it, a card when it is only named, a mention at
  most otherwise. When the ceiling is reached, items fall a tier, then out, lowest priority first;
  the priority comes from what the item is for and from the story (how it was learned, how sure, how
  recent). The core never leaves.
- **Research.** Only a `research` need outside roleplay runs the tool loop, on its own question, for
  the profile's search rounds and with no pre-search.
- **Chat Archive.** A last resort for an open question nothing else answers. A passage starts at a
  sentence.
- **Vectors.** Filled in the background after each analysis and when a turn starts, 16 texts at a
  time, from where the last run stopped. Facts carry a text of their own (names, not ids); Facts
  written before that get it once, through a copy that supersedes them.
- **Writing Desk.** A rewrite or an analysis also gets the Facts and earlier scenes the passage is
  about, under Story canon, so prose does not contradict what the story established.

The message diagnostics show what each need cost, what the ceiling shrank and what the story refused.

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
- **A journey costs what the world says.** When a turn ends somewhere else, the location graph
  gives the move a Time Cost Matrix category: between spots of one place is Micro, between places
  of one area Local, across the districts of an area Transit, between areas of a region Macro. Being
  directly inside the other is Micro, and a road, door or portal between the two can shorten the
  trip to Local but never lengthen it. A location with no size takes one from its neighbours (one
  step above the largest sized thing inside it, never above what holds it), so a house left unsized
  does not turn a walk between its rooms into Transit. The advance is raised to the category's
  minimum. A move still waiting for approval does not charge the clock.
- **Moving is not the same as acting.** The matrix guidance describes actions, so the triage reads a
  journey's category from the scene's location chain and the sizes of the places named, not from
  the guidance. It also says whether the move was all the turn did (`movementOnly`). Only then is
  the advance also capped at the category's maximum, so crossing a room cannot cost a quarter of an
  hour; a meal or a search at the destination keeps its own time. A stated span or clock outranks
  the cap. The turn's diagnostics show the category and the band applied on the Location line.
- **Resources follow story time in what the player can see.** A resource keeps whole numbers or
  one decimal. Each turn's drain or recovery is added to what earlier turns left over; only the
  part that moves the shown value is applied, and the rest stays banked on the value until it adds
  up. Reaching the lowest or highest value clears the bank, so a full battery saves no charge. All
  of a turn's time changes read as one line under its Time entry in Recent changes.
- **A date the narrative states is never bounded**: there the author said it.

## Cleanup

Worlds played before the gate still hold duplicates, scene chatter filed as knowledge and raw-key
records. Cleanup is previewed and never deletes: a retired record stays in the story file's history
with its event and evidence, and stops being current through a retraction. The first copy of a
statement wins, so the record that established something keeps its place in the sequence.
