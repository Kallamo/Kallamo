import React from 'react';
import { useApp } from '../../context/AppContext';
import { AlertCircle, Play, SkipForward, XCircle } from 'lucide-react';

export default function WorkflowErrorModal() {
  const { errorData, handleRespondToError, settings } = useApp();

  if (!errorData) return null;

  const stepName = errorData.profileName || 'Unknown AI Profile';
  const errorMessage = errorData.errorMessage || errorData.message || 'An unexpected connection or API error occurred during execution.';

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none ${(settings?.interface?.blur ?? true) ? 'bg-black/70 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-[480px] bg-[#011419] border border-red-950 rounded-xl shadow-2xl p-6 flex flex-col space-y-4 animate-in fade-in zoom-in duration-200">
        
        {/* Error Header */}
        <div className="flex items-center space-x-3 text-red-500">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <AlertCircle className="w-6 h-6 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-white font-bold text-base">Workflow Execution Error</h3>
            <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Failed at: {stepName}</span>
          </div>
        </div>

        {/* Detailed Error message */}
        <div className="bg-red-950/20 border border-red-900/40 rounded-lg p-4 max-h-48 overflow-y-auto custom-scrollbar">
          <p className="text-xs text-red-200 font-mono leading-relaxed whitespace-pre-wrap">
            {errorMessage}
          </p>
        </div>

        {/* Instructions */}
        <p className="text-xs text-gray-400 leading-normal">
          An error occurred in the execution chain. Choose how you would like to proceed with the workflow sequence:
        </p>

        {/* Actions grid */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          {/* Interrupt */}
          <button 
            onClick={() => handleRespondToError('interrupt')}
            className="flex flex-col items-center justify-center p-3 bg-red-950/10 hover:bg-red-950/30 border border-red-900/50 hover:border-red-500/50 rounded-xl transition-all cursor-pointer group"
          >
            <XCircle className="w-5 h-5 text-red-500 mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Interrupt</span>
            <span className="text-[8px] text-gray-500 text-center mt-0.5 leading-tight">Stop chain & save messages</span>
          </button>

          {/* Skip */}
          <button 
            onClick={() => handleRespondToError('skip')}
            className="flex flex-col items-center justify-center p-3 bg-[#0a161d] hover:bg-[#1a2d32] border border-gray-800 hover:border-gray-500 rounded-xl transition-all cursor-pointer group"
          >
            <SkipForward className="w-5 h-5 text-gray-400 group-hover:text-white mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">Skip Step</span>
            <span className="text-[8px] text-gray-500 text-center mt-0.5 leading-tight">Pass prev output to next step</span>
          </button>

          {/* Retry */}
          <button 
            onClick={() => handleRespondToError('retry')}
            className="flex flex-col items-center justify-center p-3 bg-accent/5 hover:bg-accent/15 border border-accent/20 hover:border-accent rounded-xl transition-all cursor-pointer group"
          >
            <Play className="w-5 h-5 text-accent mb-1 group-hover:scale-110 transition-transform" fill="currentColor" />
            <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Retry Step</span>
            <span className="text-[8px] text-gray-500 text-center mt-0.5 leading-tight">Re-execute call to errored AI</span>
          </button>
        </div>

      </div>
    </div>
  );
}
