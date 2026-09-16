// The one Tagger pipeline: prompt, batches, request, repair, split on a cut reply, validation.
// Names already found in the text arrive as hints, so the model reports only what is left.

const { TAGGER_RESPONSE_SCHEMA, parseTaggerResponse, createTaggerBatches } = require('./tagger-response');
const { matchedEvidence, evidenceText } = require('./evidence-match');
const { buildCategoryResolver } = require('./category-match');

const TAGGER_MAX_TOKENS = 4096;
// Kept low: higher earns 429s from most providers.
const TAGGER_CONCURRENCY = 3;

function describeTagRejections(rejections) {
  const counts = new Map();
  const samples = new Map();
  for (const entry of rejections) {
    counts.set(entry.reason, (counts.get(entry.reason) || 0) + 1);
    if (!samples.has(entry.reason)) samples.set(entry.reason, entry.detail);
  }
  const wording = {
    'unknown-category': (n, sample) => `${n} used a category this workspace does not have (for example "${sample}")`,
    'no-name': (n) => `${n} carried no name`,
    'evidence-not-found': (n, sample) => `${n} quoted text that is not in the chunk (for example "${sample}")`
  };
  const parts = [];
  for (const [reason, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const describe = wording[reason];
    if (describe) parts.push(describe(count, samples.get(reason)));
  }
  return parts.join('; ');
}

// `rejections` records why each mention was dropped: an unknown category and
// unquoted evidence need opposite fixes, so the error must name which one.
function validateChunkTags(arr, categories, chunkRecords, rejections = null) {
  const chunkCount = Array.isArray(chunkRecords) ? chunkRecords.length : Number(chunkRecords) || 0;
  const resolveCategory = buildCategoryResolver(categories);
  const out = [];
  for (const entry of (Array.isArray(arr) ? arr : [])) {
    if (!entry || typeof entry !== 'object') continue;
    const idx = Number(entry.chunk);
    if (!Number.isInteger(idx) || idx < 0 || idx >= chunkCount) continue;
    const reject = (reason, detail) => { if (rejections) rejections.push({ reason, detail, chunk: idx }); };
    const tags = [];
    const chunkText = Array.isArray(chunkRecords) ? String(chunkRecords[idx]?.text || '') : '';
    for (const mention of (Array.isArray(entry.mentions) ? entry.mentions : [])) {
      const rawType = String(mention && (mention.type || mention.tag) || '').trim();
      const name = resolveCategory(rawType);
      const value = String(mention && (mention.canonicalName || mention.value || mention.text) || '').trim();
      // Store the excerpt the chunk actually supports, not everything the model offered.
      const evidence = matchedEvidence(chunkText, mention && mention.evidence);
      if (!name) { reject('unknown-category', rawType || '(empty)'); continue; }
      if (!value) { reject('no-name', rawType); continue; }
      if (!evidence) { reject('evidence-not-found', evidenceText(mention && mention.evidence).slice(0, 160)); continue; }
      const proposalKind = String(mention && mention.proposalKind || '').trim().toLowerCase();
      const surface = String(mention && mention.text || '').trim();
      tags.push({ tag: name, value, surface, evidence, proposalKind });
    }
    if (tags.length) out.push({ chunkIndex: idx, tags });
  }
  return out;
}

function buildTaggerSystemPrompt({ languageInstruction = '', categories = [], vocab = '' } = {}) {
  const catLines = categories.length
    ? categories.map(c => `- ${c.name}: ${c.description}`).join('\n')
    : '- Characters: People, beings, or named agents present in the scene.';
  return [
    languageInstruction,
    'You tag a text segment that is split into numbered chunks.',
    'Known entities written with a registered name or alias are already tagged; each chunk lists them as "Already tagged". Never report those again for that chunk.',
    'For EACH chunk, report only what is left:',
    '- a known entity referenced without its registered name or alias: a title, a nickname, the same name in another grammatical form (declined, possessive, or with an attached particle), a misspelling, or a role or description that the same chunk clearly ties to that one entity;',
    '- a name that belongs to several known entities: tag the one the chunk refers to, and only when the chunk makes that clear;',
    '- words listed under a chunk as "Check": each may be another form of a known name, a name shared by several entities, or a name that is also a common word. Tag one only when the chunk refers to that entity;',
    '- a specific persistent story entity that is not known yet and is named explicitly in the chunk. A persistent entity is something a user would reasonably find and reuse in a world bible.',
    'Report a known entity only when the chunk refers to that specific entity. A common word or generic phrase that merely matches or resembles its name, or a longer word that contains the name, is not a reference.',
    'Categories:',
    catLines,
    vocab,
    'Treat every chunk on its own: an entity referenced in three chunks appears under all three.',
    'Never propose a name already present in Known entities, even under another category. Do not turn generic nouns, unnamed roles, pronouns, descriptive phrases, or ordinary objects into new entities. A role alone (for example captain, duke, guard, blacksmith), a generic organization word (order, guild, army), or an ordinary object (sword, spear, cane, coat) is not a new entity. Distinctive reusable world-specific items or materials (for example Dragon Mead or Salamander Leather) are valid item types even when they are not unique objects. When identity or category is ambiguous, omit the mention. Every mention must include a short verbatim evidence excerpt copied from that chunk\'s text.',
    'Use ONLY the category names above.',
    'Return one valid JSON object and nothing else. Its exact shape is {"items": [{"chunk": <number>, "mentions": [{"text": "<surface text>", "canonicalName": "<existing canonical name or exact explicit name>", "type": "<Category>", "proposalKind": "known|named|world_specific_type", "evidence": "<verbatim excerpt>"}]}]}.',
    'Use proposalKind=known only for a supplied Known entity, named for a specific proper entity or unique named artifact, and world_specific_type only for a distinctive reusable Items type or material. Never use named for a generic role, category, or ordinary object.',
    'Use {"items": []} when nothing is left to report.'
  ].filter(Boolean).join('\n');
}

// `detected` maps a chunk id to the canonical names already tagged in it; `candidates`
// to the "word -> possible entity" hints the model has to confirm or ignore.
function renderTaggerChunks(records, detected = new Map(), candidates = new Map()) {
  return records.map((record, index) => {
    const names = detected.get(record.id) || [];
    const checks = candidates.get(record.id) || [];
    const hint = (names.length ? `Already tagged: ${names.join('; ')}\n` : '') + (checks.length ? `Check: ${checks.join('; ')}\n` : '');
    return `[CHUNK ${index}]\n${hint}${record.text}`;
  }).join('\n\n');
}

function normalizeReply(reply) {
  if (reply && typeof reply === 'object') return { content: String(reply.content ?? ''), truncated: Boolean(reply.truncated) };
  return { content: String(reply ?? ''), truncated: false };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// A cut or unreadable reply is retried on each half of the batch, down to one chunk.
// A chunk that still fails is reported failed, never completed.
async function runModelTagger({
  records,
  detected = new Map(),
  candidates = new Map(),
  categories = [],
  vocabFor = () => '',
  languageInstruction = '',
  send,
  onProgress = null,
  concurrency = TAGGER_CONCURRENCY,
  maxTokens = TAGGER_MAX_TOKENS
}) {
  const list = Array.isArray(records) ? records : [];
  const position = new Map(list.map((record, index) => [record.id, index]));
  const outcomes = new Map();
  const chunkTags = [];
  let done = 0;
  const report = (count) => {
    done += count;
    if (onProgress) onProgress(Math.min(done, list.length), list.length);
  };
  const fail = (batch, error) => {
    for (const record of batch) outcomes.set(record.id, { status: 'failed', error, rejected: 0 });
    report(batch.length);
  };

  const attempt = async (batch) => {
    const numbered = renderTaggerChunks(batch, detected, candidates);
    const systemPrompt = buildTaggerSystemPrompt({ languageInstruction, categories, vocab: vocabFor(batch.map(record => record.text).join('\n\n')) });
    const request = async (prompt, repair) => normalizeReply(await send({
      systemPrompt,
      newPrompt: prompt,
      temperature: repair ? 0 : 0.1,
      maxTokens,
      jsonMode: true,
      jsonSchema: TAGGER_RESPONSE_SCHEMA,
      includeResponseMetadata: true
    }));
    const read = (reply) => {
      const parsed = parseTaggerResponse(reply.content);
      const rejections = [];
      const validated = parsed.valid ? validateChunkTags(parsed.items, categories, batch, rejections) : [];
      // A chunk listed with no mentions is a valid "nothing left"; only all-rejected mentions are unusable.
      const offered = parsed.items.reduce((sum, item) => sum + (Array.isArray(item && item.mentions) ? item.mentions.length : 0), 0);
      return { parsed, rejections, validated, unusable: !parsed.valid || (offered > 0 && validated.length === 0) };
    };

    let reply = await request(numbered, false);
    if (reply.truncated) return { cut: true };
    let result = read(reply);
    if (result.unusable) {
      reply = await request(
        `Repair the response below to the exact required JSON shape. Preserve only mentions supported by the original numbered chunks.\n\nORIGINAL CHUNKS:\n${numbered}\n\nINVALID RESPONSE:\n${reply.content.slice(0, 12000)}`,
        true
      );
      if (reply.truncated) return { cut: true };
      result = read(reply);
    }
    if (!result.parsed.valid) return { cut: true, error: 'The Tagger returned invalid structured JSON after one repair attempt.' };
    if (result.unusable) {
      const detail = describeTagRejections(result.rejections);
      return { error: detail ? `The Tagger returned mentions, but none could be used: ${detail}.` : 'The Tagger returned mentions, but none could be used.' };
    }
    return result;
  };

  const runBatch = async (batch) => {
    let result;
    try {
      result = await attempt(batch);
    } catch (error) {
      fail(batch, (error && error.message) || String(error));
      return;
    }
    if (result.cut) {
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await runBatch(batch.slice(0, middle));
        await runBatch(batch.slice(middle));
      } else {
        fail(batch, result.error || 'The Tagger reply was cut off before it finished, even for a single passage.');
      }
      return;
    }
    if (result.error) {
      fail(batch, result.error);
      return;
    }
    const rejected = new Map();
    for (const entry of result.rejections) rejected.set(entry.chunk, (rejected.get(entry.chunk) || 0) + 1);
    for (const entry of result.validated) chunkTags.push({ chunkIndex: position.get(batch[entry.chunkIndex].id), tags: entry.tags });
    batch.forEach((record, index) => outcomes.set(record.id, { status: 'completed', error: null, rejected: rejected.get(index) || 0 }));
    report(batch.length);
  };

  await mapWithConcurrency(createTaggerBatches(list), concurrency, runBatch);
  chunkTags.sort((a, b) => a.chunkIndex - b.chunkIndex);
  return { chunkTags, outcomes };
}

module.exports = {
  TAGGER_MAX_TOKENS,
  TAGGER_CONCURRENCY,
  buildTaggerSystemPrompt,
  renderTaggerChunks,
  validateChunkTags,
  describeTagRejections,
  mapWithConcurrency,
  runModelTagger
};
