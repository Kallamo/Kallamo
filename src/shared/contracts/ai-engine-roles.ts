export type AiEngineRoleId = 'tagger' | 'summarizer' | 'retrievalPlanner';

export type GenerativeRoleMode = 'inherit-system' | 'dedicated' | 'disabled';
export type RetrievalPlannerMode = 'profile' | 'dedicated' | 'off';
export type AiEngineRoleMode = GenerativeRoleMode | RetrievalPlannerMode;

export interface ApiConnectionSummary {
  id: string;
  name: string;
  provider: string;
  models?: string[] | string;
}

export interface AiEngineRoleDefinition {
  id: AiEngineRoleId;
  title: string;
  description: string;
  modes: ReadonlyArray<{ value: AiEngineRoleMode; label: string; description: string }>;
}

export const SYSTEM_AI_LANGUAGES = [
  { value: 'English', label: 'English' },
  { value: 'Portuguese (Brazil)', label: 'Português (Brasil)' },
  { value: 'Portuguese (Portugal)', label: 'Português (Portugal)' },
  { value: 'Spanish', label: 'Español' },
  { value: 'French', label: 'Français' },
  { value: 'German', label: 'Deutsch' },
  { value: 'Italian', label: 'Italiano' },
  { value: 'Dutch', label: 'Nederlands' },
  { value: 'Polish', label: 'Polski' },
  { value: 'Czech', label: 'Čeština' },
  { value: 'Romanian', label: 'Română' },
  { value: 'Greek', label: 'Ελληνικά' },
  { value: 'Swedish', label: 'Svenska' },
  { value: 'Danish', label: 'Dansk' },
  { value: 'Norwegian', label: 'Norsk' },
  { value: 'Finnish', label: 'Suomi' },
  { value: 'Turkish', label: 'Türkçe' },
  { value: 'Ukrainian', label: 'Українська' },
  { value: 'Arabic', label: 'العربية' },
  { value: 'Hebrew', label: 'עברית' },
  { value: 'Hindi', label: 'हिन्दी' },
  { value: 'Chinese (Simplified)', label: '中文 (简体)' },
  { value: 'Chinese (Traditional)', label: '中文 (繁體)' },
  { value: 'Japanese', label: '日本語' },
  { value: 'Korean', label: '한국어' },
  { value: 'Russian', label: 'Русский' },
  { value: 'Indonesian', label: 'Bahasa Indonesia' },
  { value: 'Vietnamese', label: 'Tiếng Việt' },
  { value: 'Thai', label: 'ไทย' }
] as const;

export const AI_ENGINE_ROLE_DEFINITIONS: ReadonlyArray<AiEngineRoleDefinition> = [
  {
    id: 'tagger',
    title: 'Tagger',
    description: 'Reads existing chunks and assigns World Index entity tags. It does not vectorize text or decide what becomes canon.',
    modes: [
      { value: 'inherit-system', label: 'System AI', description: 'Share the base connection and model.' },
      { value: 'dedicated', label: 'Dedicated', description: 'Choose a faster model just for tagging.' },
      { value: 'disabled', label: 'Disabled', description: 'Keep retrieval, but skip automatic tags.' }
    ]
  },
  {
    id: 'retrievalPlanner',
    title: 'Retrieval Planner',
    description: 'Plans Agentic Retrieval, selects search tools, and prepares relevant context before the active AI Profile writes the response.',
    modes: [
      { value: 'profile', label: 'AI Profile', description: 'Use the model that will write the response.' },
      { value: 'dedicated', label: 'Dedicated', description: 'Use one model only for retrieval planning.' },
      { value: 'off', label: 'Hybrid RAG', description: 'Skip the agentic loop and retrieve directly.' }
    ]
  },
  {
    id: 'summarizer',
    title: 'Summarizer',
    description: 'Creates faithful titles and summaries for archived conversations while preserving the original messages and searchable chunks.',
    modes: [
      { value: 'inherit-system', label: 'System AI', description: 'Share the base connection and model.' },
      { value: 'dedicated', label: 'Dedicated', description: 'Choose a model focused on faithful synthesis.' },
      { value: 'disabled', label: 'Disabled', description: 'Archive searchable history without a summary.' }
    ]
  }
];
