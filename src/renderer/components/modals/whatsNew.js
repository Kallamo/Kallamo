const RELEASE_2_0_0 = {
  sections: {
    // Added may be grouped by area: each key is a subtitle over its own list.
    Added: {
      Roleplay: [
        "Turn any workspace into a story you play. Pick your character, set the scene, and a clock keeps time on your world's own calendar.",
        'Start a new story in any world, or play Evenwell again with someone else.',
        'A panel beside the chat shows where you are, who is around, what you carry and how much health or energy is left, and you can change any of it by hand.',
        'After every reply, the Narrative State updates the scene, the time, what everyone carries, their resources and their relationships. Bigger changes, like a secret coming out, wait for your approval.',
        'Characters can grow with levels, attributes and skills that use your own rank names.',
        'Who is in the conversation follows the story, and paying, buying or trading moves coins and items between inventories, in whatever language you play.',
        'Conditions your world defines come and go with the story, characters recover while they sleep or rest, and growth is weighed when a scene ends.',
        'Each workspace keeps a Chat and a Roleplay conversation side by side.',
      ],
      'Who knows what': [
        'Each character knows only what they saw, were told or remember, so a secret stays out of a scene until someone in it finds out.',
        'Memories fade as story time passes and return when recalled, and characters remember the earlier scenes they witnessed.',
        'Before each reply, Kallamo plans what the turn needs from the story and your world, within a set budget.',
        'The Knowledge tab lets you decide what a character knows, believes and remembers about anyone or anything in your world.',
        'Factions share what they know with their members, and regions and towns with the people who live there.',
      ],
      Worldbuild: [
        'Already have a world? Create with AI reads your notes, documents, or SillyTavern character cards and lorebooks, and turns them into Worldbuild sheets you review before anything is saved.',
        'Give your world its own calendar, with months, eras and seasons. Dates, birthdays and events follow it, and an event can keep hours, last several days or fall on chosen weekdays.',
        'A Rules page holds resources such as health or mana, how characters level up, and the skills they can learn.',
        'Record each time an event happened, who was there and what it changed.',
        'Shape each kind of entry with your own fields, give places a size from a whole region down to a single room, and add portraits and scene backgrounds.',
        'Hide spoilers from whoever reads a sheet until they click them. The AI still knows them.',
        'Write journals, letters and notices in the Writing Desk that the AI reads only when someone opens them in a scene.',
        'Custom fields can carry guidance the AI follows while it writes and while it updates your sheets.',
      ],
      'Getting started': [
        'New installs open with Evenwell, a sample roleplay story, and a step-by-step guide that connects a model with you.',
        'When a story has no model yet, Kallamo says what is missing and takes you straight to it.',
      ],
      'Cost and safety': [
        'The part of each request that repeats stays the same between turns, so providers that cache it charge less for it. The token panel shows what the reply, the research and the Narrative State each read from the cache.',
        'In a roleplay, research runs only for what lies outside the scene, and the Narrative State reads only what the turn touches.',
        'Before an update touches your data, Kallamo saves a copy, and puts everything back if the update cannot finish.',
        'Local servers share their context size and receive the reply shape, so requests fit and story updates stay in shape.',
      ],
    },
    Changed: [
      'Kallamo is redesigned from end to end: the chat, Memory, the Writing Desk, Worldbuild, Configuration, Settings, Workspaces and the Library.',
      'A splash window covers checking for updates and opening, with an option to open now and update later.',
      'Regenerating or switching a roleplay reply first undoes the story state of the reply it replaces, and reverting or deleting turns removes what they wrote to the story.',
      'The reply is ready at once while the Narrative State catches up in the background.',
      'Workspaces open without the conversation jumping, switching between areas is faster, and long conversations stay responsive.',
      'Update entities runs in the background with progress, Stop and a list of failures to retry.',
      'Speech in replies can have its own color, in Settings > Appearance.',
      'Side panels can be resized and the Roleplay panel rearranged, and Ctrl+F finds anything in the chat.',
    ],
    Fixed: [
      'Newer Claude models no longer fail with an error about temperature.',
      'Background AI tasks stay within your MAX API Payload, like the chat.',
      'Deleting a workspace, chapter, profile or connection removes everything that pointed at it.',
      'Menus near the edge of the window stay fully visible, and button labels stay on one line.',
      "The context meter and Summarize no longer count a reply's reasoning.",
    ],
  },
};

// Shown to everyone on the first release of a major line, and to new installs after it.
export const GLOBAL_WHATS_NEW = {
  version: '2.0',
  title: 'A whole new app and a world that keeps up',
  intro: "Kallamo 2.0 redesigns every screen and rebuilds much of what runs underneath. Umwelt, Kallamo's epistemic state engine, now keeps your world in step with the story, and it is still growing, so tell us what it gets wrong. Everything you already made is right where you left it.",
  highlights: [
    {
      icon: 'Drama',
      title: 'Roleplay with a Narrative State',
      text: "Play a character while Umwelt keeps the story straight: the scene, the time, inventories, resources and relationships update after every reply.",
    },
    {
      icon: 'Brain',
      title: 'Characters know only what reached them',
      text: 'Each character holds what they saw, were told and remember, so a secret stays out of the scene until someone in it learns it.',
    },
    {
      icon: 'Sparkles',
      title: 'A new Kallamo, end to end',
      text: 'Every screen is redesigned: the chat, Memory, the Writing Desk, Worldbuild, Configuration, Settings and the Library, with one look and one set of icons throughout.',
    },
  ],
  releases: [
    {
      version: '2.0.0',
      ...RELEASE_2_0_0,
    },
  ],
};

// Notes for each later 2.x update, keyed by version, shown once after updating to it.
export const PATCH_WHATS_NEW = {
  '2.0.0-beta.4': {
    title: 'Connect any service and keep your roleplay steady',
    intro: 'Thanks for every report on Beta 3. This update fixes what you found, adds extra headers so services like OpenCode Go can connect, and opens faster.',
    highlights: [],
    sections: {
      Added: [
        'Connections can send extra headers, so services such as OpenCode Go can be used.',
        "Fetch models lists a provider's models, and typing searches them.",
        'A Thinking models setting gives models that reason room to answer, whatever their name.',
        'Moving the scene by hand asks who comes along.',
        'Universal GM narrates any world from its lore, and Universal GM Lite does it with simpler rules for local models. New Evenwell stories start with both.',
      ],
      Changed: [
        'Local or compatible is now OpenAI-compatible, for local servers and any other /v1 API.',
        'Kallamo opens faster, and the update copy no longer freezes the splash.',
        'Recent changes shows a clock you corrected by hand.',
        'Archive settings say that Chat and Roleplay keep their own.',
        'Saving an item type as unique asks first when something would be lost.',
      ],
      Fixed: [
        'Chat and Roleplay keep their own draft and summary numbers.',
        'Italics inside dialogue keep the dialogue color.',
        'Scene changes no longer reach review with Unknown entity.',
        'An item can switch between unique and item type without saving first.',
        'Local models stop when they start writing your turn.',
        'A new character you approve shows up in the scene.',
        'The token panel says Savings unknown instead of Saved ≈ 0.',
      ],
    },
  },
  '2.0.0-beta.3': {
    title: 'Your story moves into Umwelt',
    intro: 'Thanks for playing the second beta. The Narrative State now runs on Umwelt, our epistemic state engine: it tracks what happened and who knows it, on the story\'s own timeline. Your stories from earlier betas move into it on their own the first time you open this version.',
    highlights: [
      {
        icon: 'Sparkles',
        title: 'Powered by Umwelt',
        text: 'Each story lives in its own Umwelt file. Every turn is kept as a draft that a regenerated reply replaces, nothing is erased, and each character reads only what the engine admits for them.',
      },
      {
        icon: 'Brain',
        title: 'Memories that fade and return',
        text: 'What the story stops drawing on drifts out of reach as time passes and comes back when someone recalls it. Hearing it again makes knowledge firmer, and seeing proof makes it certain.',
      },
      {
        icon: 'Globe2',
        title: 'Each reply reads what the turn needs',
        text: 'Before every reply, Kallamo plans what to look up: who and what the turn names, earlier scenes it calls back and what the characters know, all within a set budget.',
      },
      {
        icon: 'Drama',
        title: 'Conditions, sleep and growth',
        text: 'Characters can be poisoned, exhausted or anything your world defines, recover while they sleep or rest, and gain XP and skills when a scene ends.',
      },
    ],
    sections: {
      Added: [
        'Diagnostics show story checks for each turn: a secret told outside its circle, or a claim with nothing behind it.',
        'Each workspace has a Chat and a Roleplay conversation, and messages can move between them.',
        'Characters recall earlier scenes they witnessed, and a secret can be held, suspected, denied or lied about.',
        'Choose what a scene may create on its own, for review, or not at all, for each kind of thing, factions included.',
        'A sheet born in a scene is filled from that scene right away, so the next turn already knows it.',
        'The narrator knows how the people present feel about someone who is away, and when they last saw them.',
        'Characters have a gender, a home and a workplace with a job.',
        'Ctrl+F finds anything in the whole chat history.',
        'Side panels can be resized, and the Roleplay panel can sit on either side with its blocks rearranged.',
        'The Library opens from the title bar, and the uninstaller can also remove your data if you ask it to.',
      ],
      Changed: [
        'Update entities no longer proposes memories, knowledge and relationships twice, and fills empty fields in a pass of their own.',
        'Changing a field type keeps the values and warns about any that would be lost.',
        'Renaming an entity carries the new name into the story.',
        'Long campaigns plan each turn several times faster, and long chats open quicker.',
        'Portraits are framed at 3:4, and the roleplay rail shows level progress.',
      ],
      Fixed: [
        'Local and OpenRouter models that think before answering have room to think and still reply.',
        'An item already equipped is no longer equipped again every turn.',
        'A vague line such as "not long" no longer moves the clock by a full hour.',
        'A dropped connection says why, and story updates try again.',
        'Tall dialogs scroll instead of cutting off their top, and pickers focus their search field.',
        'Reasoning in <reasoning> tags stays out of history and search.',
      ],
    },
  },
  '2.0.0-beta.2': {
    title: 'Bring any world into Kallamo',
    intro: 'Thanks for playing the first beta. This one brings any world you already have into Worldbuild in minutes, lets you start a story over in the same world, and gives events their hours.',
    highlights: [
      {
        icon: 'Sparkles',
        title: 'Bring any world into Worldbuild',
        text: 'Create with AI reads your notes, documents, wiki pages or SillyTavern cards and lorebooks, lists everyone and everything they describe, and fills a sheet for each one you keep.',
      },
      {
        icon: 'Drama',
        title: 'A new story in the same world',
        text: 'Start Evenwell again with another character, or copy any world into a fresh story without its chat and without what the last one changed.',
      },
      {
        icon: 'Globe2',
        title: 'Events with hours and length',
        text: 'An event can open at a set time, last several days or fall on chosen weekdays, and the narrator knows whether it is happening right now.',
      },
    ],
    sections: {
      Added: [
        'Speech in replies can have its own color, in Settings > Appearance.',
        'The narrator follows the AI guidance you write on custom fields.',
        "A System can be sent with every message: turn on Always in the AI's context under its rules, and Kallamo shows how many tokens that adds.",
        'Recently changed shows what happened to each entry, and a breadcrumb on every sheet leads back to your world.',
        'Update entities fills the relations between factions and people.',
        'Local servers such as KoboldCpp, llama.cpp, LM Studio and Ollama share their context size and receive the reply shape, so Narrative State replies stay in shape.',
        'Diagnostics show every model call behind a reply, the exact request the narrator received, and why the scene did or did not move.',
      ],
      Changed: [
        'Relationships move easily near neutral and slower toward either extreme, so deep bonds and hatreds take real story to build.',
        'Narrative State sends roughly half as much in a long campaign, and messages take far less space.',
        'Update entities reads a long document in full in one run, in the language you chose.',
        'Propose unknown entities starts on, so new names in your story are suggested as Worldbuild entries for you to review.',
      ],
      Fixed: [
        "A System's rules no longer claim to be always in the AI's context when they were not. The switch now decides.",
        'Moving within a place, such as to a room, floor or corner your map does not list, keeps the scene in that place instead of jumping somewhere nearby. A move to an unrelated place happens only when the story names it.',
        'Reverting past a reply whose story update failed brings back the state before it.',
        'Ordinary text is no longer hidden as a spoiler, and values no longer keep stray quotes.',
      ],
    },
  },
};

export const FALLBACK_PATCH_WHATS_NEW = {
  title: 'Kallamo has been updated',
  intro: `This version includes improvements and fixes. Open What's New from Settings any time to revisit the full ${GLOBAL_WHATS_NEW.version} release story.`,
  highlights: [],
  sections: {},
};
