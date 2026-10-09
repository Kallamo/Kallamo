function openAiResponseFormat(schema) {
  if (!schema) return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: { name: 'kallamo_structured_response', strict: false, schema }
  };
}

// Claude refuses the whole schema over a single bound it cannot enforce. The callers already
// clamp and validate what comes back, so the bounds are dropped rather than the schema.
const CLAUDE_UNSUPPORTED_KEYWORDS = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'maxItems'
]);
// Keys whose value maps names to schemas, so a property called "maximum" is kept.
const SCHEMA_MAPS = new Set(['properties', '$defs', 'definitions']);
// Keys whose value is data, not a schema.
const SCHEMA_VALUES = new Set(['enum', 'const', 'default', 'examples', 'required']);

function claudeCompatibleSchema(node) {
  if (Array.isArray(node)) return node.map(claudeCompatibleSchema);
  if (!node || typeof node !== 'object') return node;
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (CLAUDE_UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === 'minItems' && value > 1) continue;
    if (SCHEMA_VALUES.has(key)) result[key] = value;
    else if (SCHEMA_MAPS.has(key) && value && typeof value === 'object') {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, claudeCompatibleSchema(schema)]));
    } else result[key] = claudeCompatibleSchema(value);
  }
  return result;
}

function applyBedrockStructuredOutput(requestBody, schema) {
  if (!schema) return requestBody;
  return {
    ...requestBody,
    output_config: { format: { type: 'json_schema', schema: claudeCompatibleSchema(schema) } }
  };
}

module.exports = { openAiResponseFormat, applyBedrockStructuredOutput, claudeCompatibleSchema };
