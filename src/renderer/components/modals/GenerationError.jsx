import React from 'react';
import { RotateCw, SkipForward, Square, Workflow } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { isRetryableGenerationError } from '../../features/chat/generation-target';
import { MarkedAvatar, ProviderError, StepChain, ToneTile } from './ModalParts';

// One error window for a profile reply and for a workflow step: who failed, what the provider said, and what to do next.
export default function GenerationError({ workflow = false }) {
  const { errorData, handleRespondToError, writingProfiles, apiProfiles } = useApp();
  if (!errorData) return null;

  const profile = writingProfiles?.find(p => p.id === errorData.profileId) || writingProfiles?.find(p => p.name === errorData.profileName);
  const name = errorData.profileName || profile?.name || 'The AI profile';
  const connection = apiProfiles?.find(ap => ap.id === (errorData.apiProfileId || profile?.apiProfileId))?.name;
  const model = errorData.model || profile?.model;
  const message = errorData.errorMessage || errorData.message || 'The request failed without a message from the provider.';
  const canRetry = isRetryableGenerationError(errorData);
  const stepIndex = Math.max(0, (errorData.step || 1) - 1);
  const steps = (errorData.stepProfileIds || []).map(id => {
    const p = writingProfiles?.find(item => item.id === id);
    return { name: p?.name || 'Missing profile', color: p?.color };
  });
  const showChain = workflow && steps.length > 1;
  const where = [model, connection].filter(Boolean).join(' · ');

  const title = workflow
    ? `${errorData.workflowName || 'The workflow'} stopped${steps.length ? ` at step ${stepIndex + 1}` : ''}`
    : `${name} couldn't reply`;
  const subtitle = workflow
    ? `${name} couldn't reply${steps.length ? ` · step ${stepIndex + 1} of ${steps.length}` : ''}`
    : where || null;

  const explain = !canRetry
    ? 'Nothing more can be done with this request. Close this, fix what the message points to, and send again.'
    : workflow
      ? <><b className="font-semibold text-text-secondary">Retry step</b> sends this step again. <b className="font-semibold text-text-secondary">Skip</b> passes the last reply on. <b className="font-semibold text-text-secondary">Stop</b> keeps the replies so far.</>
      : <><b className="font-semibold text-text-secondary">Retry</b> sends the same request again. <b className="font-semibold text-text-secondary">Stop</b> keeps the conversation as it is.</>;

  return (
    <Modal
      onClose={() => handleRespondToError('interrupt')}
      closeOnOverlay={false}
      showClose={false}
      size="lg"
      title={title}
      subtitle={subtitle}
      leading={workflow ? <ToneTile icon={Workflow} color="var(--theme-status-danger)" /> : <MarkedAvatar color={profile?.color} size={40} mark="failed" />}
      className="!max-w-[36rem]"
    >
      <div className="space-y-3.5 p-5">
        {showChain && <StepChain steps={steps} failedIndex={stepIndex} />}
        <ProviderError source={connection} message={message} />
        <p className="text-sm leading-relaxed text-text-muted">{explain}</p>
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        {canRetry ? (
          <>
            <Button variant="ghost" icon={Square} onClick={() => handleRespondToError('interrupt')}>Stop</Button>
            <span className="flex-1" />
            {workflow && <Button variant="subtle" icon={SkipForward} onClick={() => handleRespondToError('skip')}>Skip step</Button>}
            <Button icon={RotateCw} onClick={() => handleRespondToError('retry')}>{workflow ? 'Retry step' : 'Retry'}</Button>
          </>
        ) : (
          <>
            <span className="flex-1" />
            <Button onClick={() => handleRespondToError('interrupt')}>Close</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
