// Curated, user-tone release notes for the What's New modal.
// This is intentionally separate from CHANGELOG.md: the changelog is the full
// record, this is the friendly version we actually show people after an update.
// `icon` values are lucide-react component names, resolved in WhatsNewModal.

export const WHATS_NEW = {
  version: '1.1.0',
  title: 'Say hello to the Writing Desk and Worldbuild',
  intro:
    "This is the biggest Kallamo update yet. You can now write long-form work right inside the app, and build a living \"bible\" of your world that the AI actually keeps track of as your story grows. Here is what is new.",
  highlights: [
    {
      icon: 'PenLine',
      title: 'Writing Desk',
      text: 'A real place to write. Format your text, import and export chapters, and select any passage to have an AI profile rewrite it as an inline diff you accept or discard.',
    },
    {
      icon: 'Globe2',
      title: 'Worldbuild',
      text: 'A registry of your characters, places, creatures, and events, plus the relations between them. It can even fill itself in from what you write.',
    },
    {
      icon: 'Brain',
      title: 'A world the AI remembers',
      text: 'Your knowledge is tagged with who and what it mentions, so the AI recalls the right people, places, and items by name during a chat.',
    },
  ],
  // Full, still user-tone notes shown below the highlights.
  changelog: {
    Added: [
      'Writing Desk: a dedicated writing workspace with formatting, page setup, find & replace, import/export, and an AI editing layer that suggests changes as non-destructive inline diffs.',
      'Writing Desk notes: a per-chapter review panel where you can turn an AI analysis into a durable note and jump back to the passage later.',
      'Worldbuild: a per-workspace registry of characters, places, creatures, events and their relations, with rich fields like status, ownership, rarity, and multiple locations.',
      'Worldbuild auto-fill and enrichment: it proposes new entities from your text and stages suggested changes to existing ones for you to accept field by field.',
      'Worldbuild in-text bridge: link a name in your writing to an entity, or create one on the spot, without leaving the page.',
      'Portable Worldbuild packages (.klwb) you can export and import, with imported entities arriving as reviewable proposals.',
      'Living-world index: knowledge is automatically tagged with the entities it mentions, with an Index button and a per-chapter status pill so you always know if the AI\'s memory is current.',
      'Guided first run: three ready-to-use AI Profiles, clearer empty states, and one-time hints that point out the new features.',
      'Memory switches: toggle any knowledge item off to exclude it from the AI without deleting it.',
      'Retrieval Strictness (Settings → Advanced): one clear control over how closely retrieved knowledge must match your query.',
      'Durable chunk edits: hand-edited chunks keep an "edited" badge, survive re-indexing, and travel with an exported knowledge base.',
    ],
    Changed: [
      'Knowledge and memory retrieval is noticeably more accurate, ranking results by how close they actually are to your query so strong matches rise to the top.',
      'Agentic retrieval reads the Worldbuild registry directly, looking entities up by name and following relations to ground its answers.',
      'Sending in a chat, tagging, and Worldbuild enrichment now clearly require a configured System AI, with prompts pointing you to set one up.',
      'Dropdowns and menus no longer get clipped behind neighboring panels, and switching between menus takes a single click.',
      'Helper text throughout the app is more legible and scales with your Interface → Font Size setting.',
    ],
    Fixed: [
      'Facts recorded in Worldbuild now actually reach the AI, not just an entity\'s lore.',
      'Writing Desk chapter indexing is scoped per document, so one chapter\'s memory no longer bleeds into another.',
      'Empty or low-information sections no longer pollute retrieval results.',
      'The relevance cutoff now applies to keyword matches too, so weak keyword-only chunks stop slipping into the context.',
    ],
  },
};
