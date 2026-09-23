const STORY_EVIDENCE_MARKER = '[STORY EVIDENCE, NOT AUTOMATIC CHARACTER KNOWLEDGE]';
const LEADING_STORY_EVIDENCE_MARKERS = new RegExp(
    `^(?:${escapeRegExp(STORY_EVIDENCE_MARKER)}[\\t ]*(?:\\r?\\n)?)+`
);

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingStoryEvidenceMarkers(content) {
    return String(content || '').replace(LEADING_STORY_EVIDENCE_MARKERS, '');
}

module.exports = {
    STORY_EVIDENCE_MARKER,
    stripLeadingStoryEvidenceMarkers
};
