// Defined once for both protocols, so text tags and native functions describe the same tools.

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
    description: "Returns the passages tagged with a known world entity (see KNOWN ENTITIES) that are most relevant to the request, across the chat archive, the workspace files and the workspace documents, by exact name or alias. It also lists the entity's RELATED ENTITIES; follow one with another lookup_entity to traverse the world by structure. Its Worldbuild facts are narrator authority: they do not mean that any character knows them. Passages that mention the entity only in passing may be untagged, so use search_memories with specific terms when looking for one detail. Prefer this over the searches when the request is about a known entity."
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

// Offered only in a Roleplay workspace, where scene Awareness and per-subject records exist.
const ROLEPLAY_TOOLS = [
  {
    name: 'scan_scene_awareness',
    arg: 'query',
    hint: 'current',
    description: 'Re-reads the compact Awareness map for the player, scene actors, possible observers and nearby characters.'
  },
  {
    name: 'inspect_subject_knowledge',
    arg: 'query',
    hint: 'subject name | target name',
    description: 'Deepens one subject-target pair into known fields and active knowledge or beliefs. Use it only when Awareness is not enough for this scene.'
  },
  {
    name: 'inspect_subject_evidence',
    arg: 'query',
    hint: 'subject name | target name',
    description: 'Explains why one pair is confirmed, derived, an evidence candidate, explicitly unaware or undetermined.'
  },
  {
    name: 'inspect_subject_relationships',
    arg: 'query',
    hint: 'subject name',
    description: "Reads the subject's outgoing current relationships for private behavior planning."
  },
  {
    name: 'inspect_subject_memories',
    arg: 'query',
    hint: 'subject name | optional topic',
    description: "Reads only that subject's relevant active memories."
  },
  {
    name: 'explore_worldbuild_options',
    arg: 'query',
    hint: 'Races | optional scene need',
    description: 'Retrieves a bounded palette from one registered Worldbuild category: System, Locations, Items, Races, Factions, Characters, Creatures or Events. Options are narrator material, not facts already chosen for the scene and not character knowledge.'
  }
];

// Earlier prompts named the entity lookup differently; both spellings run the same tool.
const TOOL_ALIASES = { lookup_world_entity: 'lookup_entity' };

const ALL_TOOLS = [...PLANNER_TOOLS, ...ROLEPLAY_TOOLS];

// Every name the text parser accepts; whether a tool is offered in this workspace is decided later.
const TOOL_NAMES = [...ALL_TOOLS.map(tool => tool.name), ...Object.keys(TOOL_ALIASES)];

const FINISH_DESCRIPTION = 'Ends the research. List the result handles (R3, R7) and exact file names of the results that were actually relevant; listed results get priority in the final context, and when none are listed every result is included equally. Keep the summary to one or two sentences and never copy retrieved text into it: the full text of every result already reaches the writing assistant. Only state facts that appear in the results.';

function canonicalToolName(name) {
  const normalized = String(name || '').toLowerCase();
  return TOOL_ALIASES[normalized] || normalized;
}

function toolsFor({ roleplay = false } = {}) {
  return roleplay ? ALL_TOOLS : PLANNER_TOOLS;
}

function toolNamesFor(options) {
  return toolsFor(options).map(tool => tool.name);
}

function toolByName(name) {
  const canonical = canonicalToolName(name);
  return ALL_TOOLS.find(tool => tool.name === canonical) || null;
}

// Models name the argument loosely, so every spelling the text parser accepts is read here too.
function argOf(name, args) {
  const values = args && typeof args === 'object' ? args : {};
  const tool = toolByName(name);
  const value = (tool && values[tool.arg]) ?? values.query ?? values.filename ?? values.file ?? values.q ?? values.term ?? values.arg ?? '';
  return String(value).trim();
}

function plannerToolDefinitions(options) {
  return [
    ...toolsFor(options).map(tool => ({
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

function textToolCatalog(options) {
  const offered = toolsFor(options);
  const tools = offered.map((tool, index) =>
    `${index + 1}. <tool_call name="${tool.name}" ${tool.arg}="${tool.hint}" />\n   ${tool.description}`);
  tools.push(`${offered.length + 1}. <finish sources="R3, notes.txt">one or two sentences</finish>\n   ${FINISH_DESCRIPTION}`);
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
  ROLEPLAY_TOOLS,
  TOOL_NAMES,
  argOf,
  canonicalToolName,
  plannerToolDefinitions,
  renderTextCall,
  textToolCatalog,
  toolNamesFor
};
