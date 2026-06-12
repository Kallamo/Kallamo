import React, { useState, useEffect } from 'react';
import { X, HelpCircle, Code } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function VariableModal({ variable, onClose, onSave }) {
  const { settings } = useApp();
  
  const isEditing = !!variable;
  
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  
  const [keyError, setKeyError] = useState('');

  useEffect(() => {
    if (variable) {
      setName(variable.name || '');
      setKey(variable.key || '');
      setValue(variable.value || '');
      setDescription(variable.description || '');
    }
  }, [variable]);

  const validateKey = (val) => {
    setKey(val);
    if (!val.trim()) {
      setKeyError('Key is required');
      return;
    }
    // Regex for only letters, numbers, and underscores
    const regex = /^[a-zA-Z0-9_]+$/;
    if (!regex.test(val)) {
      setKeyError('Key can only contain letters, numbers, and underscores');
    } else {
      setKeyError('');
    }
  };

  const handleSave = () => {
    if (keyError || !key.trim() || !name.trim() || !value.trim()) return;
    
    const updated = {
      id: variable?.id || 'var_' + Math.random().toString(36).substr(2, 9),
      name: name.trim(),
      key: key.trim(),
      value: value.trim(),
      description: description.trim()
    };
    
    if (onSave) onSave(updated);
    onClose();
  };

  const isBlurEnabled = settings?.interface?.blur ?? true;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-8 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-2xl bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="shrink-0 flex justify-between items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <div className="flex items-center space-x-2.5">
            <Code className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-bold text-white tracking-wide">
              {isEditing ? 'Edit Variable' : 'Create Variable'}
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          
          <div className="grid grid-cols-2 gap-4">
            {/* Friendly Name */}
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Friendly Name</label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., General Writing Rules"
                className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
              />
            </div>
            
            {/* Tag/Key */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Variable Key
                </label>
                <div className="text-[10px] text-gray-500 font-mono">
                  {'{{' + (key || 'key') + '}}'}
                </div>
              </div>
              <input 
                type="text" 
                value={key}
                onChange={(e) => validateKey(e.target.value)}
                disabled={isEditing}
                placeholder="e.g., writing_rules"
                className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed font-mono"
              />
              {keyError && (
                <p className="text-[10px] text-red-400 mt-1 font-semibold">{keyError}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Description</label>
            <input 
              type="text" 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide a brief explanation of what this variable is used for..."
              className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Content (Value) */}
          <div className="flex flex-col h-64">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Variable Content</label>
            <textarea 
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste or write the rule text / instructions that this variable expands to..."
              className="flex-1 w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md p-4 focus:outline-none focus:border-accent resize-none font-mono custom-scrollbar"
            />
          </div>

        </div>

        {/* Footer Actions */}
        <div className="shrink-0 flex justify-between items-center h-16 px-6 bg-[#011419] border-t border-gray-800/50">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
          
          <button 
            onClick={handleSave}
            disabled={keyError || !key.trim() || !name.trim() || !value.trim()}
            className="px-5 py-2 text-sm bg-accent hover:brightness-110 text-[#011419] rounded transition-colors shadow-md font-bold cursor-pointer disabled:opacity-50"
          >
            Save Variable
          </button>
        </div>

      </div>
    </div>
  );
}
