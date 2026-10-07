import React, { useState, useEffect } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, GripVertical, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TextInput from '../ui/TextInput';
import Toggle from '../ui/Toggle';
import SelectMenu from '../ui/SelectMenu';
import IconButton from '../ui/IconButton';

const newStepId = () => `step_${Date.now()}_${Math.random()}`;
// Short chains read best fully open; longer ones open one step at a time.
const OPEN_ALL_UP_TO = 3;

export default function WorkflowModal({ workflow, onClose, onSave, inline = false }) {
  const { writingProfiles, handleSaveWorkflow } = useApp();
  const isEditing = !!workflow;
  const [name, setName] = useState('');
  const [steps, setSteps] = useState([]); // [{ id, profileId, prompt, includeContext, includeChatHistory }]
  const [expanded, setExpanded] = useState(() => new Set());
  const [dragIndex, setDragIndex] = useState(null);

  useEffect(() => {
    if (!workflow) return;
    setName(workflow.name || '');
    let loaded = [];
    try {
      loaded = typeof workflow.steps === 'string' ? JSON.parse(workflow.steps) : (workflow.steps || []);
    } catch {
      loaded = [];
    }
    const withIds = loaded.map((s, idx) => ({
      ...s,
      id: s.id || `step_${Date.now()}_${idx}_${Math.random()}`,
      includeChatHistory: s.includeChatHistory !== false,
    }));
    setSteps(withIds);
    setExpanded(new Set(withIds.length <= OPEN_ALL_UP_TO ? withIds.map(s => s.id) : withIds.slice(0, 1).map(s => s.id)));
  }, [workflow]);

  const profileOf = (id) => writingProfiles.find(p => p.id === id);
  const toggleExpanded = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allExpanded = steps.length > 0 && steps.every(s => expanded.has(s.id));

  const addStep = () => {
    const step = { id: newStepId(), profileId: writingProfiles[0]?.id || '', prompt: '', includeContext: true, includeChatHistory: true };
    setSteps(prev => [...prev, step]);
    setExpanded(prev => new Set([...prev, step.id]));
  };
  const removeStep = (id) => setSteps(prev => prev.filter(s => s.id !== id));
  const updateStep = (id, field, value) => setSteps(prev => prev.map(s => (s.id === id ? { ...s, [field]: value } : s)));
  const moveStep = (from, to) => {
    if (to < 0 || to >= steps.length || from === to) return;
    setSteps(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const validSteps = steps.filter(s => s.profileId).map(s => ({
      profileId: s.profileId,
      prompt: (s.prompt || '').trim(),
      includeContext: !!s.includeContext,
      includeChatHistory: s.includeChatHistory !== false,
    }));
    const updatedWorkflow = {
      id: workflow?.id || 'wf_' + Math.random().toString(36).substr(2, 9),
      name: name.trim(),
      entryProfileId: validSteps[0]?.profileId || '',
      steps: JSON.stringify(validSteps),
    };
    await handleSaveWorkflow(updatedWorkflow);
    if (onSave) onSave(updatedWorkflow);
    onClose();
  };

  const blocked = steps.map((s, i) => ({ step: s, index: i, profile: profileOf(s.profileId) })).find(({ profile }) => profile?.needsSetup);
  const profileOptions = writingProfiles.map(p => ({ value: p.id, label: p.name }));

  return (
    <Modal
      onClose={onClose}
      size="wide"
      title={isEditing ? 'Edit workflow' : 'New workflow'}
      subtitle="Each step runs in order and hands its reply to the next. The chat shows the last step's reply."
      className={inline ? '' : 'h-[min(58rem,calc(100vh-2rem))]'}
      inline={inline}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto custom-scrollbar px-7 py-5">
        <div className="flex items-end gap-3.5">
          <TextInput label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="Draft, then check the canon" containerClassName="w-full max-w-[26rem]" autoFocus={!isEditing} />
          <span className="flex-1" />
          {steps.length > 1 && (
            <Button variant="subtle" size="sm" onClick={() => setExpanded(allExpanded ? new Set() : new Set(steps.map(s => s.id)))}>
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
        </div>

        <div className="flex flex-col">
          <div className="mb-2 flex items-center gap-4">
            <span className="flex w-[2.125rem] justify-center"><MessageSquare className="h-4 w-4 text-text-subtle" aria-hidden="true" /></span>
            <span className="caption">Your message</span>
          </div>

          {steps.map((step, index) => {
            const profile = profileOf(step.profileId);
            const tint = profile?.color || 'var(--theme-text-muted)';
            const open = expanded.has(step.id);
            const sub = profile?.needsSetup
              ? <span className="text-xs text-status-warning">No model linked</span>
              : <span className="truncate font-mono text-xs text-text-subtle">{profile?.model || 'Choose a profile'}</span>;
            return (
              <div
                key={step.id}
                className={`flex gap-4 ${dragIndex === index ? 'opacity-50' : ''}`}
                onDragOver={e => { if (dragIndex !== null) e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); if (dragIndex !== null) moveStep(dragIndex, index); setDragIndex(null); }}
              >
                <div className="flex w-[2.125rem] shrink-0 flex-col items-center">
                  <span
                    className="inline-flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-full border-[1.5px] text-sm font-bold tabular-nums"
                    style={{ color: tint, background: `color-mix(in srgb, ${tint} 16%, var(--theme-surface-canvas))`, borderColor: `color-mix(in srgb, ${tint} 55%, transparent)` }}
                  >
                    {index + 1}
                  </span>
                  <span aria-hidden="true" className="mt-1.5 w-0.5 flex-1 bg-tint/[0.08]" />
                </div>

                {open ? (
                  <div className="mb-3 flex-1 rounded-[0.875rem] border border-border-default bg-tint/[0.035] px-4 pb-1 pt-3.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tint }} />
                      <SelectMenu ariaLabel={`Profile for step ${index + 1}`} value={step.profileId} onChange={value => updateStep(step.id, 'profileId', value)} options={profileOptions} className="w-full max-w-[18rem]" />
                      <span className="min-w-0 flex-1 truncate">{sub}</span>
                      <IconButton icon={ArrowUp} label="Move up" size="sm" disabled={index === 0} onClick={() => moveStep(index, index - 1)} />
                      <IconButton icon={ArrowDown} label="Move down" size="sm" disabled={index === steps.length - 1} onClick={() => moveStep(index, index + 1)} />
                      <IconButton icon={Trash2} label="Remove step" tone="danger" size="sm" onClick={() => removeStep(step.id)} />
                      {steps.length > 1 && <IconButton icon={ChevronDown} label="Collapse step" size="sm" className="rotate-180" onClick={() => toggleExpanded(step.id)} />}
                    </div>
                    <label className="mt-3.5 block">
                      <span className="mb-1.5 block text-sm font-medium text-text-secondary">Instructions for this step <span className="caption">(optional)</span></span>
                      <textarea
                        rows={2}
                        value={step.prompt}
                        onChange={e => updateStep(step.id, 'prompt', e.target.value)}
                        placeholder={index === 0 ? 'Write the next scene from the latest message.' : 'Check the text above against the canon and fix only what contradicts it.'}
                        className="w-full resize-y rounded-control border border-border-default bg-surface-input px-3 py-2.5 text-sm text-text-secondary custom-scrollbar placeholder:text-text-subtle focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                      />
                    </label>
                    <div className="mt-2 border-t border-border-subtle py-3">
                      <Toggle
                        checked={!!step.includeContext}
                        onChange={value => updateStep(step.id, 'includeContext', value)}
                        label="Use the workspace context"
                        description="Memory, Worldbuild and retrieved lore. The profile's own knowledge base is always included."
                      />
                    </div>
                    {index > 0 && (
                      <div className="border-t border-border-subtle py-3">
                        <Toggle
                          checked={step.includeChatHistory !== false}
                          onChange={value => updateStep(step.id, 'includeChatHistory', value)}
                          label="Read the chat history"
                          description={`Off: this step only reads the reply from step ${index}.`}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={`mb-2.5 flex h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border pl-2 pr-2 ${profile?.needsSetup ? 'border-status-warning/25' : 'border-border-subtle'} bg-tint/[0.02]`}>
                    <span
                      draggable
                      onDragStart={() => setDragIndex(index)}
                      onDragEnd={() => setDragIndex(null)}
                      aria-hidden="true"
                      className="cursor-grab text-text-disabled hover:text-text-muted"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <button type="button" onClick={() => toggleExpanded(step.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tint }} />
                      <span className="flex w-52 shrink-0 flex-col">
                        <span className="truncate text-sm font-semibold text-text-primary">{profile?.name || 'No profile'}</span>
                        {sub}
                      </span>
                      <span className="caption min-w-0 flex-1 truncate">{step.prompt || 'No extra instructions'}</span>
                      {!step.includeContext && <StepChip>No context</StepChip>}
                      {index > 0 && step.includeChatHistory === false && <StepChip>No history</StepChip>}
                      <ChevronDown className="h-4 w-4 shrink-0 text-text-subtle" aria-label="Expand step" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-4">
            <span className="flex w-[2.125rem] justify-center">
              <span className="inline-flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-full border-[1.5px] border-dashed border-tint/20 text-text-muted"><Plus className="h-4 w-4" aria-hidden="true" /></span>
            </span>
            <Button variant="ghost" size="sm" onClick={addStep} disabled={!writingProfiles.length}>Add a step</Button>
            <span className="caption">{steps.length ? 'Then the reply goes to the chat.' : 'Steps run one after the other; the last one answers in the chat.'}</span>
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2.5 border-t border-border-subtle px-6 py-3.5">
        {blocked ? (
          <span className="flex flex-1 items-center gap-1.5 text-xs text-status-warning-strong">
            <AlertTriangle className="h-3.5 w-3.5 text-status-warning" aria-hidden="true" />
            {blocked.profile.name} has no model. Running stops at step {blocked.index + 1}.
          </span>
        ) : <span className="flex-1" />}
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={!name.trim() || steps.length === 0}>Save workflow</Button>
      </footer>
    </Modal>
  );
}

function StepChip({ children }) {
  return <span className="inline-flex h-[1.375rem] shrink-0 items-center rounded-full border border-border-default bg-tint/[0.03] px-2.5 text-xs font-medium text-text-secondary">{children}</span>;
}
