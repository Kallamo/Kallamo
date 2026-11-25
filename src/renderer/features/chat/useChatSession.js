import { useEffect, useRef, useState } from 'react';
import { createHistoryEdit } from './generation-target';
import { reconcileMessages } from './message-reconcile';
import { preloadMessageFrames, preloadPresentation, preloadUiState } from './workspace-presentation';
import { adoptLegacyUiState } from '../layout/layout-store';
import { createStore } from '../../utils/store';
import { perfStart } from '../../utils/perf';
import { ChatWorkspaceView } from '../../views';

const STREAM_DISPLAY_INTERVAL_MS = 48;
const STREAM_DISPLAY_CHARACTERS_PER_TICK = 48;

function getAlternativeData(message) {
  if (!message || message.role !== 'ai') return null;
  return {
    content: message.content,
    aiName: message.aiName,
    aiColor: message.aiColor,
    createdAt: message.createdAt,
    alternatives: message.alternatives
  };
}

function buildAlternatives(oldAlternative, newMessage) {
  const list = [];
  if (oldAlternative.alternatives) {
    try {
      const parsed = typeof oldAlternative.alternatives === 'string'
        ? JSON.parse(oldAlternative.alternatives)
        : oldAlternative.alternatives;
      if (parsed?.list) list.push(...parsed.list);
    } catch (error) {
      console.error('Failed to parse old AI alternatives list', error);
    }
  } else {
    list.push({
      content: oldAlternative.content,
      aiName: oldAlternative.aiName,
      aiColor: oldAlternative.aiColor,
      createdAt: oldAlternative.createdAt
    });
  }

  list.push({
    content: newMessage.content,
    aiName: newMessage.aiName,
    aiColor: newMessage.aiColor,
    createdAt: newMessage.createdAt
  });

  return { activeIndex: list.length - 1, list };
}

const THREADS = ['chat', 'roleplay'];
const threadKey = (chatId, thread) => `${chatId}\u0000${thread}`;

export function useChatSession({ api, setChats, setCurrentView }) {
  const [activeChatId, setActiveChatId] = useState(null);
  // The workspace's two conversations share this session; the one on screen is the active thread.
  // Each keeps its last page here, so switching tabs shows it at once while it is read again.
  const [activeThread, setActiveThread] = useState('chat');
  const activeThreadRef = useRef('chat');
  const activeChatIdRef = useRef(null);
  activeChatIdRef.current = activeChatId;
  const threadCacheRef = useRef(new Map());
  const loadSeqRef = useRef(0);
  const [activeMessages, setActiveMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [oldestMessageCursor, setOldestMessageCursor] = useState(null);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editError, setEditError] = useState(null);
  const [lastGeneratedMessageId, setLastGeneratedMessageId] = useState(null);
  // Streamed text changes every tick; keeping it out of React state means only the
  // bubble that shows it re-renders, not the provider and everything under it.
  const [streamDisplayStore] = useState(() => createStore({ content: '', reasoning: '' }));
  const streamContentQueueRef = useRef('');
  const streamReasoningQueueRef = useRef('');
  const streamDisplayTimerRef = useRef(null);
  const generationRequestRef = useRef(0);

  const flushStreamDisplay = () => {
    const contentDelta = streamContentQueueRef.current.slice(0, STREAM_DISPLAY_CHARACTERS_PER_TICK);
    const reasoningDelta = streamReasoningQueueRef.current.slice(0, STREAM_DISPLAY_CHARACTERS_PER_TICK);

    streamContentQueueRef.current = streamContentQueueRef.current.slice(contentDelta.length);
    streamReasoningQueueRef.current = streamReasoningQueueRef.current.slice(reasoningDelta.length);

    if (contentDelta || reasoningDelta) {
      streamDisplayStore.set(previous => ({
        content: previous.content + contentDelta,
        reasoning: previous.reasoning + reasoningDelta
      }));
    }

    if (streamContentQueueRef.current || streamReasoningQueueRef.current) {
      streamDisplayTimerRef.current = setTimeout(flushStreamDisplay, STREAM_DISPLAY_INTERVAL_MS);
    } else {
      streamDisplayTimerRef.current = null;
    }
  };

  const enqueueStreamDisplay = ({ contentDelta, reasoningDelta }) => {
    if (contentDelta) streamContentQueueRef.current += contentDelta;
    if (reasoningDelta) streamReasoningQueueRef.current += reasoningDelta;
    if (!streamDisplayTimerRef.current) flushStreamDisplay();
  };

  const clearStreamDisplay = () => {
    streamContentQueueRef.current = '';
    streamReasoningQueueRef.current = '';
    if (streamDisplayTimerRef.current) clearTimeout(streamDisplayTimerRef.current);
    streamDisplayTimerRef.current = null;
    streamDisplayStore.set({ content: '', reasoning: '' });
  };

  useEffect(() => {
    if (!isGenerating) clearStreamDisplay();
  }, [isGenerating]);

  useEffect(() => () => clearStreamDisplay(), []);

  // Narrative State finishes after the reply is shown; only that message's diagnostics change.
  useEffect(() => api.onMessageDebugNotice?.(({ workspaceId, messageId, debugNotice }) => {
    if (workspaceId !== activeChatId) return;
    setActiveMessages(previous => previous.map(item => item.id === messageId ? { ...item, debugNotice } : item));
  }), [api, activeChatId]);

  // A read for another workspace or conversation lands in the cache, never on screen.
  const isShown = (chatId, thread) => chatId === activeChatIdRef.current && thread === activeThreadRef.current;

  const loadLatestChatMessages = async (chatId, thread = activeThreadRef.current) => {
    const seq = ++loadSeqRef.current;
    const page = await api.getChatMessagePage({ chatId, thread });
    const cached = threadCacheRef.current.get(threadKey(chatId, thread));
    threadCacheRef.current.set(threadKey(chatId, thread), {
      messages: reconcileMessages(cached?.messages || [], page.messages),
      hasMore: page.hasMore,
      cursor: page.oldestCursor
    });
    if (isShown(chatId, thread) && seq === loadSeqRef.current) {
      setActiveMessages(previous => reconcileMessages(previous, page.messages));
      setHasOlderMessages(page.hasMore);
      setOldestMessageCursor(page.oldestCursor);
    }
    return page.messages;
  };

  // Keeps what is on screen for the conversation being left, then shows the other one.
  const selectThread = (thread) => {
    const next = THREADS.includes(thread) ? thread : 'chat';
    if (next === activeThreadRef.current) return;
    const chatId = activeChatIdRef.current;
    if (chatId) {
      threadCacheRef.current.set(threadKey(chatId, activeThreadRef.current), {
        messages: activeMessages, hasMore: hasOlderMessages, cursor: oldestMessageCursor
      });
    }
    activeThreadRef.current = next;
    setActiveThread(next);
    const cached = chatId ? threadCacheRef.current.get(threadKey(chatId, next)) : null;
    setActiveMessages(cached?.messages || []);
    setHasOlderMessages(Boolean(cached?.hasMore));
    setOldestMessageCursor(cached?.cursor || null);
    setLastGeneratedMessageId(null);
    if (chatId) loadLatestChatMessages(chatId, next).catch(error => console.error('Failed to load the conversation:', error));
  };

  // After messages move between the conversations, neither kept page is current any more.
  const forgetThreadCache = () => threadCacheRef.current.clear();

  const loadOlderChatMessages = async () => {
    if (!activeChatId || !hasOlderMessages || !oldestMessageCursor || isLoadingOlderMessages) return;

    setIsLoadingOlderMessages(true);
    const thread = activeThreadRef.current;
    try {
      const page = await api.getChatMessagePage({ chatId: activeChatId, before: oldestMessageCursor, thread });
      if (!isShown(activeChatId, thread)) return;
      setActiveMessages(previous => [...page.messages, ...previous]);
      setHasOlderMessages(page.hasMore);
      setOldestMessageCursor(page.oldestCursor);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  };

  const jumpToChatStart = async () => {
    if (!activeChatId || !hasOlderMessages || !oldestMessageCursor || isLoadingOlderMessages) return;

    setIsLoadingOlderMessages(true);
    const thread = activeThreadRef.current;
    try {
      const olderMessages = [];
      let cursor = oldestMessageCursor;
      let hasMore = hasOlderMessages;

      while (hasMore) {
        const page = await api.getChatMessagePage({ chatId: activeChatId, before: cursor, thread });
        olderMessages.unshift(...page.messages);
        cursor = page.oldestCursor;
        hasMore = page.hasMore;
      }
      if (!isShown(activeChatId, thread)) return;

      setActiveMessages(previous => [...olderMessages, ...previous]);
      setHasOlderMessages(false);
      setOldestMessageCursor(cursor);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  };

  // Pages back only as far as one message, so a search result far in the past can be shown.
  const loadOlderUntil = async (messageId) => {
    if (!activeChatId || !hasOlderMessages || !oldestMessageCursor || isLoadingOlderMessages) return;
    setIsLoadingOlderMessages(true);
    const thread = activeThreadRef.current;
    try {
      const olderMessages = [];
      let cursor = oldestMessageCursor;
      let hasMore = hasOlderMessages;
      while (hasMore && !olderMessages.some(message => message.id === messageId)) {
        const page = await api.getChatMessagePage({ chatId: activeChatId, before: cursor, thread });
        olderMessages.unshift(...page.messages);
        cursor = page.oldestCursor;
        hasMore = page.hasMore;
      }
      if (!isShown(activeChatId, thread)) return;
      setActiveMessages(previous => [...olderMessages, ...previous]);
      setHasOlderMessages(hasMore);
      setOldestMessageCursor(cursor);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  };

  // Opens a workspace on the given conversation, or on the one already chosen for it.
  const handleSelectChat = async (chatId, { thread } = {}) => {
    perfStart('workspace-open');
    const opening = THREADS.includes(thread) ? thread : activeThreadRef.current;
    threadCacheRef.current.clear();
    activeChatIdRef.current = chatId;
    activeThreadRef.current = opening;
    setActiveThread(opening);
    setActiveMessages([]);
    setHasOlderMessages(false);
    setOldestMessageCursor(null);
    setActiveChatId(chatId);
    const [messages] = await Promise.all([
      loadLatestChatMessages(chatId, opening),
      preloadPresentation(api, chatId),
      preloadUiState(api, chatId, adoptLegacyUiState),
      ChatWorkspaceView.preload().catch(() => undefined)
    ]);
    await preloadMessageFrames(api, chatId, messages);
    setCurrentView('chat');
  };

  const handleCreateChat = async (newChat) => {
    await api.saveChat(newChat);
    setChats(await api.getChats());
    await handleSelectChat(newChat.id);
  };

  const handleDeleteChat = async (id) => {
    await api.deleteChat(id);
    setChats(await api.getChats());
    if (activeChatId !== id) return;

    setActiveChatId(null);
    setActiveMessages([]);
    setHasOlderMessages(false);
    setOldestMessageCursor(null);
    setCurrentView('dashboard');
  };

  const handleSaveChat = async (chat) => {
    await api.saveChat(chat);
    setChats(await api.getChats());
    if (activeChatId === chat.id) await loadLatestChatMessages(chat.id);
  };

  const refreshChats = async (chatId) => {
    setChats(await api.getChats());
    const targetId = chatId || activeChatId;
    if (targetId) await loadLatestChatMessages(targetId);
  };

  const refreshGeneratedChat = async (chatId, response, thread = activeThreadRef.current) => {
    const messages = await loadLatestChatMessages(chatId, thread);
    const chats = await api.getChats();
    if (isShown(chatId, thread) && response.aiMsgId && !response.streamed) setLastGeneratedMessageId(response.aiMsgId);
    setChats(chats);
    setIsGenerating(false);
    setGenerationProgress(null);
    return messages;
  };

  const saveAlternative = async (oldAlternative, messages) => {
    if (!oldAlternative || messages.length === 0) return messages;
    const newMessage = messages.at(-1);
    if (!newMessage || newMessage.role !== 'ai') return messages;

    newMessage.alternatives = JSON.stringify(buildAlternatives(oldAlternative, newMessage));
    await api.saveMessage(newMessage);
    return loadLatestChatMessages(activeChatId, newMessage.thread || activeThreadRef.current);
  };

  const handleSendMessage = async (content, selectedProfileOrWorkflowId, attachedFiles = []) => {
    if (!activeChatId || !selectedProfileOrWorkflowId || (!content.trim() && attachedFiles.length === 0)) return;
    const requestId = ++generationRequestRef.current;
    const thread = activeThreadRef.current;

    const userMsg = {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      chatId: activeChatId,
      thread,
      role: 'user',
      content,
      aiName: '',
      aiColor: '',
      debugNotice: '',
      attachedFiles,
      createdAt: Date.now()
    };

    await api.saveMessage(userMsg);
    if (isShown(activeChatId, thread)) setActiveMessages(previous => [...previous, userMsg]);
    setIsGenerating(true);
    setGenerationProgress({ chatId: activeChatId, thread, step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        thread,
        messageContent: content,
        targetId: selectedProfileOrWorkflowId,
        attachedFiles
      });
      if (response?.success) await refreshGeneratedChat(activeChatId, response, thread);
    } catch (error) {
      console.error('SendMessage error:', error);
    } finally {
      if (generationRequestRef.current === requestId) {
        setIsGenerating(false);
        setGenerationProgress(null);
      }
    }
  };

  const handleRegenerateMessage = async (messageId, selectedProfileOrWorkflowId) => {
    if (!activeChatId) return;

    const lastUserMessage = activeMessages.filter(message => message.role === 'user').at(-1);
    if (!lastUserMessage) return;
    const requestId = ++generationRequestRef.current;

    const lastMessage = activeMessages.find(message => message.id === messageId) || activeMessages.at(-1);
    const oldAlternative = getAlternativeData(lastMessage);
    const thread = activeThreadRef.current;
    setIsGenerating(true);
    setGenerationProgress({ chatId: activeChatId, thread, step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        thread,
        messageContent: lastUserMessage.content,
        targetId: selectedProfileOrWorkflowId,
        regenerateMessageId: oldAlternative ? lastMessage.id : null
      });
      // The previous reply is only replaced once a new one was actually saved.
      if (response?.success && response.aiMsgId) {
        if (oldAlternative) await api.deleteMessage(lastMessage.id);
        const messages = await refreshGeneratedChat(activeChatId, response, thread);
        await saveAlternative(oldAlternative, messages);
        // The kept reply now waits for Narrative State; the Roleplay panel offers to read it.
        window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId: activeChatId } }));
      }
    } catch (error) {
      console.error('RegenerateMessage error:', error);
    } finally {
      if (generationRequestRef.current === requestId) {
        setIsGenerating(false);
        setGenerationProgress(null);
      }
    }
  };

  const handleEditUserMessage = async (messageId, newText, selectedProfileOrWorkflowId) => {
    if (!activeChatId) return;

    const userMessageIndex = activeMessages.findIndex(message => message.id === messageId);
    if (userMessageIndex < 0) return;
    const requestId = ++generationRequestRef.current;
    const nextMessage = activeMessages[userMessageIndex + 1];
    const oldAlternative = getAlternativeData(nextMessage);
    const currentMessage = activeMessages[userMessageIndex];
    const attachedFiles = Array.isArray(currentMessage?.attachedFiles)
      ? currentMessage.attachedFiles
      : JSON.parse(currentMessage?.attachedFiles || '[]');
    const updatedMessages = activeMessages.map(message => message.id === messageId ? { ...message, content: newText } : message);
    const thread = activeThreadRef.current;

    setActiveMessages(updatedMessages.slice(0, userMessageIndex + 1));
    setIsGenerating(true);
    setGenerationProgress({ chatId: activeChatId, thread, step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        thread,
        messageContent: newText,
        targetId: selectedProfileOrWorkflowId,
        attachedFiles,
        historyEdit: createHistoryEdit(messageId, newText)
      });
      // The messages after the edit are only removed once their replacement exists.
      if (!response?.success || !response.aiMsgId) throw new Error('Generation was not successful.');

      await api.saveMessage(updatedMessages[userMessageIndex]);
      for (const message of activeMessages.slice(userMessageIndex + 1)) {
        await api.deleteMessage(message.id);
      }
      const messages = await refreshGeneratedChat(activeChatId, response, thread);
      await saveAlternative(oldAlternative, messages);
    } catch (error) {
      console.error('EditUserMessage generation error:', error);
      if (isShown(activeChatId, thread)) setActiveMessages(activeMessages);
      setEditError({
        chatId: activeChatId,
        thread,
        editedText: newText,
        msgId: messageId,
        targetId: selectedProfileOrWorkflowId,
        errorMessage: error.message || 'Request failed'
      });
    } finally {
      if (generationRequestRef.current === requestId) {
        setIsGenerating(false);
        setGenerationProgress(null);
      }
    }
  };

  const handleSwitchAIAlternative = async (messageId, targetIndex) => {
    const message = activeMessages.find(item => item.id === messageId);
    if (!message) return;

    try {
      const alternatives = typeof message.alternatives === 'string' ? JSON.parse(message.alternatives) : message.alternatives;
      if (!alternatives?.list || targetIndex < 0 || targetIndex >= alternatives.list.length) return;

      alternatives.activeIndex = targetIndex;
      const selected = alternatives.list[targetIndex];
      const updatedMessage = {
        ...message,
        id: `msg_${crypto.randomUUID()}`,
        debugNoticeFrom: message.id,
        content: selected.content,
        aiName: selected.aiName,
        aiColor: selected.aiColor,
        createdAt: selected.createdAt,
        alternatives: JSON.stringify(alternatives)
      };

      // The shown reply is only removed once its replacement is saved, and the copy is
      // withdrawn if the story cannot let go of the shown reply.
      await api.saveMessage(updatedMessage);
      try {
        await api.deleteMessage(messageId);
      } catch (error) {
        await api.deleteMessage(updatedMessage.id);
        throw error;
      }
      // Narrative State analyzes the kept reply once, when the story continues.
      const deferred = await api.deferNarrativeStateTurn?.(activeChatId, updatedMessage.id);
      if (deferred?.success) updatedMessage.debugNotice = deferred.debugNotice;
      setActiveMessages(previous => previous.map(item => item.id === messageId ? updatedMessage : item));
      window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId: activeChatId } }));
    } catch (error) {
      console.error('Error switching alternative response:', error);
    }
  };

  const handleCancelGeneration = () => {
    generationRequestRef.current++;
    api.cancelGeneration();
    setIsGenerating(false);
    setGenerationProgress(null);
  };

  return {
    activeChatId,
    setActiveChatId,
    activeThread,
    selectThread,
    forgetThreadCache,
    activeMessages,
    setActiveMessages,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderChatMessages,
    jumpToChatStart,
    loadOlderUntil,
    handleSelectChat,
    handleCreateChat,
    handleDeleteChat,
    handleSaveChat,
    refreshChats,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditUserMessage,
    handleSwitchAIAlternative,
    isGenerating,
    setIsGenerating,
    generationProgress,
    setGenerationProgress,
    streamDisplayStore,
    enqueueStreamDisplay,
    clearStreamDisplay,
    handleCancelGeneration,
    editError,
    setEditError,
    lastGeneratedMessageId,
    setLastGeneratedMessageId
  };
}
