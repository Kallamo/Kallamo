// The roleplay narrator plans each character's turn inside <scene_plan> before narrating. The plan
// is diagnostics only: it never reaches the reply, the history or the stream.
const OPEN_TAG = '<scene_plan>';
const CLOSE_TAG = '</scene_plan>';
const PLAN_BLOCK = /<scene_plan>([\s\S]*?)<\/scene_plan>/i;
const UNCLOSED_PLAN = /<scene_plan>([\s\S]*)$/i;

function extractScenePlan(text) {
    const value = String(text ?? '');
    const closed = PLAN_BLOCK.exec(value);
    if (closed) {
        return {
            plan: closed[1].trim(),
            text: (value.slice(0, closed.index) + value.slice(closed.index + closed[0].length).replace(/^\s+/, '')).trim()
        };
    }
    // A plan the model never closed swallowed the reply; what remains is still not narration.
    const open = UNCLOSED_PLAN.exec(value);
    if (open) return { plan: open[1].trim(), text: value.slice(0, open.index).trim() };
    return { plan: '', text: value };
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
