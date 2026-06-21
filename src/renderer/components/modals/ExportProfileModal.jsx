import React, { useState } from 'react';
import { X, Check, AlertTriangle, Download, ArrowRight, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function ExportProfileModal({ profile, onClose, onExport }) {
  const { settings } = useApp();
  const [exportKb, setExportKb] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');

  const handleConfirmExport = async () => {
    setExporting(true);
    setProgress(0);
    setStatusText('Starting export...');

    let unsub = null;
    if (window.electronAPI?.onExportProgress) {
      unsub = window.electronAPI.onExportProgress((data) => {
        setProgress(data.progress);
        setStatusText(data.status);
      });
    }

    try {
      await onExport(exportKb);
      // Wait briefly so the user sees 100% complete
      await new Promise(resolve => setTimeout(resolve, 600));
      onClose();
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      if (unsub) unsub();
      setExporting(false);
    }
  };

  const isBlurEnabled = settings?.interface?.blur ?? true;

  if (exporting) {
    return (
      <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-4 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
        <div className="w-full max-w-md bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
          
          {/* Header */}
          <div className="shrink-0 flex items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
            <Loader2 className="w-4 h-4 text-accent animate-spin mr-2.5" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Exporting Profile</h2>
          </div>

          {/* Content Body */}
          <div className="p-6 space-y-6">
            <div className="space-y-2 text-center">
              <span className="text-3xl font-extrabold text-white tracking-tight">{progress}%</span>
              <p className="text-xs text-gray-400 font-semibold leading-relaxed truncate px-4" title={statusText}>
                {statusText || "Packaging profile configuration..."}
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

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-4 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-lg bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="shrink-0 flex justify-between items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <div className="flex items-center space-x-2.5">
            <Download className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Export AI Profile</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-accent uppercase tracking-wider">Export Process & Details</h3>
            
            {/* Info Cards */}
            <div className="space-y-3">
              <div className="flex items-start space-x-3 p-3 bg-[#051116] border border-gray-800/80 rounded-lg">
                <Check className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                <div className="text-xs text-gray-300 leading-relaxed">
                  <strong className="text-white block mb-0.5">Dynamic Variables Resolution</strong>
                  Any dynamic variable placeholders (like <code className="font-mono text-accent">{"{{"}variable_name{"}}"}</code>) inside the profile prompts will be automatically replaced with their current text values.
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 bg-[#051116] border border-gray-800/80 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-gray-300 leading-relaxed">
                  <strong className="text-white block mb-0.5">Credentials Protection</strong>
                  The linked API Profile and model configuration will <strong className="text-amber-400">NOT</strong> be exported. The imported profile will be empty of connections and ready for new linking.
                </div>
              </div>
            </div>
          </div>

          {/* Option Checkbox */}
          <div className="pt-4 border-t border-gray-800/60">
            <div className="flex items-center justify-between bg-[#051116] border border-gray-800/60 rounded-xl p-4">
              <div className="pr-4 flex-1">
                <span className="text-xs font-bold text-gray-200 block mb-1">Export Knowledge Base</span>
                <p className="caption">Include all documents, constant files, and custom memory blocks.</p>
              </div>
              <div className="shrink-0 select-none">
                <div
                  onClick={() => setExportKb(!exportKb)}
                  className={`w-5 h-5 rounded-sm border flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 ${exportKb
                    ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]'
                    : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'
                    }`}
                >
                  {exportKb && <Check className="w-3.5 h-3.5 stroke-[3.5]" />}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end space-x-3 h-16 px-6 bg-[#011419] border-t border-gray-800/50 items-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmExport}
            className="px-5 py-2 bg-accent text-[#011419] font-bold text-xs uppercase tracking-wider rounded transition-all hover:brightness-110 shadow-md flex items-center space-x-2 cursor-pointer"
          >
            <span>Export Profile</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

      </div>
    </div>
  );
}
