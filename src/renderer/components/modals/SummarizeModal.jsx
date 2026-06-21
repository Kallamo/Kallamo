import React, { useState, useEffect, useRef } from 'react';
import { X, Check, CheckSquare, Square, Info } from 'lucide-react';

export default function SummarizeModal({
  isOpen,
  onClose,
  messages = [],
  currentSummarizedIndex = 0,
  memoryBlocksCount = 0,
  onConfirm,
  isVectorizing
}) {
  const [customTitle, setCustomTitle] = useState('');
  const [pendingList, setPendingList] = useState([]);
  const modalRef = useRef(null);

  // Initialize the list of messages when modal opens
  useEffect(() => {
    if (isOpen) {
      const activeRange = messages.slice(currentSummarizedIndex);
      setPendingList(activeRange.map((msg, idx) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        selected: true, // initially all selected
        originalIndex: currentSummarizedIndex + idx
      })));
      setCustomTitle('');
    }
  }, [isOpen, messages, currentSummarizedIndex]);

  // Click outside to close modal
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target) && !isVectorizing) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, isVectorizing]);

  if (!isOpen) return null;

  const handleToggleSelect = (id) => {
    if (isVectorizing) return;
    setPendingList(prev => prev.map(m => m.id === id ? { ...m, selected: !m.selected } : m));
  };

  const handleSelectAll = () => {
    if (isVectorizing) return;
    setPendingList(prev => prev.map(m => ({ ...m, selected: true })));
  };

  const handleDeselectAll = () => {
    if (isVectorizing) return;
    setPendingList(prev => prev.map(m => ({ ...m, selected: false })));
  };

  const handleConfirmSubmit = () => {
    if (isVectorizing) return;
    const selectedMessages = pendingList.filter(m => m.selected);
    const newSummarizedIndex = Math.max(0, messages.length - 10);

    onConfirm({
      selectedMessages,
      newSummarizedIndex,
      customTitle: customTitle.trim() || `Summarization ${memoryBlocksCount + 1}`
    });
  };

  const selectedCount = pendingList.filter(m => m.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm select-none p-4">
      <div
        ref={modalRef}
        className="w-full max-w-2xl bg-[#0a161d]/95 border border-gray-800/80 rounded-2xl flex flex-col max-h-[90vh] shadow-2xl relative animate-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800/80">
          <div className="flex flex-col">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Archive & Summarize Memory</h3>
            <span className="caption mt-0.5">Select blocks of history to vectorize and move to long-term memory</span>
          </div>
          <button
            disabled={isVectorizing}
            onClick={onClose}
            className="text-gray-500 hover:text-white hover:bg-white/5 p-1 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Modal Body / Scroll Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {/* Custom title block */}
          <div className="flex flex-col space-y-1.5 shrink-0">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Memory Chapter Title (Optional)</label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              disabled={isVectorizing}
              placeholder={`e.g. Summarization ${memoryBlocksCount + 1}`}
              className="bg-[#011419] border border-gray-800/80 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Premium Info Tooltip Block */}
          <div className="flex items-start space-x-2.5 bg-[#1a2d32]/20 border border-[#FBCB2D]/15 rounded-xl p-3 select-text shrink-0">
            <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <div className="flex flex-col space-y-1 text-[10px] text-gray-300 leading-relaxed">
              <span className="font-bold text-gray-200">How Memory Archiving Works:</span>
              <p>
                Selected messages will be compiled, summarized, and vectorized into your local vector database (RAG).
                The AI will dynamically search this database whenever relevant.
                Archived messages stay visible in the chat log, but are excluded from active context API tokens.
                To preserve context continuity, the last <strong>10 messages</strong> are kept active.
              </p>
            </div>
          </div>

          {/* Selection Controls */}
          <div className="flex items-center justify-between pt-2 shrink-0">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              Selected: <span className="text-accent font-mono">{selectedCount}</span> / {pendingList.length} Messages
            </span>
            <div className="flex items-center space-x-2 text-[10px] uppercase font-bold tracking-wider">
              <button
                disabled={isVectorizing}
                onClick={handleSelectAll}
                className="flex items-center space-x-1 text-gray-400 hover:text-white cursor-pointer transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>Select All</span>
              </button>
              <span className="text-gray-800">|</span>
              <button
                disabled={isVectorizing}
                onClick={handleDeselectAll}
                className="flex items-center space-x-1 text-gray-400 hover:text-white cursor-pointer transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>
          </div>

          {/* Messages list */}
          <div className="space-y-2 max-h-[35vh] overflow-y-auto custom-scrollbar pr-1 select-text">
            {pendingList.map(msgObj => {
              const isUser = msgObj.role === 'user';
              return (
                <div
                  key={msgObj.id}
                  onClick={() => handleToggleSelect(msgObj.id)}
                  className={`flex items-start p-3 rounded-xl border transition-colors cursor-pointer ${msgObj.selected
                    ? 'bg-[#1a2d32]/50 border-accent/35 shadow-md shadow-black/10'
                    : 'bg-[#011419]/45 border-gray-800/40 opacity-55'
                    }`}
                >
                  <div className="flex-1 pr-4">
                    <span className={`text-[9px] font-bold uppercase mb-1 block ${isUser ? 'text-accent' : 'text-gray-400'
                      }`}>
                      {isUser ? 'User Prompt' : 'AI Response'}
                    </span>
                    <p className="text-xs text-gray-300 leading-relaxed line-clamp-3 whitespace-pre-wrap">
                      {msgObj.content}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center justify-center pt-1.5 select-none">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${msgObj.selected ? 'bg-accent border-accent' : 'border-gray-600'
                      }`}>
                      {msgObj.selected && <Check className="w-3 h-3 text-[#011419] stroke-[3]" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-gray-800/80 flex items-center justify-end space-x-3 shrink-0">
          <button
            disabled={isVectorizing}
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-white/5 rounded-xl cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            disabled={isVectorizing || selectedCount === 0}
            onClick={handleConfirmSubmit}
            className="px-5 py-2.5 bg-accent text-[#011419] text-xs font-bold uppercase tracking-wider rounded-xl shadow-lg shadow-accent/10 hover:brightness-110 active:scale-98 transition-all cursor-pointer flex items-center space-x-2 disabled:opacity-35 disabled:cursor-not-allowed"
          >
            {isVectorizing ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-[#011419]" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Archiving...</span>
              </>
            ) : (
              <span>Confirm Archive</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
