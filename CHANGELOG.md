# Changelog

All notable changes to Kallamo are documented in this file. Version numbers reflect the change for the people using Kallamo. From 2.0.0, a major release brings a feature that changes what Kallamo is, a minor release adds features on top of it, and a patch release only fixes. Before 2.0.0, minor releases were named milestones and patch releases also refined.

## [2.0.0] - Unreleased

Roleplay Mode and a world that remembers. The story's state, what each character knows and when things happened are kept as records the AI reads from the right point of view, Worldbuild grows into the rulebook of the world, and the whole app is redesigned around them. New installs start with Evenwell, a guided roleplay story.

### Added

#### Getting started
- **Evenwell**: new installs get a sample roleplay world, a village at the edge of an old forest, with a cast to choose from and an opening scene for each playable character. A first visit introduces what the Narrative State does and the world, then asks who to play, or lets you make your own character. Evenwell can be restored from the empty home. Each playable card shows how the character looks, the opening arrives as if it were being written, with the roleplay header from the first message, and the village trades in copper, silver and gold coins. Its Narrative State starts on Automatic, so clear changes apply as you play and only secrets, beliefs and ruptures wait for you.
- **Step-by-step guide**: a guide walks through adding a connection, choosing the models for Kallamo's AI roles and giving a profile its model, pointing at each control in turn. Worldbuild has its own tour on the first visit.
- Pressing Begin on a story whose narrator has no model says what is missing: with no connection yet it offers the guide or Settings, and with a connection it offers to link the narrator to a model there and then. You can always open the story without a model to look around.
- The setup panel on the launch screen goes away for good once any profile can reply.
- With no workspaces, the home creates one in place, with a cover and profiles, and can restore the sample stories.
- **Splash window**: Kallamo opens on a splash with the logo while it checks for updates, downloads and restarts, updates the database and loads your workspaces, with an option to open now and update later.
- The Windows installer and uninstaller have Kallamo's icon and colours, and their welcome and finish pages say what Kallamo is and that it updates itself.

#### Roleplay Mode
- **Roleplay Mode**: a workspace can be switched to roleplay in Configuration. It adds a player character, a current scene with its location, participating characters, nearby characters, objects present and current situation, a scenario context, and the focal perspective the narration is written from. Turning it off keeps every scene, resource, value and history entry.
- **Roleplay panel**: a panel beside the chat shows the story date and time on a daylight clock, the location, the cast by presence and the player's inventory, with an equipped carousel, and edits them in place. It folds into a rail, shows every resource as a bar, and says when the story state is still updating. Each reply shows its place and time as soon as it arrives, marked as updating until the story state is ready.
- **Resources**: pools such as Health, Stamina or Mana that can belong to chosen characters, races or species, and recover or drain with story time. A maximum is set at level 1 with how much it grows per level, a race or species can set its own, and each character keeps an adjustment with its reason in History. The AI reports changes as amounts with a reason, and changes a maximum only where the resource allows it, always for review.
- **Progression**: levels and attributes with XP, level rewards, a rule for when attributes go up, and who progresses, by character, race, species or everyone. The chat panel shows the player's level and attributes.
- **Skills**: a world can define skills with its own rank names and choose who learns them. Skills can be searched, sub-skills fold under their parent, and they show on character sheets, reach the chat context, can be proposed by the AI during a turn and travel in exported worlds. A character the story introduces can start with the level, attributes and skills it shows.
- **Story time**: roleplay has a clock in the world calendar. The Time Cost Matrix sets how long each kind of action or move can take, from Micro to Macro, and each reply records the place and time it happened.
- **Narrative State**: after each roleplay reply, a background AI role reads the turn and updates the story: the scene, the time, inventories, resources, relationships, what characters know, believe and remember, and new characters, places and items. A short triage decides which parts of the story the turn touched, and only those are analyzed in depth. The update policy decides what applies on its own and what waits for review, where each suggestion is approved or rejected on its own. The reply can be read at once while the update runs in the background.
- Narrative State keeps only records that last. Every fact, piece of knowledge, belief and memory the AI writes declares its kind, and momentary detail such as where someone stands or what they are doing right now stays in the scene instead of becoming a record. A relationship moves only when the turn names a cause for it, courtesy and small talk never move it, one event moves a relationship once, and each move is one bounded step. Ordinary world lore applies automatically, while secrets, identities, beliefs and ruptures wait for review.
- **Characters know only what reached them**: each character present keeps what they perceived, what they were told and their stance, and leaves and returns with it. Before each reply the narrator writes a private scene plan, which never reaches the reply and shows under the message diagnostics.
- A scene change applies whole or not at all, so characters are never moved into a room the player has just left.
- Who is in the conversation follows the story: someone heard speaking joins it, and a participant who neither speaks nor is involved for two turns in a row steps back to nearby. Someone leaving the place is read from what the narration says.
- Payments, purchases, sales, trades, tips and loans move coins and items between inventories. The triage judges each turn by meaning, so these, a completed move and who is in the conversation work in any language the story is written in.
- A time skip moves the clock by the span the turn states, once Kallamo finds that span in the turn's own words. An estimated skip is capped at a week, and a completed move costs at least the minimum time for that kind of trip. The panel says what a skip did, or why it was limited or raised.
- A new character or creature with an established name can be added to Worldbuild automatically. Anonymous people, places and items are proposed for review.
- **Narrative State Activity** lists recent changes and the updates that were interrupted or failed, which can be run again. Tidy previews repeated statements, momentary scene detail and records that only hold an identifier, and retires them. Retired records stay in the history.
- Settings has Show Narrative State Diagnostics, with the triage, the deep analysis, proposals, retries, timing and token use of each turn, and Show Retrieval & Context Diagnostics, with the exact narrative context sent with each reply.

#### Perspective and Knowledge
- **Perspective-aware context**: the roleplay context is built from what the focal character can know. Facts, a character's knowledge, beliefs and memories, and relationships are chosen by perspective and relevance inside the retrieval budget, so a secret stays out of the scene until someone in it learns it. Agentic retrieval can look up what a character knows in the same way.
- **Canonical Facts**: objective truths of the world, kept apart from what any character knows or believes. Facts can be searched, filtered by source and retracted.
- **Knowledge tab**: characters, creatures and factions hold Knowledge cards about the subjects they know. Access sets what they know about a subject: that it exists, which of its fields, and which of its connections. Statements hold knowledge and beliefs in the subject's own words, each with its kind and how it was learned, observed or reported, and who told them. Memories record experiences, the story day they happened on and whether they can still be recalled.
- A faction shares its Knowledge cards with its members, with everyone or everyone except the members you pick. What a member learns alone never becomes the faction's knowledge.
- **Local knowledge**: characters and individual creatures can be Local to a Region or Area and read the Knowledge it holds in play, as members read a faction's. A Region or Area knows the places inside it and has its own Knowledge tab.
- Knowledge covers structural connections too, such as who leads a faction or who owns an item, and each one reads as its own kind of connection.

#### Worldbuild
- **Spoilers**: an eye beside every field, list row, alias, skill, custom field and Knowledge statement hides it from whoever reads the sheet until they click it, and text written between || and || hides part of any written text. The AI still reads everything, Update entities keeps hidden text hidden, and exported packages carry what is hidden.
- **Texts inside the story**: a Writing Desk chapter can be marked as written inside an item, such as a journal, a letter or a notice, with an optional author. An item's sheet lists its pages in reading order, adds new ones and opens them in the Writing Desk. The AI reads them only when the item is named and within reach of the scene, as what the author claims rather than as fact, and they stay out of story search, Update entities and background chapters.
- **Rules page**: Resources, Progression, Skills and Time costs live on their own page in Worldbuild. Exports carry the rules, optionally with each character's current values, and an import asks what to do when they differ.
- **Portraits and scene backgrounds**: characters can have portraits and places framed scene backgrounds, both carried in exported packages.
- **World Calendar**: a workspace can define its own calendar, with months, hours per day, leap years, eras that count forward or backward, seasons and a timeline origin. Worldbuild dates and roleplay time follow it, and changing a rule that no longer fits saved dates asks how to handle them before anything changes. Every world date is written with the same date control.
- **Event occurrences**: an Event can record each time it happened, with its date, location, participants, faction audience, the memories participants keep and its lasting consequences on state, inventories and relationships. Occurrences can be edited and removed, and the records they created follow them.
- **Templates**: each entity type has a template. Its Data sections can be renamed, reordered, hidden or added, and custom fields can be short or long text, a number range, a single or multiple choice, or one or more entity references. Each field can be required, sets whether the AI can read it, read and propose edits, or not see it, and sits alongside the built-in fields on every sheet.
- **Relationships**: a character's relationships have a value, a title and a description written from that character's side, and the other side's view is shown as an Incoming perspective. A review shows the current bond beside the suggested change.
- **Inventory**: characters and creatures carry items with a quantity, a condition and notes.
- **Factions** have command and territory, a roster, former members and relations with other factions, with a stance from -100 to 100. Membership keeps when someone joined or left, since when they lead and whether they founded it, and retrieval reads it. Individual creatures can join factions.
- Creatures can be a specific being or a group or species, each with its own entry in Create and its own sections. A specific being has a Species, suggested by Update entities when the text says it, and a species sets starting values and attribute bonuses for its members and lists them, like a race.
- Character sheets show their roleplay state, with pending changes to approve, and say why someone progresses.
- Locations have a Size: Region, Area, Place or Spot. Sizes follow how a place relates to a scene, not a genre, so a kingdom, a space station and a classroom all fit. The Type field keeps its free wording, and a location with no size works as before.
- The location tree, pickers and sheets show each size with its own icon. When a location sits inside a smaller one, its sheet shows a warning but does not block the choice.
- Update entities can suggest a size for a location from the kind of place your story names. The first Update entities run after this update reads every location's passages again, so it takes longer and costs more than usual.
- The scene context names where the scene is and the places around it, for example "Crow Tavern (place), within Porto Velho (area), within Norvania (region)".
- A place introduced during roleplay comes with a suggested size and a suggested parent location, both shown on the proposal. Approving it adds the location under that parent. A suggestion whose parent no longer exists adds the location without one.
- Exported packages include the Knowledge you wrote, with who knows what and how, and importing one recreates it in the new world. What the story recorded during play stays behind.
- Importing a package shows what it holds before anything is written, and lets you keep your calendar or take the package's. Dates that do not fit the new calendar move to the nearest valid day or can be cleared.

#### Retrieval, cost and safety
- **Prompt Cache**: the stable part of each prompt is kept identical between turns, so providers that reuse a repeated prefix bill less for it. Anthropic, Claude on AWS Bedrock, and Claude and Gemini through OpenRouter are asked for that caching explicitly, and OpenAI, Gemini, other OpenRouter models and local servers reuse the prefix on their own. On OpenAI and OpenRouter each workspace sends its own cache key, so its turns reach the same cache. The cache lifetime follows the pace of the conversation, and the token panel shows what the provider read from and wrote to its cache for the reply, agentic retrieval and Narrative State, each on its own. Retrieved Context Position can move retrieved context from the system prompt to the turn, which lets the history be cached as well.
- Retrieval settings have a Worldbuild Entity Limit, the number of entities that reach the context as complete dossiers, a Worldbuild Breadth, how far connections are followed to find them, and a Workspace Documents Top-K.
- With token or RAG diagnostics on, Writing Desk suggestions, analyses and AI notes show what each request cost, call by call, and what retrieval sent.
- Before an update changes your data, Kallamo saves a verified copy of it. It keeps the last three copies, plus the one taken when you moved to a new version line, so a run of updates cannot remove your only copy of the data from the previous version. If the copy cannot be saved, the update does not touch your data, and when the disk is full Kallamo says how much space to free.
- If an update cannot bring your data up to date, Kallamo puts the data back exactly as it was before the update and says so, instead of opening with half-updated data.
- Settings > Advanced lists these copies under Update Safety Copies and has a Show Folder button. Restore Backup opens in that folder, so going back to a copy takes a few clicks.

### Changed
- **A new interface**: Kallamo is redesigned from end to end, with one scale for depth, corner radius, motion and text, one set of icons with one icon per idea, and sentence-case labels. Panels rely on borders instead of stacked shadows, and a workspace without a background image gets its own tones.
- **Chat**: replies show the profile that spoke, actions sit under each bubble, and diagnostics open as a structured report from the reply header. The composer has a context meter, a payload warning and a reply picker, and Settings moved to the title bar.
- **Memory**: memory is grouped by how the AI reads it, always on, searchable and history, with sections that remember whether they are open, a menu on each row, new note and passage editors, and a summary log that splits roleplay archives into scenes with the character played. Archives keep each speaker's name, colour and time.
- **Writing Desk**: chapters have one menu per row and can be dragged to the top level, folders show how many chapters they hold, and each row shows when the AI is working, a suggestion is ready or the AI's memory is updating. The chapter header gathers the folder, title, find, page setup, export, and Notes, Analyses and Directives with their counts. The toolbar groups text style, font, size and spacing into menus. Replace and Insert results show the profile and the words added and removed, and Analyze results open in their own Analyses history beside the text. While the AI works, the editor grays out until the result returns.
- **Worldbuild**: sheets have a header tinted by type, framed fact grids and one style of section header, and Create opens the whole Data tab of the type. The sidebar shows how many of each type exist, each character's life status, a World row with Calendar, Facts, Rules and Entity types, and an aligned location tree. Worldbuild starts on the world overview and keeps its search, filters and scroll position while you switch tabs. Update entities runs in the background with progress, Stop and a list of failures to retry.
- **Configuration**: sections have their own navigation, profiles and workflows switch on and off with Edit in place, and Narrative State puts problems first and groups pending changes with Approve and Reject.
- **Settings, Workspaces and the Library**: Settings is a full-screen page, the Library is a list with details beside it, and Workspaces has new cards with the latest story as a banner. Small dialogs share one frame, and exports show what goes in the file and what stays out.
- In a roleplay, regenerating, editing or switching to another reply first undoes the story state of the reply it replaces, so the new reply is written from the state before it. Narrative State analyzes the reply you keep once, when the story continues or when you choose Update now, instead of once for every alternative you try. A replacement interrupted by closing the app is undone on the next start.
- Reverting the chat, deleting a message or replacing a reply also removes what those turns wrote to the story: records, proposals, scene changes and inventory moves. What earlier removed turns left behind is cleaned up once on startup.
- Narrative State reads the full perspective only of the characters present, and for characters only mentioned, just what touches the turn, and only the items within reach, so each update is smaller. Its stable part comes first, so a provider can cache it between turns.
- In a roleplay, agentic retrieval researches only what lies outside the scene. A message that stays among the people and the place already in the context uses the ordinary search, the planner is told which sheets the scene already carries, and a research turn that adds nothing ends the research.
- The writer gets each lookup's three best passages, a one-line mention for entities only named in passing, and known relationships once and only when they touch the turn. Every provider receives the expected reply shape in its own form, with a retry without it when a provider refuses it.
- Update entities reads the passage before a section of a list-shaped document, sends only the skills that matter to the entity, and cannot replace a written text with a much shorter one.
- Tagging sends up to twelve passages per request, about half as many requests on long documents.
- Deleting an entity also retires the Narrative State records about it and removes its Knowledge cards and scene entries, and the confirmation says how many. Merging two entities moves their story records, Knowledge and roleplay state to the one that remains, and an update already under way when the merge happens writes to it as well.
- Opening Kallamo while it is already running brings the open window to the front instead of starting a second copy of the app.
- Opening a workspace no longer moves the conversation after it appears. The roleplay layout and each reply's place and time are read before the chat is shown, and the view stays on the latest message while a reply streams, frames load or images arrive.
- Switching between the workspace areas is faster. The chat stays open behind Writing, Worldbuild, Memory and Files and comes back where you were reading, Worldbuild shows its last list at once while it refreshes, and each area loads in the background before you open it.
- Long conversations stay responsive. A streamed reply, a toast or an indexing update redraws only what changed, a new reply no longer re-reads the whole history, and older messages far from view are drawn only when you scroll to them.
- Kallamo starts faster: code highlighting includes the common languages instead of every language, and screens load when they are first needed.
- Turning Blur off in Settings removes every blur effect. Chat bubbles blur only over a background image, where the effect is visible.
- In a world with sizes, a scene can move anywhere inside the region around it, however deep the scene's location is nested. Worlds without sizes keep the previous rule.
- The minimum time a move between two locations costs uses their sizes. A move within one place is Micro, a walk within one area is Local, crossing into another area is Transit, and a trip between areas of a region is Macro. Moves the map cannot place are still Transit.
- Pickers that ask where something is, such as a scene's location or a unique item's location, list places and spots first. The picker for a location's parent lists the largest locations first. A Spot is a room or enclosed space inside a place.
- Update entities tells its failures apart. A reply cut off before it produced anything, such as a reasoning model that spent its output on thinking, is retried with less evidence and more room, and only a malformed reply goes to the repair pass.
- Button labels stay on one line, and a dialog whose buttons do not fit side by side stacks them.

### Fixed
- Claude Opus 4.7 and later, Sonnet 5 and Fable no longer fail with an error about temperature. Kallamo sends a temperature only to the Claude models that accept one, on Anthropic and on AWS Bedrock.
- Narrative State, the Tagger, Update entities and the RAG Query Simulator stay within the workspace's MAX API Payload, like the chat. An oversized request used to reach the provider and be billed.
- Deleting a workspace, chapter or profile removes everything it owned, and a failed delete shows an error. Leftovers from earlier deletes are cleaned up once on startup.
- Deleting a connection clears it from every AI profile and AI role that used it, instead of leaving them pointing at a connection that no longer exists. Links left by earlier deletions are cleared on startup.
- Renaming a choice option of a custom field keeps every value already stored with it.
- Switching to another reply no longer loses it when saving the switch fails. The new reply is saved before the old one is removed.
- Accepting every Update entities suggestion at once no longer fails on an entity that still carries chapter suggestions from an earlier version.
- An import whose links the world rejects skips those links instead of failing, and a failed import leaves the calendar untouched.
- Letting go of the mouse while framing a portrait or scene background no longer closes the window with an error.
- Choosing a new workspace background and then cancelling keeps the old image.
- Menus and popovers near the edge of the window stay fully visible.
- Number fields can be cleared and typed again.
- The Plan every message and Native tool calling switches are disabled when the Retrieval Planner is off.
- The workspace menu on the dashboard stays open when clicked.
- Row actions that appear on hover also appear when the row has keyboard focus.
- A database whose updates ran before its base tables existed is repaired on startup.
- The context meter, automatic summaries and Summarize no longer count a reply's reasoning, which is shown but never sent back to the model.
- A deleted or merged entity no longer reaches the AI as a bare identifier, and records left behind by earlier deletes are cleaned up once on startup.

## [1.1.7] - 2026-09-14

### Added
- API connections accept an optional Model Context Window. Every request through that connection stays below it as well as below the workspace's MAX API Payload, which protects local servers that silently cut the start of an oversized prompt.
- Agentic retrieval uses the provider's own tool calling when the connection and model support it: OpenAI and compatible servers, OpenRouter, Anthropic, Google AI, Vertex AI and Claude on AWS Bedrock. Everywhere else it uses the text protocol. A native request that fails moves that connection and model to the text protocol until Kallamo restarts, and so does a second first reply that calls no tool. The Retrieval Planner settings have a Native tool calling switch.
- Agentic retrieval starts from a free search. The passages the ordinary search finds for the message are in the context before the planner is asked anything, and the strongest of them are shown to the planner in full, so research can no longer end with an empty context and can finish on the first turn when they already answer.
- A short message that names no known entity and asks no question skips the retrieval planner and uses the ordinary search alone, so replies like "continue" or "ok" no longer pay for a planning call. The Retrieval Planner settings have a Plan every message switch.
- The Agentic RAG panel shows the trajectory: which path the message took and why, what the free search found, and for each turn the queries, how many results each returned, what it added, what it cost in tokens and what the provider reports about input and cached tokens. It also shows how much of the research was packed out of the budget, and the planner's window with the measured token ratio when that ratio reduced it.
- The retrieval planner's conversation is sent as real turns that only grow, so a provider that reuses a repeated prompt prefix can reuse every earlier research turn. On Anthropic's own endpoint and for Claude on AWS Bedrock, Kallamo asks for that caching explicitly.
- Entity names and aliases written in a passage are tagged directly, without calling the Tagger, in any language and script. New passages are tagged this way as they are stored, existing passages once when Kallamo starts, and creating, renaming, merging or importing entities tags the passages that already name them.
- Worldbuild has a Needs review filter for entities whose names look like common words, numbers, pieces of a longer name or duplicates. Each one can be merged, deleted or kept as is.
- A reply that stopped at the output limit says so under the message, and so does a reply whose retrieval stopped early after an error.

### Changed
- Payload limits follow what each model really counts. Kallamo estimates tokens with one fixed tokenizer, which can fall well short of a model's own count and, on a small context window, send a request the model cuts or refuses. The input count a provider reports after a chat reply or a research turn teaches how much more that connection and model count, and the MAX API Payload and the connection's context window are reduced by that ratio for history, retrieval and the final check alike. A model that has not reported its usage is not corrected, and what was learned survives a restart. The payload error says when a limit was corrected and by how much.
- Retrieved context has a budget. Knowledge base results, archived memory and agentic research are ranked and packed into the room left after the profile, constant knowledge and the response reserve. Recent history is measured first and retrieval always keeps at least 40% of that room, so a long conversation with many summaries no longer outgrows the workspace's MAX API Payload.
- Retrieval asks for more passages when the budget holds them, up to twenty per search and never fewer than the configured Top-K, in the ordinary search and in the planner's searches alike.
- Archived memory arrives with its neighboring passages from the same scene, joined in reading order, so an answer split across two passages is no longer lost.
- A passage that carries an entity named in the message is ranked by how rare that name is in the workspace. A name written across much of the archive counts for little, and the lower similarity bar it earns follows the same measure.
- Entity names in a message are recognized by the same matcher the Tagger uses on passages, so names in scripts written without spaces are recognized, and a name typed in lower case still counts.
- Keyword search only searches the workspace being queried, and also matches the beginning of a long word, so other forms of the same word are found in any language and without a word list.
- An entity lookup reaches the chat archive, the workspace files and the workspace documents, and returns the passages most relevant to the message, at most 12, instead of every passage tagged with the entity.
- The retrieval planner is measured against its own connection's context window instead of the writing profile's. A small planner gets a shorter history, at most 6,000 tokens, a shorter entity list, a bounded preview of the free search and a smaller reply reserve. Earlier research turns are summarized only when that window requires it, and when a further turn cannot fit, the research stops with what it has instead of failing.
- A query the planner already ran is refused instead of executed again, and the planner is shown what it already asked and what each query returned. Across messages, a query that found nothing is remembered for twenty minutes per workspace, and indexing or deleting passages clears that memory.
- The retrieval planner is asked for whole questions instead of keywords, is told which turn it is on and when it is the last one, is told that an empty result is not an answer until a second angle also comes back empty, and is instructed to state only facts that appear in its results.
- The planner reads the first five results of a call in full and the rest as snippets it can expand, while all of them reach the writing assistant. Workspace files are ranked with the same entity boost the archive gets.
- Worldbuild facts and passages the planner did not cite are ranked lower instead of being discarded.
- The list of known entities shown to the planner is ordered by the names written in the message, then the ones in play in recent turns. A large world used to be cut alphabetically, which hid whole types of entity.
- Linked lore is searched for the user's own request with the configured strictness and Top-K, and is no longer cut to five thousand characters on its way to the writing assistant.
- A single file or linked lore read during agentic retrieval takes at most 60% of the retrieval budget.
- The Tagger handles only what names cannot settle: titles, nicknames, other grammatical forms of a name, roles tied to one entity, and new entities. Archiving, re-tagging, World Index backfill and Writing Desk chapters share one Tagger with the same prompt, batch size and output limit.
- A long Lore is extended with new paragraphs instead of being rewritten whole.
- Long search queries are embedded in windows, so text past the model's input limit still counts.
- Very long paragraphs are split at sentence boundaries when indexed, instead of becoming one oversized passage.
- Archive recaps of very long histories are written in parts and then combined, so they fit the Summarizer's limit.
- The safety margin kept under the payload limit scales with the limit.
- Retrieved text and agentic research are stored with a message only while the matching diagnostics option is on.
- An entity name resolves regardless of accents and typographic quotes when only one entity matches it, and categories named in any script are recognized.
- Search reuses parsed vectors between messages, and the Writing Desk embeds distant chapter text in one batch.

### Fixed
- Agentic retrieval no longer returns an empty context when the planner writes its tool calls and its conclusion in the same reply. The calls run, and the conclusion waits for a turn that has actually seen the results.
- Agentic retrieval no longer sends an empty context when the research cites characters by name. Archive passages were discarded unless the planner listed them under their generic source name.
- A reasoning model's thinking is no longer read as tool calls. A search or a conclusion the model only considered while thinking used to run.
- A tool call written with a closing tag no longer hides the calls written before it.
- Provider errors, safety blocks and refusals are reported as errors instead of being saved as the AI's reply.
- An error in the middle of a streamed reply ends it with an error instead of saving the partial text as complete.
- An empty reply is reported as an error instead of being saved as a blank message.
- Regenerate and Edit keep the previous reply until the new one has been saved.
- A request over the payload limit explains how much came from instructions, retrieved context and history, and no longer offers a Retry that would fail the same way.
- GPT-5 and o-series requests no longer send a temperature, which those models reject, and reasoning models get extra output room for their thinking.
- Gemini replies split into several parts are read in full.
- Reasoning is kept out of the history, the archives and the input passed between workflow steps.
- The Writing Desk sizes the chapter window after instructions and notes, so medium chapters no longer fail with a context window error, and the chat history it reads is limited to the reading size.
- Writing Desk analysis has an output floor of 1,024 tokens, retries once when cut off, and marks a note that is still incomplete.
- Constant knowledge and full file reads no longer lose the opening paragraph of a file, and its passages are rejoined in their original order without repeated overlap.
- A Tagger reply cut off at the output limit no longer marks its passages as done with no tags. The batch is retried in halves, and passages that still fail are shown as failed.
- The Tagger no longer proposes common words, numbers or pieces of existing names as new entities.
- The tagged and untagged passage counts in Memory match the tags passages actually carry.
- Re-tagging a Writing Desk chapter keeps the tags added by hand.
- A Lore update that is cut off or unreadable appears in the failures panel instead of being dropped silently.
- The history marker in the chat header uses the number of messages the last reply actually left out.
- Workspace variables containing `$` patterns are inserted literally.
- Opening a long chat is faster. Messages load without their diagnostics, and oversized diagnostics already stored are trimmed once on startup.

## [1.1.6] - 2026-08-23

### Added
- Archive window now supports three outcomes per message: archive it into the summary, keep it in the active conversation, or drop it from context entirely without deleting it from the log.
- Dropped messages can be toggled from any message menu and are marked in the chat.
- Context & Memory shows how the history is split between archived, active, and dropped.
- Each summary can be rebuilt on its own, returning only its messages to the conversation and leaving the other summaries untouched.
- Rebuild everything deletes every summary and brings the whole conversation back, including messages dropped by deleting a summary.
- Rebuilding and deleting a summary now explain what will happen before they run.
- A marker appears in the chat header when live history no longer fits the payload budget and the oldest messages are being cut. Clicking it opens archiving, and it stays for as long as the history overflows.
- The archive window can also offer the most recent messages, for when they belong to the chapter being closed.

### Changed
- Deleting a summary now drops the messages it covered instead of returning them to the conversation. Rebuild is the action that hands them back, and Rebuild everything recovers them once dropped.
- Live history is now derived from the messages each summary covers rather than a single position marker, so gaps in the middle of a history are valid and repair themselves.
- The archive window holds back the last 5 messages instead of the last 10. Long roleplay replies made the wider reserve pin far more of the payload than it protected.
- Archived history that mentions an entity named in the message now clears a lower similarity bar, so a character who appears in only a few lines of a long scene can still be recalled.
- Chat Memory Top-K now defaults to 8 instead of 5. Five snippets per message proved too narrow for long roleplay histories.
- A chat now reopens on the AI Profile or Workflow it was last used with, rather than the first active one on the list.
- The Writing Desk now reads the same live history the chat does, so an invocation no longer receives passages the workspace has already archived or dropped.

### Fixed
- Archive recaps are no longer written as a continuation of the story. The summarizer receives the transcript as a record to describe, and a reply that turns into prose is discarded instead of stored.
- Archive recaps render their formatting instead of showing raw markup, and an archive with no usable recap says so.
- Deleting a summary no longer leaves a workspace unable to archive again.
- Archiving a non-contiguous selection no longer stores messages in a summary while they stay in the active context, which silently doubled their cost.
- The archive window no longer offers messages that a summary already covers.
- Deleting a summary now removes its vectorized chunks, index entries, and tags instead of leaving them behind, and existing orphans are cleaned up on startup.
- Deleting a message or reverting a chat no longer leaves the archive marker pointing at the wrong position.
- Summary cards now show how many tokens of history they hold instead of the length of the recap text, matching how uploaded files are measured.
- Reasoning models no longer break structured AI tasks. Their thinking is kept out of replies that are parsed as JSON, where it could make an otherwise valid response unreadable.
- Update Entities no longer fails on providers that reject open-ended response schemas. The schema is now built from the fields and relations each entity actually accepts, instead of leaving those sections unconstrained.
- Update Entities now reports why an update failed, separating an exhausted output budget from a genuinely malformed response, and records the raw reply so the cause can be confirmed.
- Update Entities now retries with a doubled output allowance when the first attempt ran out of room, instead of a small increase that rarely helped.
- A failed entity tagging pass during archiving is now reported instead of leaving the history stored without tags and harder to recall from.
- The archive window now closes as soon as your history is stored. The recap and the entity tags are produced afterwards, and the summary shows its own progress in Context & Memory while that happens.
- A summary's recap and its entity tags are now tracked separately, so a tagging failure no longer discards or hides a recap that was written, and Finish only redoes the part that is missing.
- Context & Memory shows a live tagging position for a summary that is still finishing, instead of a single unchanging line.
- Entity tagging now accepts the category name the AI actually writes, such as "Character" for a workspace category named "Characters". A label written in the singular no longer voids every mention in the batch. Categories that do not exist in the workspace are still rejected.
- Entity tagging now sizes every call the same way across the app, budgeting by passage length instead of a fixed count, so a batch cannot grow large enough to push the AI's answer past its output limit.
- When no mention in a batch can be used, the error now names the actual reason and gives an example, instead of reporting category and evidence problems as one indistinguishable failure.
- A summary that is missing tags now says how many passages are still untagged, so repeated attempts show progress instead of one unchanging warning.
- Entity tagging no longer discards a whole batch of mentions because the AI retyped a quote instead of copying it. Evidence is now matched past differences that carry no meaning, such as a plain hyphen for a dash, straight quotes for curly ones, or missing accents, and several excerpts are checked individually instead of being joined into one. Invented evidence is still rejected.
- A failed tagging pass no longer reports the same error in two separate notifications.
- A summary interrupted by closing the app is marked as unfinished and offers a Finish action, instead of leaving stored history with no recap or tags and no way to complete it.
- Entity tagging now runs several groups at once and waits out a provider rate limit instead of losing that group.
- New summaries are numbered by how many summaries exist, not how many memory blocks. A workspace with custom memory no longer names its first summary "Summarization 2".
- Archiving a long history is substantially faster. Passages are now embedded in batches instead of one at a time, and entity tagging works in bounded groups rather than sending the whole archive in a single request.
- Entity tagging no longer loses a whole archive to one failed group: whatever was tagged is kept, and the failure is reported.
- The archive window now shows which stage is running, so a long archive reads as work in progress instead of a frozen window.
- Editing a message in a long conversation no longer lags while typing.
- Kallamo now remembers window size and position between launches instead of always starting maximized.
- The workspace menu on the dashboard is in English.
- A character's Appearance and Personality are now shown and editable on the character sheet. Update Entities could already propose both fields and stored them when accepted, but the sheet had no section for them, so an accepted change looked like it had been lost. Existing values reappear on their own.
- Appearance and personality now reach the AI during retrieval, for characters and for individual creatures. A character's dossier previously carried only status and age, so the physical and behavioural description written into the sheet never left it. A creature's sheet already showed both fields, but they did not travel either.
- An event's Kind now reaches the AI during retrieval as well, for the same reason.
- A creature recorded as a group or species no longer offers Personality, and Update Entities no longer proposes one for it. A temperament belongs to one being, not to every member of a kind. Appearance stays, and now asks for the look the members share.

## [1.1.5] - 2026-08-10

### Fixed
- Chat submissions now preserve the selected AI Profile or Workflow and pending attachments, fixing a regression that stopped valid local API requests before they reached the provider.
- Local and OpenAI-compatible connections now resolve base URLs and full endpoints consistently, require an explicit URL for Local providers, omit empty authorization headers, and preserve plain-text HTTP error details.
- Edit & Regenerate now sends the edited conversation without replaced user text or discarded AI replies, and keeps the previous AI response intact if regeneration fails.
- Generation error dialogs now offer Retry and Skip only while the failed provider call is actually resumable.
- Empty or legacy zero MAX API Payload values now restore the workspace default of 128000 tokens instead of being reduced to the minimum limit.

## [1.1.4] - 2026-08-01

### Added
- **Configurable internal AI roles**: Engine & Memory can assign dedicated executors for background tasks such as retrieval planning, summarization, and World Index tagging.
- **System AI output language**: choose the language used by background AI tasks from an expanded language list.
- **Max API Payload protection**: each workspace now has a validated payload ceiling. Kallamo reserves response space, trims chat history first, and stops oversized fixed context before contacting the provider.
- **Durable Update Entities runs**: entity update runs, jobs, evidence state, retries, and estimated token usage are tracked so deferred evidence remains eligible and changed evidence can be processed again.

### Changed
- Direct generation now requires the selected AI Profile or Workflow to be active in the current workspace. Workflow-owned profiles remain available to their workflow without becoming direct targets.
- Standard and Agentic retrieval now apply the executed profile's file and Memory Scope consistently, including full-file reads and entity-based memory lookup.
- Structured AI tasks use provider-compatible JSON controls where supported, with shared schema handling for World Index tagging and Update Entities.
- World Index tagging now uses bounded batches, tolerant JSON parsing, one repair attempt, deterministic rejection of generic Proposed Entities, and a valid distinction between empty results and failed output. Tagging failures remain visible without discarding completed embeddings.
- Update Entities now prioritizes bounded evidence, covers empty writable fields, rejects relative numeric deltas, recovers common JSON errors, stops repeated malformed runs with a circuit breaker, and keeps Lore in a separate cumulative response protected against destructive compression.
- Update Entities review now uses readable native field labels and supports bulk rejection or reprocessing. Rejecting a review removes only staged suggestions and leaves canonical data unchanged.
- Items now distinguish reusable Item Types from Unique Items. Availability lists apply to Item Types, while ownership and one current location apply to Unique Items.

### Fixed
- Progress, streaming, errors, overflow decisions, cancellation, and late completions are scoped to the correct workspace and generation.
- Provider responses that stop because of an output limit are reported as truncated instead of being treated as complete.
- Dismissing an automatic Archive Chat Memory prompt now suppresses repeated prompts until summarization is opened manually.
- Finishing a streamed response no longer jumps readers to the end after they have scrolled away from the latest message.
- Edit & Regenerate now sends the post-edit conversation to the provider without including the replaced user text or discarded AI replies.
- Clicking the Writing Desk paper margin no longer moves the cursor to the end, Find & Replace centers the active result, text selection keeps a natural I-beam cursor, and the AI Profile picker is searchable.
- Popovers, tooltips, color controls, and anchored menus stay within the viewport more reliably.
- Location descriptions and creature appearance or personality fields are visible and editable, matching the fields Update Entities can review.

## [1.1.3] - 2026-07-17

### Added
- **Fast Tag for Searchable Files**: the File Chunks Viewer now gives you a file-wide tag overview, lets you add a keyword or Worldbuild entity to every chunk at once, and lets you remove a tag across the file. Removing an automatic entity tag creates a persistent suppression, so a later World Index re-tag respects that editorial decision.
- **Selective World Index tagging**: Custom Memory and Searchable Memory now offer **Tag selected blocks**. Choose individual Custom Memory blocks or whole Searchable Files, and World Index tags every chunk inside only those selections.
- **Chat archive summary control**: Engine & Memory now includes a switch for generated chat archive summaries. Turn it off to keep archived conversations as raw local vectors only.
- **Worldbuild bulk management**: Manage mode lets you select visible entities or groups by AI policy, change their Open, Review, or Locked policy together, accept proposed entities and AI updates in bulk, or delete a reviewed selection with a clear confirmation summary.
- **Worldbuild review filters**: Proposed Entities and AI Updates receive dedicated filters whenever either group needs attention.
- **Entity update failure review**: Update Entities now groups unresolved failures in one compact panel, with per-entity details, individual dismissal, and a dismiss-all control that links to System AI settings.

### Changed
- Searchable Memory token totals are now informational rather than an urgency signal. Only Always-on memory uses amber and red context-budget warnings, because it is the only memory sent in full with every invocation.
- The Memory Tab's World Index is now presented as a tagging process, not text indexing. It reports pending, active, completed, empty, and failed tagging coverage per memory tier. Failed runs show a concise retry count for the current workspace session, while correctly examined chunks are not processed again when they contain no matching entity.
- The File Chunks Viewer and Fast Tag controls now use a larger, responsive type scale for more legible desktop reading.
- Streaming now follows the reply only while you are already at the end of the chat. Scroll up to read earlier messages without interruption, then use the new control to return to the latest response.
- Generated chat archive titles, summaries, and World Index tags now run only through the configured System AI. Kallamo never falls back to an active writing profile for this background work.
- Custom Memory is no longer tagged automatically when saved. Use the manual World Index actions when you want to tag it.
- Proposed Entities now require direct supporting evidence, avoid names and aliases already represented in Worldbuild, and show the source excerpt that justified each proposal.
- Update Entities now uses existing values as canon instead of limiting suggestions to empty fields. Every proposed replacement or relationship includes its supporting evidence, remains reviewable beside the current value, and is restricted to fields valid for that entity type.
- Entity evidence retrieval now prioritizes explicitly tagged Writing Desk and Memory chunks, then uses canonical names and aliases as a bounded fallback. This keeps relevant matches first without sending every mention to the System AI.
- System / Concept entities now support aliases and receive Concept-specific updates instead of generic Lore suggestions.

### Fixed
- Memory Scope menus now open reliably, so Custom Memory and Searchable Memory can be assigned to specific AI Profiles again.
- World Index entity tags now appear in the Searchable Memory chunk viewer, including tags generated before the fix.
- Chat archiving and context usage now read the complete persisted conversation instead of the 50-message viewport. Existing summaries created during the affected period are repaired on startup so unarchived messages return to active context.
- Context & Memory now shows the number of active user and AI messages beside the token total, making the archive threshold easier to interpret.
- Update Entities no longer skips System / Concept entities or stages nonexistent Lore fields for them.
- Invalid structured entity updates now receive an automatic correction attempt and surface an actionable failure when the provider still returns an unusable response.
- Ordinary Writing Desk mentions no longer become linked lore documents. Lore linking is reserved for documents intentionally dedicated to an entity.

## [1.1.2] - 2026-07-12

A quality-of-life update for long conversations, continuous writing, and navigating a growing world.

### Added
- End-to-end SSE response streaming for final workflow output, with buffered renderer delivery and a global `advanced.streaming` setting. AWS Bedrock remains on the non-streaming fallback path.
- A cursor-paginated, 50-message chat viewport with incremental and full-history navigation controls.
- Workspace-scoped Writing Desk navigation state, persisted through `workspace_ui_state` for expanded folders and the last open document.
- Location hierarchy navigation derived from the existing `Inside` relation, while locations without a parent remain at the root.
- Separate Global and Patch What's New flows, with independent persisted first-run and version-seen state.

### Changed
- Markdown now recognizes headings from `#` through `######`.
- Chat input composition state is isolated from the visible message thread, avoiding message re-renders and Markdown reparsing while typing.
- Removed per-message truncation so long narrative responses render in full.

### Fixed
- Returning to Chat from another workspace view now restores the message container to its latest position before paint.

## [1.1.1] - 2026-07-08

A hotfix that clears four issues surfaced by the community after 1.1.0.

### Fixed
- Newer OpenAI models now work. The GPT-5 series and the reasoning models (o1, o3, o4) reject the older token-limit parameter, so Kallamo now sends the one they expect and no longer errors out when you pick one of them. The Manual JSON override can also remove a parameter entirely by setting it to null.
- Custom Base URL connections no longer return a "Not Found" error. If you point Kallamo at an OpenAI-compatible provider and enter the base address, it now resolves the full endpoint for both chat and embeddings, so providers like NanoGPT work out of the box.
- Entity tagging no longer fails silently. When a System AI is configured and a tagging pass fails, you now get a clear notification with a shortcut to your System AI settings, instead of being left to assume your text was tagged when it was not. Your text is still indexed either way.
- Changing an AI Profile's model now saves reliably. Switching the model in the dropdown and pressing Save no longer keeps the old value.

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
