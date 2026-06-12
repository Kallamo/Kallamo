import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Plus, Trash2, ArrowUp, ArrowDown, Settings, ListOrdered, HelpCircle } from 'lucide-react';

export default function WorkflowModal({ workflow, onClose, onSave }) {
  const {
    writingProfiles,
    handleSaveWorkflow,
    settings
  } = useApp();

  const isEditing = !!workflow;
  const [name, setName] = useState('');
  const [steps, setSteps] = useState([]); // Array of { id, profileId, prompt, includeContext }

  useEffect(() => {
    if (workflow) {
      setName(workflow.name || '');
      let loadedSteps = [];
      try {
        loadedSteps = typeof workflow.steps === 'string'
          ? JSON.parse(workflow.steps)
          : (workflow.steps || []);
      } catch (e) {
        loadedSteps = [];
      }
      // Add local unique IDs for keys and editing, default includeChatHistory to true
      setSteps(loadedSteps.map((s, idx) => ({
        ...s,
        id: s.id || `step_${Date.now()}_${idx}_${Math.random()}`,
        includeChatHistory: s.includeChatHistory !== false
      })));
    }
  }, [workflow]);

  const addStep = () => {
    const defaultProfile = writingProfiles[0]?.id || '';
    setSteps(prev => [...prev, {
      id: `step_${Date.now()}_${Math.random()}`,
      profileId: defaultProfile,
      prompt: '',
      includeContext: true,
      includeChatHistory: true
    }]);
  };

  const removeStep = (id) => {
    setSteps(prev => prev.filter(s => s.id !== id));
  };

  const updateStepField = (id, field, value) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const moveStep = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === steps.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const newSteps = [...steps];

    // Swap
    const temp = newSteps[index];
    newSteps[index] = newSteps[targetIndex];
    newSteps[targetIndex] = temp;

    setSteps(newSteps);
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    // Filter out invalid steps (no profile selected)
    const validSteps = steps.filter(s => s.profileId).map(s => ({
      profileId: s.profileId,
      prompt: s.prompt.trim(),
      includeContext: !!s.includeContext,
      includeChatHistory: s.includeChatHistory !== false
    }));

    const targetId = workflow?.id || 'wf_' + Math.random().toString(36).substr(2, 9);
    const updatedWorkflow = {
      id: targetId,
      name: name.trim(),
      entryProfileId: validSteps[0]?.profileId || '',
      steps: JSON.stringify(validSteps)
    };

    await handleSaveWorkflow(updatedWorkflow);
    if (onSave) onSave(updatedWorkflow);
    onClose();
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-8 ${(settings?.interface?.blur ?? true) ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-4xl h-full max-h-[680px] bg-[#000D11] border border-gray-800/60 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="shrink-0 flex justify-between items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <h2 className="text-lg font-bold text-white tracking-wide">
            {isEditing ? 'Configure Workflow' : 'Build Agent Workflow'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Workflow Name */}
          <div className="flex flex-col space-y-1.5 w-full max-w-md">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Workflow Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Translate and Summarize"
              className="bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Steps Section */}
          <div className="flex flex-col space-y-4">
            <div className="flex justify-between items-center border-b border-gray-800 pb-2">
              <h3 className="text-sm font-bold text-accent uppercase tracking-wider flex items-center space-x-2">
                <ListOrdered className="w-4 h-4" />
                <span>Execution Steps Chain</span>
              </h3>
              <button
                onClick={addStep}
                className="flex items-center space-x-1 px-3 py-1 bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent rounded-md text-xs font-semibold transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Step</span>
              </button>
            </div>

            {/* List of Steps */}
            <div className="space-y-4 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
              {steps.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-gray-500 py-16 bg-[#0a161d]/20 border border-dashed border-gray-800/80 rounded-xl">
                  <Settings className="w-8 h-8 opacity-30 mb-2 animate-spin-slow" />
                  <p className="text-xs font-medium">No steps added to the workflow yet.</p>
                  <button
                    onClick={addStep}
                    className="mt-3 text-xs text-accent font-semibold hover:underline"
                  >
                    Click here to add the first execution step
                  </button>
                </div>
              ) : (
                steps.map((step, index) => {
                  const selectedProfile = writingProfiles.find(p => p.id === step.profileId);
                  const stepColor = selectedProfile ? selectedProfile.color : '#FBCB2D';

                  return (
                    <div
                      key={step.id}
                      className="bg-[#051116] border border-gray-800 rounded-lg p-4 relative group flex flex-col space-y-3 shadow-md"
                    >
                      {/* Step index pill and move actions */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="w-5 h-5 rounded-full bg-accent/20 border border-accent/40 text-accent font-bold text-xs flex items-center justify-center">
                            {index + 1}
                          </span>
                          <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Execution Step</span>
                        </div>

                        <div className="flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            disabled={index === 0}
                            onClick={() => moveStep(index, 'up')}
                            className="p-1 hover:bg-[#111f2e] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            disabled={index === steps.length - 1}
                            onClick={() => moveStep(index, 'down')}
                            className="p-1 hover:bg-[#111f2e] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeStep(step.id)}
                            className="p-1 hover:bg-red-500/10 text-gray-500 hover:text-red-500 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Config parameters for step */}
                      {/* Profile & Switches Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-800/40 pb-2.5">
                        {/* Profile Selector */}
                        <div className="flex-1 flex flex-col space-y-1">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">AI Profile</label>
                          <div className="relative flex items-center max-w-xs">
                            <span
                              className="absolute left-3 w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: stepColor }}
                            />
                            <select
                              value={step.profileId}
                              onChange={(e) => updateStepField(step.id, 'profileId', e.target.value)}
                              className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-xs rounded-md pl-8 pr-8 py-1.5 focus:outline-none focus:border-accent appearance-none cursor-pointer"
                            >
                              <option value="" disabled>Select Profile...</option>
                              {writingProfiles.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                              </svg>
                            </div>
                          </div>
                        </div>

                        {/* Switches container */}
                        <div className="flex items-center gap-6 mt-2 sm:mt-0">
                          {/* Switch: Include Chat Context */}
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-bold text-gray-400 uppercase leading-none">Include Chat Context</span>
                            <div className="relative group/tooltip flex items-center">
                              <HelpCircle className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300 transition-colors mr-2 cursor-help" />
                              <div className="pointer-events-none absolute bottom-1/2 translate-y-1/2 right-full mr-2 w-72 p-3 bg-[#0a161d] border border-gray-800 rounded-lg shadow-xl text-[11px] text-gray-300 leading-normal invisible opacity-0 group-hover/tooltip:visible group-hover/tooltip:opacity-100 transition-all duration-200 z-50">
                                <p className="font-semibold text-accent mb-1">Include Chat Context</p>
                                <p>When enabled, the AI Profile responsible for this step will receive the chat/memory context to think its response. This includes only the chat/memory context; the AI Profile's Knowledge Base is always inserted by default.</p>
                              </div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={step.includeContext}
                                onChange={(e) => updateStepField(step.id, 'includeContext', e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                            </label>
                          </div>

                          {/* Switch: Include Chat History */}
                          {index > 0 && (
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] font-bold text-gray-400 uppercase leading-none">Include Chat History</span>
                              <div className="relative group/tooltip flex items-center">
                                <HelpCircle className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300 transition-colors mr-2 cursor-help" />
                                <div className="pointer-events-none absolute bottom-1/2 translate-y-1/2 right-full mr-2 w-72 p-3 bg-[#0a161d] border border-gray-800 rounded-lg shadow-xl text-[11px] text-gray-300 leading-normal invisible opacity-0 group-hover/tooltip:visible group-hover/tooltip:opacity-100 transition-all duration-200 z-50">
                                  <p className="font-semibold text-accent mb-1">Include Chat History</p>
                                  <p>If disabled, this step ignores previous chat history. The AI will focus solely on processing the output generated by the previous step.</p>
                                </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={step.includeChatHistory !== false}
                                  onChange={(e) => updateStepField(step.id, 'includeChatHistory', e.target.checked)}
                                  className="sr-only peer"
                                />
                                <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Textarea: Instructions */}
                      <div className="flex flex-col space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Step Prompt Instructions</label>
                        <textarea
                          rows={3}
                          value={step.prompt}
                          onChange={(e) => updateStepField(step.id, 'prompt', e.target.value)}
                          placeholder="Additional instructions concatenated to System Prompt..."
                          className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-xs rounded-md px-3 py-2 focus:outline-none focus:border-accent resize-y min-h-[72px] custom-scrollbar"
                        />
                      </div>

                    </div>
                  );
                })
              )}
            </div>
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
            disabled={!name.trim() || steps.length === 0}
            className="px-5 py-2 text-sm font-medium bg-accent hover:brightness-110 text-[#011419] rounded transition-colors shadow-md font-bold cursor-pointer disabled:opacity-50"
          >
            Save Workflow
          </button>
        </div>

      </div>
    </div>
  );
}
