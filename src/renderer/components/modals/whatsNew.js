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
      ],
      'Who knows what': [
        'Each character knows only what they saw, were told or remember, so a secret stays out of a scene until someone in it finds out.',
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
  intro: "Kallamo 2.0 redesigns every screen and rebuilds much of what runs underneath. Kallamo's own knowledge engine now keeps your world in step with the story, and it is still growing, so tell us what it gets wrong. Everything you already made is right where you left it.",
  highlights: [
    {
      icon: 'Drama',
      title: 'Roleplay with a Narrative State',
      text: "Play a character while Kallamo's own knowledge engine keeps the story straight: the scene, the time, inventories, resources and relationships update after every reply.",
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
