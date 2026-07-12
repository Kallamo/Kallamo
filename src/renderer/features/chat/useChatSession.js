import { useEffect, useRef, useState } from 'react';

const STREAM_DISPLAY_INTERVAL_MS = 32;
const STREAM_DISPLAY_CHARACTERS_PER_TICK = 16;

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

export function useChatSession({ api, setChats, setCurrentView }) {
  const [activeChatId, setActiveChatId] = useState(null);
  const [activeMessages, setActiveMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [oldestMessageCursor, setOldestMessageCursor] = useState(null);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editError, setEditError] = useState(null);
  const [lastGeneratedMessageId, setLastGeneratedMessageId] = useState(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const streamContentQueueRef = useRef('');
  const streamReasoningQueueRef = useRef('');
  const streamDisplayTimerRef = useRef(null);

  const flushStreamDisplay = () => {
    const contentDelta = streamContentQueueRef.current.slice(0, STREAM_DISPLAY_CHARACTERS_PER_TICK);
    const reasoningDelta = streamReasoningQueueRef.current.slice(0, STREAM_DISPLAY_CHARACTERS_PER_TICK);

    streamContentQueueRef.current = streamContentQueueRef.current.slice(contentDelta.length);
    streamReasoningQueueRef.current = streamReasoningQueueRef.current.slice(reasoningDelta.length);

    if (contentDelta) setStreamingContent(previous => previous + contentDelta);
    if (reasoningDelta) setStreamingReasoning(previous => previous + reasoningDelta);

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
    setStreamingContent('');
    setStreamingReasoning('');
  };

  useEffect(() => {
    if (!isGenerating) clearStreamDisplay();
  }, [isGenerating]);

  useEffect(() => () => clearStreamDisplay(), []);

  const loadLatestChatMessages = async (chatId) => {
    const page = await api.getChatMessagePage({ chatId });
    setActiveMessages(page.messages);
    setHasOlderMessages(page.hasMore);
    setOldestMessageCursor(page.oldestCursor);
    return page.messages;
  };

  const loadOlderChatMessages = async () => {
    if (!activeChatId || !hasOlderMessages || !oldestMessageCursor || isLoadingOlderMessages) return;

    setIsLoadingOlderMessages(true);
    try {
      const page = await api.getChatMessagePage({ chatId: activeChatId, before: oldestMessageCursor });
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
    try {
      const olderMessages = [];
      let cursor = oldestMessageCursor;
      let hasMore = hasOlderMessages;

      while (hasMore) {
        const page = await api.getChatMessagePage({ chatId: activeChatId, before: cursor });
        olderMessages.unshift(...page.messages);
        cursor = page.oldestCursor;
        hasMore = page.hasMore;
      }

      setActiveMessages(previous => [...olderMessages, ...previous]);
      setHasOlderMessages(false);
      setOldestMessageCursor(cursor);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  };

  const handleSelectChat = async (chatId) => {
    setActiveChatId(chatId);
    await loadLatestChatMessages(chatId);
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

  const refreshGeneratedChat = async (chatId, response) => {
    const messages = await loadLatestChatMessages(chatId);
    if (response.aiMsgId && !response.streamed) setLastGeneratedMessageId(response.aiMsgId);
    setChats(await api.getChats());
    return messages;
  };

  const saveAlternative = async (oldAlternative, messages) => {
    if (!oldAlternative || messages.length === 0) return messages;
    const newMessage = messages.at(-1);
    if (!newMessage || newMessage.role !== 'ai') return messages;

    newMessage.alternatives = JSON.stringify(buildAlternatives(oldAlternative, newMessage));
    await api.saveMessage(newMessage);
    return loadLatestChatMessages(activeChatId);
  };

  const handleSendMessage = async (content, selectedProfileOrWorkflowId, attachedFiles = []) => {
    if (!activeChatId || (!content.trim() && attachedFiles.length === 0)) return;

    const userMsg = {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      chatId: activeChatId,
      role: 'user',
      content,
      aiName: '',
      aiColor: '',
      debugNotice: '',
      attachedFiles,
      createdAt: Date.now()
    };

    await api.saveMessage(userMsg);
    setActiveMessages(previous => [...previous, userMsg]);
    setIsGenerating(true);
    setGenerationProgress({ step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        messageContent: content,
        targetId: selectedProfileOrWorkflowId,
        attachedFiles
      });
      if (response?.success) await refreshGeneratedChat(activeChatId, response);
    } catch (error) {
      console.error('SendMessage error:', error);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handleRegenerateMessage = async (messageId, selectedProfileOrWorkflowId) => {
    if (!activeChatId) return;

    const lastUserMessage = activeMessages.filter(message => message.role === 'user').at(-1);
    if (!lastUserMessage) return;

    const lastMessage = activeMessages.find(message => message.id === messageId) || activeMessages.at(-1);
    const oldAlternative = getAlternativeData(lastMessage);
    if (oldAlternative) {
      await api.deleteMessage(lastMessage.id);
      setActiveMessages(previous => previous.filter(message => message.id !== lastMessage.id));
    }

    setIsGenerating(true);
    setGenerationProgress({ step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        messageContent: lastUserMessage.content,
        targetId: selectedProfileOrWorkflowId
      });
      if (response?.success) {
        const messages = await refreshGeneratedChat(activeChatId, response);
        await saveAlternative(oldAlternative, messages);
      }
    } catch (error) {
      console.error('RegenerateMessage error:', error);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handleEditUserMessage = async (messageId, newText, selectedProfileOrWorkflowId) => {
    if (!activeChatId) return;

    const userMessageIndex = activeMessages.findIndex(message => message.id === messageId);
    if (userMessageIndex < 0) return;
    const nextMessage = activeMessages[userMessageIndex + 1];
    const oldAlternative = getAlternativeData(nextMessage);
    const currentMessage = activeMessages[userMessageIndex];
    const attachedFiles = Array.isArray(currentMessage?.attachedFiles)
      ? currentMessage.attachedFiles
      : JSON.parse(currentMessage?.attachedFiles || '[]');
    const updatedMessages = activeMessages.map(message => message.id === messageId ? { ...message, content: newText } : message);

    setActiveMessages(updatedMessages.slice(0, userMessageIndex + 1));
    setIsGenerating(true);
    setGenerationProgress({ step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        messageContent: newText,
        targetId: selectedProfileOrWorkflowId,
        attachedFiles
      });
      if (!response?.success) throw new Error('Generation was not successful.');

      await api.saveMessage(updatedMessages[userMessageIndex]);
      for (const message of activeMessages.slice(userMessageIndex + 1)) {
        await api.deleteMessage(message.id);
      }
      const messages = await refreshGeneratedChat(activeChatId, response);
      await saveAlternative(oldAlternative, messages);
    } catch (error) {
      console.error('EditUserMessage generation error:', error);
      setActiveMessages(activeMessages);
      setEditError({
        chatId: activeChatId,
        editedText: newText,
        msgId: messageId,
        targetId: selectedProfileOrWorkflowId,
        errorMessage: error.message || 'Request failed'
      });
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
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
        content: selected.content,
        aiName: selected.aiName,
        aiColor: selected.aiColor,
        createdAt: selected.createdAt,
        alternatives: JSON.stringify(alternatives)
      };

      await api.saveMessage(updatedMessage);
      setActiveMessages(previous => previous.map(item => item.id === messageId ? updatedMessage : item));
    } catch (error) {
      console.error('Error switching alternative response:', error);
    }
  };

  const handleCancelGeneration = () => {
    api.cancelGeneration();
    setIsGenerating(false);
    setGenerationProgress(null);
  };

  return {
    activeChatId,
    setActiveChatId,
    activeMessages,
    setActiveMessages,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderChatMessages,
    jumpToChatStart,
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
    streamingContent,
    streamingReasoning,
    enqueueStreamDisplay,
    clearStreamDisplay,
    handleCancelGeneration,
    editError,
    setEditError,
    lastGeneratedMessageId,
    setLastGeneratedMessageId
  };
}
