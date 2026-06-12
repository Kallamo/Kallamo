import React from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function DeleteModal({ 
  title, 
  message, 
  onConfirm, 
  onClose, 
  confirmText,
  showCheckbox,
  checkboxLabel,
  checkboxValue,
  onCheckboxChange
}) {
  const { settings } = useApp();
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none ${(settings?.interface?.blur ?? true) ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-[380px] bg-[#011419] border border-gray-800 rounded-xl shadow-2xl p-6 flex flex-col space-y-4 animate-in fade-in zoom-in duration-200">
        
        {/* Warning Icon and Title */}
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-red-500/10 rounded-lg text-red-500">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-white font-bold text-lg">{title || 'Confirm Deletion'}</h3>
        </div>

        {/* Message */}
        <p className="text-sm text-gray-400 leading-relaxed">
          {message || 'Are you sure you want to delete this item? This action is permanent and cannot be undone.'}
        </p>

        {showCheckbox && (
          <div className="flex items-center space-x-3 bg-[#0a161d] border border-gray-800/80 p-3 rounded-lg select-none">
            <div className="flex-1">
              <span className="text-xs text-gray-200 block font-medium">{checkboxLabel}</span>
            </div>
            <div className="shrink-0">
              <div
                onClick={() => onCheckboxChange && onCheckboxChange(!checkboxValue)}
                className={`w-5 h-5 rounded-sm border flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 ${checkboxValue
                  ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]'
                  : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'
                  }`}
              >
                {checkboxValue && <Check className="w-3.5 h-3.5 stroke-[3.5]" />}
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-[#0a161d] hover:bg-[#1a2d32] border border-gray-800 text-gray-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button 
            onClick={() => onConfirm(checkboxValue)}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            {confirmText || 'Delete'}
          </button>
        </div>

      </div>
    </div>
  );
}

