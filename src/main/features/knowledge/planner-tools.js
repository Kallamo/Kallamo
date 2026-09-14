// The retrieval planner's tool surface, written once. The text protocol renders it as tag
// syntax and native tool calling renders it as function definitions, so both describe the
// same tools in the same words.

const PLANNER_TOOLS = [
  {
    name: 'search_kb',
    arg: 'query',
    hint: 'a full question',
    description: "Searches the profile's and the workspace's knowledge base files. Write the query as a whole question or statement, keeping proper nouns exactly as written."
  },
  {
    name: 'read_file',
    arg: 'filename',
    hint: 'filename.txt',
    description: 'Reads the entire text of one knowledge base file, when you need complete code or a full lore or character profile.'
  },
  {
    name: 'search_memories',
    arg: 'query',
    hint: 'a full question, or #tags',
    description: "Searches the chat's archived memory, custom snippets and manual tags. Write a whole question, or exact hashtags such as #character or #backstory."
  },
  {
    name: 'lookup_entity',
    arg: 'query',
    hint: 'entity name or alias',
    description: "Returns the passages tagged with a known world entity (see KNOWN ENTITIES) that are most relevant to the request, across the chat archive, the workspace files and the workspace documents, by exact name or alias. It also lists the entity's RELATED ENTITIES; follow one with another lookup_entity to traverse the world by structure. Passages that mention the entity only in passing may be untagged, so use search_memories with specific terms when looking for one detail. Prefer this over the searches when the request is about a known entity."
  },
  {
    name: 'read_lore',
    arg: 'query',
    hint: 'entity name or alias',
    description: "For an entity with a linked lore document (Writing Desk), returns the passages of that document most relevant to the request. Use it when lookup_entity shows the entity has authored lore and you need its canonical background. Does nothing if the entity has no linked lore."
  },
  {
    name: 'expand',
    arg: 'query',
    hint: 'R3 or a source name',
    description: 'Re-reads the full text of a result that was shown as a snippet (results are labelled like [R3 · source]). Use it only when the snippet is not enough to decide; everything retrieved already reaches the writing assistant in full.'
  }
];

const TOOL_NAMES = PLANNER_TOOLS.map(tool => tool.name);

const FINISH_DESCRIPTION = 'Ends the research. List the result handles (R3, R7) and exact file names of the results that were actually relevant; listed results get priority in the final context, and when none are listed every result is included equally. Keep the summary to one or two sentences and never copy retrieved text into it: the full text of every result already reaches the writing assistant. Only state facts that appear in the results.';

function toolByName(name) {
  return PLANNER_TOOLS.find(tool => tool.name === String(name || '').toLowerCase()) || null;
}

// Models name the argument loosely, so every spelling the text parser accepts is read here too.
function argOf(name, args) {
  const values = args && typeof args === 'object' ? args : {};
  const tool = toolByName(name);
  const value = (tool && values[tool.arg]) ?? values.query ?? values.filename ?? values.file ?? values.q ?? values.term ?? values.arg ?? '';
  return String(value).trim();
}

function plannerToolDefinitions() {
  return [
    ...PLANNER_TOOLS.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: { [tool.arg]: { type: 'string', description: tool.hint } },
        required: [tool.arg]
      }
    })),
    {
      name: 'finish',
      description: FINISH_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          sources: { type: 'string', description: 'Comma-separated result handles and file names that were relevant.' },
          summary: { type: 'string', description: 'One or two sentences about what was found.' }
        },
        required: ['summary']
      }
    }
  ];
}

function textToolCatalog() {
  const tools = PLANNER_TOOLS.map((tool, index) =>
    `${index + 1}. <tool_call name="${tool.name}" ${tool.arg}="${tool.hint}" />\n   ${tool.description}`);
  tools.push(`${PLANNER_TOOLS.length + 1}. <finish sources="R3, notes.txt">one or two sentences</finish>\n   ${FINISH_DESCRIPTION}`);
  return tools.join('\n');
}

// A native call replayed in the text protocol, so a transcript that changes protocol mid-loop
// still reads as one coherent conversation.
function renderTextCall(call) {
  const clean = value => String(value ?? '').replace(/"/g, "'");
  if (call.name === 'finish') {
    const sources = Array.isArray(call.args?.sources) ? call.args.sources.join(', ') : call.args?.sources;
    return `<finish sources="${clean(sources)}">${String(call.args?.summary ?? '')}</finish>`;
  }
  const tool = toolByName(call.name);
  return `<tool_call name="${call.name}" ${tool ? tool.arg : 'query'}="${clean(argOf(call.name, call.args))}" />`;
}

module.exports = {
  PLANNER_TOOLS,
  TOOL_NAMES,
  argOf,
  plannerToolDefinitions,
  textToolCatalog,
  renderTextCall
};
