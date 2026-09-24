import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, History, Info, MapPin, X } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import { formatTokens } from '../../components/ui/TokenBadge';
import { parseMarkdown } from '../../utils/markdown';
import { formatFrameDate, formatFrameTime, framePlaceKey, shouldShowTimeTransition } from '../chat/frame-format';

const fileUrl = path => `app-file:///${String(path).replace(/\\/g, '/')}`;

const formatStamp = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
};

// A summary made in roleplay keeps a frame per reply, so the log can break into scenes
// wherever the place changes and mark real jumps in time between them.
function buildLog(messages, frames) {
  const items = [];
  let place = null;
  let scene = 0;
  const pushScene = point => {
    scene += 1;
    items.push({ kind: 'scene', key: `scene-${scene}`, index: scene, point });
    place = framePlaceKey(point);
  };
  messages.forEach((message, position) => {
    const frame = message.role === 'user' ? null : frames[message.id];
    let playerName = null;
    if (message.role === 'user') {
      // A turn opens with the player's line, so a new place shows before it, not after it.
      const next = messages.slice(position + 1).find(candidate => candidate.role !== 'user');
      const nextFrame = next ? frames[next.id] : null;
      playerName = nextFrame?.start?.playerName || null;
      if (framePlaceKey(nextFrame?.start) && framePlaceKey(nextFrame.start) !== place) pushScene(nextFrame.start);
    } else if (frame && framePlaceKey(frame.start) && framePlaceKey(frame.start) !== place) {
      pushScene(frame.start);
    }
    items.push({ kind: 'message', key: message.id || `message-${position}`, message, playerName });
    if (!frame) return;
    if (framePlaceKey(frame.end) && framePlaceKey(frame.end) !== place) pushScene(frame.end);
    else if (shouldShowTimeTransition(frame)) items.push({ kind: 'time', key: `time-${message.id}`, frame });
  });
  return { items, scenes: scene };
}

export default function SummaryLogModal({ block, chatId, electronAPI, backgroundImage, onClose }) {
  const messages = useMemo(
    () => (block?.raw?.messages || []).filter(message => message && typeof message === 'object' && message.content != null),
    [block]
  );
  const [details, setDetails] = useState({});
  const [frames, setFrames] = useState({});
  const [backgrounds, setBackgrounds] = useState({});
  const [recapOpen, setRecapOpen] = useState(false);
  const [sceneInView, setSceneInView] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const ids = messages.map(message => message.id).filter(Boolean);
    if (!ids.length || !chatId) return;
    let active = true;
    const missing = messages.filter(message => !message.createdAt || (message.role !== 'user' && !message.aiName)).map(message => message.id);
    if (missing.length && electronAPI?.getArchivedMessageDetails) {
      electronAPI.getArchivedMessageDetails(chatId, missing).then(result => {
        if (active && result?.success) setDetails(Object.fromEntries(result.messages.map(row => [row.id, row])));
      }).catch(() => {});
    }
    const replyIds = messages.filter(message => message.role !== 'user').map(message => message.id);
    if (replyIds.length && electronAPI?.getRoleplayMessageFrames) {
      electronAPI.getRoleplayMessageFrames(chatId, replyIds).then(result => {
        if (active && result?.success) setFrames(Object.fromEntries((result.frames || []).map(frame => [frame.originId, frame])));
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [messages, chatId, electronAPI]);

  const { items, scenes } = useMemo(() => buildLog(messages, frames), [messages, frames]);
  const isRoleplay = scenes > 0;

  useEffect(() => {
    if (!isRoleplay || !electronAPI?.getRoleplayLocationBackground) return;
    let active = true;
    const locationIds = [...new Set(items.filter(item => item.kind === 'scene' && item.point?.locationId).map(item => item.point.locationId))];
    Promise.all(locationIds.map(async id => {
      const result = await electronAPI.getRoleplayLocationBackground(chatId, id).catch(() => null);
      return [id, result?.background?.imagePath || null];
    })).then(entries => { if (active) setBackgrounds(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [isRoleplay, items, chatId, electronAPI]);

  // The banner follows the scene at the top of the log, so the art changes as the reader moves.
  useEffect(() => {
    if (!isRoleplay || !scrollRef.current) return;
    const root = scrollRef.current;
    const update = () => {
      const cards = [...root.querySelectorAll('[data-scene]')];
      const top = root.getBoundingClientRect().top + 24;
      let current = cards[0];
      for (const card of cards) if (card.getBoundingClientRect().top <= top) current = card;
      setSceneInView(current ? Number(current.dataset.scene) : null);
    };
    update();
    root.addEventListener('scroll', update, { passive: true });
    return () => root.removeEventListener('scroll', update);
  }, [isRoleplay, items]);

  const activeScene = items.find(item => item.kind === 'scene' && item.index === sceneInView) || items.find(item => item.kind === 'scene');
  const bannerImage = (activeScene?.point?.locationId && backgrounds[activeScene.point.locationId]) || backgroundImage || null;
  const meta = [
    `~${formatTokens(block?.tokenCount || 0)} tok`,
    messages.length ? `${messages.length} message${messages.length === 1 ? '' : 's'}` : null,
    isRoleplay ? `${scenes} scene${scenes === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Modal onClose={onClose} size="wide" showClose={false} className="h-[88vh] max-h-[52rem] !bg-surface-panel">
      <div className="relative h-40 shrink-0 overflow-hidden">
        {bannerImage
          ? <img key={bannerImage} src={fileUrl(bannerImage)} alt="" className="absolute inset-0 h-full w-full object-cover animate-in fade-in duration-500" />
          : <div className="absolute inset-0 bg-mode-history/10" />}
        <div className="absolute inset-0 bg-gradient-to-b from-surface-canvas/10 via-surface-canvas/55 to-surface-panel" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close summary"
          className="absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-surface-canvas/55 text-text-primary backdrop-blur-md hover:bg-surface-canvas/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="absolute inset-x-7 bottom-4 flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="inline-flex h-6 items-center gap-1.5 self-start rounded-full border border-mode-history/35 bg-surface-canvas/60 px-2.5 text-xs font-medium text-mode-history backdrop-blur-md">
              <History className="h-3.5 w-3.5" aria-hidden="true" />{isRoleplay ? 'History summary · Roleplay' : 'History summary'}
            </span>
            <h2 className="truncate text-2xl font-semibold tracking-tight text-text-primary [text-shadow:0_1px_12px_rgb(0_0_0/50%)]">{block?.title}</h2>
            <span className="text-sm text-text-secondary tabular-nums">{meta}</span>
          </div>
          {isRoleplay && activeScene?.point?.locationName && (
            <span className="hidden h-7 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-surface-canvas/60 px-2.5 text-xs text-text-secondary backdrop-blur-md sm:inline-flex">
              <MapPin className="h-3.5 w-3.5 text-status-success" aria-hidden="true" />Scene in view: {activeScene.point.locationName}
            </span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar select-text">
        <div className="flex flex-col gap-5 px-7 pb-8 pt-3">
          {isRoleplay ? (
            <div className="flex items-start gap-3 rounded-card border border-border-subtle bg-white/[0.03] px-4 py-3">
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-secondary">Recap</span>
                {block?.summary
                  ? <div className={`markdown-content mt-1 text-sm leading-relaxed text-text-primary ${recapOpen ? '' : 'line-clamp-2'}`} dangerouslySetInnerHTML={{ __html: parseMarkdown(block.summary) }} />
                  : <p className="mt-1 text-sm italic text-text-muted">No recap was written for this archive.</p>}
              </div>
              {block?.summary && (
                <button type="button" onClick={() => setRecapOpen(value => !value)} className="shrink-0 rounded text-xs font-semibold text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer">
                  {recapOpen ? 'Show less' : 'Show all'}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <span className="text-sm font-semibold text-text-secondary">Recap</span>
              {block?.summary
                ? <div className="markdown-content text-[0.9375rem] leading-relaxed text-text-primary" dangerouslySetInnerHTML={{ __html: parseMarkdown(block.summary) }} />
                : <p className="text-sm italic text-text-muted">No recap was written for this archive. The saved history below is complete and searchable either way.</p>}
              <div className="flex items-start gap-2 rounded-control border border-border-subtle bg-white/[0.03] px-3 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
                <span className="text-xs leading-relaxed text-text-muted">This recap is for you. The AI does not read it: it searches the saved messages below and pulls back the passages that matter.</span>
              </div>
            </div>
          )}

          {!isRoleplay && (
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold text-text-secondary">Saved conversation</span>
              <span className="h-px flex-1 bg-border-subtle" />
              {messages.length > 0 && <span className="text-xs text-text-subtle">{messages.length} messages</span>}
            </div>
          )}

          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Info className="h-5 w-5 text-text-subtle" aria-hidden="true" />
              <p className="text-sm text-text-muted">No transcript was saved for this summary.</p>
              <p className="max-w-sm text-xs text-text-subtle">It was archived before transcripts were kept. The recap and the search data still work.</p>
            </div>
          ) : items.map(item => {
            if (item.kind === 'scene') {
              const image = item.point?.locationId ? backgrounds[item.point.locationId] : null;
              return (
                <div key={item.key} data-scene={item.index} className="relative h-[4.75rem] shrink-0 overflow-hidden rounded-card border border-border-default">
                  {image && <img src={fileUrl(image)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                  <div className={`absolute inset-0 ${image ? 'bg-gradient-to-r from-surface-canvas/95 via-surface-canvas/75 to-surface-canvas/35' : 'bg-white/[0.03]'}`} />
                  <div className="absolute inset-0 flex items-center justify-between gap-4 px-4">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-status-success">
                        <MapPin className="h-3 w-3" aria-hidden="true" />Scene {item.index}
                      </span>
                      <span className="truncate text-[0.9375rem] font-semibold text-text-primary">{item.point?.locationName || 'Unknown location'}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-text-secondary">
                      <span>{formatFrameDate(item.point)}</span>
                      <span className="font-mono text-text-muted">{formatFrameTime(item.point)}</span>
                    </span>
                  </div>
                </div>
              );
            }
            if (item.kind === 'time') {
              return (
                <div key={item.key} className="flex items-center gap-2.5 text-xs text-text-muted">
                  <span className="h-px flex-1 bg-border-subtle" />
                  <Clock3 className="h-3.5 w-3.5 text-status-warning" aria-hidden="true" />
                  <span className="font-mono">{formatFrameTime(item.frame.start)} → {formatFrameTime(item.frame.end)}</span>
                  <span className="h-px flex-1 bg-border-subtle" />
                </div>
              );
            }
            const message = { ...item.message, ...(details[item.message.id] || {}), content: item.message.content };
            const stamp = formatStamp(message.createdAt);
            if (message.role === 'user') {
              return (
                <div key={item.key} className="flex max-w-[78%] flex-col items-end gap-1.5 self-end">
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span className="font-semibold text-text-secondary">You</span>
                    {item.playerName && <>as<span className="rounded-full border border-status-info/30 bg-status-info/12 px-2 py-px font-medium text-status-info">{item.playerName}</span></>}
                    {stamp && <span>· {stamp}</span>}
                  </span>
                  <div className="whitespace-pre-wrap rounded-2xl rounded-br-md border border-border-subtle bg-surface-hover px-3.5 py-2.5 text-sm leading-relaxed text-text-primary">{message.content}</div>
                </div>
              );
            }
            const color = message.aiColor || null;
            return (
              <div key={item.key} className="flex max-w-[92%] flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  <span className="h-[0.4375rem] w-[0.4375rem] rounded-full bg-text-subtle" style={color ? { backgroundColor: color } : undefined} />
                  <span className="font-semibold text-text-secondary">{message.aiName || 'AI'}</span>
                  {stamp && <span>· {stamp}</span>}
                </span>
                <div
                  className="whitespace-pre-wrap border-l-2 border-border-default pl-3.5 text-sm leading-relaxed text-text-primary"
                  style={color ? { borderLeftColor: `color-mix(in srgb, ${color} 40%, transparent)` } : undefined}
                >
                  {message.content}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
