import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, CalendarDays, ChevronLeft, ChevronRight, Clock3, Copy, Eye, EyeOff, History, MapPin, MoreHorizontal, Paperclip, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { Menu, MenuItem, MenuSeparator } from '../../../components/ui/Menu';
import MessageMarkdown from './MessageMarkdown';
import MessageEditor from './MessageEditor';
import TypingText from './TypingText';
import { parseMessageContent } from '../message-content';
import { readAlternativeSwitcher } from '../message-alternatives';
import { safeParseDebugNotice, safeParseJson } from '../diagnostic-format';
import { MessageDiagnostics, diagnosticsFor } from './MessageDiagnostics';
import { daylightFor } from '../../roleplay/daylight';
import { formatFrameDate, formatFrameTime, formatFrameWeekday, sameFrameDate, shouldShowTimeTransition } from '../frame-format';

const COPIED_FEEDBACK_MS = 2000;

export const isImage = (name) => /\.(png|jpe?g|gif|webp)$/i.test(name);
export const isVideo = (name) => /\.(mp4|webm|ogg)$/i.test(name);

export function SpeakerLabel({ name, color, children }) {
  return (
    <div className="flex items-center gap-2 pl-1 text-[0.8125rem] font-semibold text-text-primary select-none">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color || 'var(--theme-text-subtle)' }} />
      <span className="truncate">{name || 'AI'}</span>
      {children}
    </div>
  );
}

function RoleplayMessageFrame({ frame }) {
  if (!frame?.end) return null;
  const locationChanged = frame.start?.locationId !== frame.end?.locationId
    || frame.start?.locationName !== frame.end?.locationName;
  const timeChanged = shouldShowTimeTransition(frame);
  const weekday = formatFrameWeekday(frame.end);
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-tint/[0.07] pb-3 text-xs text-text-muted select-none">
      <span className="flex min-w-0 items-center gap-2">
        <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-entity-location" />
        <span className="min-w-0 truncate font-medium text-text-secondary">
          {locationChanged
            ? <>{frame.start?.locationName || 'Unknown location'}<span className="px-1.5 text-text-disabled">→</span>{frame.end.locationName || 'Unknown location'}</>
            : frame.end.locationName || 'No current location'}
        </span>
        {frame.pending && (
          <span
            data-tooltip="Place and time for this reply update when the story continues."
            className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-tint/[0.06] px-2 text-[0.6875rem] font-medium text-text-muted"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-text-subtle" />
            Pending
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-3.5">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-status-info" />
          {sameFrameDate(frame.start, frame.end) ? formatFrameDate(frame.end) : `${formatFrameDate(frame.start)} → ${formatFrameDate(frame.end)}`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 aria-hidden="true" className={`h-3.5 w-3.5 ${daylightFor(frame.end.position?.hour).text}`} />
          <span className="font-mono text-text-secondary">
            {timeChanged ? <>{formatFrameTime(frame.start)}<span className="px-1 text-text-disabled">→</span>{formatFrameTime(frame.end)}</> : formatFrameTime(frame.end)}
          </span>
          {weekday && <span>{weekday}</span>}
        </span>
      </span>
    </div>
  );
}

function AttachedFiles({ files, isDocumentMode, softBlur }) {
  return (
    <div className={`flex flex-wrap gap-2 mb-2 select-none ${isDocumentMode ? 'justify-start w-full' : 'justify-end w-full'}`}>
      {files.map(file => {
        const fileUrl = file.path ? `app-file:///${encodeURI(file.path.replace(/\\/g, '/'))}` : '';
        const hasThumbnail = isImage(file.name) || isVideo(file.name);
        return (
          <div
            key={file.name}
            className={`flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-panel/70 p-1.5 pr-2.5 text-xs text-text-secondary shadow-sm ${softBlur ? 'backdrop-blur-sm' : ''}`}
          >
            {isImage(file.name) && <img src={fileUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg border border-border-subtle object-cover" />}
            {isVideo(file.name) && <video src={fileUrl} className="h-8 w-8 shrink-0 rounded-lg border border-border-subtle object-cover" muted />}
            {!hasThumbnail && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-input text-text-subtle">
                <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
              </div>
            )}
            <div className="flex min-w-0 max-w-[8rem] flex-col">
              <span className="truncate font-semibold text-text-primary" data-tooltip={file.name}>{file.name}</span>
              <span className="font-mono text-text-subtle">{(file.size / 1024).toFixed(0)} KB</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="chat-action inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-muted transition-colors hover:bg-tint/[0.06] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function AlternativeSwitcher({ alternatives, onSwitch }) {
  return (
    <span className="chat-action mx-1 inline-flex h-7 items-center gap-0.5 rounded-lg border border-border-subtle px-0.5 text-xs tabular-nums text-text-secondary">
      <button
        type="button"
        aria-label="Previous reply"
        disabled={alternatives.index === 0}
        onClick={() => onSwitch(alternatives.index - 1)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <span aria-live="polite">{alternatives.index + 1} of {alternatives.count}</span>
      <button
        type="button"
        aria-label="Next reply"
        disabled={alternatives.index === alternatives.count - 1}
        onClick={() => onSwitch(alternatives.index + 1)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function MessageMenu({ message, actions }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const excluded = message.excluded === 1;
  const choose = action => () => {
    setOpen(false);
    action();
  };
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(value => !value);
        }}
        className={`chat-action inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open ? 'bg-tint/[0.08] text-text-primary' : 'text-text-muted hover:bg-tint/[0.06] hover:text-text-primary'}`}
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Message actions" className="w-72">
        <MenuItem
          icon={excluded ? Eye : EyeOff}
          label={excluded ? 'Restore to context' : 'Drop from context'}
          description={excluded ? 'The AI reads it again.' : 'Stays in the chat. The AI stops reading it.'}
          onSelect={choose(() => actions.toggleExcluded(message.id, !excluded))}
        />
        <MenuSeparator />
        <MenuItem icon={History} label="Revert chat here" description="Deletes every message after this one." danger onSelect={choose(() => actions.requestRevert(message.id))} />
        <MenuItem icon={Trash2} label="Delete message" description="Removes it for good." danger onSelect={choose(() => actions.requestDelete(message.id))} />
      </Menu>
    </>
  );
}

function useCopiedFeedback() {
  const [copiedKey, setCopiedKey] = useState(null);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const markCopied = key => {
    setCopiedKey(key);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedKey(null), COPIED_FEEDBACK_MS);
  };
  return [copiedKey, markCopied];
}

// Older rows show their actions on hover or focus; the latest exchange keeps them in view.
const actionRowClass = (pinned, align) => `flex w-full items-center gap-0.5 ${align === 'end' ? 'justify-end' : ''} select-none transition-opacity duration-150 ${pinned ? '' : 'opacity-0 group-hover/message:opacity-100 focus-within:opacity-100'}`;

function Notice({ children }) {
  return (
    <p className="flex items-start gap-2 pl-1 text-xs leading-snug text-status-warning select-none">
      <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function DroppedChip() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-tint/[0.06] px-2.5 text-xs text-text-muted select-none">
      <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
      Not in the AI&apos;s context
    </span>
  );
}

function UserMessage({ message, isEditing, isLastUser, playerName, view, actions }) {
  const [copiedKey, markCopied] = useCopiedFeedback();
  const { sizeClass, isDocumentMode } = view;
  const isDropped = message.excluded === 1;
  const filesArray = Array.isArray(message.attachedFiles)
    ? message.attachedFiles
    : (typeof message.attachedFiles === 'string' ? safeParseJson(message.attachedFiles) : []);
  const isAutoGenerated = filesArray.length > 0
    && message.content === `Attached files: ${filesArray.map(file => file.name).join(', ')}`;
  const align = isDocumentMode ? 'start' : 'end';

  return (
    <div className={`flex flex-col gap-1.5 ${align === 'end' ? 'items-end' : 'items-start'} ${isDocumentMode || isEditing ? 'w-full' : 'max-w-[80%]'}`}>
      {isDropped && !isEditing && <DroppedChip />}
      {playerName && !isDropped && (
        <div className="px-1 text-xs text-text-muted select-none">
          {isEditing ? 'Editing your message as ' : 'You as '}<span className="font-semibold text-text-primary">{playerName}</span>
        </div>
      )}

      {filesArray.length > 0 && (
        <AttachedFiles files={filesArray} isDocumentMode={isDocumentMode} softBlur={view.softBlur} />
      )}

      {!isAutoGenerated && (isEditing ? (
        <MessageEditor
          initialValue={message.content}
          sizeClass={sizeClass}
          saveLabel="Save and regenerate"
          hint="The reply below it is replaced."
          requireChange
          onCancel={actions.cancelEdit}
          onSave={text => actions.saveUserEdit(message.id, text)}
        />
      ) : (
        <div
          style={isDropped ? undefined : view.userBubbleStyle}
          className={`relative max-w-full rounded-surface border text-text-secondary ${sizeClass} ${isDocumentMode ? 'w-full p-5' : 'px-4.5 py-3.5'} ${isDropped ? 'border-dashed border-tint/20 text-text-muted' : 'shadow-sm'}`}
        >
          <MessageMarkdown content={message.content} className="select-text text-left markdown-content leading-relaxed" />
        </div>
      ))}

      {!isEditing && (
        <div className={actionRowClass(isLastUser || isDropped, align)}>
          {isDropped ? (
            <button
              type="button"
              onClick={() => actions.toggleExcluded(message.id, false)}
              className="chat-action inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-default px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-tint/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Eye aria-hidden="true" className="h-3.5 w-3.5" />
              Restore to context
            </button>
          ) : (
            <>
              <ActionButton icon={Copy} label={copiedKey === 'message' ? 'Copied' : 'Copy'} onClick={() => { actions.copyText(message.content); markCopied('message'); }} />
              {isLastUser && <ActionButton icon={Pencil} label="Edit" onClick={() => actions.startEdit(message.id)} />}
            </>
          )}
          <MessageMenu message={message} actions={actions} />
        </div>
      )}
    </div>
  );
}

function AiMessage({ message, isEditing, isLastAi, isTyping, frame, view, actions }) {
  const [copiedKey, markCopied] = useCopiedFeedback();
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const { sizeClass, isDocumentMode, flags } = view;
  const { thinking, response } = parseMessageContent(message.content);
  const debugObj = safeParseDebugNotice(message.debugNotice);
  const diagnostics = diagnosticsFor(debugObj, flags);
  const alternatives = readAlternativeSwitcher(message.alternatives);
  const isDropped = message.excluded === 1;

  return (
    <div className={`flex flex-col items-start gap-2 ${isDocumentMode || isEditing ? 'w-full' : 'max-w-[86%]'}`}>
      <div className="flex w-full min-w-0 items-center gap-3">
        <SpeakerLabel name={message.aiName} color={message.aiColor}>
          {isEditing && <span className="font-normal text-text-muted">· Editing</span>}
        </SpeakerLabel>
        {diagnostics.length > 0 && (
          <MessageDiagnostics
            debug={debugObj}
            items={diagnostics}
            names={view.entityNames}
            copiedKey={copiedKey}
            onCopy={(key, content) => {
              actions.copyText(content);
              markCopied(key);
            }}
          />
        )}
      </div>
      {isDropped && !isEditing && <DroppedChip />}

      <div
        style={isEditing || isDropped ? undefined : view.aiBubbleStyle}
        className={`relative max-w-full overflow-hidden rounded-surface border ${sizeClass} ${isEditing ? 'w-full border-border-subtle bg-surface-panel p-4' : isDocumentMode ? 'w-full p-5' : 'px-4.5 py-4'} ${isDropped ? 'border-dashed border-tint/20 text-text-muted' : 'text-text-secondary shadow-sm'}`}
      >
        <RoleplayMessageFrame frame={frame} />
        {isEditing ? (
          <MessageEditor
            initialValue={message.content}
            sizeClass={sizeClass}
            saveLabel="Save"
            onCancel={actions.cancelEdit}
            onSave={text => actions.saveAiEdit(message, text)}
          />
        ) : (
          <>
            {thinking && (
              <div className="mb-3 border-b border-tint/[0.07] pb-3 select-none">
                <button
                  type="button"
                  aria-expanded={thinkingOpen}
                  onClick={() => setThinkingOpen(value => !value)}
                  className="flex w-full items-center gap-2 rounded-md text-left text-xs font-medium text-text-muted transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <Brain aria-hidden="true" className="h-3.5 w-3.5" />
                  Reasoning
                  <ChevronRight aria-hidden="true" className={`ml-auto h-3.5 w-3.5 transition-transform ${thinkingOpen ? 'rotate-90' : ''}`} />
                </button>
                {thinkingOpen && (
                  <div className="mt-2 rounded-xl border border-tint/5 bg-tint/5 p-3 font-mono text-xs italic text-text-muted whitespace-pre-wrap select-text animate-in fade-in duration-200">
                    {thinking}
                  </div>
                )}
              </div>
            )}
            {isTyping ? (
              <TypingText text={response} onComplete={actions.finishTyping} onClick={actions.finishTyping} />
            ) : (
              <MessageMarkdown content={response} className="leading-relaxed select-text markdown-content" />
            )}
          </>
        )}
      </div>

      {debugObj?.truncated && <Notice>The reply stopped at the output limit. Raise Max tokens on the AI profile for longer replies.</Notice>}
      {debugObj?.context?.agenticDegraded && <Notice>Retrieval stopped early after an error. This reply used partial context.</Notice>}

      {!isEditing && (
        <div className={actionRowClass(isLastAi || isDropped)}>
          {isDropped ? (
            <button
              type="button"
              onClick={() => actions.toggleExcluded(message.id, false)}
              className="chat-action inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-default px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-tint/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Eye aria-hidden="true" className="h-3.5 w-3.5" />
              Restore to context
            </button>
          ) : (
            <>
              <ActionButton icon={Copy} label={copiedKey === 'message' ? 'Copied' : 'Copy'} onClick={() => { actions.copyText(response); markCopied('message'); }} />
              <ActionButton icon={Pencil} label="Edit" onClick={() => actions.startEdit(message.id)} />
              {isLastAi && <ActionButton icon={RotateCw} label="Regenerate" onClick={() => actions.regenerate(message.id)} />}
            </>
          )}
          {alternatives && <AlternativeSwitcher alternatives={alternatives} onSwitch={index => actions.switchAlternative(message.id, index)} />}
          <MessageMenu message={message} actions={actions} />
        </div>
      )}
    </div>
  );
}

// One row of the chat. Memoized: a row re-renders only when its own message or flags
// change, never because another row opened a menu or the stream advanced.
export default memo(function ChatMessageItem({ message, isEditing, isLastUser, isLastAi, isTyping, frame, playerName, view, actions, deferRender }) {
  const isUser = message.role === 'user';
  const alignEnd = isUser && !view.isDocumentMode;
  return (
    <div
      data-chat-message-id={message.id}
      className={`${deferRender ? 'chat-message-deferred ' : ''}group/message flex w-full ${alignEnd ? 'justify-end' : 'justify-start'}`}
    >
      {isUser ? (
        <UserMessage message={message} isEditing={isEditing} isLastUser={isLastUser} playerName={playerName} view={view} actions={actions} />
      ) : (
        <AiMessage message={message} isEditing={isEditing} isLastAi={isLastAi} isTyping={isTyping} frame={frame} view={view} actions={actions} />
      )}
    </div>
  );
});
