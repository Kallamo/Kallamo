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

const RELEASE_1_1_3 = {
  title: 'More control over memory and your world',
  sections: {
    Added: [
      'Fast Tag in the File Chunks Viewer lets you add a keyword or Worldbuild entity to every chunk in a searchable file, or remove a tag across the file.',
      'Choose the exact Custom Memory blocks and Searchable Files that World Index should tag.',
      'Choose whether Kallamo creates summaries for archived chats, or keeps their local memory without a summary.',
      'Manage Worldbuild entries in bulk: adjust their AI policy, review proposals and updates, or remove reviewed entries together.',
      'New filters help you focus on proposed entities and AI updates when either needs your attention.',
      'Entity updates that could not be completed now stay together in one clear review area, with details and ways to dismiss them.',
    ],
    Changed: [
      'Searchable Memory totals are now informational. Context warnings stay focused on Always-on memory, which is sent with every request.',
      'World Index now makes its tagging progress clear across each memory area, including items with no matching entity or a failed attempt.',
      'The File Chunks Viewer and Fast Tag controls are easier to read on desktop screens.',
      'Chat replies follow along only while you are already at the latest message, so you can read earlier messages without being pulled away.',
      'Chat archive titles, summaries, and World Index tags now use your configured System AI only.',
      'Custom Memory is tagged when you choose to run World Index, instead of automatically when you save it.',
      'New entity suggestions now show the source that supports them and avoid names or aliases already in your Worldbuild.',
      'AI updates can now suggest well-supported improvements to existing entity details and relationships, not only fill blank fields. Every change remains reviewable beside your current canon.',
      'Entity updates now prioritize material explicitly connected to an entity, then use its names and aliases only as a focused fallback.',
      'System and Concept entries now support aliases and receive suggestions designed for their own type.',
    ],
    Fixed: [
      'Memory Scope menus now open reliably, so you can assign Custom Memory and Searchable Memory to specific AI Profiles again.',
      'World Index tags now appear in the Searchable Memory chunk viewer, including tags created before this update.',
      'Archived chats now keep their complete context, while the chat view can remain focused on recent messages.',
      'Context and Memory now shows how many active messages are included beside the token total.',
      'Entity updates no longer skip System and Concept entries or offer fields that do not belong to them.',
      'If an AI provider returns an unusable entity update, Kallamo makes one correction attempt and clearly explains what still needs attention.',
      'Writing Desk only creates linked lore documents for documents intentionally dedicated to an entity.',
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
      version: '1.1.3',
      ...RELEASE_1_1_3,
    },
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
          'Worldbuild auto-fill and reviewable entity updates, with a per-workspace policy that lets you decide how active the AI should be.',
          'An in-text Worldbuild bridge: link a selected name to an entity or create one without leaving Writing Desk.',
          'Portable Worldbuild packages (.klwb) for sharing a whole world, with imported entities arriving as reviewable proposals.',
          'Living-world indexing that connects your knowledge to the entities and world variables it mentions, plus clear indexing status.',
          'A guided first run with three editable AI Profiles, helpful empty states, and one-time pointers for entity linking and memory tagging.',
          'Memory switches that let you keep knowledge while excluding it from AI context and retrieval.',
          'Retrieval Strictness, a clearer way to decide how closely knowledge should match before Kallamo brings it into a response.',
          'Durable chunk edits that remain intact when a knowledge file is re-indexed and travel with an exported knowledge base.',
          'Unified memory tags across memory and file chunks, including editable file tags and inline entity linking.',
        ],
        Changed: [
          'Knowledge results are ranked more accurately, so stronger matches rise above weak or unrelated material.',
          'Agentic retrieval can work across turns, follow your Worldbuild, and handle imperfect AI output more reliably.',
          'Chat, entity tagging, and Worldbuild enrichment now clearly point to the System AI they require.',
          'Menus and dropdowns are more reliable and no longer hide behind nearby panels.',
          'Helper text is more consistent and scales with your Interface font-size setting.',
          'The AI Profile setup flow now calls its knowledge step simply Knowledge Base.',
        ],
        Fixed: [
          'Worldbuild facts now reach the AI from an entity’s structured fields as well as its lore.',
          'Writing Desk chapter indexing stays scoped to the current document.',
          'Empty and low-information sections no longer crowd out useful retrieval results.',
          'The relevance cutoff now filters weak keyword matches as well as semantic ones.',
        ],
      },
    },
  ],
};

export const PATCH_WHATS_NEW = {
  '1.1.3': {
    ...RELEASE_1_1_3,
    intro: 'This update makes Worldbuild and memory easier to review, manage, and trust as your project grows.',
    highlights: [
      {
        icon: 'Globe2',
        title: 'Smarter Worldbuild suggestions',
        text: 'AI suggestions now show the source behind them, avoid duplicating your existing world, and can propose evidence-based improvements to the canon you already have.',
      },
      {
        icon: 'Brain',
        title: 'Manage your Worldbuild at scale',
        text: 'Select groups of entries to adjust their AI policy, review suggestions and updates, or remove reviewed entries together with a clear confirmation.',
      },
      {
        icon: 'Sparkles',
        title: 'Stay where you are reading',
        text: 'Replies follow live only when you are already at the newest message. Scroll up freely, then return to the latest response when you are ready.',
      },
      {
        icon: 'PenLine',
        title: 'A cleaner Writing Desk bridge',
        text: 'Only documents intentionally dedicated to an entity become linked lore, keeping ordinary story mentions in their proper place.',
      },
    ],
  },
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
