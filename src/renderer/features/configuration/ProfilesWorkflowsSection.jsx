import { useState } from 'react';
import { AlertTriangle, BookOpen, Pencil, Plus, Search, Workflow } from 'lucide-react';
import { AiGlyph } from '../../components/ui/glyphs';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import Toggle from '../../components/ui/Toggle';
import ProfileModal from '../../components/modals/ProfileModal';
import WorkflowModal from '../../components/modals/WorkflowModal';
import KbManagerModal from '../../components/modals/KbManagerModal';
import { ConfigSection, FieldLabel, Help } from './ConfigParts';

const parseList = value => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const stepCount = workflow => {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : parseList(workflow.steps);
  return steps.length;
};

/**
 * Which profiles and workflows run here. Each row edits its profile, knowledge or workflow
 * in place, with the same dialogs as the Library, so nothing needs a trip away.
 */
export default function ProfilesWorkflowsSection({ sectionRef, activeChat, writingProfiles, workflows, handleSaveChat }) {
  const [profileQuery, setProfileQuery] = useState('');
  // { kind: 'profile' | 'knowledge' | 'workflow', item?: object }
  const [editing, setEditing] = useState(null);
  const activeProfiles = parseList(activeChat.activeProfiles);
  const activeWorkflows = parseList(activeChat.activeWorkflows);

  const toggle = async (field, list, id) => {
    const next = list.includes(id) ? list.filter(item => item !== id) : [...list, id];
    await handleSaveChat({ ...activeChat, [field]: JSON.stringify(next) });
  };
  const addActive = async (field, list, id) => {
    if (!id || list.includes(id)) return;
    await handleSaveChat({ ...activeChat, [field]: JSON.stringify([...list, id]) });
  };

  const profiles = writingProfiles.filter(profile => profile.name.toLowerCase().includes(profileQuery.trim().toLowerCase()));
  const profilesOn = writingProfiles.filter(profile => activeProfiles.includes(profile.id)).length;
  const workflowsOn = workflows.filter(workflow => activeWorkflows.includes(workflow.id)).length;

  return (
    <ConfigSection
      id="agents"
      sectionRef={sectionRef}
      icon={AiGlyph}
      title="Profiles & Workflows"
      description="Choose which AI Profiles and Workflows can run in this workspace."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <FieldLabel>AI Profiles</FieldLabel>
            <span className="flex-1 text-xs tabular-nums text-text-subtle">{profilesOn} of {writingProfiles.length} on</span>
            <Button variant="subtle" size="sm" icon={Plus} onClick={() => setEditing({ kind: 'profile', item: null })}>New</Button>
          </div>
          {writingProfiles.length > 0 && (
            <label className="field-input flex h-8 items-center gap-2 px-2.5 focus-within:border-accent/65">
              <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
              <input
                type="text"
                value={profileQuery}
                onChange={event => setProfileQuery(event.target.value)}
                placeholder="Filter profiles"
                aria-label="Filter profiles"
                className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-text-primary outline-none placeholder:text-text-subtle"
              />
            </label>
          )}
          <div className="max-h-[22rem] divide-y divide-border-subtle overflow-y-auto rounded-card border border-border-subtle bg-surface-inset custom-scrollbar">
            {profiles.length === 0 && <p className="px-4 py-5 text-center text-xs text-text-subtle">{writingProfiles.length ? 'No profile matches.' : 'No profiles yet.'}</p>}
            {profiles.map(profile => {
              const on = activeProfiles.includes(profile.id);
              const needsSetup = Boolean(profile.needsSetup);
              return (
                <div key={profile.id} className="flex min-h-12 items-center gap-2 py-2 pl-3.5 pr-3">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${needsSetup ? 'opacity-60' : ''}`} style={{ backgroundColor: profile.color }} />
                  <span className="ml-1 min-w-0 flex-1">
                    <span className={`block truncate text-[0.8125rem] ${needsSetup ? 'text-text-muted' : on ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>{profile.name}</span>
                    {needsSetup && (
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-status-warning">
                        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Needs an API connection</span>
                      </span>
                    )}
                  </span>
                  <IconButton icon={BookOpen} size="sm" label={`Knowledge of ${profile.name}`} onClick={() => setEditing({ kind: 'knowledge', item: profile })} />
                  <IconButton
                    icon={Pencil}
                    size="sm"
                    label={needsSetup ? `Edit ${profile.name} to connect an API` : `Edit ${profile.name}`}
                    className={needsSetup ? '!bg-status-warning/14 !text-status-warning ring-1 ring-inset ring-status-warning/35 hover:!bg-status-warning/20' : ''}
                    onClick={() => setEditing({ kind: 'profile', item: profile })}
                  />
                  <span aria-hidden="true" className="mx-1 h-4.5 w-px bg-border-subtle" />
                  <Toggle checked={on} disabled={needsSetup} ariaLabel={`Use ${profile.name}`} onChange={() => toggle('activeProfiles', activeProfiles, profile.id)} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <FieldLabel>Workflows</FieldLabel>
            <span className="flex-1 text-xs tabular-nums text-text-subtle">{workflowsOn} of {workflows.length} on</span>
            <Button variant="subtle" size="sm" icon={Plus} onClick={() => setEditing({ kind: 'workflow', item: null })}>New</Button>
          </div>
          <div className="max-h-[22rem] divide-y divide-border-subtle overflow-y-auto rounded-card border border-border-subtle bg-surface-inset custom-scrollbar">
            {workflows.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
                <Workflow aria-hidden="true" className="h-5 w-5 text-text-disabled" />
                <span className="text-xs text-text-subtle">No workflows yet. A workflow runs several profiles one after another.</span>
              </div>
            )}
            {workflows.map(workflow => {
              const on = activeWorkflows.includes(workflow.id);
              const steps = stepCount(workflow);
              return (
                <div key={workflow.id} className="flex min-h-12 items-center gap-2 py-2 pl-3.5 pr-3">
                  <Workflow aria-hidden="true" className="h-4 w-4 shrink-0 text-text-subtle" />
                  <span className="ml-1 min-w-0 flex-1">
                    <span className={`block truncate text-[0.8125rem] ${on ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>{workflow.name}</span>
                    <span className="block text-xs text-text-subtle">{steps} {steps === 1 ? 'step' : 'steps'}</span>
                  </span>
                  <IconButton icon={Pencil} size="sm" label={`Edit ${workflow.name}`} onClick={() => setEditing({ kind: 'workflow', item: workflow })} />
                  <span aria-hidden="true" className="mx-1 h-4.5 w-px bg-border-subtle" />
                  <Toggle checked={on} ariaLabel={`Use ${workflow.name}`} onChange={() => toggle('activeWorkflows', activeWorkflows, workflow.id)} />
                </div>
              );
            })}
          </div>
          <Help>Editing opens the profile, its knowledge or the workflow right here. Changes apply everywhere the profile or workflow is used.</Help>
        </div>
      </div>

      {editing?.kind === 'profile' && (
        <ProfileModal
          profile={editing.item}
          onClose={() => setEditing(null)}
          onSave={async (saved, { isNew } = {}) => {
            if (isNew || !editing.item) await addActive('activeProfiles', activeProfiles, saved?.id);
          }}
        />
      )}
      {editing?.kind === 'knowledge' && <KbManagerModal profile={editing.item} onClose={() => setEditing(null)} />}
      {editing?.kind === 'workflow' && (
        <WorkflowModal
          workflow={editing.item}
          onClose={() => setEditing(null)}
          onSave={async saved => {
            if (!editing.item) await addActive('activeWorkflows', activeWorkflows, saved?.id);
          }}
        />
      )}
    </ConfigSection>
  );
}
