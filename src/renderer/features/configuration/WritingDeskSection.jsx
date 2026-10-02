import { useEffect, useState } from 'react';
import { WritingGlyph } from '../../components/ui/glyphs';
import { ConfigSection, SettingsList, SwitchRow, UnitNumberField } from './ConfigParts';

export default function WritingDeskSection({ sectionRef, activeChat, handleSaveChat }) {
  const [readingSize, setReadingSize] = useState(8192);
  useEffect(() => setReadingSize(Number(activeChat.wdContextWindow ?? 8192) || 8192), [activeChat.id, activeChat.wdContextWindow]);

  const commit = () => {
    const value = Math.max(1024, Math.floor(Number(readingSize) || 8192));
    setReadingSize(value);
    if (value !== Number(activeChat.wdContextWindow)) handleSaveChat({ ...activeChat, wdContextWindow: value });
  };

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
      <SettingsList className="mt-4">
        <SwitchRow
          label="Include chat history"
          description="Lets the Desk see this workspace's conversation. Turn it off if the chat's tone or language is leaking into your prose."
          checked={activeChat.wdUseChatHistory !== 0}
          onChange={checked => handleSaveChat({ ...activeChat, wdUseChatHistory: checked ? 1 : 0 })}
        />
      </SettingsList>
    </ConfigSection>
  );
}
