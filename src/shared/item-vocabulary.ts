// The closed lists an item or a creature group is described with. The sheet, the AI prompt and the
// check on what the AI answers all read them here, so the two processes cannot drift apart.

export interface VocabularyEntry {
  id: string;
  hint?: string;
}

// Rarest first: the scale reads top to bottom in the sheet and in every prompt. Stored values are
// the ids, so a new step never invalidates one already saved.
export const ABUNDANCE_LEVELS: readonly VocabularyEntry[] = Object.freeze([
  { id: 'Unique', hint: 'Only one exists in the whole world.' },
  { id: 'Mythic', hint: 'A handful in the whole world, known by name.' },
  { id: 'Very rare', hint: 'Few exist; most people never see one.' },
  { id: 'Rare', hint: 'Very few, hard to come by.' },
  { id: 'Uncommon', hint: 'Exists, but not everywhere.' },
  { id: 'Common', hint: 'Found in most places.' },
  { id: 'Abundant', hint: 'Everywhere, effectively unlimited.' },
]);

export const ITEM_CATEGORIES: readonly VocabularyEntry[] = Object.freeze([
  { id: 'Weapon' },
  { id: 'Armor' },
  { id: 'Tool' },
  { id: 'Consumable' },
  { id: 'Artifact' },
  { id: 'Document' },
  { id: 'Container' },
  { id: 'Currency' },
  { id: 'Material' },
  { id: 'Resource', hint: 'Natural resources and creature drops' },
  { id: 'Furniture' },
  { id: 'Art', hint: 'Paintings, sculpture and other made works' },
  { id: 'Vehicle', hint: 'Anything ridden or steered: carts, ships, cars' },
  { id: 'Object', hint: 'Anything that fits no other category' },
]);

export const ABUNDANCE_IDS: readonly string[] = Object.freeze(ABUNDANCE_LEVELS.map(level => level.id));
export const ITEM_CATEGORY_IDS: readonly string[] = Object.freeze(ITEM_CATEGORIES.map(category => category.id));
