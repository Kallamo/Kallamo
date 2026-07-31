function openAiResponseFormat(schema) {
  if (!schema) return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: { name: 'kallamo_structured_response', strict: false, schema }
  };
}

function applyBedrockStructuredOutput(requestBody, schema) {
  if (!schema) return requestBody;
  return {
    ...requestBody,
    output_config: { format: { type: 'json_schema', schema } }
  };
}

module.exports = { openAiResponseFormat, applyBedrockStructuredOutput };
