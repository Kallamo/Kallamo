import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowLeft, Plus, Cpu, Trash2, Edit3, Database, Workflow, Play, Code, Copy, AlertTriangle, Download, UploadCloud } from 'lucide-react';
import ProfileModal from './modals/ProfileModal';
import WorkflowModal from './modals/WorkflowModal';
import DeleteModal from './modals/DeleteModal';
import KbManagerModal from './modals/KbManagerModal';
import VariableModal from './modals/VariableModal';
import ExportProfileModal from './modals/ExportProfileModal';
import ExportWorkflowModal from './modals/ExportWorkflowModal';
import ImportProgressModal from './modals/ImportProgressModal';

export default function LibraryView() {
  const { 
    setCurrentView,
    writingProfiles,
    setWritingProfiles,
    handleDeleteProfile,
    handleSaveProfile,
    workflows,
    setWorkflows,
    handleDeleteWorkflow,
    apiProfiles,
    electronAPI,
    showToast,
    variables,
    handleSaveVariable,
    handleDeleteVariable
  } = useApp();

  const [activeTab, setActiveTab] = useState('profiles'); // 'profiles' | 'workflows' | 'variables'
  
  // Modals state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileToEdit, setProfileToEdit] = useState(null);
  const [profileInitialStep, setProfileInitialStep] = useState(1); // 1 or 2 (KB step)
  const [showKbManager, setShowKbManager] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [profileToExport, setProfileToExport] = useState(null);
  const [showExportWorkflowModal, setShowExportWorkflowModal] = useState(false);
  const [workflowToExport, setWorkflowToExport] = useState(null);
  const [workflowToEdit, setWorkflowToEdit] = useState(null);
  const [showVariableModal, setShowVariableModal] = useState(false);
  const [variableToEdit, setVariableToEdit] = useState(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // { type: 'profile'|'workflow'|'variable', id, name }
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importType, setImportType] = useState('profile'); // 'profile' | 'workflow'

  const triggerDeleteProfile = (e, profile) => {
    e.stopPropagation();
    setDeleteTarget({ type: 'profile', id: profile.id, name: profile.name });
    setShowDeleteModal(true);
  };


  const triggerDeleteWorkflow = (e, workflow) => {
    e.stopPropagation();
    setDeleteTarget({ type: 'workflow', id: workflow.id, name: workflow.name });
    setShowDeleteModal(true);
  };

  const triggerDeleteVariable = (e, variable) => {
    e.stopPropagation();
    setDeleteTarget({ type: 'variable', id: variable.id, name: variable.name });
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'profile') {
      await handleDeleteProfile(deleteTarget.id);
    } else if (deleteTarget.type === 'workflow') {
      await handleDeleteWorkflow(deleteTarget.id);
    } else if (deleteTarget.type === 'variable') {
      await handleDeleteVariable(deleteTarget.id);
    }
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const openNewVariable = () => {
    setVariableToEdit(null);
    setShowVariableModal(true);
  };

  const openEditVariable = (variable) => {
    setVariableToEdit(variable);
    setShowVariableModal(true);
  };

  const openNewProfile = () => {
    setProfileToEdit(null);
    setProfileInitialStep(1);
    setShowProfileModal(true);
  };

  const openEditProfile = (profile) => {
    setProfileToEdit(profile);
    setProfileInitialStep(1);
    setShowProfileModal(true);
  };

  const openManageKb = (profile) => {
    setProfileToEdit(profile);
    setShowKbManager(true);
  };

  const handleImportProfile = async () => {
    setImportType('profile');
    setIsImporting(true);
    setImportProgress(0);
    setImportStatus('Initializing import...');

    let unsub = null;
    if (electronAPI?.onImportProgress) {
      unsub = electronAPI.onImportProgress((data) => {
        setImportProgress(data.progress);
        setImportStatus(data.status);
      });
    }

    try {
      const result = await electronAPI.importAiProfile();
      if (result && result.success) {
        await new Promise(resolve => setTimeout(resolve, 600));
        const updated = await electronAPI.getWritingProfiles();
        setWritingProfiles(updated);
        showToast(`Profile "${result.profile.name}" imported successfully!`, 'success');
      }
    } catch (e) {
      console.error("Failed to import profile:", e);
      showToast("Failed to import profile package.", "error");
    } finally {
      if (unsub) unsub();
      setIsImporting(false);
    }
  };

  const handleExportProfileClick = (profile) => {
    setProfileToExport(profile);
    setShowExportModal(true);
  };

  const handleExportProfileConfirm = async (exportKb) => {
    if (!profileToExport) return;
    try {
      let resolvedSystemPrompt = profileToExport.systemPrompt || '';
      let resolvedAgenticPrompt = profileToExport.agenticPrompt || '';
      
      const varRegex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
      
      resolvedSystemPrompt = resolvedSystemPrompt.replace(varRegex, (match, key) => {
        const found = variables.find(v => v.key === key);
        return found ? found.value : match;
      });

      resolvedAgenticPrompt = resolvedAgenticPrompt.replace(varRegex, (match, key) => {
        const found = variables.find(v => v.key === key);
        return found ? found.value : match;
      });

      const profileCopy = {
        ...profileToExport,
        systemPrompt: resolvedSystemPrompt,
        agenticPrompt: resolvedAgenticPrompt
      };

      const result = await electronAPI.exportAiProfile(profileCopy, exportKb);
      if (result && result.success) {
        showToast("Profile exported successfully!", "success");
      }
    } catch (e) {
      console.error("Failed to export profile:", e);
      showToast("Failed to export profile.", "error");
    }
  };

  const handleExportWorkflowClick = (workflow) => {
    setWorkflowToExport(workflow);
    setShowExportWorkflowModal(true);
  };

  const handleExportWorkflowConfirm = async (exportKb) => {
    if (!workflowToExport) return;
    try {
      const result = await electronAPI.exportWorkflow(workflowToExport, exportKb);
      if (result && result.success) {
        showToast("Workflow exported successfully!", "success");
      }
    } catch (e) {
      console.error("Failed to export workflow:", e);
      showToast("Failed to export workflow.", "error");
    }
  };

  const handleImportWorkflow = async () => {
    setImportType('workflow');
    setIsImporting(true);
    setImportProgress(0);
    setImportStatus('Initializing import...');

    let unsub = null;
    if (electronAPI?.onImportProgress) {
      unsub = electronAPI.onImportProgress((data) => {
        setImportProgress(data.progress);
        setImportStatus(data.status);
      });
    }

    try {
      const result = await electronAPI.importWorkflow();
      if (result && result.success) {
        await new Promise(resolve => setTimeout(resolve, 600));
        const updatedProfiles = await electronAPI.getWritingProfiles();
        setWritingProfiles(updatedProfiles);
        const updatedWorkflows = await electronAPI.getWorkflows();
        setWorkflows(updatedWorkflows);
        showToast(`Workflow "${result.workflow.name}" imported successfully!`, 'success');
      }
    } catch (e) {
      console.error("Failed to import workflow:", e);
      showToast("Failed to import workflow package.", "error");
    } finally {
      if (unsub) unsub();
      setIsImporting(false);
    }
  };

  const openNewWorkflow = () => {
    setWorkflowToEdit(null);
    setShowWorkflowModal(true);
  };

  const openEditWorkflow = (workflow) => {
    setWorkflowToEdit(workflow);
    setShowWorkflowModal(true);
  };

  return (
    <div className="flex flex-col w-full h-full px-8 pb-8 pt-6 relative bg-[#011419] overflow-hidden select-none">
      
      {/* Back button and Tabs switcher */}
      <div className="flex items-center justify-between mb-8 w-full max-w-6xl mx-auto shrink-0 mt-4">
        <button 
          onClick={() => setCurrentView('dashboard')}
          className="p-2 text-gray-400 hover:text-white hover:bg-[#0a161d] rounded-lg border border-transparent hover:border-gray-800 transition-colors flex items-center space-x-2 cursor-pointer font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-semibold">Back to Chats</span>
        </button>

        <div className="flex bg-[#0a161d] border border-gray-800 rounded-lg p-1 space-x-1 shadow-lg mx-auto relative right-6">
          <button 
            onClick={() => setActiveTab('profiles')}
            className={`px-6 py-2 rounded-md text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'profiles' 
                ? 'bg-[#1a2d32] text-white shadow-sm' 
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            AI Profiles
          </button>
          <button 
            onClick={() => setActiveTab('workflows')}
            className={`px-6 py-2 rounded-md text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'workflows' 
                ? 'bg-[#1a2d32] text-white shadow-sm' 
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Agent Workflows
          </button>
          <button 
            onClick={() => setActiveTab('variables')}
            className={`px-6 py-2 rounded-md text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'variables' 
                ? 'bg-[#1a2d32] text-white shadow-sm' 
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Variables
          </button>
        </div>
      </div>

      {/* Main Tab Views */}
      <div className="w-full max-w-6xl mx-auto h-full flex flex-col overflow-hidden pb-6">
        
        {/* --- AI Profiles Tab --- */}
        {activeTab === 'profiles' && (
          <div className="w-full h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-end mb-6 shrink-0">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-wide">AI Profiles</h2>
                <p className="text-gray-400 text-sm mt-1">Manage and edit your AI personalities and Knowledge Bases.</p>
              </div>
              <div className="flex items-center space-x-3">
                <button 
                  onClick={handleImportProfile}
                  className="flex items-center space-x-2 border border-gray-800 hover:border-accent hover:bg-accent/5 text-gray-300 hover:text-white px-4 py-2 rounded-md transition-all active:scale-95 text-sm cursor-pointer font-bold animate-in duration-200"
                >
                  <UploadCloud className="w-4 h-4 text-accent" />
                  <span>Import</span>
                </button>
                <button 
                  onClick={openNewProfile}
                  className="flex items-center space-x-2 bg-accent hover:brightness-110 text-[#011419] font-bold px-4 py-2 rounded-md transition-all shadow-sm active:scale-95 text-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} />
                  <span>New Profile</span>
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 overflow-y-auto custom-scrollbar pb-8 pr-2">
              {writingProfiles.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center text-gray-500 py-24 border border-dashed border-gray-800/80 rounded-xl bg-[#0a161d]/30">
                  <Cpu className="w-10 h-10 opacity-30 mb-3" />
                  <p className="text-sm font-medium">No AI profiles created yet.</p>
                  <p className="text-xs mt-1 opacity-70">Click "New Profile" to get started.</p>
                </div>
              ) : (
                writingProfiles.map(profile => {
                  const linkedApi = apiProfiles.find(ap => ap.id === profile.apiProfileId);
                  const apiName = linkedApi ? linkedApi.name : 'Unknown API';

                  return (
                    <div 
                      key={profile.id}
                      className="bg-[#111f2e] border border-gray-800/80 rounded-xl p-5 hover:border-gray-600 transition-all group flex flex-col h-[180px] relative overflow-hidden shadow-lg hover:-translate-y-1"
                    >
                      {/* Accent color bar */}
                      <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: profile.color }}></div>
                      
                      {/* Title & Actions */}
                      <div className="flex justify-between items-start mb-2 mt-1 w-full">
                        <div className="flex items-center space-x-2 flex-1 min-w-0 pr-2">
                          <h3 className="text-white font-bold text-lg truncate" title={profile.name}>{profile.name}</h3>
                          {(!profile.apiProfileId || !profile.model) && (
                            <div className="relative group/warning flex items-center shrink-0">
                              <AlertTriangle 
                                className="w-4 h-4 text-amber-500 cursor-help" 
                              />
                              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2.5 w-52 p-3 text-[10px] leading-relaxed text-amber-200 bg-[#1a0f02] border border-amber-900/50 rounded-lg shadow-xl invisible opacity-0 pointer-events-none group-hover/warning:visible group-hover/warning:opacity-100 transition-all duration-200 z-30 select-none font-semibold text-center">
                                No API profile or model linked. This profile will not be able to generate responses until configured.
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-[#1a0f02] w-0 h-0 -mb-[1px]" />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-amber-900/50 w-0 h-0 -mb-[2px] -z-10" />
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex space-x-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button 
                            onClick={() => handleExportProfileClick(profile)}
                            className="text-gray-400 hover:text-accent hover:bg-accent/10 p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                            title="Export Profile"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => openManageKb(profile)}
                            className="text-gray-400 hover:text-accent hover:bg-accent/10 p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                            title="Manage Knowledge Base"
                          >
                            <Database className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => openEditProfile(profile)}
                            className="text-gray-400 hover:text-white p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                            title="Edit Profile"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => triggerDeleteProfile(e, profile)}
                            className="text-gray-500 hover:text-red-500 p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                            title="Delete Profile"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-sm text-gray-400 line-clamp-2 mb-auto leading-relaxed">
                        {profile.description || 'No description provided.'}
                      </p>

                      {/* Model & API Info */}
                      <div className="mt-4 flex items-center justify-between text-xs font-semibold">
                        <span className="bg-[#1a2d3d] text-gray-300 px-2.5 py-1 rounded-md border border-gray-700/50 truncate max-w-[140px]">{apiName}</span>
                        <span className="text-gray-500 truncate max-w-[140px]" title={profile.model}>{profile.model || 'No model'}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* --- Workflows Tab --- */}
        {activeTab === 'workflows' && (
          <div className="w-full h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-end mb-6 shrink-0">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-wide">Agent Workflows</h2>
                <p className="text-gray-400 text-sm mt-1">Build step-by-step logic chains to automate complex generations.</p>
              </div>
              <div className="flex items-center space-x-3">
                <button 
                  onClick={handleImportWorkflow}
                  className="flex items-center space-x-2 border border-gray-800 hover:border-accent hover:bg-accent/5 text-gray-300 hover:text-white px-4 py-2 rounded-md transition-all active:scale-95 text-sm cursor-pointer font-bold animate-in duration-200"
                >
                  <UploadCloud className="w-4 h-4 text-accent" />
                  <span>Import</span>
                </button>
                <button 
                  onClick={openNewWorkflow}
                  className="flex items-center space-x-2 bg-accent hover:brightness-110 text-[#011419] font-bold px-4 py-2 rounded-md transition-all shadow-sm active:scale-95 text-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} />
                  <span>New Workflow</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 overflow-y-auto custom-scrollbar pb-8 pr-2">
              {workflows.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center text-gray-500 py-24 border border-dashed border-gray-800/80 rounded-xl bg-[#0a161d]/30">
                  <Workflow className="w-10 h-10 opacity-30 mb-3" />
                  <p className="text-sm font-medium">No workflows created yet.</p>
                  <p className="text-xs mt-1 opacity-70">Click "New Workflow" to get started.</p>
                </div>
              ) : (
                workflows.map(wf => {
                  // Parse steps count
                  let stepsList = [];
                  try {
                    stepsList = typeof wf.steps === 'string' ? JSON.parse(wf.steps) : (wf.steps || []);
                  } catch (e) {
                    stepsList = [];
                  }

                  // Find profile names for the chain
                  const stepNames = stepsList.map(step => {
                    const prof = writingProfiles.find(p => p.id === step.profileId);
                    return prof ? prof.name : 'Unknown';
                  });

                  return (
                    <div 
                      key={wf.id}
                      className="bg-[#111f2e] border border-gray-800/80 rounded-xl p-5 hover:border-gray-600 transition-all group flex flex-col min-h-[185px] h-auto relative overflow-hidden shadow-lg hover:-translate-y-1 pb-5"
                    >
                      {/* Accent color bar (App Theme Color for workflows) */}
                      <div className="absolute top-0 left-0 right-0 h-1.5 bg-accent"></div>
                      
                      {/* Title & Actions */}
                      <div className="flex justify-between items-start mb-2 mt-1 w-full overflow-hidden">
                        <h3 className="text-white font-bold text-lg truncate pr-2 flex-1 min-w-0" title={wf.name}>{wf.name}</h3>
                        <div className="flex space-x-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button 
                            onClick={() => handleExportWorkflowClick(wf)}
                            className="text-gray-400 hover:text-accent hover:bg-accent/10 p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                            title="Export Workflow"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => openEditWorkflow(wf)}
                            className="text-gray-400 hover:text-white p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                            title="Edit Workflow"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => triggerDeleteWorkflow(e, wf)}
                            className="text-gray-500 hover:text-red-500 p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                            title="Delete Workflow"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Chain visualization */}
                      <div className="flex flex-col mb-auto">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Execution Chain</span>
                        <div className="flex items-center flex-wrap gap-1 text-xs text-gray-300">
                          {stepNames.length === 0 ? (
                            <span className="text-gray-500 italic">No steps defined</span>
                          ) : (
                            stepNames.map((name, sIdx) => (
                              <React.Fragment key={sIdx}>
                                <span className="bg-[#1a2d3d] px-2 py-0.5 rounded border border-gray-700/40 truncate max-w-[90px]">{name}</span>
                                {sIdx < stepNames.length - 1 && <span className="text-accent text-[9px]">→</span>}
                              </React.Fragment>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Steps Indicator */}
                      <div className="mt-4 flex items-center justify-between text-xs font-semibold">
                        <span className="text-gray-500 flex items-center space-x-1">
                          <Play className="w-3 h-3 text-accent" fill="currentColor" />
                          <span>{stepsList.length} Steps</span>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* --- Variables Tab --- */}
        {activeTab === 'variables' && (
          <div className="w-full h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-end mb-6 shrink-0">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-wide">Dynamic Variables</h2>
                <p className="text-gray-400 text-sm mt-1">Define reusable prompt snippets referenced via double brackets (e.g. &#123;&#123;my_variable&#125;&#125;).</p>
              </div>
              <button 
                onClick={openNewVariable}
                className="flex items-center space-x-2 bg-accent hover:brightness-110 text-[#011419] font-bold px-4 py-2 rounded-md transition-all shadow-sm active:scale-95 text-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" strokeWidth={2.5} />
                <span>New Variable</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 overflow-y-auto custom-scrollbar pb-8 pr-2">
              {variables.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center text-gray-500 py-24 border border-dashed border-gray-800/80 rounded-xl bg-[#0a161d]/30">
                  <Code className="w-10 h-10 opacity-30 mb-3" />
                  <p className="text-sm font-medium">No variables created yet.</p>
                  <p className="text-xs mt-1 opacity-70">Click "New Variable" to get started.</p>
                </div>
              ) : (
                variables.map(v => (
                  <div 
                    key={v.id}
                    className="bg-[#111f2e] border border-gray-800/80 rounded-xl p-5 hover:border-gray-600 transition-all group flex flex-col h-[200px] relative overflow-hidden shadow-lg hover:-translate-y-1"
                  >
                    <div className="absolute top-0 left-0 right-0 h-1.5 bg-accent/80"></div>
                    
                    <div className="flex justify-between items-start mb-2 mt-1">
                      <h3 className="text-white font-bold text-sm truncate pr-2" title={v.name}>{v.name}</h3>
                      <div className="flex space-x-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => openEditVariable(v)}
                          className="text-gray-400 hover:text-white p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                          title="Edit Variable"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={(e) => triggerDeleteVariable(e, v)}
                          className="text-gray-500 hover:text-red-500 p-1.5 bg-[#0a141d] rounded-md transition-colors cursor-pointer" 
                          title="Delete Variable"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-[#051116] border border-gray-800/60 rounded px-2.5 py-1 mt-1 shrink-0">
                      <span className="font-mono text-accent text-[11px] font-bold select-all">&#123;&#123;{v.key}&#125;&#125;</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(`{{${v.key}}}`);
                          showToast("Variable tag copied to clipboard!", "success");
                        }}
                        className="text-gray-500 hover:text-white p-1 transition-colors cursor-pointer"
                        title="Copy variable tag"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-[10px] text-gray-500 mt-2 truncate italic shrink-0" title={v.description}>{v.description || 'No description'}</p>
                    
                    <div className="mt-2 p-2 rounded bg-black/25 border border-gray-800/40 text-[10px] font-mono text-gray-400 overflow-y-auto max-h-[60px] custom-scrollbar flex-1 whitespace-pre-wrap select-text">
                      {v.value}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>

      {/* Modals wiring */}
      {showProfileModal && (
        <ProfileModal 
          profile={profileToEdit}
          initialStep={profileInitialStep}
          onClose={() => {
            setShowProfileModal(false);
            setProfileToEdit(null);
          }}
        />
      )}

      {showWorkflowModal && (
        <WorkflowModal 
          workflow={workflowToEdit}
          onClose={() => {
            setShowWorkflowModal(false);
            setWorkflowToEdit(null);
          }}
        />
      )}

      {showVariableModal && (
        <VariableModal 
          variable={variableToEdit}
          onSave={handleSaveVariable}
          onClose={() => {
            setShowVariableModal(false);
            setVariableToEdit(null);
          }}
        />
      )}

      {showDeleteModal && (
        <DeleteModal 
          title={deleteTarget?.type === 'profile' ? "Delete Profile" : deleteTarget?.type === 'workflow' ? "Delete Workflow" : "Delete Variable"}
          message={`Are you sure you want to permanently delete "${deleteTarget?.name}"?`}
          onConfirm={confirmDelete}
          onClose={() => {
            setShowDeleteModal(false);
            setDeleteTarget(null);
          }}
        />
      )}

      {showKbManager && (
        <KbManagerModal 
          profile={profileToEdit}
          onClose={() => {
            setShowKbManager(false);
            setProfileToEdit(null);
          }}
        />
      )}

      {showExportModal && (
        <ExportProfileModal
          profile={profileToExport}
          onExport={handleExportProfileConfirm}
          onClose={() => {
            setShowExportModal(false);
            setProfileToExport(null);
          }}
        />
      )}

      {showExportWorkflowModal && (
        <ExportWorkflowModal
          workflow={workflowToExport}
          onExport={handleExportWorkflowConfirm}
          onClose={() => {
            setShowExportWorkflowModal(false);
            setWorkflowToExport(null);
          }}
        />
      )}

      {isImporting && (
        <ImportProgressModal
          progress={importProgress}
          statusText={importStatus}
          title={importType === 'profile' ? "Importing AI Profile" : "Importing Workflow"}
        />
      )}

    </div>
  );
}
