import { useEffect, useState } from 'react';
import { WritingGlyph } from '../../components/ui/glyphs';
import { ChoiceCard, ConfigSection, SettingsList, ShareSlider, SwitchRow, UnitNumberField } from './ConfigParts';
import { deskHistorySource } from './desk-history';


const SOURCES = [
  { value: 'none', title: 'None', description: 'Only the chapter, notes and memory.' },
  { value: 'chat', title: 'Chat', description: 'Your talk with the AI about the work.' },
  { value: 'roleplay', title: 'Roleplay', description: 'The story as it was played.', roleplay: true },
  { value: 'both', title: 'Both', description: 'The story and the talk, split below.', roleplay: true }
];

export default function WritingDeskSection({ sectionRef, activeChat, handleSaveChat, roleplayEnabled = false }) {
  const [readingSize, setReadingSize] = useState(8192);
  const [share, setShare] = useState(25);
  const [split, setSplit] = useState(60);
  useEffect(() => setReadingSize(Number(activeChat.wdContextWindow ?? 8192) || 8192), [activeChat.id, activeChat.wdContextWindow]);
  useEffect(() => setShare(Number(activeChat.wdHistoryShare) || 25), [activeChat.id, activeChat.wdHistoryShare]);
  useEffect(() => setSplit(Number(activeChat.wdHistorySplit) || 60), [activeChat.id, activeChat.wdHistorySplit]);

  const save = patch => handleSaveChat({ ...activeChat, ...patch });
  const commit = () => {
    const value = Math.max(1024, Math.floor(Number(readingSize) || 8192));
    setReadingSize(value);
    if (value !== Number(activeChat.wdContextWindow)) save({ wdContextWindow: value });
  };

  const source = deskHistorySource(activeChat);
  // A roleplay source stays visible while chosen, so turning the mode off never hides the setting in use.
  const sources = SOURCES.filter(option => !option.roleplay || roleplayEnabled || option.value === source);
  const chooseSource = value => save({ wdHistorySource: value, wdUseChatHistory: value === 'none' ? 0 : 1 });
  const readsHistory = source !== 'none';

  return (
    <ConfigSection
      id="writing"
      sectionRef={sectionRef}
      icon={WritingGlyph}
      title="Writing Desk"
      description="What the AI reads when you ask it about a highlighted passage."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <UnitNumberField
          label="Reading size"
          unit="tokens"
          value={readingSize}
          min={1024}
          step={1024}
          onChange={setReadingSize}
          onCommit={commit}
          help="A chapter that fits is read whole. A longer one is read around your selection, with related notes. Lower it for tighter, faster answers."
        />
      </div>

      <h3 className="mb-2.5 mt-7 text-[0.8125rem] font-semibold text-text-muted">Conversation history</h3>
      <div role="radiogroup" aria-label="Conversation history" className={`grid gap-2.5 ${sources.length > 2 ? 'md:grid-cols-4' : 'md:grid-cols-2'}`}>
        {sources.map(option => (
          <ChoiceCard
            key={option.value}
            name="wd-history-source"
            selected={source === option.value}
            onSelect={() => chooseSource(option.value)}
            title={option.title}
            description={option.description}
          />
        ))}
      </div>

      {readsHistory && (
        <SettingsList className="mt-3">
          <ShareSlider
            label="Share of the reading size"
            value={share}
            summary={`${share}% · about ${Math.round((readingSize * share) / 100).toLocaleString('en-US')} tokens`}
            help="What the chapter does not use can go to history, never the other way round. Turn it down if a conversation's tone or language is leaking into your prose."
            onChange={setShare}
            onCommit={() => { if (share !== Number(activeChat.wdHistoryShare)) save({ wdHistoryShare: share }); }}
          />
          {source === 'both' && (
            <ShareSlider
              label="Split between the two"
              value={split}
              summary={`${split}% roleplay · ${100 - split}% chat`}
              leftLabel="More chat"
              rightLabel="More roleplay"
              onChange={setSplit}
              onCommit={() => { if (split !== Number(activeChat.wdHistorySplit)) save({ wdHistorySplit: split }); }}
            />
          )}
          <SwitchRow
            label="Include summaries"
            description="Archived parts of the chosen history, read before the recent messages."
            checked={activeChat.wdHistorySummaries !== 0}
            onChange={checked => save({ wdHistorySummaries: checked ? 1 : 0 })}
          />
        </SettingsList>
      )}
    </ConfigSection>
  );
}
