import React from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function ImportProgressModal({ progress, statusText, title = "Importing Data" }) {
  const { settings } = useApp();
  const isBlurEnabled = settings?.interface?.blur ?? true;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-4 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-md bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="shrink-0 flex items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <Loader2 className="w-4 h-4 text-accent animate-spin mr-2.5" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h2>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          <div className="space-y-2 text-center">
            <span className="text-3xl font-extrabold text-white tracking-tight">{progress}%</span>
            <p className="text-xs text-gray-400 font-semibold leading-relaxed truncate px-4" title={statusText}>
              {statusText || "Processing package data..."}
            </p>
          </div>

          {/* Progress Bar Container */}
          <div className="w-full h-2 bg-[#051116] border border-gray-800/60 rounded-full overflow-hidden p-0.5 relative">
            <div 
              className="h-full bg-accent rounded-full shadow-[0_0_8px_rgba(221,186,110,0.5)] transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
