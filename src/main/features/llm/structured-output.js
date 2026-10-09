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

// Gemini reads an OpenAPI subset: upper-case types, `nullable` instead of a null branch, and
// properties in alphabetical order unless told otherwise. A schema it cannot express exactly
// (an open object, a union, a reference) returns null, and the request keeps plain JSON mode.
function geminiResponseSchema(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  if (node.$ref || node.const !== undefined || node.oneOf || node.allOf) return null;
  if (Array.isArray(node.anyOf)) {
    const branches = node.anyOf.filter(branch => branch?.type !== 'null');
    if (branches.length !== 1 || branches.length === node.anyOf.length) return null;
    const inner = geminiResponseSchema(branches[0]);
    return inner ? { ...inner, nullable: true } : null;
  }
  if (typeof node.type !== 'string') return null;
  const result = { type: node.type.toUpperCase() };
  if (node.description) result.description = node.description;
  if (Array.isArray(node.enum)) {
    if (node.type !== 'string') return null;
    result.enum = node.enum;
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== undefined && node.additionalProperties !== false) return null;
    const entries = Object.entries(node.properties || {});
    if (!entries.length) return null;
    result.properties = {};
    for (const [name, schema] of entries) {
      const converted = geminiResponseSchema(schema);
      if (!converted) return null;
      result.properties[name] = converted;
    }
    result.propertyOrdering = entries.map(([name]) => name);
    if (Array.isArray(node.required)) result.required = node.required;
  }
  if (node.type === 'array') {
    const items = geminiResponseSchema(node.items);
    if (!items) return null;
    result.items = items;
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

module.exports = { openAiResponseFormat, applyBedrockStructuredOutput, claudeCompatibleSchema, geminiResponseSchema };
