import React from 'react';
import { X, Check, AlertTriangle, Download, Share2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

// Pre-export confirmation for a Worldbuild (.klwb) package: spells out what travels, what
// stays behind, and a privacy reminder, mirroring the Profile/Workflow export modals so
// the user never exports by accident. Confirming calls onConfirm (which opens the save
// dialog); this modal just informs.
export default function ExportWorldbuildModal({ entityCount = 0, onClose, onConfirm }) {
  const { settings } = useApp();
  const isBlurEnabled = settings?.interface?.blur ?? true;

  return (
    <div className={`fixed inset-0 z-[80] flex items-center justify-center titlebar-nodrag select-none p-4 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-lg bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="shrink-0 flex justify-between items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <div className="flex items-center space-x-2.5">
            <Download className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-sans">Export Worldbuild</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 p-6 space-y-5 overflow-y-auto max-h-[70vh] custom-scrollbar">
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-accent uppercase tracking-wider font-sans">Before you share</h3>

            <div className="space-y-3">
              <div className="flex items-start space-x-3 p-3 bg-[#051116] border border-gray-800/80 rounded-lg">
                <Check className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                <div className="text-xs text-gray-300 leading-relaxed font-sans">
                  <strong className="text-white block mb-0.5 font-sans">Entities &amp; relations packaged</strong>
                  Every character, location, item, faction, creature and concept in this Worldbuild
                  {entityCount ? <> (<strong className="text-white">{entityCount}</strong> in total)</> : null}, and the connections between them, is bundled into one portable <span className="text-accent font-semibold">.klwb</span> file.
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 bg-[#051116] border border-gray-800/80 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-gray-300 leading-relaxed font-sans">
                  <strong className="text-white block mb-0.5 font-sans">Chapter links stay behind</strong>
                  Links to Writing Desk chapters and any <strong className="text-amber-400">pending suggestions</strong> awaiting your review are <strong className="text-amber-400">NOT</strong> exported. They belong to this workspace only.
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 bg-[#051116] border border-gray-800/80 rounded-lg">
                <Share2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div className="text-xs text-gray-300 leading-relaxed font-sans">
                  <strong className="text-white block mb-0.5 font-sans">Safe to share</strong>
                  Only your world travels: its entities and their lore, and nothing else. No API keys or private settings ride along, so you can share it freely.
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-400 leading-relaxed font-sans bg-[#051116] border border-gray-800/60 rounded-lg p-3">
            When imported elsewhere, every entity comes in as a suggestion to accept, merge, or dismiss. Nothing is ever overwritten on its own.
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end space-x-3 h-16 px-6 bg-[#011419] border-t border-gray-800/50 items-center">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-white transition-colors cursor-pointer font-sans">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2 bg-accent text-[#011419] font-bold text-xs uppercase tracking-wider rounded transition-all hover:brightness-110 shadow-md flex items-center cursor-pointer font-sans"
          >
            Export Worldbuild
          </button>
        </div>

      </div>
    </div>
  );
}
