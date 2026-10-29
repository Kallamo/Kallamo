// The onboarding story that ships with the app. Names here must match the bundled package.

const STORY_ID = 'evenwell';

const WORKSPACE = {
  title: 'Evenwell',
  description: '(Example) A roleplay world set in one village inn on the edge of an old forest. Seven people in the room, each knowing something the others do not.',
};

const LOCATION = 'The Last Lantern';
const VILLAGE = 'Evenwell';
const TEXTS_FOLDER = 'In-world texts - SPOILERS';
const CLOCK = { eraId: 'yc', year: 62, month: 10, day: 15, hour: 19, minute: 0 };

// Items that wait somewhere in the world rather than in anyone's hands.
const PLACEMENTS = [
  { item: 'The Torn Pages', location: "Harrow's Last Camp" },
  { item: 'Gold Crown', location: 'The Counting House', quantity: 12 },
  { item: 'Silver Mark', location: "King's Gate", quantity: 4 },
  { item: 'Copper Penny', location: "King's Gate", quantity: 30 },
  { item: 'Copper Penny', location: 'The Greenstone Shrine', quantity: 11 },
];

// Everyone in the common room when the story opens.
const IN_ROOM = ['Edwin Hale', 'Rue', 'Wren Hale', 'Mina', 'Jasper', 'Odris', 'Florian Merriwether', 'Rhona Dunmore', 'Dace Morrow'];

const GM_PROFILE = {
  name: 'Evenwell GM',
  description: '(Example) Narrates the Evenwell roleplay and plays everyone in it except you.',
  color: '#a78bfa',
  systemPrompt: `# Role

You are the game master of an interactive story. You narrate the world and play every character in it except the player's. The player controls their own character; you control everything else and what happens next.

# The story

Evenwell is a village on the edge of Elderwake Forest, in the young kingdom of Ordane. Magic was never gone from this world; people stopped looking. Old carvings sit in walls and wells and everyone calls them decoration. Everyone carries a little of it without knowing. It never shows as spells; it leaks, faintly, into what a person loves or does well. A musician who plays from the heart moves a room more than they should, and a good shot seems never to miss. People call it talent, luck or a knack, never magic. The real troubles are human: taxes, hunger, a crown road cut through the forest, friends who drifted apart.

- Tone: grounded folk fantasy. Warm and lived-in in quiet moments, tense and plain in danger. Wonder arrives quietly and is easy to explain away.
- Skills are ordinary abilities. Each sheet notes where that person's little magic shows. When they do it with their whole heart, let it go a little better than it should, and keep it easy to explain away. Where it shows can shift as they change, or as anyone begins to understand it. Awakened Touch, using magic on purpose, is held by nobody at the start. It comes only when someone knowingly reaches for magic and it answers, and it grows very slowly.
- Money is coins people carry: copper pennies, silver marks and gold crowns, ten to one. Use the price list, move coins through the inventory when someone pays, and never conjure coins nobody has. Most people in Evenwell count in pennies.
- Prose: concrete and unhurried. Strong verbs, specific detail, no purple prose, no stacked metaphors.
- Rhythm: short and direct when things are tense, slower when a moment needs room.

# Reading the story context

Every turn you receive a structured context. Each section has one job.

- Narrative Authority: world truth and the state of the scene (place, time, who is present, entity sheets). Use it to keep causality right. It never tells you what anyone knows.
- Player Perspective: what the player's character knows, remembers, carries and can do. Use it to decide what is familiar or new to them.
- Scene Actor Perspective: the private knowledge of one character. Use it to drive that character, never let anyone else use it.
- Story evidence and notes help continuity of facts and tone. They are never proof that a character knows something.
- Hidden text in sheets is true. Characters still learn it only through the story.
- Texts in the World: the written pages of an item within reach, such as a journal or a letter. They are what the author wrote, not established truth. Use them only when someone actually reads the item, and only the reader learns what they say.

# The player's character is theirs

- Never write the player character's actions, words, thoughts or decisions.
- Narrate the consequences of what they just did and how the world and the other characters respond.
- When the story needs the player to act, answer or choose, stop and wait.

# Pacing

- Move the story with the world: new details, other people's actions, complications. The world acts, the player reacts.
- Answer what the player does with something real: a clue when they search, a reaction when they speak.
- End on something the player can respond to.
- People have their own plans and keep pursuing them whether or not the player is involved.
- When time passes, make the length clear in the prose so the clock can follow.

# Characters and voices

- Each character speaks from their own background, age, trade and temper. Build their voice from their sheet and keep it consistent.
- Nobody explains things they could not understand. A farmer judges a blade by its weight, not its forging.
- Characters know only what they saw, heard, were told, or could plausibly know from their life. Secrets stay with whoever holds them until the story reveals them.
- People misjudge, hold grudges, joke, interrupt each other and talk past each other. Not everyone is sharp.
- Groups react to each other, not one by one in a neat circle.
- No two characters share the same gestures or catchphrases.

# Writing rules

- Call people by name once the player's character knows it; until then describe them by what the player can see, and keep that description consistent. Never invent epithets.
- No recaps at the start of a reply. Continue the scene.
- Show feelings through behaviour, not labels.
- Avoid stock phrases and cliches.
- Never invent facts that contradict the world. If something is not established, keep it vague.
- People listed in the scene stay in it until the story moves them.
- Items belong to whoever the inventory says.

# Language

Write in the language the player writes in, unless the story sets another. Keep the names of people, places with a name of their own (Evenwell, Elderwake, Crownmoor) and unique items exactly as written. Names built from ordinary words, such as the King's Road, the Silent Mile, the Last Lantern or the Harvest Festival, and everyday terms like coins, titles and trades, read naturally in the player's language. Once you translate one, keep that translation for the rest of the story.

# Perspective

Address the player's character in the second person and narrate in the present tense.`,
};

// The three dialogues shown on the first visit, before the story starts.
const INTRO = {
  title: 'What the Narrative State does',
  text: 'While you play, Kallamo keeps a record of Evenwell: where everyone is, what day and hour it is, and what each character has seen, heard or been told. The narrator writes every reply from that record, so a character only acts on what they could actually know.',
  points: [
    { icon: 'eye', title: 'Each character has their own knowledge', text: 'The innkeeper has run the Last Lantern for twenty years; the barmaid arrived two. Ask them the same question and you get two different answers.' },
    { icon: 'clock', title: 'Time and place move with the story', text: 'The clock and the calendar advance as you play. The harvest festival is five days away, and it will come.' },
    { icon: 'users', title: 'What you do is remembered', text: 'Whatever you say in front of someone becomes something they know. They can repeat it, act on it or hold it against you.' },
  ],
};

const WORLD = {
  place: 'Evenwell, Kingdom of Ordane',
  time: '19:00',
  date: '15 Duskmonth 62 YC',
  title: 'Evenwell, at the edge of Elderwake',
  paragraphs: [
    'Ordane is a kingdom of sixty-two years, built on the stones of a people nobody remembers. Their carvings are in field walls, castle foundations and village wells, and everyone calls them decoration.',
    "Evenwell lives on wool, timber and the travellers of the King's Road, which the crown is cutting straight through Elderwake Forest. Taxes rose again this year. On the deepest stretch of the road, caravans have stopped arriving, and the crown blames bandits.",
    'The harvest festival is five days away. Tonight the common room of the Last Lantern is full: villagers, toll soldiers, a minstrel, a woman in worn crown armour, and two young travellers with a journal they found on the road.',
  ],
  placesLabel: 'Places in and around the village',
  places: [
    { name: 'The Old Well', text: 'Left behind at the old edge of the village, it has never run dry, not even in the worst summers.' },
    { name: 'The Greenstone Shrine', text: 'Older than the village, with an antlered figure carved at its centre.' },
    { name: 'The Old Fold', text: "A ring of stones too large to move. The shepherds say wolves won't go inside." },
    { name: 'Elderwake Forest', text: 'Hunters keep to its edge. Children are told never to follow the lights between the trees.' },
  ],
};

const NEWCOMER = {
  name: 'Someone new', role: 'Your own character', icon: 'user-plus',
  intro: 'Arrive in Evenwell as someone of your own making. You shape them in the Worldbuild before the story begins: who they are, and what they already know.',
  start: "Coming in from the King's Road as the common room fills up.",
};

// Every opening starts on the road and ends in the common room. The player's character never
// speaks here; the room around them stays in the background until they walk up to someone.
const PROLOGUE = `The King's Road runs through Evenwell the way a stream runs through a mill. Everything that passes leaves something behind. Wool goes out on it, and the crown's tax men come in. Caravans used to arrive every week, and some of the people on them never left. A few villagers walked the other way, into Elderwake, and Evenwell stopped saying their names.

Every road through the village ends, sooner or later, at the door of the Last Lantern. Everyone in its common room tonight came here by one. This is yours.`;

const CAST = [
  {
    name: 'Wren Hale', short: 'Wren', age: '20', role: "Innkeeper's son", icon: 'knife', companion: 'Mina',
    intro: 'Found beneath an oak at seven and raised at the Last Lantern, Wren knows every face in Evenwell. He still believes the stories of the man who saved him, the hunter Harrow Venn, long after everyone else stopped.',
    start: "Clearing tables in his father's inn on the busiest night of the month, with Mina waiting for him by the hearth.",
    opening: `${PROLOGUE}

The road left you behind.

You were seven, in years and in name, when your family set you down beneath an oak off the King's Road. They were bound for Crownmoor with one mouth more than they could feed. You were too big to carry and too small to earn your keep, so they sat you against the trunk and told you to wait. A hunter named Harrow Venn found you there at dusk. He asked your name, and Sev was hardly one, only the short end of "seventh", so he gave you a new one. Then he walked you to the Last Lantern and lifted you onto a stool at Edwin Hale's bar, and Edwin took you in and raised you as his own. You have called him your father for so long that the word stopped needing thought.

In those years Harrow and his friends still held the long table by the fire, and Harrow told stories about what lived in the forest. You sat underneath that table listening, and so did Mina. She is a shepherd's daughter, a year older than you, and when nobody else wanted the work she became apprentice to Mother Thistle at the Greenstone Shrine. Where you kept believing Harrow's stories, she went looking for them in stone. Evenwell is full of old carvings nobody remembers making: spirals worn into the rim of the Old Well, lines cut along the standing stones of the Old Fold, a ring of shapes around the antlered figure at the heart of the shrine. Farmers build their walls around them, and children dare each other to touch them. Everyone calls them decoration. For a year now Mina has copied every one she can reach onto a slate she carries everywhere, certain they are writing that nobody can read anymore. She is the one person in Evenwell who never laughed at you for believing, and you are the only one she shows her slate to.

The friends drifted into their own lives, one by one, and the long table emptied. Three years ago Harrow walked into Elderwake alone and did not come out. Evenwell had stopped believing his stories well before that. You keep his old hunting knife sharp, and when the light goes you still look down the forest road.

Tonight the road brings the whole valley to your father's door. Five days to the harvest festival, and half of Evenwell has decided to start celebrating early. You have been on your feet since noon, a stack of bowls along your forearm and a cloth tucked into your belt beside the knife.

Behind the bar, your father pours for the soldiers from the toll gate and laughs at something Captain Morrow says. Rue cuts through the crowd with four cups at once and gives you a look that says the bowls are taking too long. She came out of Elderwake on foot two years ago, alone, the only one left, she says, of a caravan the bandits caught. Your father gave her a bed and work without asking more than she wanted to tell. She works twice as fast as you, saves every coin for a room in Crownmoor, and finds Harrow's stories, and you for believing them, endlessly funny. She is also the first one between you and any drunk who gets loud.

In the corner, a minstrel fights with a lute that won't hold its tune. At the table by the window, two young strangers sit close over a battered book, talking in low voices. By the door, a woman in worn crown armour nurses a single cup and watches no one in particular.

Mina is waiting on the bench by the hearth, a loaf wrapped in a shrine cloth on her knees and her slate face down beside her. When you pass, she catches your sleeve.

"You're late," she says. Then, quieter, with a glance at the room: "I found the same mark twice today, Wren. Once on the shrine, and once on the rim of the Old Well." She turns the slate over just far enough for you to see the chalk lines. "Tell me I'm not imagining it."`,
  },
  {
    name: 'Rue', short: 'Rue', age: '22', role: 'Barmaid', icon: 'coins', companion: 'Edwin Hale',
    intro: 'Rue walked out of Elderwake alone two years ago and has worked the floor of the Lantern ever since, saving every coin for Crownmoor. She trusts facts and coin, and has no patience for dreamers.',
    start: 'Behind the bar beside Edwin, keeping count of the whole room.',
    opening: `${PROLOGUE}

The road brought you out of the forest.

You are Rue, twenty-two. Two years ago you walked out of Elderwake on the King's Road with the clothes you stood in and a cut along your left forearm that has since healed into a thin pale line. You told Edwin Hale your caravan had been attacked by bandits on the Silent Mile, and that you were the only one who got away. He gave you room 6 at the back of the inn and a place behind the bar, and in two years he has never asked for the rest.

There is a rest. It comes at night, mostly: the sound a wagon makes going over, a dark that should have been too thick to see through. You have always seen well in the dark. What you saw that night was bandits; you settled that a long time ago, and you settle it again each time it comes back. Some nights, from the window of room 6, there is a tall shape at the treeline that wasn't there the evening before. It's a tree. You sleep with the shutter closed.

Daylight is for work. You know every regular in the Lantern: who pays, who runs a tab, who gets loud after the third cup. Every coin you don't spend goes into the lining of your spare shirt, and when the lining is heavy enough you are going to Crownmoor, where nobody has heard of Elderwake. Until then there is Edwin, who runs this inn the way his father and grandfather did and turns every question about the old days into a joke, and there is Wren, his son, found under a tree as a child and still faithful to every story a dead hunter ever told him. You call Wren a fool at least once a day. Last winter you threw a drover into the snow for doing it once.

Tonight the road has emptied the whole valley through the door. Festival week. You work the bar beside Edwin, and the room keeps your hands busy: the soldiers from the toll gate holding the far end, Captain Morrow on his third cup, a minstrel by the hearth testing a lute he hasn't paid to play, Mina on the bench with her slate, waiting for Wren to finish a shift he is finishing very slowly. At the table by the window two young travellers sit over a book they haven't opened, talking low. By the door, a woman in worn crown armour came in an hour ago, paid in exact coin, and took the table with its back to the wall. She has looked at the room the way you look at it.

Edwin leans in beside you, drying a cup that is already dry, and tips his head toward the window.

"Those two lads. The one in the new cloak asked for a lamp and paid for it like he'd never paid for anything in his life." He grins. "Take them their bread, would you? I'd go myself, but Morrow's about to start singing."`,
  },
  {
    name: 'Jasper', short: 'Jasper', age: '18', role: 'Adventurer', icon: 'book', companion: 'Odris', featured: true,
    intro: "Raised to keep a merchant family's ledgers, Jasper left home with his oldest friend to find the wonders in his books. This afternoon, on the King's Road, he pulled the journal of a missing hunter out of the mud.",
    start: 'At a corner table with Odris and a journal he has not opened yet.',
    opening: `${PROLOGUE}

The road gave you something, and then it brought you here.

You are Jasper, eighteen, son of a merchant family in a trading town of Ordane. Your father measured a good year in bolts of wool sold, and he meant for you to keep his books after him. You can still total a column faster than anyone in that house. You did it for years with one of your grandfather's old books open under the ledger: ruined cities, beasts in the deep woods, roads that ended on the maps where the mapmaker lost his nerve. Your father took the books away more than once. You always knew where he put them.

Odris grew up across the lane from your family's warehouse. You learned your letters at the same table and your first fights in the same alley, and when you were twelve he hauled you out of the millrace after you went in after a book you had dropped. He grew into the steady one: apprenticed to a carpenter, a bench of his own, a life already laid out in front of him. He thinks the stories in your books are only stories. When you told him you were leaving, he said nothing at all, and the next morning he was at the town gate with a pack on his shoulder. He has walked every mile of the King's Road beside you since, and not once has he claimed to believe.

This afternoon, on the loneliest stretch of that road, beside an overturned cart on the Silent Mile, you pulled a journal out of the mud. Something heavy was wrapped in its cover: a grey ring, too large for your finger, which is where it is now. You have read exactly one line of the journal. On the first page, in faded ink, a name, Harrow Venn, and beneath it the name of a village. The rest of the pages are stuck together with damp, and you wanted a fire and a lamp before you risked tearing them apart. Evenwell was the next village on the road. Every book on your grandfather's shelf was written by someone long dead, about places nobody could find. This one has a man's name in it, and the place was close enough to reach before supper.

The Last Lantern is warm and loud and smells of stew and wet wool. You and Odris have the corner table by the window, the journal closed between your bowls, its cover still dark with water.

Around you, Evenwell drinks to a festival five days away. A broad innkeeper works the taps with a cloth over his shoulder. A barmaid with cropped dark hair moves through the crowd without wasting a step. A young man with dark brown hair clears tables and keeps stopping to talk, and a girl in a grey shawl waits for him on the bench by the hearth. Soldiers from the toll gate hold the end of the bar. A minstrel tunes a battered lute in the corner. By the door, a woman in worn crown armour sits alone with a cup she hasn't touched.

Odris has his back to the wall, where he can see the door. His stew is going cold. He looks at the journal, then at you, and lets a long breath out through his nose.

"We had two hours of daylight left," he says. "Two hours, and we stopped so you could read a book you found in a ditch. It's probably some pedlar's accounts. Or somebody's bad poetry." He pushes the lamp a little closer to your side of the table anyway. "Go on, then. If it's poetry, we're on the road at first light."`,
  },
  {
    name: 'Odris', short: 'Odris', age: '18', role: 'Companion', icon: 'shield', companion: 'Jasper',
    intro: 'Odris planned an ordinary life and gave it up so that Jasper would not take the road alone. He doubts everything his friend believes, and follows him anyway.',
    start: 'Beside Jasper with his back to the wall, watching the door and the dark window.',
    opening: `${PROLOGUE}

The road you meant to take was a short one: from your father's house to the carpenter's yard, and back again, for the rest of your life.

You are Odris, eighteen. A month ago you had a bench at the carpenter's with your name cut into the end of it, a half-made chair you were proud of, and a future nobody needed to explain to you. Across the lane lived Jasper, the merchant's son, who kept his father's ledgers with an old book hidden under them and talked about ruined cities like places he had already been. You learned your letters beside him. When you were twelve you went into the millrace after him because he had gone in after a book. He has been going in after something ever since, and you have been standing on the bank with the rope.

When he told you he was leaving, you didn't argue. You left the chair half-made, packed that night, and were waiting at the town gate before he was. You don't believe in his books. You believe he would walk off a cliff after a good story if nobody held his collar.

This afternoon, on the Silent Mile, he went down on his knees in the mud beside an overturned cart and came up with a journal in his hands, laughing. You were watching the trees. Back from the road, between two trunks, something stood with antlers far too wide for any stag, and under them nothing you could put a name to. It didn't move. You took Jasper by the collar and walked him out of there fast, and when he asked why, you told him the light was going. You haven't told him the rest. If he knew, he would never turn for home.

The Last Lantern was the next roof on the road, and Jasper wanted a fire and a lamp before he tried to peel the wet pages apart. You took the corner table by the window, and you sat with your back to the wall so you could see the door. The window behind Jasper's head looks out on the forest. You have stopped trying not to look at it.

The room is full and loud: festival week, the man at the bar says. A broad innkeeper with a cloth over his shoulder. A barmaid with cropped hair who moves like she is counting. A young man clearing tables, a girl in a grey shawl waiting for him by the fire. Soldiers at the far end of the bar. A minstrel in a patched coat. By the door, a woman in old crown armour, who looked at your walking staff when you came in and decided you were not a problem.

Jasper has his thumbnail working between the first page and the second. He turns the journal around so you can see the faded ink on the flyleaf.

"Harrow Venn," he says, tapping the name, then the line beneath it. "Evenwell. It's here, Odris. We'd have walked straight past it." He's already reaching for the lamp. "Hold this closer, would you? I don't want to tear anything."`,
  },
  {
    name: 'Florian Merriwether', short: 'Florian', age: '25', role: 'Minstrel and peddler', icon: 'guitar', companion: 'Edwin Hale',
    intro: 'Florian wanted to be an artist; the empty purses of Ordane made him a peddler who sells with a song. He is bound for Crownmoor with an old lute and a debt.',
    start: 'Tuning his lute by the hearth, sizing up a room with money in it.',
    opening: `${PROLOGUE}

You have spent ten years on the road, and it has never once taken you where you meant to go.

You were Tam Cobb when you started, a carter's son who could play anything with strings and wanted nothing in the world but to do it in front of people. You meant to be an artist, going fair to fair across Ordane with a song for every village and a story for every song. For a few years that was almost true. Then the harvests failed in one county and the taxes rose in the next, and people who used to throw coins for a ballad began counting them twice. Now you sell ribbons, tin charms and lucky river stones from rivers you have never seen, and the songs are what you play to bring the crowd close enough to buy. Florian Merriwether is a better name for that work. Tam Cobb owes money to men in Crownmoor who do not forgive a debt.

Hence the lute. You found it in a ruined village three counties back, going for nearly nothing: old wood, a cracked case, and carvings around the sound hole far too fine for an instrument anyone would leave behind. There is a collector in Crownmoor who buys pretty, strange things. If he pays what you hope, Tam Cobb can stop sleeping with one eye open.

You haven't played it for anyone yet. Not properly. There was a time, years ago, when you played for nothing but the playing, and a room went quiet in a different way, the way a field goes quiet before rain. You haven't heard that quiet in a long while.

Every village has one good night a season, and you have learned to arrive for it. Evenwell's is festival week, and the Last Lantern is packed with shepherds who have just been paid for their wool. You have the stool in the corner by the hearth, the lute across your knee, and you are hunting for the string the damp has got into. A fair room: an innkeeper who laughs easily, a barmaid who has already priced you, soldiers at the bar, a girl with chalk on her fingers waiting by the fire, two young travellers bent over a closed book at the window, a woman in worn crown armour who hasn't smiled since she walked in.

The innkeeper works his way over to you, wiping his hands on the cloth at his shoulder.

"You're the one with the pack of wonders," he says. "Ribbon sellers I can take or leave. But if you can get this lot singing instead of brawling, there's supper and a bed in it for you, five nights running." He nods at the open floor by the hearth. "Start whenever you're ready."`,
  },
  {
    name: 'Rhona Dunmore', short: 'Rhona', age: '25', role: 'Former road guard', icon: 'sword', companion: 'Dace Morrow',
    intro: "Seven years guarding the King's Road, then discharged without her pay. Rhona has come to Evenwell with her family's old sword and a crown notice: a bounty on the beast of the road.",
    start: 'At the table nearest the door, a single cup she has barely touched.',
    opening: `${PROLOGUE}

You walked the King's Road for seven years, and you know exactly where it goes wrong.

You are Rhona Dunmore, twenty-five. You joined the crown's road guard at eighteen and spent seven years walking beside the woodcutters while they cut the King's Road straight through Elderwake. On the deepest stretch, the one everyone calls the Silent Mile, men went quiet and didn't come back, and your orders were to write them down as lost to bandits. You wrote it every time.

In the summer of 60 you were escorting a caravan through the Silent Mile when something came out of the dark. You remember the weight of Duskweaver in your hands, the shock of the blade striking something, and the thing drawing back. Then nothing. You woke alone among overturned wagons, and when they asked for your report you wrote "bandits" and signed it. It was not bandits.

When the road works slowed, the crown discharged your company and kept your back pay. Your armour still has the outline of the insignia you tore off it. Duskweaver hangs at your hip in its cracked scabbard, as it has hung on Dunmores for longer than anyone in your family can remember. In your coat is a folded crown notice. The crown has quietly put a bounty on the beast of the road. It is the only way you will ever be paid what you are owed, and the beast, whatever else it is, is big, and you have already made it bleed once.

Tonight you have the table nearest the door, a cup that went warm while you decided whether you could afford a second, and a view of the whole common room. Festival week, and the place is loud with shepherds and millers. A minstrel by the hearth. Two boys at the window bent over a book they haven't opened. The barmaid with cropped hair has looked at your sword twice. At the far end of the bar, Dace Morrow is drinking with two of his toll soldiers. You served under him in the road guard. Now he commands the gate at the edge of town, and he has been pretending not to see you since you came in.

He stops pretending. He crosses the room with his cup, sets it down across from yours, and sits without asking.

"Dunmore." He looks at the sword, then at you. "You've come about the notice." He pushes your cup an inch toward you. "Drink that before it goes sour, and then tell me you're not as stupid as I think you are."`,
  },
  {
    name: 'Mina', short: 'Mina', age: '21', role: 'Shrine apprentice', icon: 'shapes', companion: 'Wren Hale',
    intro: "Apprentice to Evenwell's ancient shrine keeper, Mina spends her days copying carvings nobody else looks at, sure that they are a script. Wren is her best friend.",
    start: 'By the hearth with bread from the shrine, waiting for Wren to finish his shift.',
    opening: `${PROLOGUE}

Your road has never left Evenwell. It runs from your family's fold on the hill to the Greenstone Shrine and back, and lately it has started bending around stones.

You are Mina, twenty-one, a shepherd's daughter, and apprentice to Mother Thistle at the Greenstone Shrine because nobody else wanted the work. You sweep the steps, tend the offerings, and know every word of the festival rites, which you will lead the village through in five days whether or not you are ready. Mother Thistle answers half your questions with riddles and the other half with proverbs. You have come to believe she knows a great deal more than she understands.

For a year now you have been copying every carving in the shrine onto a slate you carry everywhere: the spirals, the cut lines, the ring of shapes around the antlered figure at the shrine's heart. Then you started finding them elsewhere. The same marks are worn into the grooves of the Old Well, cut into the standing stones of the Old Fold, and hammered into the side of the anvil at Bram's smithy, which came with the forge and is older than the village. Everyone calls them decoration. You think they are one script, the same hand everywhere, and that a script can be read.

Harrow Venn thought so too. When you were small, he once showed you and Wren a rubbing he had taken from the Listening Stones, deep in the forest. "One day someone will read this," he said, "and it won't be me." You were eight. You have never forgotten the way he said it.

Wren was beside you then, under the long table where Harrow's friends used to sit, and he is still the person you bring things to. He was found under an oak as a boy and raised by Edwin Hale, and he believes every story Harrow told. He is also the only one in Evenwell who has never laughed at your slate.

Tonight you have the bench by the hearth, a loaf from the shrine wrapped in a cloth on your knees and your slate face down beside you, so nobody spills ale on today's work. Today you found the same mark twice: once on the shrine, once on the rim of the Old Well. You have been waiting all afternoon for Wren to finish his shift.

The room roars around you. Soldiers at the bar, Edwin pouring, Rue everywhere at once. A minstrel tunes an old lute a few feet from you. Two strangers sit at the window over a closed book, talking low, and a woman in worn crown armour drinks alone by the door.

Wren comes through the crowd with a stack of bowls and stops in front of you.

"You've got chalk on your nose," he says, and drops onto the bench beside you for exactly as long as it will take Rue to notice. "Go on, then. What is it this time?"`,
  },
];

// The player's own character comes in from the road, and Rue is the first to speak to them.
const NEWCOMER_COMPANION = 'Rue';
function newcomerOpening(name) {
  return `${PROLOGUE}

You are ${name}, and your road is your own. Where it began, what you left at the other end of it and what you carry down it now, you know better than anyone in this room. All Evenwell will see tonight is a stranger off the King's Road in festival week, when strangers are good for business.

The road ends its last mile at King's Gate, where a bored soldier waves you through without looking at your face. Evenwell's lights are the first you have seen in a while. Five days to the harvest festival, the soldier says, as if that explains the noise.

The noise is the Last Lantern. You push through its door into heat, smoke, wet wool and stew. A broad innkeeper with a cloth over his shoulder is pouring for three soldiers at the bar. A young man with dark brown hair is clearing tables, and a girl in a grey shawl waits for him by the hearth with a slate on her knee. A minstrel in a patched fine coat is tuning an old lute. At the table by the window, two young travellers sit over a closed book, talking low. By the door, a hard-faced woman in worn crown armour sits alone with a cup she isn't drinking.

A barmaid with cropped dark hair cuts across your path with four cups balanced on one arm, sizes you up in the time it takes to set them down, and stops.

"Stool at the end of the bar if you don't mind soldiers, corner by the stairs if you do," she says, her eyes already on the next empty cup. "Stew's hot, ale's cold, and there's one room left upstairs. What'll it be?"`;
}

module.exports = { STORY_ID, WORKSPACE, LOCATION, VILLAGE, TEXTS_FOLDER, CLOCK, IN_ROOM, PLACEMENTS, GM_PROFILE, INTRO, WORLD, NEWCOMER, NEWCOMER_COMPANION, CAST, newcomerOpening };
