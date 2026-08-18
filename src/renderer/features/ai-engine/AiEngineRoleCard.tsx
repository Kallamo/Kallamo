import { AlertTriangle, BrainCircuit, CheckCircle2, Route, Tags, TextQuote } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AiEngineRoleDefinition, AiEngineRoleMode, ApiConnectionSummary } from '@shared/contracts/ai-engine-roles';

interface AiEngineRoleCardProps {
  definition: AiEngineRoleDefinition;
  mode: AiEngineRoleMode;
  apiProfileId: string;
  modelName: string;
  apiProfiles: ApiConnectionSummary[];
  systemReady: boolean;
  onModeChange: (mode: AiEngineRoleMode) => void;
  onConnectionChange: (connectionId: string) => void;
  onModelChange: (model: string) => void;
  children?: ReactNode;
}

const ICONS = { tagger: Tags, retrievalPlanner: Route, summarizer: TextQuote, narrativeState: BrainCircuit } as const;

function readModels(profile?: ApiConnectionSummary): string[] {
  if (!profile?.models) return [];
  if (Array.isArray(profile.models)) return profile.models;
  try {
    const parsed: unknown = JSON.parse(profile.models);
    return Array.isArray(parsed) ? parsed.filter((model): model is string => typeof model === 'string') : [];
  } catch {
    return [];
  }
}

export default function AiEngineRoleCard({
  definition,
  mode,
  apiProfileId,
  modelName,
  apiProfiles,
  systemReady,
  onModeChange,
  onConnectionChange,
  onModelChange,
  children
}: AiEngineRoleCardProps) {
  const Icon = ICONS[definition.id];
  const models = readModels(apiProfiles.find(profile => profile.id === apiProfileId));
  const isDedicated = mode === 'dedicated';
  const isDisabled = mode === 'disabled' || mode === 'off';
  const isInherited = mode === 'inherit-system';
  const isReady = isDisabled || mode === 'profile' || (isInherited ? systemReady : Boolean(apiProfileId && modelName && models.includes(modelName)));
  const status = isDisabled ? (mode === 'off' ? 'Hybrid RAG' : 'Disabled') : isReady ? (isInherited ? 'Inherited' : mode === 'profile' ? 'Uses profile' : 'Ready') : 'Needs setup';

  return (
    <section className="rounded-card border border-border-subtle/80 bg-surface-editor p-4 shadow-[0_1px_0_rgba(255,255,255,0.02)] md:p-5">
      <header className="flex items-start gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-accent/20 bg-accent/[0.07] text-accent">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-base font-bold text-text-primary">{definition.title}</h5>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide ${isReady ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-300'}`}>
              {isReady ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {status}
            </span>
          </div>
          <p className="caption mt-1 max-w-3xl">{definition.description}</p>
        </div>
      </header>

      <fieldset className="mt-4 border-t border-border-subtle/70 pt-4">
        <legend className="sr-only">{definition.title} execution mode</legend>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-text-subtle">How it runs</span>
          <span className="text-[0.6875rem] text-text-disabled">One global strategy</span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {definition.modes.map(option => {
            const isSelected = option.value === mode;
            return (
              <label key={option.value} className={`group relative cursor-pointer rounded-control border p-3 transition-colors ${isSelected ? 'border-accent/45 bg-accent/[0.075]' : 'border-border-subtle bg-surface-canvas hover:border-border-default hover:bg-surface-panel-muted'}`}>
                <input className="sr-only" type="radio" name={`${definition.id}-mode`} value={option.value} checked={isSelected} onChange={() => onModeChange(option.value)} />
                <span className="flex items-center gap-2 text-xs font-bold text-text-secondary">
                  <span className={`h-2 w-2 rounded-full border ${isSelected ? 'border-accent bg-accent shadow-[0_0_0_3px_rgba(251,203,45,0.1)]' : 'border-border-strong bg-transparent'}`} />
                  {option.label}
                </span>
                <span className={`mt-1.5 block text-[0.6875rem] leading-relaxed ${isSelected ? 'text-text-secondary' : 'text-text-subtle'}`}>{option.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {isDedicated && (
        <div className="mt-3 rounded-control border border-accent/15 bg-surface-canvas p-4">
          <div className="mb-3">
            <span className="text-xs font-bold text-text-secondary">Dedicated executor</span>
            <p className="mt-0.5 text-[0.6875rem] text-text-subtle">This connection and model will only be used for {definition.title} work.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-text-muted">API Connection</label>
              <select value={apiProfileId} onChange={event => onConnectionChange(event.target.value)} className="w-full cursor-pointer rounded-md border border-border-default bg-surface-canvas px-3 py-2 text-xs text-text-secondary focus:border-accent focus:outline-none">
                <option value="">Select API Connection</option>
                {apiProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} ({profile.provider})</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-text-muted">Model</label>
              <select value={modelName} disabled={!apiProfileId} onChange={event => onModelChange(event.target.value)} className="w-full cursor-pointer rounded-md border border-border-default bg-surface-canvas px-3 py-2 text-xs text-text-secondary focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50">
                <option value="">{apiProfileId ? 'Select model' : 'Pick a connection first'}</option>
                {models.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {!isReady && (
        <p className="mt-3 flex items-center gap-2 rounded-md border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {isInherited ? 'Configure both the System AI connection and model above.' : 'Select a valid API Connection and model for this role.'}
        </p>
      )}
      {children && <div className="mt-4 border-t border-border-subtle/70 pt-4">{children}</div>}
    </section>
  );
}
