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

const RELEASE_1_1_5 = {
  title: 'Local AI and chat fixes',
  sections: {
    Fixed: [
      'Chat now keeps the selected AI Profile or Workflow and any pending attachments when sending, so valid local requests are no longer stopped before reaching the provider.',
      'Local and OpenAI-compatible connections now accept either a base URL or a full endpoint, require an explicit Local URL, avoid empty authorization headers, and show the provider\'s error details more clearly.',
      'Edit & Regenerate now uses the conversation exactly as edited and keeps the previous AI response safe if the replacement cannot be generated.',
      'Retry and Skip are shown only when a failed generation can actually resume.',
      'Workspaces with an empty or legacy zero MAX API Payload now return to the 128000-token default.',
    ],
  },
};

const RELEASE_1_1_4 = {
  title: 'More control over the AI behind your work',
  sections: {
    Added: [
      'Choose dedicated AI executors for background Engine and Memory tasks such as retrieval planning, summaries, and World Index tagging.',
      'Choose the language Kallamo uses for background AI tasks from an expanded language list.',
      'Set a maximum API payload for each workspace. Kallamo protects room for the response, trims older chat history first, and stops requests that still cannot fit before contacting the provider.',
      'Update Entities now keeps track of runs, evidence, retries, and estimated token use, so deferred or changed evidence remains available for a later pass.',
    ],
    Changed: [
      'Direct generation now uses only AI Profiles and Workflows active in the current workspace, while profiles assigned to a Workflow remain available inside that Workflow.',
      'Standard and Agentic retrieval now follow the active profile\'s file access and Memory Scope consistently, including full-file and entity-based memory searches.',
      'World Index tagging and Update Entities now use structured output controls suited to each supported AI provider for more reliable results.',
      'World Index tagging now handles large workloads in bounded groups, repairs common response issues once, avoids generic Proposed Entities, and clearly distinguishes an empty result from a failed attempt.',
      'Update Entities now focuses on the strongest evidence, can fill empty valid fields, rejects vague numeric changes, recovers common response errors, and protects cumulative Lore from destructive rewrites.',
      'Entity update reviews now use readable field names and let you reject or reprocess suggestions in bulk without changing canonical data.',
      'Items now distinguish reusable Item Types from Unique Items, with availability for types and ownership plus one current location for unique objects.',
    ],
    Fixed: [
      'Progress, streaming, errors, cancellation, and completed replies now stay attached to the correct workspace and generation.',
      'Responses stopped by an AI provider\'s output limit are now reported as truncated instead of appearing complete.',
      'Dismissing an automatic Archive Chat Memory prompt now keeps it dismissed until you open summarization yourself.',
      'A finished streamed reply no longer pulls you to the end after you have scrolled up to read.',
      'Edit & Regenerate now sends the conversation exactly as edited, without the replaced user message or discarded AI replies.',
      'Writing Desk keeps the cursor where you expect, centers the active Find & Replace result, preserves the natural text-selection cursor, and makes the AI Profile picker searchable.',
      'Popovers, tooltips, color controls, and anchored menus now stay inside the visible window more reliably.',
      'Location descriptions and creature appearance or personality fields are now visible and editable wherever Update Entities can review them.',
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

const RELEASE_1_1_6 = {
  title: 'More control over a long history',
  sections: {
    Added: [
      'The archive window now offers three choices for each message: archive it into the summary, keep it in the active conversation, or drop it from context without deleting it from the log.',
      'Drop or restore a message from its own menu, with dropped messages marked in the chat.',
      'Context & Memory shows how your history is split between archived, active, and dropped messages.',
      'Rebuild a single summary to return only its messages to the conversation, leaving your other summaries untouched.',
      'Rebuild everything brings the whole conversation back from the very first message, including anything dropped along the way.',
      'A small mark appears in the chat header when your live history no longer fits the payload budget and the oldest messages are being cut. Click it to archive them.',
      'The archive window can also include your most recent messages, for when they belong to the chapter you are closing.',
    ],
    Changed: [
      'Kallamo now works out your live history from the messages each summary covers, so summaries can be deleted or rebuilt in any order and the workspace repairs itself.',
      'Archived history that mentions a character, place, or item named in your message is now easier to recall, so someone who appears in only a few lines of a long scene can still be found.',
      'Chat Memory now recalls 8 passages per message instead of 5. You can still change this in Settings > Advanced.',
      'The archive window keeps the last 5 messages active instead of the last 10, since long replies made the wider reserve hold back more of your context than it protected.',
      'Deleting a summary now drops the messages it covered rather than returning them to the conversation, and says so before it happens. Rebuild is what hands them back.',
      'A chat reopens on the AI Profile or Workflow you last used in it, rather than the first one on the list.',
      'The Writing Desk reads the same live history the chat does, so an invocation no longer receives passages you have archived or dropped.',
    ],
    Fixed: [
      'Deleting your only summary no longer leaves a workspace unable to archive again.',
      'Archiving messages from the middle of a history no longer keeps them in the active context at the same time, which silently doubled their cost.',
      'The archive window no longer offers messages a summary already covers.',
      'Deleting a summary now removes its stored history, search entries, and tags. Anything left behind by an earlier version is cleaned up on startup.',
      'Deleting a message or reverting a chat no longer leaves the archive out of step with your history.',
      'Summary cards show how much history they hold instead of the length of the recap text, matching how files are measured.',
      'Archive recaps no longer come back as a continuation of your story. The recap card also shows its formatting properly, and says plainly when no recap could be written.',
      'Reasoning models no longer break background AI tasks that expect a structured answer.',
      'Update Entities works with AI providers that require a fully specified response format, which previously refused the request outright.',
      'Update Entities now tells you why an update failed, separating a response that ran out of room from one that was genuinely malformed, and retries with more room when that was the cause.',
      'A failed tagging pass while archiving is now reported instead of quietly leaving that history harder to recall.',
      'The archive window now closes as soon as your history is saved. The recap and entity tags finish in the background, and the summary shows its progress in Context & Memory.',
      'Entity tagging no longer throws away results when the AI writes a category name in the singular, such as Character instead of Characters.',
      'Entity tagging is far more reliable on prose with dashes, quotation marks and accents. It no longer throws away correct results because the AI retyped a quote slightly differently.',
      'A summary recap and its entity tags now succeed or fail independently, so a tagging problem never costs you the recap.',
      'A summary that is still finishing shows how far along its tagging is, right on its card in Context & Memory.',
      'A summary left unfinished by closing the app can be completed later instead of being stuck without a recap or tags.',
      'New summaries are numbered by the summaries you have, so a workspace with custom memory no longer starts at Summarization 2.',
      'Archiving a long history is much faster, and the window now tells you which stage it is on instead of sitting silent.',
      'A tagging problem partway through an archive no longer costs the whole archive its entity tags.',
      'Editing a message in a long conversation no longer lags while you type.',
      'Kallamo remembers your window size and position between launches instead of always starting maximized.',
      'The workspace menu on the dashboard is in English.',
      'A character now has Appearance and Personality on their sheet. Update Entities could already suggest both, and accepting one saved it, but there was nowhere to see it. Anything you accepted before is still there and shows up now.',
      'What a character looks like and how they behave now reaches the AI when your world is recalled, instead of staying on the sheet. The same goes for what kind of thing an event was.',
      'A creature saved as a group or species no longer asks for a Personality, since that belongs to one being rather than a whole kind. Appearance stays, and now asks what the members look like.',
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
      version: '1.1.6',
      ...RELEASE_1_1_6,
    },
    {
      version: '1.1.5',
      ...RELEASE_1_1_5,
    },
    {
      version: '1.1.4',
      ...RELEASE_1_1_4,
    },
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
  '1.1.6': {
    ...RELEASE_1_1_6,
    intro: 'This update rebuilds how a workspace remembers a long story. Summaries can be deleted and rebuilt freely, you decide what each message becomes, and recall reaches further back.',
    highlights: [],
  },
  '1.1.5': {
    ...RELEASE_1_1_5,
    intro: 'This focused patch restores dependable local AI connections and corrects the chat paths around sending, retrying, editing, and regenerating.',
    highlights: [
      {
        icon: 'Brain',
        title: 'Local AI requests reach the provider',
        text: 'Kallamo now keeps your active AI target and attachments through the send flow, while handling local base URLs and complete endpoints consistently.',
      },
      {
        icon: 'PenLine',
        title: 'Safer editing and regeneration',
        text: 'Edited history reaches the model correctly, and your previous response remains available if regeneration fails.',
      },
      {
        icon: 'Sparkles',
        title: 'Clearer recovery from errors',
        text: 'Provider details remain visible, and recovery controls appear only when the interrupted generation can continue.',
      },
    ],
  },
  '1.1.4': {
    ...RELEASE_1_1_4,
    intro: 'This update gives you more control over Kallamo\'s background AI work while making retrieval, Worldbuild updates, chat, and writing more dependable.',
    highlights: [
      {
        icon: 'Brain',
        title: 'Put the right AI on each task',
        text: 'In Settings > Engine & Memory, choose dedicated executors for background tasks and the language they use.',
      },
      {
        icon: 'Globe2',
        title: 'Worldbuild updates that keep their place',
        text: 'Update Entities keeps track of evidence and retries, handles common AI response issues, and protects your canonical data while suggestions remain under review.',
      },
      {
        icon: 'PenLine',
        title: 'A steadier writing and chat flow',
        text: 'Edit & Regenerate now follows the edited conversation, completed replies respect where you are reading, and everyday Writing Desk controls behave more naturally.',
      },
    ],
  },
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
