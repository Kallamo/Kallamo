import { memo, useState } from 'react';

// The edit box owns its own draft text. It used to live in ChatWorkspaceView, which
// meant every keystroke re-rendered the whole message list: each message re-ran its
// content parsing, its attachment parsing and its class strings, and long chats
// turned typing into a visible lag. Nothing here reaches the parent until save.
export default memo(function MessageEditor({
  initialValue,
  sizeClass,
  minHeightClass = 'min-h-[7rem]',
  saveLabel,
  onCancel,
  onSave,
  requireChange = false
}) {
  const [text, setText] = useState(initialValue);
  const canSave = !requireChange || text !== initialValue;

  return (
    <div className="flex flex-col gap-3 text-left w-full">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        className={`bg-[#051116] border border-gray-700/70 rounded-xl px-3.5 py-3 ${sizeClass} leading-relaxed text-white placeholder-gray-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 w-full ${minHeightClass} resize-none shadow-inner`}
      />
      <div className="flex justify-end items-center gap-2 select-none">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        {canSave && (
          <button
            onClick={() => onSave(text)}
            className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-accent text-[#011419] rounded-lg shadow-sm hover:brightness-110 transition-all active:scale-95"
          >
            {saveLabel}
          </button>
        )}
      </div>
    </div>
  );
});
