import { memo, useEffect, useRef, useState } from 'react';
import { Brain, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, Edit, Eye, EyeOff, MapPin, MoreVertical, Paperclip, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import Popover from '../../../components/ui/Popover';
import MessageMarkdown from './MessageMarkdown';
import MessageEditor from './MessageEditor';
import TypingText from './TypingText';
import { parseMessageContent } from '../message-content';
import { readAlternativeSwitcher } from '../message-alternatives';
import {
  diagnosticText,
  formatAgenticTrace,
  formatRetrievalDiagnostics,
  safeParseDebugNotice,
  safeParseJson
} from '../diagnostic-format';

const COPIED_FEEDBACK_MS = 2000;

export const isImage = (name) => /\.(png|jpe?g|gif|webp)$/i.test(name);
export const isVideo = (name) => /\.(mp4|webm|ogg)$/i.test(name);

const formatFrameDate = point => {
  if (!point?.position) return '';
  const { position, display } = point;
  return `${position.day} ${display?.monthName || `Month ${position.month}`} ${position.year}${display?.eraShortName ? ` ${display.eraShortName}` : ''}`;
};

const formatFrameTime = point => point?.position
  ? `${String(point.position.hour ?? 0).padStart(2, '0')}:${String(point.position.minute ?? 0).padStart(2, '0')}`
  : '';

const formatFrameWeekday = point => point?.display?.weekdayName || '';

const sameFrameDate = (left, right) => left?.position && right?.position
  && left.position.eraId === right.position.eraId
  && left.position.year === right.position.year
  && left.position.month === right.position.month
  && left.position.day === right.position.day;

const shouldShowTimeTransition = frame => {
  if (!frame?.advance) return false;
  const duration = frame.advance.duration || {};
  return !sameFrameDate(frame.start, frame.end)
    || Number(duration.years) > 0
    || Number(duration.months) > 0
    || Number(duration.days) > 0
    || Number(duration.hours) > 0
    || Number(duration.minutes) >= 30;
};

function RoleplayMessageFrame({ frame }) {
  if (!frame?.end) return null;
  const locationChanged = frame.start?.locationId !== frame.end?.locationId
    || frame.start?.locationName !== frame.end?.locationName;
  const timeChanged = shouldShowTimeTransition(frame);
  return (
    <div className={`mb-3 grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-white/[0.07] pb-3 text-gray-500 select-none ${frame.pending ? 'opacity-70' : ''}`}>
      <span className="flex min-w-0 items-center gap-2 text-xs">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
        <span className="min-w-0 truncate font-medium text-gray-400">
          {locationChanged
            ? <><span>{frame.start?.locationName || 'Unknown location'}</span><span className="px-1.5 text-gray-700">→</span><span className="text-gray-300">{frame.end.locationName || 'Unknown location'}</span></>
            : <span>{frame.end.locationName || 'No current location'}</span>}
        </span>
        {frame.pending && (
          <span
            title="Place and time for this reply update when the story continues."
            className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-gray-500"
          >
            Pending
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-4 text-right">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <CalendarDays className="h-3.5 w-3.5 text-sky-300/80" />
          {sameFrameDate(frame.start, frame.end) ? formatFrameDate(frame.end) : `${formatFrameDate(frame.start)} → ${formatFrameDate(frame.end)}`}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-gray-500">
          <Clock3 className="h-3.5 w-3.5 text-amber-300/80" />
          {timeChanged ? <>{formatFrameTime(frame.start)}<span className="px-1 text-gray-700">→</span>{formatFrameTime(frame.end)}</> : formatFrameTime(frame.end)}
          {formatFrameWeekday(frame.end) && <span className="font-sans text-gray-500">· {formatFrameWeekday(frame.end)}</span>}
        </span>
      </span>
    </div>
  );
}

function MessageDiagnostics({ debug, flags, activeKey, onToggle, onCopy, copiedKey }) {
  const diagnostics = [
    flags.agenticDebug && (debug?.agentic || debug?.agenticRagResponse || debug?.agenticTrajectory) && {
      key: 'agentic',
      label: 'Agentic Retrieval Trace',
      title: 'Copy the sanitized Agentic retrieval trace',
      content: formatAgenticTrace(debug),
      copyLabel: 'Copy Trace'
    },
    flags.ragDebug && (debug?.retrieval || debug?.standardRagContextGathered) && {
      key: 'retrieval',
      label: 'Retrieval & Context',
      title: 'Copy retrieval decisions and final narrative context',
      content: formatRetrievalDiagnostics(debug),
      copyLabel: 'Copy Report'
    },
    flags.narrativeStateDebug && debug?.narrativeState && {
      key: 'narrative',
      label: `Narrative State · ${debug.narrativeState.status}`,
      title: 'Copy Narrative State diagnostics',
      content: diagnosticText(debug.narrativeState),
      copyLabel: 'Copy Report'
    }
  ].filter(Boolean);
  if (!diagnostics.length) return null;
  const active = diagnostics.find(item => item.key === activeKey);
  return (
    <div className="mb-2 ml-1 max-w-full select-none">
      <div className="flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 custom-scrollbar">
        {diagnostics.map(item => (
          <span key={item.key} className={`inline-flex shrink-0 items-center rounded-md border text-[0.625rem] font-semibold uppercase tracking-[0.08em] transition-colors ${activeKey === item.key ? 'border-accent/25 bg-accent/[0.07] text-accent' : 'border-white/[0.07] bg-black/20 text-gray-500 hover:border-white/15 hover:text-gray-300'}`}>
            <button type="button" aria-expanded={activeKey === item.key} onClick={() => onToggle(item.key)} className="inline-flex items-center gap-1 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <span>{item.label}</span>
              <ChevronDown className={`h-2.5 w-2.5 transition-transform ${activeKey === item.key ? 'rotate-180' : ''}`} />
            </button>
            {activeKey === item.key && (
              <button type="button" onClick={() => onCopy(item.key, item.content)} className="inline-flex items-center gap-1 border-l border-white/10 px-2 py-1 text-gray-400 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" title={item.title}>
                <Copy className="h-2.5 w-2.5" />
                <span>{copiedKey === item.key ? 'Copied!' : item.copyLabel}</span>
              </button>
            )}
          </span>
        ))}
      </div>
      {active && (
        <div className="mt-1 max-h-96 max-w-2xl overflow-y-auto rounded-lg border border-gray-800 bg-[#051116] p-3 font-mono text-xs text-gray-400 shadow-md custom-scrollbar animate-in fade-in duration-200">
          <div className="whitespace-pre-wrap">{active.content}</div>
        </div>
      )}
    </div>
  );
}

function TokenUsage({ debug, expanded, onToggle }) {
  const usage = debug.usage;
  const legacyUsage = debug.tokens || {};
  const input = usage
    ? usage.total.input
    : (legacyUsage.totalInput || 0) + (legacyUsage.agenticInput || 0);
  const output = usage
    ? usage.total.output
    : (legacyUsage.output || 0) + (legacyUsage.agenticOutput || 0);
  const total = usage ? usage.total.total : input + output;
  return (
    <div className="mb-1.5 ml-1 max-w-full font-mono text-[0.625rem] text-gray-400">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="inline-flex max-w-full items-center gap-2.5 rounded-md border border-white/[0.07] bg-black/25 px-2 py-0.5 text-left tracking-[0.06em] hover:border-white/15"
      >
        <span className="uppercase text-gray-600">Tokens · {usage?.accuracy || 'legacy estimate'}</span>
        <span><span className="text-gray-600">In</span> <strong className="font-semibold text-accent/90">{input.toLocaleString()}</strong></span>
        <span><span className="text-gray-600">Out</span> <strong className="font-semibold text-accent/90">{output.toLocaleString()}</strong></span>
        <span><span className="text-gray-600">Total</span> {total.toLocaleString()}</span>
        <ChevronDown className={`h-2.5 w-2.5 shrink-0 text-gray-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1 grid w-fit max-w-full grid-cols-[auto_auto_auto] gap-x-4 gap-y-1 rounded-lg border border-gray-800 bg-[#051116] px-3 py-2 text-[0.625rem] text-gray-400">
          <span className="font-bold text-gray-300">Lifecycle</span>
          <span className="font-bold text-gray-300">Input</span>
          <span className="font-bold text-gray-300">Output</span>
          <span>Main generation</span>
          <span>{(usage?.main.input ?? legacyUsage.totalInput ?? 0).toLocaleString()}</span>
          <span>{(usage?.main.output ?? legacyUsage.output ?? 0).toLocaleString()}</span>
          {(usage?.agentic.total ?? ((legacyUsage.agenticInput || 0) + (legacyUsage.agenticOutput || 0))) > 0 && (
            <>
              <span>Agentic retrieval</span>
              <span>{(usage?.agentic.input ?? legacyUsage.agenticInput ?? 0).toLocaleString()}</span>
              <span>{(usage?.agentic.output ?? legacyUsage.agenticOutput ?? 0).toLocaleString()}</span>
            </>
          )}
          {usage?.narrativeState.total > 0 && (
            <>
              <span>Narrative State</span>
              <span>{usage.narrativeState.input.toLocaleString()}</span>
              <span>{usage.narrativeState.output.toLocaleString()}</span>
            </>
          )}
          <span className="col-span-3 mt-1 border-t border-gray-800 pt-1 text-gray-500">
            Main input: System {(usage?.main.systemInstructions ?? 0).toLocaleString()} · Context {(usage?.main.narrativeContext ?? legacyUsage.knowledgeBase ?? 0).toLocaleString()} · History {(usage?.main.chatHistory ?? legacyUsage.chatHistory ?? 0).toLocaleString()} · Message {(usage?.main.userInput ?? 0).toLocaleString()}
          </span>
          {usage?.cache?.active && (
            <span className="col-span-3 border-t border-gray-800 pt-1 text-gray-500">
              Prompt cache (reported by the provider): Read {usage.cache.read.toLocaleString()} · Written {usage.cache.write.toLocaleString()} · Net saving ≈ {(usage.cache.savedTokens - usage.cache.surchargeTokens).toLocaleString()} input tokens
            </span>
          )}
        </div>
      )}
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
            className={`flex items-center space-x-2 bg-[#1a2d32]/45 ${softBlur ? 'backdrop-blur-sm' : ''} border border-gray-800/80 rounded-xl p-1.5 text-[0.625rem] text-gray-300 shadow-md`}
          >
            {isImage(file.name) && (
              <img
                src={fileUrl}
                alt="preview"
                className="w-8 h-8 object-cover rounded-lg border border-gray-700/50 shrink-0"
              />
            )}
            {isVideo(file.name) && (
              <video
                src={fileUrl}
                className="w-8 h-8 object-cover rounded-lg border border-gray-700/50 shrink-0"
                muted
              />
            )}
            {!hasThumbnail && (
              <div className="w-8 h-8 bg-[#051116] border border-gray-800 rounded-lg flex items-center justify-center text-gray-500 shrink-0">
                <Paperclip className="w-3.5 h-3.5" />
              </div>
            )}
            <div className="flex flex-col min-w-0 max-w-[80px]">
              <span className="truncate text-[0.5625rem] font-bold text-gray-100" title={file.name}>{file.name}</span>
              <span className="text-[0.4375rem] text-gray-500 font-mono mt-0.5">{(file.size / 1024).toFixed(0)} KB</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MessageMenu({ message, actions }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const choose = (event, action) => {
    event.stopPropagation();
    setOpen(false);
    action();
  };
  return (
    <div className="relative">
      <button
        ref={anchorRef}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(value => !value);
        }}
        className="flex items-center text-gray-300 hover:text-accent transition-colors cursor-pointer three-dots-button"
      >
        <MoreVertical className="w-3 h-3 transition-colors" />
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} align="right" maxHeight={160} scroll={false} className="w-44 py-1 text-left text-[0.625rem] font-bold uppercase tracking-wider">
        <button
          onClick={(event) => choose(event, () => actions.requestDelete(message.id))}
          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-white/5 hover:text-red-400 transition-colors flex items-center space-x-1.5 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5 text-inherit" />
          <span>Delete Message</span>
        </button>
        <button
          onClick={(event) => choose(event, () => actions.toggleExcluded(message.id, message.excluded !== 1))}
          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-white/5 hover:text-accent transition-colors flex items-center space-x-1.5 cursor-pointer"
        >
          {message.excluded === 1
            ? <Eye className="w-3.5 h-3.5 text-inherit" />
            : <EyeOff className="w-3.5 h-3.5 text-inherit" />}
          <span>{message.excluded === 1 ? 'Restore to Context' : 'Drop from Context'}</span>
        </button>
        <button
          onClick={(event) => choose(event, () => actions.requestRevert(message.id))}
          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-white/5 hover:text-accent transition-colors flex items-center space-x-1.5 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-inherit" />
          <span>Revert Chat Here</span>
        </button>
      </Popover>
    </div>
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

function UserMessage({ message, isEditing, isLastUser, view, actions }) {
  const [copiedKey, markCopied] = useCopiedFeedback();
  const { sizeClass, isDocumentMode } = view;
  const filesArray = Array.isArray(message.attachedFiles)
    ? message.attachedFiles
    : (typeof message.attachedFiles === 'string' ? safeParseJson(message.attachedFiles) : []);
  const isAutoGenerated = filesArray.length > 0
    && message.content === `Attached files: ${filesArray.map(file => file.name).join(', ')}`;

  return (
    <div className={`flex flex-col ${!isDocumentMode ? 'items-end' : 'items-start'} ${isDocumentMode || isEditing ? 'w-full' : 'max-w-[80%]'}`}>

      {/* Attached files preview above the user bubble box */}
      {filesArray.length > 0 && (
        <AttachedFiles files={filesArray} isDocumentMode={isDocumentMode} softBlur={view.softBlur} />
      )}

      {/* User Message Bubble */}
      {!isAutoGenerated && (
        <div
          style={view.userBubbleStyle}
          className={`rounded-2xl border text-gray-200 shadow-sm relative group max-w-full ${sizeClass} ${isEditing ? 'w-full' : ''} ${isDocumentMode ? 'p-5 w-full text-left' : 'p-3 text-right'
            }`}
        >
          {isEditing ? (
            <MessageEditor
              initialValue={message.content}
              sizeClass={sizeClass}
              minHeightClass="min-h-[7rem]"
              saveLabel="Save & Regenerate"
              requireChange
              onCancel={actions.cancelEdit}
              onSave={text => actions.saveUserEdit(message.id, text)}
            />
          ) : (
            <MessageMarkdown content={message.content} className="select-text text-left markdown-content leading-relaxed" />
          )}
        </div>
      )}

      {/* User Actions (Copy, Edit, 3-dots) */}
      {!isEditing && (
        <div className={`flex items-center space-x-2 px-2 py-1 ${view.softBlur ? 'backdrop-blur-[2px]' : ''} rounded-lg text-[0.5625rem] font-bold uppercase tracking-wider select-none shrink-0 group`}>
          <button
            onClick={() => {
              actions.copyText(message.content);
              markCopied('message');
            }}
            className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
          >
            <Copy className="w-3 h-3 transition-colors" />
            <span>{copiedKey === 'message' ? 'Copied' : 'Copy'}</span>
          </button>
          {isLastUser && (
            <>
              <span className="text-gray-600">|</span>
              <button
                onClick={() => actions.startEdit(message.id)}
                className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
              >
                <Edit className="w-3 h-3 transition-colors" />
                <span>Edit</span>
              </button>
            </>
          )}
          <span className="text-gray-600">|</span>
          <MessageMenu message={message} actions={actions} />
        </div>
      )}

    </div>
  );
}

function AiMessage({ message, isEditing, isLastAi, isTyping, frame, view, actions }) {
  const [copiedKey, markCopied] = useCopiedFeedback();
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [diagnosticKey, setDiagnosticKey] = useState(null);
  const { sizeClass, isDocumentMode, flags } = view;
  const { thinking, response } = parseMessageContent(message.content);
  const debugObj = safeParseDebugNotice(message.debugNotice);

  const alternatives = readAlternativeSwitcher(message.alternatives);

  return (
    <div className={`flex flex-col items-start ${isDocumentMode || isEditing ? 'w-full' : 'max-w-[80%]'}`}>

      {flags.tokenDebug && (debugObj?.usage || debugObj?.tokens) && (
        <TokenUsage debug={debugObj} expanded={tokensOpen} onToggle={() => setTokensOpen(value => !value)} />
      )}

      {debugObj?.truncated && (
        <p className="mb-1 ml-1.5 select-none text-[0.625rem] font-medium uppercase tracking-[0.08em] text-status-warning">
          Reply cut off at the output limit. Raise Max Tokens on the AI Profile for longer replies.
        </p>
      )}
      {debugObj?.context?.agenticDegraded && (
        <p className="mb-1 ml-1.5 select-none text-[0.625rem] font-medium uppercase tracking-[0.08em] text-status-warning">
          Retrieval stopped early after an error. This reply used partial context.
        </p>
      )}

      <MessageDiagnostics
        debug={debugObj}
        flags={flags}
        activeKey={diagnosticKey}
        onToggle={key => setDiagnosticKey(previous => previous === key ? null : key)}
        onCopy={(key, content) => {
          actions.copyText(content);
          markCopied(key);
        }}
        copiedKey={copiedKey}
      />

      {/* Legacy RAG Context Warning Header */}
      {flags.ragDebug && (debugObj?.legacyText || debugObj?.workflowStatus) && (
        <div className="text-[0.5625rem] text-gray-500 font-mono mb-1 ml-1.5 select-none uppercase tracking-wider">
          ℹ️ {debugObj.legacyText || debugObj.workflowStatus}
        </div>
      )}

      {/* AI Bubble */}
      <div
        style={view.aiBubbleStyle}
        className={`rounded-2xl border text-gray-200 shadow-sm relative overflow-hidden group max-w-full ${sizeClass} ${isEditing ? 'w-full' : ''} ${isDocumentMode ? 'p-5 w-full text-left' : 'p-3'
          }`}
      >
        {isEditing ? (
          <MessageEditor
            initialValue={message.content}
            sizeClass={sizeClass}
            minHeightClass="min-h-[10rem]"
            saveLabel="Save"
            onCancel={actions.cancelEdit}
            onSave={text => actions.saveAiEdit(message, text)}
          />
        ) : (
          <>
            <RoleplayMessageFrame frame={frame} />

            {alternatives && (
              <div className="mb-2 ml-auto flex w-fit items-center space-x-1.5 rounded border border-gray-800 bg-[#011419]/70 px-1.5 py-0.5 text-[0.5rem] font-bold text-gray-400 select-none">
                <button
                  disabled={alternatives.index === 0}
                  onClick={() => actions.switchAlternative(message.id, alternatives.index - 1)}
                  className="hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-2.5 h-2.5" />
                </button>
                <span className="font-mono text-[0.5rem]">{alternatives.index + 1}/{alternatives.count}</span>
                <button
                  disabled={alternatives.index === alternatives.count - 1}
                  onClick={() => actions.switchAlternative(message.id, alternatives.index + 1)}
                  className="hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            {/* AI Thinking Collapsible Block */}
            {thinking && (
              <div className="mb-2.5 select-none border-b border-gray-800/40 pb-2">
                <button
                  onClick={() => setThinkingOpen(value => !value)}
                  className="flex items-center space-x-1.5 text-gray-500 hover:text-accent transition-colors text-[0.625rem] font-bold uppercase tracking-wider cursor-pointer"
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span>{thinkingOpen ? 'Hide Thoughts' : 'Thinking'}</span>
                </button>
                {thinkingOpen && (
                  <div className="mt-2 p-3 bg-white/5 border border-white/5 rounded-xl text-xs font-mono text-gray-400 italic whitespace-pre-wrap animate-in fade-in duration-200">
                    {thinking}
                  </div>
                )}
              </div>
            )}

            {/* AI Response with streaming typing effect */}
            {isTyping ? (
              <TypingText
                text={response}
                onComplete={actions.finishTyping}
                onClick={actions.finishTyping}
              />
            ) : (
              <MessageMarkdown content={response} className="leading-relaxed select-text markdown-content" />
            )}
          </>
        )}
      </div>

      {/* AI Actions (Copy, Edit, Regenerate, 3-dots) */}
      {!isEditing && (
        <div className={`flex items-center space-x-2 px-2 py-1 ${view.softBlur ? 'backdrop-blur-[2px]' : ''} rounded-lg text-[0.5625rem] font-bold uppercase tracking-wider select-none shrink-0 group`}>
          <button
            onClick={() => {
              actions.copyText(response);
              markCopied('message');
            }}
            className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
          >
            <Copy className="w-3 h-3 transition-colors" />
            <span>{copiedKey === 'message' ? 'Copied' : 'Copy'}</span>
          </button>
          <span className="text-gray-600">|</span>
          <button
            onClick={() => actions.startEdit(message.id)}
            className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
          >
            <Edit className="w-3 h-3 transition-colors" />
            <span>Edit</span>
          </button>
          {isLastAi && (
            <>
              <span className="text-gray-600">|</span>
              <button
                onClick={() => actions.regenerate(message.id)}
                className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
              >
                <RotateCw className="w-3 h-3 transition-colors" />
                <span>Regenerate</span>
              </button>
            </>
          )}
          <span className="text-gray-600">|</span>
          <MessageMenu message={message} actions={actions} />
        </div>
      )}

    </div>
  );
}

// One row of the chat. Memoized: a row re-renders only when its own message or flags
// change, never because another row opened a menu or the stream advanced.
export default memo(function ChatMessageItem({ message, isEditing, isLastUser, isLastAi, isTyping, frame, view, actions, deferRender }) {
  const isUser = message.role === 'user';
  const isDropped = message.excluded === 1;
  const alignEnd = isUser && !view.isDocumentMode;
  return (
    <div
      data-chat-message-id={message.id}
      className={`${deferRender ? 'chat-message-deferred ' : ''}flex flex-col ${alignEnd ? 'items-end' : 'items-start'} w-full ${isDropped ? 'opacity-45' : ''}`}
    >
      {isDropped && (
        <span className="flex items-center space-x-1 text-[0.5625rem] font-bold uppercase tracking-wider text-gray-500 mb-1 select-none">
          <EyeOff className="w-2.5 h-2.5" />
          <span>Dropped from context</span>
        </span>
      )}
      <div className={`flex w-full ${alignEnd ? 'justify-end' : 'justify-start'}`}>
        {isUser ? (
          <UserMessage message={message} isEditing={isEditing} isLastUser={isLastUser} view={view} actions={actions} />
        ) : (
          <AiMessage message={message} isEditing={isEditing} isLastAi={isLastAi} isTyping={isTyping} frame={frame} view={view} actions={actions} />
        )}
      </div>
    </div>
  );
});
