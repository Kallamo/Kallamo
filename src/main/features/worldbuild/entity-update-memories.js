// What each owner already remembers, approved or still waiting for review, compared by meaning.
// The same scene told in other words is a duplicate, not a new memory.

// On the local e5 model, unrelated memories of one owner score up to ~0.927 (p99 on a long
// campaign) and retellings of one scene from 0.93 up.
const DUPLICATE_FLOOR = 0.93;
const PROMPT_MEMORIES = 12;

const cosine = (left, right) => {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
};

/**
 * `load(ownerId)` lists the owner's memory texts; `embed(texts)` returns one normalized vector per
 * text, or null when meaning cannot be compared (an external engine, a failure), and then only the
 * textual check applies.
 */
function createMemoryIndex({ load, embed, comparable }) {
  const owners = new Map();
  const vectors = new Map();
  let canEmbed = typeof embed === 'function';

  async function vectorsFor(texts) {
    const missing = [...new Set(texts.filter(text => !vectors.has(text)))];
    if (missing.length && canEmbed) {
      try {
        const result = await embed(missing);
        if (!Array.isArray(result) || result.length !== missing.length) throw new Error('unexpected embedding shape');
        missing.forEach((text, index) => vectors.set(text, result[index]));
      } catch (error) {
        console.warn('[Entity Update] Memories are compared by text only:', error.message);
        canEmbed = false;
      }
    }
    return texts.map(text => vectors.get(text) || null);
  }

  function memoriesOf(ownerId) {
    if (!owners.has(ownerId)) owners.set(ownerId, [...new Set(load(ownerId).map(text => String(text || '').trim()).filter(Boolean))]);
    return owners.get(ownerId);
  }

  async function closest(ownerId, text) {
    const known = memoriesOf(ownerId);
    const own = comparable(text);
    const literal = known.find(item => {
      const other = comparable(item);
      return other === own || other.includes(own) || (own.length > 40 && own.includes(other));
    });
    if (literal) return { similarity: 1, text: literal };
    if (!known.length || !canEmbed) return { similarity: 0, text: '' };
    const [vector, ...others] = await vectorsFor([text, ...known]);
    if (!vector) return { similarity: 0, text: '' };
    let best = { similarity: 0, text: '' };
    others.forEach((other, index) => {
      if (!other) return;
      const similarity = cosine(vector, other);
      if (similarity > best.similarity) best = { similarity, text: known[index] };
    });
    return best;
  }

  return {
    async isDuplicate(ownerId, text) {
      const match = await closest(ownerId, text);
      return { duplicate: match.similarity >= DUPLICATE_FLOOR, ...match };
    },
    remember(ownerId, text) {
      memoriesOf(ownerId).push(String(text || '').trim());
    },
    // The owner's memories nearest to what is being read, whole, instead of the newest few cut short.
    async nearest(ownerId, passages, limit = PROMPT_MEMORIES) {
      const known = memoriesOf(ownerId);
      if (known.length <= limit || !canEmbed || !passages.length) return known.slice(-limit);
      const all = await vectorsFor([...passages, ...known]);
      const passageVectors = all.slice(0, passages.length).filter(Boolean);
      if (!passageVectors.length) return known.slice(-limit);
      return known
        .map((text, index) => {
          const vector = all[passages.length + index];
          return { text, score: vector ? Math.max(...passageVectors.map(passage => cosine(passage, vector))) : 0 };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map(item => item.text);
    },
  };
}

module.exports = { createMemoryIndex, DUPLICATE_FLOOR };
