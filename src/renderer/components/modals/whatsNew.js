const RELEASE_2_0_0 = {
  sections: {
    // Added may be grouped by area: each key is a subtitle over its own list.
    Added: {
      Roleplay: [
        "Turn any workspace into a story you play. Pick your character, set the scene, and a clock keeps time on your world's own calendar.",
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
        'Give your world its own calendar, with months, eras and seasons. Dates, birthdays and events all follow it.',
        'A Rules page holds resources such as health or mana, how characters level up, and the skills they can learn.',
        'Record each time an event happened, who was there and what it changed.',
        'Shape each kind of entry with your own fields, give places a size from a whole region down to a single room, and add portraits and scene backgrounds.',
        'Hide spoilers from whoever reads a sheet until they click them. The AI still knows them.',
        'Write journals, letters and notices in the Writing Desk that the AI reads only when someone opens them in a scene.',
      ],
      'Getting started': [
        'New installs open with Evenwell, a sample roleplay story, and a step-by-step guide that connects a model with you.',
        'When a story has no model yet, Kallamo says what is missing and takes you straight to it.',
      ],
      'Cost and safety': [
        'The part of each request that repeats stays the same between turns, so providers that cache it charge less for it. The token panel shows what the reply, the research and the Narrative State each read from the cache.',
        'In a roleplay, research runs only for what lies outside the scene, and the Narrative State reads only what the turn touches.',
        'Before an update touches your data, Kallamo saves a copy, and puts everything back if the update cannot finish.',
      ],
    },
    Changed: [
      'Kallamo is redesigned from end to end: the chat, Memory, the Writing Desk, Worldbuild, Configuration, Settings, Workspaces and the Library.',
      'A splash window covers checking for updates and opening, with an option to open now and update later.',
      'Regenerating or switching a roleplay reply first undoes the story state of the reply it replaces, and reverting or deleting turns removes what they wrote to the story.',
      'The reply is ready at once while the Narrative State catches up in the background.',
      'Workspaces open without the conversation jumping, switching between areas is faster, and long conversations stay responsive.',
      'Update entities runs in the background with progress, Stop and a list of failures to retry.',
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
export const PATCH_WHATS_NEW = {};

export const FALLBACK_PATCH_WHATS_NEW = {
  title: 'Kallamo has been updated',
  intro: `This version includes improvements and fixes. Open What's New from Settings any time to revisit the full ${GLOBAL_WHATS_NEW.version} release story.`,
  highlights: [],
  sections: {},
};
