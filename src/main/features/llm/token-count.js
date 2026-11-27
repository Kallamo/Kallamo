// The o200k table takes about a third of a second to load, so it waits for the first count instead of the launch.
let tokenizer = null;
const o200k = () => tokenizer || (tokenizer = require('gpt-tokenizer/encoding/o200k_base'));

const encode = (text) => o200k().encode(text);

/** Loads the table ahead of the first count, once the window is up. */
function preloadTokenizer() {
    try { o200k(); } catch (error) { console.warn('[Tokens] Could not preload the tokenizer:', error); }
}

module.exports = { encode, preloadTokenizer };
