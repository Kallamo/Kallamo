// The roleplay narrator plans each character's turn inside <scene_plan> before narrating. The plan
// is diagnostics only: it never reaches the reply, the history or the stream.
const OPEN_TAG = '<scene_plan>';
const CLOSE_TAG = '</scene_plan>';
const PLAN_BLOCK = /<scene_plan>([\s\S]*?)<\/scene_plan>/i;
const PLAN_BLOCKS = /<scene_plan>[\s\S]*?<\/scene_plan>\s*/gi;
const UNCLOSED_PLAN = /<scene_plan>([\s\S]*)$/i;
const LEADING_REASONING = /^\s*<think>[\s\S]*?<\/think>/i;

// Reasoning stays as the model wrote it; a plan drafted inside it is not the one that counts.
function extractScenePlan(text) {
    const value = String(text ?? '');
    const reasoning = LEADING_REASONING.exec(value)?.[0] || '';
    const reply = value.slice(reasoning.length);
    const closed = PLAN_BLOCK.exec(reply);
    if (closed) {
        return {
            plan: closed[1].trim(),
            text: (reasoning + reply.replace(PLAN_BLOCKS, '')).trim()
        };
    }
    // A plan the model never closed swallowed the reply; what remains is still not narration.
    const open = UNCLOSED_PLAN.exec(reply);
    if (open) return { plan: open[1].trim(), text: (reasoning + reply.slice(0, open.index)).trim() };
    return { plan: PLAN_BLOCK.exec(reasoning)?.[1].trim() || '', text: value };
}

/**
 * Holds content back only while it could still be the opening of a plan, so a reply without one
 * streams untouched. A plan is dropped up to its closing tag.
 */
function createScenePlanStreamFilter() {
    let state = 'detect';
    let buffer = '';
    return {
        push(delta) {
            if (!delta) return '';
            if (state === 'pass') return delta;
            if (state === 'trim') {
                const narration = delta.replace(/^\s+/, '');
                if (narration) state = 'pass';
                return narration;
            }
            buffer += delta;
            if (state === 'detect') {
                const leading = buffer.trimStart();
                if (leading.length < OPEN_TAG.length && OPEN_TAG.startsWith(leading.toLowerCase())) return '';
                if (!leading.toLowerCase().startsWith(OPEN_TAG)) {
                    state = 'pass';
                    const released = buffer;
                    buffer = '';
                    return released;
                }
                state = 'plan';
            }
            const end = buffer.toLowerCase().indexOf(CLOSE_TAG);
            if (end < 0) return '';
            const released = buffer.slice(end + CLOSE_TAG.length).replace(/^\s+/, '');
            state = released ? 'pass' : 'trim';
            buffer = '';
            return released;
        },
        // Whatever is still held when the stream ends was only ever a possible plan opening.
        flush() {
            const released = state === 'detect' ? buffer : '';
            buffer = '';
            state = 'pass';
            return released;
        }
    };
}

module.exports = { createScenePlanStreamFilter, extractScenePlan };
