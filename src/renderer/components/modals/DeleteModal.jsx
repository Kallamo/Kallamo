import React from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Button from '../ui/Button';

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
    <div className={`fixed inset-0 z-[80] flex items-center justify-center titlebar-nodrag select-none ${(settings?.interface?.blur ?? true) ? 'bg-surface-overlay backdrop-blur-sm' : 'bg-surface-canvas'}`}>
      <div className="w-[380px] bg-surface-canvas border border-border-default rounded-xl shadow-2xl p-6 flex flex-col space-y-4 animate-in fade-in zoom-in duration-200">
        
        {/* Warning Icon and Title */}
        <div className="flex items-center space-x-3">
          <div className="rounded-lg bg-status-danger/10 p-2 text-status-danger">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-text-primary font-bold text-lg">{title || 'Confirm Deletion'}</h3>
        </div>

        {/* Message */}
        <p className="text-sm text-gray-400 leading-relaxed">
          {message || 'Are you sure you want to delete this item? This action is permanent and cannot be undone.'}
        </p>

        {showCheckbox && (
          <div className="flex items-center space-x-3 bg-surface-panel border border-gray-800/80 p-3 rounded-lg select-none">
            <div className="flex-1">
              <span className="text-xs text-gray-200 block font-medium">{checkboxLabel}</span>
            </div>
            <div className="shrink-0">
              <div
                onClick={() => onCheckboxChange && onCheckboxChange(!checkboxValue)}
                className={`w-5 h-5 rounded-sm border flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 ${checkboxValue
                  ? 'bg-accent border-accent text-on-accent shadow-[0_0_8px_color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                  : 'border-gray-700 bg-surface-canvas/90 hover:border-accent/50'
                  }`}
              >
                {checkboxValue && <Check className="w-3.5 h-3.5 stroke-[3.5]" />}
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm(checkboxValue)}>{confirmText || 'Delete'}</Button>
        </div>

      </div>
    </div>
  );
}

