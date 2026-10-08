import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { copyText } from '../utils/clipboard';
import ProfileModal from './modals/ProfileModal';
import WorkflowModal from './modals/WorkflowModal';
import DeleteModal from './modals/DeleteModal';
import KbManagerModal from './modals/KbManagerModal';
import VariableModal from './modals/VariableModal';
import ExportProfileModal from './modals/ExportProfileModal';
import ExportWorkflowModal from './modals/ExportWorkflowModal';
import ImportProgressModal, { PROGRESS_STAGES } from './modals/ImportProgressModal';
import { ToneTile } from './modals/ModalParts';
import { Braces, Workflow as WorkflowIcon } from 'lucide-react';
import { ProfileAvatar } from './modals/ProfileModal';
import { ReedPen } from '../logo';
import { PROFILE_STARTERS, ProfilesIntro, VariablesIntro, WorkflowsIntro } from '../features/library/LibraryIntros';
import { LibraryRail, RailItem, RailEmpty, ProfileDetail, WorkflowDetail, VariableDetail } from '../features/library/LibraryInspector';

export default function LibraryView() {
  const { 
    setCurrentView,
    writingProfiles,
    setWritingProfiles,
    handleDeleteProfile,
    handleSaveProfile,
    workflows,
    setWorkflows,
    handleSaveWorkflow,
    handleDeleteWorkflow,
    apiProfiles,
    electronAPI,
    showToast,
    variables,
    handleSaveVariable,
    handleDeleteVariable,
    chats
  } = useApp();

  const [activeTab, setActiveTab] = useState('profiles'); // 'profiles' | 'workflows' | 'variables'
  
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileToEdit, setProfileToEdit] = useState(null);
  const [profileModalTab, setProfileModalTab] = useState('rules');
  const [showKbManager, setShowKbManager] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [profileToExport, setProfileToExport] = useState(null);
  const [showExportWorkflowModal, setShowExportWorkflowModal] = useState(false);
  const [workflowToExport, setWorkflowToExport] = useState(null);
  const [workflowToEdit, setWorkflowToEdit] = useState(null);
  const [showVariableModal, setShowVariableModal] = useState(false);
  const [variableToEdit, setVariableToEdit] = useState(null);
  const [variablePreset, setVariablePreset] = useState(null);
  const [profilePreset, setProfilePreset] = useState(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // { type: 'profile'|'workflow'|'variable', id, name }
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importType, setImportType] = useState('profile'); // 'profile' | 'workflow'
  const [searches, setSearches] = useState({});
  const [selected, setSelected] = useState({});

  const deleteSubject = target => {
    if (!target) return null;
    const { type, item = {} } = target;
    if (type === 'profile') return { leading: <ProfileAvatar color={item.color} size={36} />, name: item.name, detail: item.model || item.description || null };
    if (type === 'workflow') {
      const steps = stepsOf(item);
      return { leading: <ToneTile icon={WorkflowIcon} color="var(--app-accent)" size="sm" />, name: item.name, detail: `${steps.length} ${steps.length === 1 ? 'step' : 'steps'} · ${steps.map(step => profileOf(step.profileId)?.name).filter(Boolean).join(', ')}` };
    }
    return { leading: <ToneTile icon={Braces} color="var(--theme-mode-always)" size="sm" />, name: item.name, detail: item.key ? `{{${item.key}}}` : null };
  };

  const askDelete = (type, item) => {
    setDeleteTarget({ type, id: item.id, name: item.name, item });
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

  // Editors open in the right pane, one at a time.
  const closeEditors = () => {
    setShowProfileModal(false);
    setShowWorkflowModal(false);
    setShowVariableModal(false);
  };

  const openNewVariable = (preset = null) => {
    closeEditors();
    setActiveTab('variables');
    setVariableToEdit(null);
    setVariablePreset(preset);
    setShowVariableModal(true);
  };

  const openEditVariable = (variable) => {
    closeEditors();
    setVariableToEdit(variable);
    setShowVariableModal(true);
  };

  const openNewProfile = (preset = null) => {
    closeEditors();
    setActiveTab('profiles');
    setProfileToEdit(null);
    setProfilePreset(preset);
    setProfileModalTab('rules');
    setShowProfileModal(true);
  };

  const openEditProfile = (profile, tab = 'rules') => {
    closeEditors();
    setActiveTab('profiles');
    setSelected(prev => ({ ...prev, profiles: profile.id }));
    setProfileToEdit(profile);
    setProfileModalTab(tab);
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
    closeEditors();
    setWorkflowToEdit(null);
    setShowWorkflowModal(true);
  };

  const openEditWorkflow = (workflow) => {
    closeEditors();
    setWorkflowToEdit(workflow);
    setShowWorkflowModal(true);
  };

  const profilesById = new Map(writingProfiles.map(profile => [profile.id, profile]));
  const profileOf = id => profilesById.get(id);
  const parseIds = value => {
    try {
      const list = typeof value === 'string' ? JSON.parse(value || '[]') : (value || []);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const chatsWith = (field, id) => chats.filter(chat => parseIds(chat[field]).includes(id));
  const stepsOf = workflow => parseIds(workflow.steps);
  const query = (searches[activeTab] || '').trim().toLowerCase();
  const matches = (...fields) => !query || fields.some(field => (field || '').toLowerCase().includes(query));

  const shownProfiles = writingProfiles.filter(profile => matches(profile.name, profile.description, profile.model));
  const shownWorkflows = workflows.filter(workflow => matches(workflow.name, ...stepsOf(workflow).map(step => profileOf(step.profileId)?.name)));
  const shownVariables = variables
    .filter(variable => matches(variable.name, variable.key, variable.description, variable.value))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

  const pick = (list, tab) => list.find(item => item.id === selected[tab]) || list[0] || null;
  const currentProfile = pick(shownProfiles, 'profiles');
  const currentWorkflow = pick(shownWorkflows, 'workflows');
  const currentVariable = pick(shownVariables, 'variables');
  const select = (tab, id) => { closeEditors(); setSelected(prev => ({ ...prev, [tab]: id })); };

  const tabs = [
    { id: 'profiles', label: 'AI profiles', count: writingProfiles.length },
    { id: 'workflows', label: 'Workflows', count: workflows.length },
    { id: 'variables', label: 'Variables', count: variables.length },
  ];
  const rail = {
    profiles: { newLabel: 'New profile', onNew: () => openNewProfile(), onImport: handleImportProfile },
    workflows: { newLabel: 'New workflow', onNew: openNewWorkflow, onImport: handleImportWorkflow },
    variables: { newLabel: 'New variable', onNew: () => openNewVariable(), onImport: null },
  }[activeTab];

  const duplicateProfile = async (profile) => {
    // The copy starts without the original's knowledge files, which live in the original's own folder.
    const { needsSetup, ...rest } = profile;
    const copy = { ...rest, id: 'profile_' + Math.random().toString(36).substr(2, 9), name: `${profile.name} copy`, knowledgeFiles: '[]' };
    await handleSaveProfile(copy);
    setSelected(prev => ({ ...prev, profiles: copy.id }));
    showToast(`“${copy.name}” created. Knowledge files were not copied.`, 'success');
  };

  const duplicateWorkflow = async (workflow) => {
    const copy = { ...workflow, id: 'wf_' + Math.random().toString(36).substr(2, 9), name: `${workflow.name} copy` };
    await handleSaveWorkflow(copy);
    setSelected(prev => ({ ...prev, workflows: copy.id }));
    showToast(`“${copy.name}” created.`, 'success');
  };

  const knowledgeCount = profile => parseIds(profile.knowledgeFiles).length;
  const variableUses = variable => {
    const tag = new RegExp(`\\{\\{\\s*${variable.key}\\s*\\}\\}`);
    return [
      ...writingProfiles
        .filter(profile => tag.test(profile.systemPrompt || '') || tag.test(profile.agenticPrompt || ''))
        .map(profile => ({ key: `p-${profile.id}`, name: profile.name, color: profile.color || '#FBCB2D' })),
      ...workflows
        .filter(workflow => stepsOf(workflow).some(step => tag.test(step.prompt || '')))
        .map(workflow => ({ key: `w-${workflow.id}`, name: workflow.name })),
    ];
  };

  const newItem = label => (
    <RailItem active title={label} leading={<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.5625rem] border border-dashed border-tint/20 text-text-muted">+</span>} />
  );

  const railList = {
    profiles: (
      <>
        {shownProfiles.map(profile => (
          <RailItem
            key={profile.id}
            active={showProfileModal ? profileToEdit?.id === profile.id : currentProfile?.id === profile.id}
            onClick={() => select('profiles', profile.id)}
            leading={<ProfileAvatar color={profile.color || '#FBCB2D'} size={32} muted={profile.needsSetup} />}
            title={profile.name}
            meta={profile.needsSetup
              ? <span className="text-xs font-semibold text-status-setup">Needs a model</span>
              : <span className="font-mono text-[0.6875rem] text-text-subtle">{profile.model}</span>}
          />
        ))}
        {showProfileModal && !profileToEdit && newItem('New profile')}
        {writingProfiles.length > 0 && shownProfiles.length === 0 && <RailEmpty>Nothing matches the search.</RailEmpty>}
        {writingProfiles.length === 0 && !showProfileModal && <RailEmpty>No profiles yet.</RailEmpty>}
      </>
    ),
    workflows: (
      <>
        {shownWorkflows.map(workflow => {
          const steps = stepsOf(workflow);
          const blocked = steps.some(step => !profileOf(step.profileId) || profileOf(step.profileId).needsSetup);
          return (
            <RailItem
              key={workflow.id}
              active={showWorkflowModal ? workflowToEdit?.id === workflow.id : currentWorkflow?.id === workflow.id}
              onClick={() => select('workflows', workflow.id)}
              title={workflow.name}
              meta={(
                <span className="mt-0.5 flex items-center gap-1.5">
                  {steps.slice(0, 6).map((step, index) => {
                    const profile = profileOf(step.profileId);
                    return <ReedPen key={index} size={13} color={profile?.color || 'currentColor'} className={profile ? '' : 'text-text-disabled'} opacity={profile && !profile.needsSetup ? 1 : 0.4} />;
                  })}
                  {blocked
                    ? <span className="ml-1 text-xs font-semibold text-status-setup">A step has no model</span>
                    : <span className="caption ml-1">{steps.length} step{steps.length === 1 ? '' : 's'}</span>}
                </span>
              )}
            />
          );
        })}
        {showWorkflowModal && !workflowToEdit && newItem('New workflow')}
        {workflows.length > 0 && shownWorkflows.length === 0 && <RailEmpty>Nothing matches the search.</RailEmpty>}
        {workflows.length === 0 && !showWorkflowModal && <RailEmpty>No workflows yet.</RailEmpty>}
      </>
    ),
    variables: (
      <>
        {shownVariables.map(variable => (
          <RailItem
            key={variable.id}
            active={showVariableModal ? variableToEdit?.id === variable.id : currentVariable?.id === variable.id}
            onClick={() => select('variables', variable.id)}
            title={variable.name}
            meta={<span className="font-mono text-[0.6875rem] text-accent">{`{{${variable.key}}}`}</span>}
          />
        ))}
        {showVariableModal && !variableToEdit && newItem('New variable')}
        {variables.length > 0 && shownVariables.length === 0 && <RailEmpty>Nothing matches the search.</RailEmpty>}
        {variables.length === 0 && !showVariableModal && <RailEmpty>No variables yet.</RailEmpty>}
      </>
    ),
  }[activeTab];

  const intro = children => <div className="mx-auto max-w-[60rem] px-12 pb-16 pt-12">{children}</div>;

  let pane = null;
  if (activeTab === 'profiles') {
    if (showProfileModal) {
      pane = (
        <ProfileModal
          key={profileToEdit?.id || 'new'}
          inline
          profile={profileToEdit}
          preset={profilePreset}
          starters={PROFILE_STARTERS}
          initialTab={profileModalTab}
          onClose={() => { setShowProfileModal(false); setProfileToEdit(null); setProfilePreset(null); }}
          onDelete={target => { setShowProfileModal(false); setProfileToEdit(null); askDelete('profile', target); }}
          onSave={(savedProfile, { isNew } = {}) => {
            setSelected(prev => ({ ...prev, profiles: savedProfile.id }));
            if (isNew) {
              showToast(
                `Profile "${savedProfile.name}" created. Give it documents and memory in its knowledge base.`,
                'success',
                8000,
                { label: 'Open knowledge base', onClick: () => openManageKb(savedProfile) }
              );
            }
          }}
        />
      );
    } else if (currentProfile) {
      pane = (
        <ProfileDetail
          key={currentProfile.id}
          profile={currentProfile}
          apiName={apiProfiles.find(ap => ap.id === currentProfile.apiProfileId)?.name || 'Connection'}
          workspaces={chatsWith('activeProfiles', currentProfile.id).map(chat => chat.title)}
          workflows={workflows.filter(workflow => stepsOf(workflow).some(step => step.profileId === currentProfile.id))}
          knowledgeCount={knowledgeCount(currentProfile)}
          onEdit={() => openEditProfile(currentProfile)}
          onSetUp={() => openEditProfile(currentProfile)}
          onSearchInstructions={() => openEditProfile(currentProfile, 'search')}
          onKnowledge={() => openManageKb(currentProfile)}
          onDuplicate={() => duplicateProfile(currentProfile)}
          onExport={() => handleExportProfileClick(currentProfile)}
          onDelete={() => askDelete('profile', currentProfile)}
        />
      );
    } else if (writingProfiles.length === 0) {
      pane = intro(<ProfilesIntro onNew={() => openNewProfile()} onImport={handleImportProfile} onStart={openNewProfile} />);
    }
  } else if (activeTab === 'workflows') {
    if (showWorkflowModal) {
      pane = (
        <WorkflowModal
          key={workflowToEdit?.id || 'new'}
          inline
          workflow={workflowToEdit}
          onSave={saved => setSelected(prev => ({ ...prev, workflows: saved.id }))}
          onClose={() => { setShowWorkflowModal(false); setWorkflowToEdit(null); }}
        />
      );
    } else if (currentWorkflow) {
      pane = (
        <WorkflowDetail
          key={currentWorkflow.id}
          workflow={currentWorkflow}
          steps={stepsOf(currentWorkflow)}
          profileOf={profileOf}
          uses={chatsWith('activeWorkflows', currentWorkflow.id).length}
          onEdit={() => openEditWorkflow(currentWorkflow)}
          onSetUp={profile => openEditProfile(profile)}
          onExport={() => handleExportWorkflowClick(currentWorkflow)}
          onDuplicate={() => duplicateWorkflow(currentWorkflow)}
          onDelete={() => askDelete('workflow', currentWorkflow)}
        />
      );
    } else if (workflows.length === 0) {
      pane = intro(<WorkflowsIntro onNew={openNewWorkflow} onImport={handleImportWorkflow} />);
    }
  } else if (showVariableModal) {
    pane = (
      <VariableModal
        key={variableToEdit?.id || `new-${variablePreset?.label || ''}`}
        inline
        variable={variableToEdit}
        preset={variablePreset}
        onSave={async variable => {
          await handleSaveVariable(variable);
          if (variable?.id) setSelected(prev => ({ ...prev, variables: variable.id }));
        }}
        onClose={() => { setShowVariableModal(false); setVariableToEdit(null); setVariablePreset(null); }}
      />
    );
  } else if (currentVariable) {
    pane = (
      <VariableDetail
        key={currentVariable.id}
        variable={currentVariable}
        usedBy={variableUses(currentVariable)}
        onEdit={() => openEditVariable(currentVariable)}
        onCopy={() => { copyText(`{{${currentVariable.key}}}`); showToast('Variable tag copied.', 'success'); }}
        onDelete={() => askDelete('variable', currentVariable)}
      />
    );
  } else if (variables.length === 0) {
    pane = intro(<VariablesIntro onNew={() => openNewVariable()} onStart={openNewVariable} />);
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden surface-page select-none">
      <LibraryRail
        tabs={tabs}
        activeTab={activeTab}
        onTab={tab => { closeEditors(); setActiveTab(tab); }}
        search={searches[activeTab] || ''}
        onSearch={value => setSearches(prev => ({ ...prev, [activeTab]: value }))}
        onBack={() => setCurrentView('dashboard')}
        newLabel={rail.newLabel}
        onNew={rail.onNew}
        onImport={rail.onImport}
      >
        {railList}
      </LibraryRail>

      <div className="relative min-w-0 flex-1 overflow-y-auto custom-scrollbar pt-10 [mask-image:linear-gradient(to_bottom,transparent_0,transparent_2.25rem,black_4.25rem)]">
        {pane || <p className="caption px-14 pt-12">Nothing matches the search.</p>}
      </div>

      {showDeleteModal && (
        <DeleteModal
          title={deleteTarget?.type === 'profile' ? 'Delete this AI profile?' : deleteTarget?.type === 'workflow' ? 'Delete this workflow?' : 'Delete this variable?'}
          message={deleteTarget?.type === 'profile'
            ? 'Workspaces that use it lose this voice, and workflows lose the steps it runs. This cannot be undone.'
            : deleteTarget?.type === 'workflow'
              ? 'Its AI profiles stay in the Library. This cannot be undone.'
              : 'Rules that mention it keep the tag as plain text. This cannot be undone.'}
          confirmText={deleteTarget?.type === 'profile' ? 'Delete profile' : deleteTarget?.type === 'workflow' ? 'Delete workflow' : 'Delete variable'}
          subject={deleteSubject(deleteTarget)}
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
          onOpenSmartSearch={() => {
            const target = profileToEdit;
            setShowKbManager(false);
            openEditProfile(target, 'search');
          }}
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
          title={importType === 'profile' ? 'Importing an AI profile' : 'Importing a workflow'}
          stages={importType === 'profile' ? PROGRESS_STAGES.profileImport : PROGRESS_STAGES.workflowImport}
          footnote={importType === 'profile' ? 'Keep Kallamo open until it finishes. The profile appears in the Library when it is done.' : 'Keep Kallamo open until it finishes. The workflow and its profiles appear in the Library when it is done.'}
        />
      )}
    </div>
  );
}
