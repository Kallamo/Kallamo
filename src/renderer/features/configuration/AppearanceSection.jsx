import { useEffect, useRef, useState } from 'react';
import { ImageUp, Palette, Send } from 'lucide-react';
import Button from '../../components/ui/Button';
import { ConfigSection, FieldLabel } from './ConfigParts';

const fileUrl = path => `url("app-file:///${String(path).replace(/\\/g, '/')}")`;

export default function AppearanceSection({ sectionRef, activeChat, handleSaveChat, electronAPI, showToast }) {
  const inputRef = useRef(null);
  const background = activeChat.backgroundImage || '';
  // Saved once the hand rests: a save per step re-renders the whole app.
  const [levels, setLevels] = useState(() => readLevels(activeChat));
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const chatRef = useRef(activeChat);
  chatRef.current = activeChat;
  useEffect(() => {
    if (!Object.keys(pendingRef.current).length) setLevels(readLevels(activeChat));
  }, [activeChat.id, activeChat.backdropOpacity, activeChat.userBubbleOpacity, activeChat.aiBubbleOpacity]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = () => {
    window.clearTimeout(timerRef.current);
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length) handleSaveChat({ ...chatRef.current, ...patch, updatedAt: Date.now() });
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const slide = (field, value) => {
    setLevels(current => ({ ...current, [field]: value }));
    pendingRef.current = { ...pendingRef.current, [field]: value };
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, 350);
  };
  const { backdropOpacity: dimming, userBubbleOpacity: userOpacity, aiBubbleOpacity: aiOpacity } = levels;

  const change = (field, value) => handleSaveChat({ ...activeChat, [field]: value, updatedAt: Date.now() });

  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const stored = await electronAPI.uploadChatBgImage(activeChat.id, file.path || '', file.name);
      await change('backgroundImage', stored);
    } catch (error) {
      console.error('Error uploading the background image:', error);
      showToast?.('Could not use that image.', 'error');
    }
  };

  return (
    <ConfigSection
      id="appearance"
      sectionRef={sectionRef}
      icon={Palette}
      title="Appearance"
      description="Background art and message transparency in this workspace's chat."
    >
      <div className="grid gap-7 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <div>
            <FieldLabel className="mb-2">Background image</FieldLabel>
            {background ? (
              <>
                <div className="h-32 w-full rounded-card border border-border-subtle bg-cover bg-center" style={{ backgroundImage: fileUrl(background) }} role="img" aria-label="Current background" />
                <div className="mt-2 flex gap-2">
                  <Button variant="ghost" size="sm" icon={ImageUp} onClick={() => inputRef.current?.click()}>Replace</Button>
                  <Button variant="subtle" size="sm" onClick={() => change('backgroundImage', '')}>Remove</Button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex h-32 w-full flex-col items-center justify-center gap-1.5 rounded-card border-2 border-dashed border-border-default text-text-muted transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ImageUp aria-hidden="true" className="h-5 w-5" />
                <span className="text-xs font-semibold">Choose an image</span>
              </button>
            )}
            <input ref={inputRef} type="file" accept="image/*" onChange={upload} className="hidden" />
          </div>
          <RangeField label="Background dimming" value={dimming} onChange={value => slide('backdropOpacity', value)} onRelease={flush} />
          <RangeField label="Your messages" value={userOpacity} onChange={value => slide('userBubbleOpacity', value)} onRelease={flush} />
          <RangeField label="AI messages" value={aiOpacity} onChange={value => slide('aiBubbleOpacity', value)} onRelease={flush} />
        </div>

        <div className="flex flex-col">
          <FieldLabel className="mb-2">Preview</FieldLabel>
          <div
            className="relative min-h-[20rem] flex-1 overflow-hidden rounded-card border border-border-subtle bg-cover bg-center"
            style={background ? { backgroundImage: fileUrl(background) } : { backgroundColor: 'var(--theme-surface-canvas)' }}
          >
            <div className="absolute inset-0 bg-surface-canvas" style={{ opacity: dimming / 100 }} />
            <div className="relative z-10 flex h-full flex-col justify-end gap-2.5 p-4">
              <div
                className="max-w-[75%] self-end rounded-surface border px-3 py-2 text-[0.8125rem] leading-snug text-text-secondary backdrop-blur-md"
                style={{ backgroundColor: `color-mix(in srgb, var(--theme-bubble-user) ${userOpacity}%, transparent)`, borderColor: 'color-mix(in srgb, var(--app-accent) 15%, transparent)' }}
              >
                How does the northern keep look at dawn?
              </div>
              <div
                className="max-w-[85%] rounded-surface border px-3 py-2 text-[0.8125rem] leading-snug text-text-secondary backdrop-blur-md"
                style={{ backgroundColor: `color-mix(in srgb, var(--theme-surface-panel) ${aiOpacity}%, transparent)`, borderColor: 'var(--theme-highlight)' }}
              >
                Mist clings to the ramparts as first light spills over the valley, gilding the old stone.
              </div>
              <div className="flex h-10 items-center rounded-card border border-border-subtle bg-surface-editor/90 pl-3 pr-1.5">
                <span className="flex-1 select-none text-[0.8125rem] text-text-disabled">Write a message</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent"><Send aria-hidden="true" className="h-3.5 w-3.5 text-on-accent" /></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ConfigSection>
  );
}

function readLevels(chat) {
  return {
    backdropOpacity: chat.backdropOpacity ?? 75,
    userBubbleOpacity: chat.userBubbleOpacity ?? 100,
    aiBubbleOpacity: chat.aiBubbleOpacity ?? 0
  };
}

function RangeField({ label, value, onChange, onRelease }) {
  return (
    <label className="block">
      <span className="mb-2.5 flex justify-between">
        <span className="text-[0.8125rem] font-semibold text-text-secondary">{label}</span>
        <span className="text-[0.8125rem] tabular-nums text-text-muted">{value}%</span>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={event => onChange(parseInt(event.target.value, 10))}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
        className="setting-range"
        style={{ '--range-value': `${value}%` }}
      />
    </label>
  );
}
