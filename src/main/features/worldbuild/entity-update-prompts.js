// Rules of each Update entities pass. The system prompt never names a sheet, so every sheet of a
// run shares it and a provider can serve it from cache; everything about one sheet goes in the request.

const CANON_SHAPE = '{"changes":[{"kind":"field","key":"<allowed field key>","value":"<JSON encoded value>","target":"","targetRole":"","support":"<direct support>","evidence":["<evidence id>"]}]}';
const NARRATIVE_SHAPE = '{"changes":[{"kind":"memory","key":"","value":"","subjectId":"","target":"","targetId":"","perspectiveOwnerId":"","targetRole":"","sourcePerspective":"","score":0,"direction":"","cause":"","impact":"","method":"","accessibility":"","support":"<direct support>","evidence":["<evidence id>"]}]}';

const SHARED_EVIDENCE_RULES = [
  '- Every change must cite one or more supplied evidence IDs that support that exact change. support restates what the evidence says; never speculate about why a current value differs.',
  '- A preceding passage shown before an evidence block only tells whose section or scene the block belongs to. Use it to decide who a line is about; never cite it.',
  '- An Imported source block belongs to the subject named first in its label (before the first ·), and the rest of the label names its section. When that subject is not the record, the block is someone else\'s profile: take from it only what it states about the record itself. That subject\'s affiliation, workplace, home or origin never makes them the leader, owner or creator of the record, and never places the record inside or outside another place.',
  '- In roleplay logs, "you" and "your" refer to the player character named in the request.',
  '- CANONICAL SYSTEM / CONCEPT CONTEXT defines setting-specific terms. Use it to interpret evidence, but do not copy a concept\'s facts into the record unless the evidence explicitly connects them. The same holds for a passage about a race, people, or culture in general: it describes the group, not this record.',
  '- Text between || and || in the current record is a spoiler: true, but hidden from the person reading the sheet. A new value for a field that holds one must keep each span exactly, markers included, and must never restate it outside them. Write a new fact that would spoil a surprise inside new || markers on a single line.',
  '- Do not invent facts, names, or fields absent from the passages.',
];

function buildCanonSystemPrompt({ languageInstruction = '', sourceLanguageInstruction = '' } = {}) {
  return [
    languageInstruction,
    sourceLanguageInstruction,
    'You maintain one record of a story\'s world bible: its fields, its links to other records, its skills and its background. ' +
      'What happens in the story\'s scenes is recorded elsewhere; your job is the lasting sheet. Use the CURRENT RECORD plus ONLY the NEW STORY EVIDENCE in the request.',
    `Return one valid JSON object and nothing else. Use {"changes":[]} when nothing should change. Every change uses this fixed shape:\n${CANON_SHAPE}`,
    'All keys are required. Use an empty string for keys that do not apply. Encode field values as JSON inside value: plain text remains plain text, numbers use "12", booleans use "true", and lists use "[\\"one\\",\\"two\\"]". Never output angle-bracket placeholders.',
    'Kinds: field (an allowed data field), link (an allowed link, target one candidate), history (one background statement), skill (only when the request has a SKILLS block).',
    'BACKGROUND (kind "history"): the record\'s past, never its present story.',
    '- key "before-story": what the record was, lived or did before the story began: origin, family, upbringing, former roles and deeds. A past revealed during the story counts, such as a confession or a memory told aloud.',
    '- key "origin": for something that first appears during the story, how and where it came to be. Later details about that same origin count; what it does afterwards does not.',
    '- Never what happens in the story\'s present: a scene, a meeting, a decision, a fight, a plan, the current situation. Never a current role, title, membership, residence or workplace: those are fields and links. Never appearance, temperament, abilities when the request has a SKILLS block, a passing scene detail, or a general trait of its race, people, or culture.',
    '- One full sentence per statement, in the third person.',
    'STRICT RULES:',
    '- Return a change ONLY when the passages state it explicitly and unambiguously, or when a field\'s own guidance says what else counts as evidence for it. Inference, implication, symbolism, genre convention, probability, and interpretation are otherwise not explicit: omit them.',
    '- Never return a change to say that something is absent, unknown, or not established; omit it instead.',
    '- Do not return unchanged fields or unchanged links.',
    '- Existing values are canonical context, not protected blanks. When new explicit evidence changes an existing value, return the full replacement: keep every part of the current value that is still true and change only what the evidence changes. Never replace a value merely to rephrase it, and never shorten it to one scene.',
    '- EMPTY fields: fill one when the evidence shows a durable trait for it. A single reaction, gesture, or action in one scene does not fill appearance or personality.',
    '- Never infer, estimate, or compute a value. Numeric fields require the explicit resulting absolute value. A delta such as "+1", "-2", "gained 1", or "increased by 2" is not a field value unless the evidence also states the resulting total. Never replace a newer canonical number with an older progression value.',
    '- Persistent fields contain durable canonical characteristics. Do not place a temporary pose, scene location, passing emotion, current lighting, momentary clothing, or short-lived injury into appearance, personality, disposition, description, or another lasting field.',
    '- Only link two records when the text establishes that exact relation. A name, title, accent, or appearance in a scene does not establish origin, residence, or membership. Only nest a location inside another when the passages say one place is physically within the other.',
    '- SKILLS: key is the exact skill name, value the rank name the evidence shows, target the parent skill name for a new sub-skill or "", targetRole a one-sentence meaning only for a new skill. Never lower a rank. Use the closest catalog skill before creating one.',
    ...SHARED_EVIDENCE_RULES,
  ].filter(Boolean).join('\n');
}

function buildNarrativeSystemPrompt({ languageInstruction = '', sourceLanguageInstruction = '', scaleGuide = '', causes = [] } = {}) {
  return [
    languageInstruction,
    sourceLanguageInstruction,
    'You record what the people of a story lived, learned and feel, from passages the story record has not read yet. ' +
      'The request names one RECORD whose passages these are; the findings may belong to anyone present in them.',
    `Return one valid JSON object and nothing else. Use {"changes":[]} when nothing should be recorded. Every change uses this fixed shape:\n${NARRATIVE_SHAPE}`,
    'All keys are required. Use an empty string or 0 for keys that do not apply. Kinds: fact, awareness, knowledge, belief, memory, relationship. Never output angle-bracket placeholders.',
    'OWNERSHIP: subjectId is the entity whose mind, memory, knowledge, belief, fact, or perspective owns the change. perspectiveOwnerId must equal subjectId for relationships. targetId is the existing entity the statement or relationship is about. Use the IDs from ENTITY IDS in the request.',
    'MEMORY:',
    '- What subjectId did, lived through, decided, or took part in, as a past event with who was involved (targetId: the main other entity involved, or ""). Anything the subject did or experienced is a memory, never knowledge.',
    '- Written as its owner lived it, from their own perspective, not as a summary of the event. Never the same text for several owners: give each their own, or record none.',
    '- Only for someone present in the scene, or who perceived it directly. Never for a conversation or event they were absent from, even when it is about them.',
    '- Only a moment that matters to its owner: a bond formed or broken, a decision, a revelation, a victory, a loss, a turning point. Never logistics or routine: walking somewhere, leaving, checking for danger, handing over paperwork, waiting.',
    '- At most one memory per scene for each owner: tell what mattered in that scene in a single memory instead of splitting it into steps.',
    '- Never a scene already told under EXISTING MEMORIES, in any words.',
    'KNOWLEDGE is a fact about someone or something else that subjectId learned inside the story by witnessing it or being told (method "witness" or "reported"). Reading a document is never character Knowledge. Biography, public canon, self-description, predictions, private information unavailable to the subject, and documentary analysis are not new Knowledge. Never use method "inferred" for Knowledge.',
    'BELIEF is something subjectId explicitly holds true in the story. It is never your own reading of their motives or psychology.',
    'AWARENESS requires evidence that the owner knows the target exists. Documentary extraction alone never grants it.',
    'FACT: an explicit canonical proposition, with a concise predicate in key, the proposition in value, and its existing subject in target. Never for a Character record.',
    'For knowledge, belief, and memory, put the statement or summary in value. For knowledge and belief, target must be the exact existing entity the proposition is primarily about, not a location, group, or concept merely mentioned in the sentence.',
    'RELATIONSHIP (how SOURCE, the subjectId, sees TARGET):',
    '- targetRole is what TARGET is to SOURCE, one to four words (Dorian to Tess: "Daughter"). sourcePerspective says how SOURCE sees TARGET. Never TARGET\'s feelings toward SOURCE: those are TARGET\'s own relationship.',
    '- A feeling belongs to whoever the text says feels it. An act alone (helped, saved, trained, fought beside) is a memory, never a relationship, unless the passage also states how SOURCE feels.',
    `- Every relationship names its cause, one of: ${causes.join(', ')}. Courtesy, banter, routine cooperation, mood, compliance, instruction and presence never move a relationship: return nothing for them.`,
    '- impact: meaningful for an ordinary shift, significant for a clear turn, drastic only for an extreme event (a rescue from death, a betrayal that ends the bond).',
    '- A relationship listed under CURRENT RELATIONSHIPS is edited, never rewritten: give direction "closer" or "further", the cause and the impact, keep its targetRole unless the bond changed in kind, and carry its sourcePerspective forward with only what the evidence changes. Leave score 0. When nothing moved it for a named cause, return nothing.',
    '- A relationship not listed yet: give score from the scale below, the cause (first-impression when it is the first meeting), the impact, targetRole and sourcePerspective; leave direction empty. Fighting, meeting, or sharing a scene once is not a relationship.',
    scaleGuide ? `- ${scaleGuide.replace(/\n/g, '\n  ')}` : '',
    'STRICT RULES:',
    '- Return a change ONLY when the passages state it explicitly. Returning few or no changes is correct when the passages hold nothing durable.',
    ...SHARED_EVIDENCE_RULES,
  ].filter(Boolean).join('\n');
}

function buildFieldGapSystemPrompt({ languageInstruction = '', sourceLanguageInstruction = '' } = {}) {
  return [
    languageInstruction,
    sourceLanguageInstruction,
    'You fill the empty fields of one record of a story\'s world bible from passages chosen for those fields.',
    'Return one valid JSON object and nothing else: {"fields":[{"key":"<field key>","status":"found","value":"<JSON encoded value>","support":"<direct support>","evidence":["<evidence id>"]}]}.',
    'Answer EVERY field listed under EMPTY FIELDS exactly once. status "found" with a value, its support and the evidence IDs that show it; status "absent" with an empty value and no evidence when the passages do not show it.',
    'Each field says what counts as evidence for it. Follow that guidance: it may accept something shown consistently across passages (pronouns, where someone sleeps every night) and refuse a single scene.',
    'Encode values as JSON inside value: plain text remains plain text, numbers use "12", booleans use "true", lists use "[\\"one\\",\\"two\\"]". A choice field takes one of its options exactly. A link field takes one candidate name exactly.',
    'Never guess, never compute, never take a trait of a race, people or culture as the record\'s own. A temporary state (a pose, a passing emotion, today\'s clothes, a short-lived injury) never fills a lasting field.',
    'Text between || and || is a spoiler; keep it inside its markers.',
  ].filter(Boolean).join('\n');
}

function buildLoreCleanupSystemPrompt({ languageInstruction = '' } = {}) {
  return [
    languageInstruction,
    'A record\'s lore must hold only its background: what it was and lived before the story began, or, for something that first appears during the story, how it came to be. What happens in the story\'s scenes belongs to the story record, and current roles, titles, memberships, homes and workplaces belong to the sheet\'s fields and links.',
    'You receive the current lore split into numbered sentences, and the date or moment the story began when it is known. Sort every sentence: "keep" for background (including a past revealed during the story), "story" for anything that happens in or describes the story\'s present.',
    'Return only {"keep":[numbers],"story":[numbers]}, every sentence number exactly once. Never rewrite a sentence.',
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildCanonSystemPrompt,
  buildNarrativeSystemPrompt,
  buildFieldGapSystemPrompt,
  buildLoreCleanupSystemPrompt,
};
