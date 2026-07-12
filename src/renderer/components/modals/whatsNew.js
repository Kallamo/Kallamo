const RELEASE_1_1_2 = {
  title: 'A smoother everyday flow',
  sections: {
    Added: [
      'See replies take shape as they arrive. Turn live replies off anytime in Settings > Advanced. AWS Bedrock still returns the finished response for now.',
      'A focused chat history that starts with your latest 50 messages, with controls to show earlier messages or jump to the beginning.',
      'Saved Writing Desk navigation, preserving your expanded folders and last open document for each workspace.',
      'A Location-only Worldbuild hierarchy based on the existing Inside relationship, while locations without one remain at the root.',
      'Two kinds of What\'s New: a full release overview for new installs and focused notes after an update.',
    ],
    Changed: [
      'Markdown now recognizes headings from # through ######.',
      'The message box now stays responsive while you type, even in long conversations.',
      'Long messages now stay fully visible instead of being cut short.',
    ],
    Fixed: [
      'Returning to Chat from another workspace view now restores the latest message instead of leaving you at an older position.',
    ],
  },
};

export const GLOBAL_WHATS_NEW = {
  version: '1.1',
  title: 'Writing Desk, Worldbuild, and everything since',
  intro: 'Kallamo now gives your writing a home and your world a living reference. Here is the full story of the 1.1 release line so far.',
  highlights: [
    {
      icon: 'PenLine',
      title: 'Writing Desk',
      text: 'Write, format, import, export, and ask an AI profile to suggest non-destructive edits to any selected passage.',
    },
    {
      icon: 'Globe2',
      title: 'Worldbuild',
      text: 'Keep characters, places, creatures, events, and their relationships together in a canonical world bible.',
    },
    {
      icon: 'Brain',
      title: 'A world the AI remembers',
      text: 'Kallamo retrieves the people, places, and knowledge relevant to what you are creating instead of filling every prompt with everything.',
    },
  ],
  releases: [
    {
      version: '1.1.2',
      ...RELEASE_1_1_2,
    },
    {
      version: '1.1.1',
      title: 'Hotfixes after the 1.1 launch',
      sections: {
        Fixed: [
          'Newer OpenAI and reasoning models now use the token-limit parameter they expect, and Manual JSON can remove a parameter with null.',
          'Custom Base URL connections now resolve chat and embedding endpoints correctly for OpenAI-compatible providers.',
          'Failed entity tagging now explains what happened and points you to System AI settings, while preserving indexing.',
          'Changing an AI Profile model now reliably saves the selected model.',
        ],
      },
    },
    {
      version: '1.1.0',
      title: 'The Writing Desk and Worldbuild release',
      sections: {
        Added: [
          'Writing Desk with formatting, page setup, find and replace, import and export, and non-destructive inline AI editing suggestions.',
          'Per-chapter Writing Desk notes that preserve an analysis, its source passage, and a jump back to it later.',
          'Worldbuild, a workspace registry for characters, places, creatures, events, and their relations.',
          'Worldbuild auto-fill, enrichment review, in-text entity links, and portable .klwb packages.',
          'Living-world indexing that tags knowledge with the entities and variables it mentions, plus clear indexing status.',
          'Guided first run, memory switches, Retrieval Strictness, durable chunk edits, and unified memory tags.',
        ],
        Changed: [
          'More accurate retrieval, stronger agentic Worldbuild research, clearer System AI requirements, and more reliable menus.',
          'Helper text now scales with your Interface font-size setting.',
        ],
        Fixed: [
          'Worldbuild fields reach the AI, Writing Desk chapter indexing stays scoped to its document, and weak retrieval results are filtered out.',
        ],
      },
    },
  ],
};

export const PATCH_WHATS_NEW = {
  '1.1.2': {
    title: 'A smoother way back into your work',
    intro: 'This update makes everyday writing, chat, and world navigation feel more continuous.',
    highlights: [
      {
        icon: 'Sparkles',
        title: 'Live replies, on your terms',
        text: 'See replies take shape as they arrive. Turn live replies off anytime in Settings > Advanced. AWS Bedrock still returns the finished response for now.',
      },
      {
        icon: 'PenLine',
        title: 'Return to your place',
        text: 'Writing Desk remembers the folders you expanded and the document you last had open in each workspace.',
      },
      {
        icon: 'Globe2',
        title: 'See locations in context',
        text: 'Worldbuild can organize locations through their existing Inside relationship while keeping top-level places easy to find.',
      },
    ],
    sections: RELEASE_1_1_2.sections,
  },
};

export const FALLBACK_PATCH_WHATS_NEW = {
  title: 'Kallamo has been updated',
  intro: 'This version includes improvements and fixes. Open What\'s New from Settings any time to revisit the full 1.1 release story.',
  highlights: [],
  sections: {},
};
