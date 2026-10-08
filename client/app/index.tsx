import React, { useState, useMemo, useCallback } from 'react';
import {
  AppState,
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Alert,
  ScrollView,
  Animated,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import MessageOptionsModal from '../components/ui/MessageOptionsModal';
import MarkdownViewerOverlay from '../components/ui/MarkdownViewerOverlay';
import { useConfigStore } from '../store/useConfigStore';
import type { ConnectionMode } from '../store/useConfigStore';
import { useChatStore, Message, Thread } from '../store/useChatStore';
import { useAurora } from '../hooks/useAurora';
import RichText from '../components/chat/RichText';
import BubbleFooter from '../components/chat/BubbleFooter';
import DateDividerPill from '../components/chat/DateDividerPill';
import { buildChatFeedItems } from '../utils/chatFeed';
import { ensureThrottleTimer, runServerStream } from '../utils/serverStream';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';
import { getCachedParse } from '../utils/parseCache';
import SourceCard from '../components/chat/SourceCard';
import { styles } from './indexStyles';
import { healXmlTags } from '../utils/xmlHealer';
import { useRouter } from 'expo-router';
import { useBrowserStore } from '../store/useBrowserStore';
import { useGoogleAuthStore } from '../store/useGoogleAuthStore';

// Importing local mode modules
import { initializeLocalModel, streamLocalLlmResponse, isLocalLlmDown, localModelStorageKey, LOCAL_MODELS } from '../utils/localLlm';
import { compileLocalPrompt } from '../utils/promptCompiler';
import { parseAndExecuteTools } from '../utils/toolProxy';
import { streamCloudResponse } from '../utils/providers';
import { buildContextMessages } from '../utils/providers/context';
import { isSkillCommand, SKILL_PROMPTS, SKILL_METADATA } from '../utils/skillPrompts';
import type { SkillId } from '../utils/skillPrompts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { evaluateSafety } from '../utils/safetyManager';
import { deriveSafetyTier, type SafetyTierLabel } from '../utils/deriveSafetyTier';
import { executeDeviceAction, sendDeviceResponse } from '../utils/deviceActionExecutor';
import { isShizukuTool } from '../utils/shizuku';
import {
  checkPermission,
  getRationale,
  requestPermission,
  shouldPrompt,
  type OSPermission,
} from '../utils/permissionManager';
import PermissionRequestCard from '../components/chat/PermissionRequestCard';

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

import { resolveAgentPrompt, resolveNewThreadAgent } from '../utils/agents';
import { overlayRemoteAgents } from '../db/agentRepository';
import { useAgents } from '../hooks/useAgents';
import { useMessageActions } from '../hooks/useMessageActions';
import { generateUlid } from '../utils/syncIds';

const QUOTES = [
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
  { text: "Science is organized knowledge. Wisdom is organized life.", author: "Immanuel Kant" },
  { text: "The important thing is not to stop questioning.", author: "Albert Einstein" },
  { text: "Research is creating new knowledge.", author: "Neil Armstrong" },
  { text: "Somewhere, something incredible is waiting to be known.", author: "Carl Sagan" },
  { text: "Data! Data! Data! I can't make bricks without clay.", author: "Arthur Conan Doyle" },
  { text: "Knowledge has to be improved, challenged, and increased constantly.", author: "Peter Drucker" },
  { text: "Great things are done by a series of small things brought together.", author: "Vincent Van Gogh" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" }
];

const generateId = (_prefix: string) => {
  // T5 (#253): cursor-safe IDs are pure ULIDs. The prefix argument is kept so
  // existing call sites stay readable (`generateId('msg_user')`), but it is
  // intentionally NOT embedded: any constant prefix would make
  // `sync_pull`'s `id > cursor ORDER BY id` sort by type first and skip rows
  // across pages (finding-009). See utils/syncIds.ts.
  return generateUlid();
};

export default function ChatScreen() {
  const router = useRouter();
  const executedDeviceToolsRef = React.useRef(new Set());
  const insets = useSafeAreaInsets();

  // Config State
  const apiUrl = useConfigStore((state) => state.apiUrl);
  const apiKey = useConfigStore((state) => state.apiKey);
  const modelName = useConfigStore((state) => state.modelName);
  const defaultAgent = useConfigStore((state) => state.defaultAgent);
  const setDefaultAgent = useConfigStore((state) => state.setDefaultAgent);
  const userName = useConfigStore((state) => state.userName);
  const suggestionStarters = useConfigStore((state) => state.suggestionStarters);

  // Local and cloud mode states
  const connectionMode = useConfigStore((state) => state.connectionMode);
  const setConnectionMode = useConfigStore((state) => state.setConnectionMode);
  const activeCloudProvider = useConfigStore((state) => state.activeCloudProvider);
  const isLocalMode = connectionMode === 'local';
  const localModelName = useConfigStore((state) => state.localModelName);
  const localModelDownloadProgress = useConfigStore((state) => state.localModelDownloadProgress);
  const wifiOnlyDownload = useConfigStore((state) => state.wifiOnlyDownload);
  const setLocalModelDownloadProgress = useConfigStore((state) => state.setLocalModelDownloadProgress);

  // Chat State
  const threads = useChatStore((state) => state.threads);
  const activeThreadId = useChatStore((state) => state.activeThreadId);
  const messages = useChatStore((state) => state.messages);
  const isThreadStreaming = useChatStore((state) => state.isThreadStreaming);
  const setStreamingThread = useChatStore((state) => state.setStreamingThread);
  const selectThread = useChatStore((state) => state.selectThread);
  const deleteThread = useChatStore((state) => state.deleteThread);
  const renameThread = useChatStore((state) => state.renameThread);
  const togglePinThread = useChatStore((state) => state.togglePinThread);
  const setThreadAgent = useChatStore((state) => state.setThreadAgent);
  const setThreadSkill = useChatStore((state) => state.setThreadSkill);
  const createThread = useChatStore((state) => state.createThread);
  const addMessage = useChatStore((state) => state.addMessage);
  const appendToken = useChatStore((state) => state.appendToken);
  const setThreads = useChatStore((state) => state.setThreads);
  const setHistory = useChatStore((state) => state.setHistory);
  const branchThread = useChatStore((state) => state.branchThread);
  const truncateThreadHistory = useChatStore((state) => state.truncateThreadHistory);

  // Local/UI States
  const [input, setInput] = useState('');
  // #357: agents come from the shared DB-backed selector (no local copy).
  const agents = useAgents();
  const currentThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId),
    [threads, activeThreadId]
  );
  const currentAgentId = currentThread?.agent || defaultAgent;
  const [welcomeQuote, setWelcomeQuote] = useState(QUOTES[0]);
  const [welcomeGreeting, setWelcomeGreeting] = useState('Hello');
  const [showRawMap, setShowRawMap] = useState<Record<string, boolean>>({});
  const [activeMenuMessage, setActiveMenuMessage] = useState<Message | null>(null);
  const [authRequired, setAuthRequired] = useState<Record<string, boolean>>({});
  const [viewerContent, setViewerContent] = useState<string | null>(null);
  // #158: pending OS-permission prompt + session-scoped denial set so a denied
  // permission is not re-prompted until the app restarts.
  const [permissionPrompt, setPermissionPrompt] = useState<OSPermission | null>(null);
  const sessionDeniedPermissionsRef = React.useRef<Set<OSPermission>>(new Set());

  // Theme values — Aurora: theme = atmosphere (colors), accent = energy (aurora)
  const { colors, sizes, aurora } = useAurora();
  const accentHex = aurora.acc1;

  // Refs
  const flatListRef = React.useRef<FlatList | null>(null);
  const lastOffsetY = React.useRef(0);
  const isAgentBarVisible = React.useRef(true);

  const triggerAutoScroll = useCallback(() => {
    if (lastOffsetY.current < 120) {
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 50);
    }
  }, []);
  const agentBarHeight = React.useRef(new Animated.Value(58)).current;

  const pendingTokensMapRef = React.useRef<Record<string, string>>({});
  const throttleTimersRef = React.useRef<Record<string, any>>({});
  const abortControllersRef = React.useRef<Record<string, AbortController>>({});

  const cleanUpThrottleAndHeal = useCallback((threadId: string) => {
    if (throttleTimersRef.current[threadId]) {
      clearInterval(throttleTimersRef.current[threadId]);
      delete throttleTimersRef.current[threadId];
    }

    // Flush any leftover tokens
    if (pendingTokensMapRef.current[threadId]) {
      appendToken(threadId, pendingTokensMapRef.current[threadId]);
    }
    // FIX-3: always drop the buffer entry (even when empty) so a later
    // tick cannot resurrect work for a finished thread.
    delete pendingTokensMapRef.current[threadId];

    // Heal XML tags
    const threadMsgs = useChatStore.getState().messages[threadId] || [];
    if (threadMsgs.length > 0) {
      const last = threadMsgs[threadMsgs.length - 1];
      if (last.role === 'assistant') {
        const healed = healXmlTags(last.content);
        if (healed !== last.content) {
          const updatedHistory = [...threadMsgs.slice(0, -1), { ...last, content: healed }];
          setHistory(threadId, updatedHistory);
        }
      }
    }
  }, [appendToken, setHistory]);

  const handleScroll = useCallback((event: any) => {
    const currentOffset = event.nativeEvent.contentOffset.y;
    const diff = currentOffset - lastOffsetY.current;

    if (currentOffset > 30) {
      if (diff > 10 && isAgentBarVisible.current) {
        // Scrolling down: Hide agent bar
        isAgentBarVisible.current = false;
        Animated.timing(agentBarHeight, {
          toValue: 0,
          duration: 180,
          useNativeDriver: false,
        }).start();
      } else if (diff < -10 && !isAgentBarVisible.current) {
        // Scrolling up: Show agent bar
        isAgentBarVisible.current = true;
        Animated.timing(agentBarHeight, {
          toValue: 58,
          duration: 180,
          useNativeDriver: false,
        }).start();
      }
    } else if (currentOffset <= 5 && !isAgentBarVisible.current) {
      isAgentBarVisible.current = true;
      Animated.timing(agentBarHeight, {
        toValue: 58,
        duration: 180,
        useNativeDriver: false,
      }).start();
    }

    lastOffsetY.current = currentOffset;
  }, [agentBarHeight]);

  React.useEffect(() => {
    const randomIdx = Math.floor(Math.random() * QUOTES.length);
    setWelcomeQuote(QUOTES[randomIdx]);

    const hour = new Date().getHours();
    if (hour < 12) setWelcomeGreeting("Good morning");
    else if (hour < 17) setWelcomeGreeting("Good afternoon");
    else setWelcomeGreeting("Good evening");

    setStreamingThread(activeThreadId || '', false);
  }, []);

  React.useEffect(() => {
    return () => {
      Object.values(abortControllersRef.current).forEach((controller) => {
        controller.abort();
      });
      // FIX-3: unmount clears ALL throttle timers AND pending token buffers.
      Object.keys(throttleTimersRef.current).forEach((key) => {
        clearInterval(throttleTimersRef.current[key]);
        delete throttleTimersRef.current[key];
      });
      Object.keys(pendingTokensMapRef.current).forEach((key) => {
        delete pendingTokensMapRef.current[key];
      });
    };
  }, []);

  // FIX-3: backgrounding mid-stream must not sustain CPU. When the app
  // leaves `active`, flush + clear every throttle interval and mark all
  // streaming threads stopped.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        const ids = new Set([
          ...Object.keys(throttleTimersRef.current),
          ...Object.keys(abortControllersRef.current),
        ]);
        ids.forEach((id) => {
          abortControllersRef.current[id]?.abort();
          delete abortControllersRef.current[id];
          cleanUpThrottleAndHeal(id);
          // Same blank-chat guard as manual Stop: never leave an aborted
          // thread with zero visible messages.
          const cur = useChatStore.getState().messages[id] || [];
          const hadEmpty = cur.length > 0 && cur[cur.length - 1]?.role === 'assistant' && !(cur[cur.length - 1]?.content || '').trim();
          useChatStore.getState().removeLastEmptyAssistant(id);
          if (hadEmpty) {
            useChatStore.getState().addMessage(id, {
              id: generateId('msg_assistant'),
              role: 'assistant',
              content: '⏹️ Stopped — app went to background. Your message is kept above. Tap Send again to retry.',
              created_at: new Date().toISOString(),
            });
          }
          setStreamingThread(id, false);
        });
      }
    });
    return () => sub.remove();
  }, [cleanUpThrottleAndHeal, setStreamingThread]);

  // #357: server mode overlays the remote agent list onto the local rows by
  // id, so locally-created agents are never dropped. Standalone (local/cloud)
  // never fetches.
  React.useEffect(() => {
    if (connectionMode !== 'server' || !apiUrl || !apiKey) return;
    let cancelled = false;
    const fetchAgents = async () => {
      try {
        const res = await fetch(`${apiUrl}/chat/personas`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;
        await overlayRemoteAgents(data);
      } catch (err) {
        console.error('[fetchAgents] Failed:', err);
      }
    };
    fetchAgents();
    return () => {
      cancelled = true;
    };
  }, [connectionMode, apiUrl, apiKey]);

  const activeMessages = useMemo(() => {
    return (activeThreadId && messages[activeThreadId]) || [];
  }, [activeThreadId, messages]);
  const lastMsg = activeMessages[activeMessages.length - 1];

  const isCurrentThreadStreaming = activeThreadId ? isThreadStreaming(activeThreadId) : false;

  // Shared skill slash-command handling for handleSend, handleSendWelcome and
  // the indicator's deactivate tap. Returns true when the input was consumed.
  // Reads thread state fresh from the store to avoid stale closures.
  const handleSkillCommand = useCallback((threadId: string, rawInput: string): boolean => {
    const skillCmd = isSkillCommand(rawInput.trim());
    if (!skillCmd) return false;

    // Record the command as a user turn so roles alternate (strict APIs
    // like Anthropic reject consecutive assistant turns).
    addMessage(threadId, {
      id: generateId('msg_user'),
      role: 'user',
      content: rawInput.trim(),
      created_at: new Date().toISOString(),
    });

    if (skillCmd.type === 'activate') {
      setThreadSkill(threadId, skillCmd.skillId);
      const meta = SKILL_METADATA[skillCmd.skillId];
      addMessage(threadId, {
        id: generateId('msg_assistant'),
        role: 'assistant',
        content: `${meta.icon} **${meta.name}** activated. ${meta.description}.\n\nType \`/stop\` to deactivate.`,
        created_at: new Date().toISOString(),
      });
    } else {
      const currentThread = useChatStore.getState().threads.find((t) => t.id === threadId);
      const wasActive = currentThread?.active_skill as SkillId | undefined;
      const meta = wasActive ? SKILL_METADATA[wasActive] : undefined;
      setThreadSkill(threadId, null);
      addMessage(threadId, {
        id: generateId('msg_assistant'),
        role: 'assistant',
        content: meta ? `${meta.icon} **${meta.name}** deactivated.` : '⏹️ No skill was active.',
        created_at: new Date().toISOString(),
      });
    }
    return true;
  }, [addMessage, setThreadSkill]);

  const activeThreadSkill = useMemo(() => {
    if (!activeThreadId) return null;
    const thread = threads.find((t) => t.id === activeThreadId);
    return (thread?.active_skill as SkillId | undefined) || null;
  }, [activeThreadId, threads]);

  const handleDeactivateSkill = useCallback(() => {
    if (!activeThreadId) return;
    // Reuses the shared helper so the /stop user turn is recorded (roles
    // alternate) and the confirmation matches the slash-command path.
    handleSkillCommand(activeThreadId, '/stop');
  }, [activeThreadId, handleSkillCommand]);

  React.useEffect(() => {
    if (!lastMsg || lastMsg.role !== 'assistant' || !activeThreadId) return;

    const regex = /<call:webview_browser\s+input="((?:[^"\\]|\\.)*)"\s*>/g;
    let match;
    let lastMatch = null;

    while ((match = regex.exec(lastMsg.content)) !== null) {
      lastMatch = match;
    }

    if (lastMatch) {
      const rawInput = lastMatch[1];
      const executionId = `${lastMsg.id}_${lastMatch.index}`;
      const lastExecutedId = useBrowserStore.getState().lastExecutedId;

      if (lastExecutedId !== executionId) {
        useBrowserStore.getState().setLastExecutedId(executionId);
        try {
          const unescapedVal = rawInput.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          const parsedInput = JSON.parse(unescapedVal);
          useBrowserStore.getState().handleWebviewAction(parsedInput);
          router.push('/browser');
        } catch (e) {
          console.error("Failed to parse webview_browser input:", e);
        }
      }
    }
  }, [lastMsg?.content, activeThreadId, router]);

  React.useEffect(() => {
    if (!lastMsg || lastMsg.role !== 'assistant' || !activeThreadId) return;

    const deviceRegex = /<call:(device_[a-z_]+)\s+input="((?:[^"\\]|\\.)*)"\s*>/g;
    let match;
    const matches: { toolName: string; rawInput: string; index: number }[] = [];

    while ((match = deviceRegex.exec(lastMsg.content)) !== null) {
      matches.push({
        toolName: match[1],
        rawInput: match[2],
        index: match.index,
      });
    }

    for (const item of matches) {
      const executionId = `${lastMsg.id}_${item.index}`;
      if (!executedDeviceToolsRef.current.has(executionId)) {
        executedDeviceToolsRef.current.add(executionId);

        (async () => {
          try {
            const unescapedVal = item.rawInput.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            const parsedInput = JSON.parse(unescapedVal);

            // Extract conversation ID and task token
            const fullConvId = parsedInput.conversation_id || '';
            const lastUnderscore = fullConvId.lastIndexOf('_');
            const conversationId = lastUnderscore !== -1 ? fullConvId.slice(0, lastUnderscore) : fullConvId;
            const taskToken = lastUnderscore !== -1 ? fullConvId.slice(lastUnderscore + 1) : undefined;

            // #158: device automation requires the accessibility service. When
            // it is missing, surface the in-app permission prompt (unless the
            // user denied it this session) instead of executing, and answer the
            // pending tool call so the agent loop is not left hanging.
            // Shizuku allowlisted ops don't touch accessibility at all — they
            // gate on Shizuku readiness inside the executor.
            if (!isShizukuTool(item.toolName)) {
              const accessibilityStatus = await checkPermission('accessibility');
              if (accessibilityStatus !== 'granted') {
                if (shouldPrompt('accessibility', sessionDeniedPermissionsRef.current)) {
                  setPermissionPrompt('accessibility');
                }
                await sendDeviceResponse(
                  conversationId,
                  taskToken,
                  'error',
                  'Blocked: the Accessibility permission is required for this action.'
                );
                return;
              }
            }

            // Run safety check
            const safetyResult = await evaluateSafety(
              item.toolName,
              parsedInput.target,
              parsedInput.value,
              parsedInput.thoughts,
              conversationId,
              taskToken
            );

            let status = safetyResult.status;
            let result = safetyResult.result;

            if (status === 'success') {
              try {
                // #308: the executor says what actually happened — an action
                // the agent could not run is an error, not a success, and its
                // observation says so instead of claiming execution.
                const action = await executeDeviceAction(
                  item.toolName,
                  parsedInput.target,
                  parsedInput.value
                );
                result = action.observation;
                if (action.outcome !== 'executed' && action.outcome !== 'simulated') {
                  status = 'error';
                }
              } catch (e: any) {
                status = 'error';
                result = `Execution exception: ${e?.message || e}`;
              }
            }

            await sendDeviceResponse(conversationId, taskToken, status, result);
          } catch (err) {
            console.error('Failed to execute safety or device action:', err);
          }
        })();
      }
    }
  }, [lastMsg?.content, activeThreadId]);

  const reversedChatItems = useMemo(() => {
    return buildChatFeedItems(activeMessages);
  }, [activeMessages]);

  const {
    handleCopyText,
    handleShareText,
    handleDownloadMd,
    handleCopyCodeBlocks,
    handleShowInfo,
  } = useMessageActions();

  const toggleRaw = useCallback((msgId: string) => {
    setShowRawMap(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  }, []);

  // Shared implementation of the local prompt compiling, token streaming, and tool execution
  const streamLocalResponse = async (threadId: string, userQuery: string, historyList: Message[]) => {
    try {
      // 1. Initialize local model if not yet loaded
      await initializeLocalModel();

      let currentHistory = [...historyList];
      let hasMoreIterations = true;
      let iterationCount = 0;
      let generatorCompleted = false;

      while (hasMoreIterations && iterationCount < 5) {
        iterationCount++;
        hasMoreIterations = false;

        const activeThread = threads.find((t) => t.id === threadId);
        const selectedAgentId = activeThread?.agent || 'personal assistant';
        const agentPrompt = resolveAgentPrompt(selectedAgentId, agents);

        // Inject active skill prompt if set (standalone mode)
        const threadSkill = activeThread?.active_skill as SkillId | undefined;
        const skillAugmented = threadSkill && SKILL_PROMPTS[threadSkill]
          ? `${agentPrompt}\n\n# Active Skill Instructions\n${SKILL_PROMPTS[threadSkill]}`
          : agentPrompt;

        // 2. Compile prompt using LLM native chat template
        const compiledPrompt = compileLocalPrompt({
          systemPrompt: skillAugmented,
          history: currentHistory,
          query: userQuery,
          compactInstructions: "Format calls as <call name=\"tool\">PARAMS</call>.",
          toolDeclarations: ["webview_browser", "consolidate", "oauth_token"],
          modelName: localModelName,
        });

        // 3. Setup throttle timer
        ensureThrottleTimer(threadId, throttleTimersRef, pendingTokensMapRef, appendToken, cleanUpThrottleAndHeal);

        // 4. Stream response from local inference engine
        // Add a safety timeout so streaming always stops even if the generator hangs
        const STREAM_TIMEOUT_MS = 120000; // 2 minutes max per iteration
        const streamStartTime = Date.now();
        generatorCompleted = false;

        const generator = streamLocalLlmResponse(compiledPrompt, (token) => {
          pendingTokensMapRef.current[threadId] = (pendingTokensMapRef.current[threadId] || '') + token;
        });

        try {
          for await (const _ of generator) {
            // Tokens are captured inside callback & throttle timer
            // Safety check: stop if we've been streaming too long
            if (Date.now() - streamStartTime > STREAM_TIMEOUT_MS) {
              console.warn('[streamLocalResponse] Stream timeout reached, forcing stop');
              break;
            }
          }
          generatorCompleted = true;
        } catch (genError: any) {
          console.warn('[streamLocalResponse] Generator error:', genError);
        }

        // Clean up throttle and apply healing
        cleanUpThrottleAndHeal(threadId);
    useChatStore.getState().removeLastEmptyAssistant(threadId);

        // Mark streaming as complete for this iteration
        setStreamingThread(threadId, false);

        // 5. Check if generated content contains tool invocation requests
        const currentMessagesSnapshot = useChatStore.getState().messages[threadId] || [];
        const lastMessageSnapshot = currentMessagesSnapshot[currentMessagesSnapshot.length - 1];

        if (lastMessageSnapshot && lastMessageSnapshot.role === 'assistant') {
          const { hasInvocations, updatedContent } = await parseAndExecuteTools(
            lastMessageSnapshot.content,
            threadId,
            apiUrl,
            apiKey
          );

          if (hasInvocations) {
            // Update local message state with response content
            const updatedHistory = [...currentMessagesSnapshot.slice(0, -1), { ...lastMessageSnapshot, content: updatedContent }];
            setHistory(threadId, updatedHistory);

            // Fetch latest history and loop back for another model reasoning pass
            currentHistory = updatedHistory;
            hasMoreIterations = true;

            // Re-enable streaming state for the next iteration
            setStreamingThread(threadId, true);
          }
        }
      }

      // Final cleanup: ensure streaming state is always set to false
      if (generatorCompleted || !hasMoreIterations) {
        setStreamingThread(threadId, false);
        cleanUpThrottleAndHeal(threadId);
    useChatStore.getState().removeLastEmptyAssistant(threadId);
      }
    } catch (e: any) {
      console.error("[Local Stream Error]:", e);
      appendToken(threadId, `\n\n⚠️ **Local Inference Error:** ${e?.message || 'Inference engine failed.'}`);
    } finally {
      // Guaranteed cleanup: always stop streaming and flush remaining tokens
      setStreamingThread(threadId, false);
      cleanUpThrottleAndHeal(threadId);
    useChatStore.getState().removeLastEmptyAssistant(threadId);
      // Ensure any remaining pending tokens are flushed
      if (pendingTokensMapRef.current[threadId]) {
        appendToken(threadId, pendingTokensMapRef.current[threadId]);
        delete pendingTokensMapRef.current[threadId];
      }
    }
  };

  const streamCloudChatResponse = async (
    threadId: string,
    historyList: Message[]
  ) => {
    const config = useConfigStore.getState();
    const provider = config.activeCloudProvider || 'gemini';
    const providerConfig = config.cloudProviders?.[provider];
    const apiKey = config.cloudApiKeys?.[provider] || '';

    const activeThread = threads.find((t) => t.id === threadId);
    const selectedAgentId = activeThread?.agent || 'personal assistant';
    const activeAgent = agents.find((candidate) => candidate.id === selectedAgentId);
    const agentPrompt = resolveAgentPrompt(selectedAgentId, agents);

    // Inject active skill prompt if set (standalone mode)
    const cloudThreadSkill = activeThread?.active_skill as SkillId | undefined;
    const cloudSkillAugmented = cloudThreadSkill && SKILL_PROMPTS[cloudThreadSkill]
      ? `${agentPrompt}\n\n# Active Skill Instructions\n${SKILL_PROMPTS[cloudThreadSkill]}`
      : agentPrompt;

    const controller = new AbortController();
    abortControllersRef.current[threadId] = controller;

    const contextMessages = buildContextMessages(historyList, { maxMessages: 30 });

    try {
      await streamCloudResponse({
        provider,
        apiKey,
        model: activeAgent?.model?.trim() || providerConfig?.model || 'gemini-1.5-flash',
        baseUrl: providerConfig?.baseUrl,
        systemPrompt: cloudSkillAugmented,
        temperature: config.temperature,
        messages: contextMessages,
        signal: controller.signal,
        onToken: (chunk) => {
          pendingTokensMapRef.current[threadId] = (pendingTokensMapRef.current[threadId] || '') + chunk;
          ensureThrottleTimer(threadId, throttleTimersRef, pendingTokensMapRef, appendToken, cleanUpThrottleAndHeal);
        },
        onDone: () => {
          setStreamingThread(threadId, false);
          delete abortControllersRef.current[threadId];
          cleanUpThrottleAndHeal(threadId);
          useChatStore.getState().removeLastEmptyAssistant(threadId);
        },
        onError: (error: any) => {
          setStreamingThread(threadId, false);
          delete abortControllersRef.current[threadId];
          cleanUpThrottleAndHeal(threadId);
          useChatStore.getState().removeLastEmptyAssistant(threadId);
          const errText = `⚠️ **[${provider.toUpperCase()} Error]** ${error?.message || 'Cloud inference failed.'}`;
          const cur = useChatStore.getState().messages[threadId] || [];
          const last = cur[cur.length - 1];
          if (last?.role === 'assistant') {
            appendToken(threadId, `\n\n${errText}`);
          } else {
            addMessage(threadId, {
              id: generateId('msg_assistant'),
              role: 'assistant',
              content: errText,
              created_at: new Date().toISOString(),
            });
          }
        },
      });
    } catch (e: any) {
      console.error('[Cloud Stream Error]:', e);
      setStreamingThread(threadId, false);
      delete abortControllersRef.current[threadId];
      cleanUpThrottleAndHeal(threadId);
      useChatStore.getState().removeLastEmptyAssistant(threadId);
      const errText = `⚠️ **[${provider.toUpperCase()} Error]** ${e?.message || 'Cloud inference failed.'}`;
      const cur = useChatStore.getState().messages[threadId] || [];
      const last = cur[cur.length - 1];
      if (last?.role === 'assistant') {
        appendToken(threadId, `\n\n${errText}`);
      } else {
        addMessage(threadId, {
          id: generateId('msg_assistant'),
          role: 'assistant',
          content: errText,
          created_at: new Date().toISOString(),
        });
      }
    }
  };

  const handleSend = useCallback(async () => {
    if (!activeThreadId) return;

    // Stop-streaming must be checked BEFORE the empty-input guard: the input is
    // cleared on send, so requiring text here would make "Stop" unreachable.
    if (isCurrentThreadStreaming) {
      Keyboard.dismiss();
      if (abortControllersRef.current[activeThreadId]) {
        abortControllersRef.current[activeThreadId].abort();
        delete abortControllersRef.current[activeThreadId];
      }
      cleanUpThrottleAndHeal(activeThreadId);
      // Blank-chat guard: abort skips onError (signal.aborted), so an empty
      // assistant placeholder would be deleted leaving a bare user msg or an
      // empty thread. Keep a visible Stopped bubble instead of blank.
      const preStop = useChatStore.getState().messages[activeThreadId] || [];
      const hadEmptyAssistant = preStop.length > 0 && preStop[preStop.length - 1]?.role === 'assistant' && !(preStop[preStop.length - 1]?.content || '').trim();
      useChatStore.getState().removeLastEmptyAssistant(activeThreadId);
      if (hadEmptyAssistant) {
        addMessage(activeThreadId, {
          id: generateId('msg_assistant'),
          role: 'assistant',
          content: '⏹️ Stopped — stream was aborted. Your message is kept above. Tap Send again to retry.',
          created_at: new Date().toISOString(),
        });
      }
      setStreamingThread(activeThreadId, false);
      return;
    }

    if (!input.trim()) return;

    // Skill slash command handling (standalone modes only)
    if (connectionMode !== 'server' && activeThreadId && handleSkillCommand(activeThreadId, input)) {
      Keyboard.dismiss();
      setInput('');
      return;
    }

    if (connectionMode === 'server' && (!apiUrl || !apiKey)) {
      Alert.alert('Configuration Required', 'Please configure API URL and Key in Settings.');
      return;
    }
    if (connectionMode === 'cloud') {
      const activeProvider = useConfigStore.getState().activeCloudProvider || 'gemini';
      const key = useConfigStore.getState().cloudApiKeys?.[activeProvider];
      if (!key) {
        Alert.alert('Configuration Required', `Please configure API key for ${activeProvider} in Settings.`);
        return;
      }
    }

    Keyboard.dismiss();

    const userText = input.trim();
    setInput('');

    const userMsgId = generateId('msg_user');
    const assistantMsgId = generateId('msg_assistant');
    const nowIso = new Date().toISOString();

    const originalHistory = messages[activeThreadId] || [];

    addMessage(activeThreadId, {
      id: userMsgId,
      role: 'user',
      content: userText,
      created_at: nowIso,
    });

    addMessage(activeThreadId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      created_at: nowIso,
    });

    setStreamingThread(activeThreadId, true);
    triggerAutoScroll();

    if (isLocalMode) {
      await streamLocalResponse(activeThreadId, userText, [...originalHistory, { id: userMsgId, role: 'user', content: userText }]);
      return;
    }

    if (connectionMode === 'cloud') {
      await streamCloudChatResponse(activeThreadId, [...originalHistory, { id: userMsgId, role: 'user', content: userText }]);
      return;
    }

    const activeThread = threads.find((t) => t.id === activeThreadId);
    const selectedAgent = activeThread?.agent || 'personal assistant';

    await runServerStream({
      apiUrl,
      apiKey,
      threadId: activeThreadId,
      prompt: userText,
      agent: selectedAgent,
      syncUserEntry: { id: userMsgId, role: 'user', content: userText, created_at: nowIso },
      threads,
      abortControllers: abortControllersRef,
      throttleTimers: throttleTimersRef,
      pendingTokens: pendingTokensMapRef,
      appendToken,
      setStreamingThread,
      setThreads,
      setAuthRequired,
      cleanUpThrottleAndHeal,
    });
  }, [
    input,
    isCurrentThreadStreaming,
    activeThreadId,
    messages,
    apiUrl,
    apiKey,
    threads,
    addMessage,
    setStreamingThread,
    appendToken,
    setThreads,
    cleanUpThrottleAndHeal,
    isLocalMode,
    connectionMode,
    triggerAutoScroll,
    handleSkillCommand,
  ]);

  const handleRegenerate = useCallback(async (message: Message) => {
    if (isCurrentThreadStreaming || !activeThreadId) return;

    const threadMsgs = messages[activeThreadId] || [];
    const index = threadMsgs.findIndex((m) => m.id === message.id);
    if (index === -1) return;

    // Find the user query preceding this assistant message
    let userPrompt = '';
    let userIndex = -1;
    for (let i = index - 1; i >= 0; i--) {
      if (threadMsgs[i].role === 'user') {
        userPrompt = threadMsgs[i].content;
        userIndex = i;
        break;
      }
    }

    if (!userPrompt) {
      Alert.alert('Error', 'No preceding query found to regenerate.');
      return;
    }

    const originalHistoryForRegen = threadMsgs.slice(0, userIndex);

    // Truncate thread history up to this assistant message
    await truncateThreadHistory(activeThreadId, message.id);

    // Add empty message for streaming
    const assistantMsgId = generateId('msg_assistant');
    addMessage(activeThreadId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    });

    setStreamingThread(activeThreadId, true);

    if (isLocalMode) {
      await streamLocalResponse(activeThreadId, userPrompt, [...originalHistoryForRegen, { id: generateId('msg_user'), role: 'user', content: userPrompt }]);
      return;
    }

    if (connectionMode === 'cloud') {
      await streamCloudChatResponse(activeThreadId, [...originalHistoryForRegen, { id: generateId('msg_user'), role: 'user', content: userPrompt }]);
      return;
    }

    // Get the active thread agent
    const regenerateAgent = threads.find((t) => t.id === activeThreadId)?.agent || 'personal assistant';

    await runServerStream({
      apiUrl,
      apiKey,
      threadId: activeThreadId,
      prompt: userPrompt,
      agent: regenerateAgent,
      syncUserEntry: {
        id: threadMsgs[userIndex]?.id || generateId('msg_user'),
        role: 'user',
        content: userPrompt,
        created_at: threadMsgs[userIndex]?.created_at,
      },
      threads,
      abortControllers: abortControllersRef,
      throttleTimers: throttleTimersRef,
      pendingTokens: pendingTokensMapRef,
      appendToken,
      setStreamingThread,
      setThreads,
      setAuthRequired,
      cleanUpThrottleAndHeal,
    });
  }, [
    isCurrentThreadStreaming,
    activeThreadId,
    messages,
    apiUrl,
    apiKey,
    threads,
    truncateThreadHistory,
    addMessage,
    setStreamingThread,
    appendToken,
    setThreads,
    cleanUpThrottleAndHeal,
    isLocalMode,
    connectionMode,
  ]);

  const handleBranch = useCallback(async (message: Message) => {
    if (isCurrentThreadStreaming || !activeThreadId) return;
    const threadMsgs = messages[activeThreadId] || [];
    const index = threadMsgs.findIndex((m) => m.id === message.id);
    if (index === -1) return;

    const newThreadId = generateUUID();
    const parentThread = threads.find((t) => t.id === activeThreadId);
    const title = `Branch of ${parentThread?.title || 'Chat'}`;

    await branchThread(activeThreadId, message.id, newThreadId, title);
  }, [
    activeThreadId,
    messages,
    isCurrentThreadStreaming,
    branchThread,
    threads
  ]);

  const handleSendWelcome = useCallback(async (textToSend: string, agentId?: string) => {
    if (!textToSend.trim()) return;

    // Skill slash commands are intercepted BEFORE the credential checks:
    // activation is local-only and must work without API URL/key configured
    // (standalone modes only — server mode still requires credentials).
    if (connectionMode !== 'server' && isSkillCommand(textToSend.trim())) {
      Keyboard.dismiss();
      const newThreadId = generateUUID();
      const agent = resolveNewThreadAgent(agentId);
      createThread('New Conversation', newThreadId, agent);
      setInput('');
      handleSkillCommand(newThreadId, textToSend);
      return;
    }

    if (connectionMode === 'server' && (!apiUrl || !apiKey)) {
      Alert.alert('Configuration Required', 'Please configure API URL and Key in Settings.');
      return;
    }
    if (connectionMode === 'cloud') {
      const activeProvider = useConfigStore.getState().activeCloudProvider || 'gemini';
      const key = useConfigStore.getState().cloudApiKeys?.[activeProvider];
      if (!key) {
        Alert.alert('Configuration Required', `Please configure API key for ${activeProvider} in Settings.`);
        return;
      }
    }

    Keyboard.dismiss();

    const newThreadId = generateUUID();
    const agent = resolveNewThreadAgent(agentId);

    createThread('New Conversation', newThreadId, agent);
    setInput('');

    const userMsgId = generateId('msg_user');
    const assistantMsgId = generateId('msg_assistant');
    const nowIso = new Date().toISOString();

    addMessage(newThreadId, {
      id: userMsgId,
      role: 'user',
      content: textToSend.trim(),
      created_at: nowIso,
    });

    addMessage(newThreadId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      created_at: nowIso,
    });

    setStreamingThread(newThreadId, true);
    triggerAutoScroll();

    if (isLocalMode) {
      await streamLocalResponse(newThreadId, textToSend.trim(), [{ id: userMsgId, role: 'user', content: textToSend.trim() }]);
      return;
    }

    if (connectionMode === 'cloud') {
      await streamCloudChatResponse(newThreadId, [{ id: userMsgId, role: 'user', content: textToSend.trim() }]);
      return;
    }

    await runServerStream({
      apiUrl,
      apiKey,
      threadId: newThreadId,
      prompt: textToSend.trim(),
      agent,
      syncUserEntry: { id: userMsgId, role: 'user', content: textToSend.trim(), created_at: nowIso },
      abortControllers: abortControllersRef,
      throttleTimers: throttleTimersRef,
      pendingTokens: pendingTokensMapRef,
      appendToken,
      setStreamingThread,
      setThreads,
      setAuthRequired,
      cleanUpThrottleAndHeal,
    });
  }, [
    apiUrl,
    apiKey,
    createThread,
    addMessage,
    appendToken,
    setStreamingThread,
    cleanUpThrottleAndHeal,
    isLocalMode,
    connectionMode,
    triggerAutoScroll,
    handleSkillCommand,
  ]);

  const handleSendPress = () => {
    // While streaming, the button acts as "Stop" — handleSend owns the abort path.
    if (activeThreadId) {
      handleSend();
      return;
    }
    if (!input.trim()) return;
    handleSendWelcome(input);
  };


  const handleToggleLocalMode = async () => {
    const nextMode = !isLocalMode;
    if (nextMode) {
      if (isLocalLlmDown) {
        Alert.alert('Local Model Down', 'The local LLM is currently down/unavailable.');
        return;
      }
      // Check if model already downloaded
      const isDownloaded = await AsyncStorage.getItem(localModelStorageKey(localModelName));
      if (isDownloaded === 'true') {
        setConnectionMode('local');
        return;
      }

      const selectedModel = LOCAL_MODELS.find(m => m.name === localModelName);
      if (!selectedModel) {
        Alert.alert('Error', 'Selected model not found.');
        return;
      }

      // Check space
      try {
        const freeBytes = await FileSystem.getFreeDiskStorageAsync();
        const freeGB = freeBytes / (1024 * 1024 * 1024);
        const sizeMatch = selectedModel.size.match(/([\d.]+)/);
        const requiredSpace = sizeMatch ? parseFloat(sizeMatch[1]) * 1.2 : 2.0;
        if (freeGB < requiredSpace) {
          Alert.alert(
            'Low Storage Space',
            `You need at least ${requiredSpace.toFixed(1)}GB of free space to download the ${localModelName} model.`
          );
          return;
        }
      } catch (err) {
        console.warn('Failed to verify free space:', err);
      }

      // Warn/Prompt about cellular if wifiOnlyDownload is active
      const downloadModel = async () => {
        setConnectionMode('local');
        try {
          const modelDir = `${FileSystem.documentDirectory}models/`;
          const modelUri = `${modelDir}${selectedModel.filename}`;

          // Ensure models directory exists
          const dirInfo = await FileSystem.getInfoAsync(modelDir);
          if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
          }

          setLocalModelDownloadProgress(0);

          const downloadResumable = FileSystem.createDownloadResumable(
            selectedModel.downloadUrl,
            modelUri,
            {},
            (downloadProgress) => {
              const progress = Math.round((downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100);
              setLocalModelDownloadProgress(progress);
            }
          );

          const result = await downloadResumable.downloadAsync();

          if (result && result.status === 200) {
            // Guard against a 200 that is actually a small HTML/JSON error body
            // (gated repos return "Invalid username or password." with 200).
            const info = await FileSystem.getInfoAsync(modelUri);
            const bytes = info.exists && 'size' in info ? (info.size as number) : 0;
            if (bytes < 10 * 1024 * 1024) {
              await FileSystem.deleteAsync(modelUri, { idempotent: true });
              throw new Error(
                `Server returned ${bytes} bytes instead of a model file. The repository may require authentication.`
              );
            }

            await AsyncStorage.setItem(localModelStorageKey(localModelName), 'true');
            await AsyncStorage.setItem(`${localModelStorageKey(localModelName)}_path`, modelUri);
            setLocalModelDownloadProgress(null);
            Alert.alert('Download Complete', `${localModelName} downloaded and ready.`);
          } else {
            throw new Error(`Download failed with status: ${result?.status ?? 'unknown'}`);
          }
        } catch (downloadError: any) {
          console.error('[handleToggleLocalMode] Download failed:', downloadError);
          setLocalModelDownloadProgress(null);
          const fallbackMode: ConnectionMode = useConfigStore.getState().cloudApiKeys?.[useConfigStore.getState().activeCloudProvider || 'gemini']
            ? 'cloud'
            : 'server';
          setConnectionMode(fallbackMode);
          Alert.alert('Download Failed', `Failed to download ${localModelName}: ${downloadError.message || 'Network error'}.`);
        }
      };

      if (wifiOnlyDownload) {
        Alert.alert(
          'Confirm Cellular Download',
          `You are on a cellular connection. Continuing will download ${selectedModel.size} (${selectedModel.filename}). Proceed?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Download', onPress: downloadModel },
          ]
        );
      } else {
        await downloadModel();
      }
    } else {
      const fallbackMode: ConnectionMode = useConfigStore.getState().cloudApiKeys?.[useConfigStore.getState().activeCloudProvider || 'gemini']
        ? 'cloud'
        : 'server';
      setConnectionMode(fallbackMode);
    }
  };

  const renderSegment = (segment: any, idx: number) => {
    const isClosed = segment.isClosed;
    const hasChildren = segment.children && segment.children.length > 0;
    const isThoughtOrIntent = segment.type === 'thought' || segment.type === 'intent';
    // #160: prefer an explicit parser-provided tier, else derive it from the
    // segment's tool name/input against the active safety policy.
    const safetyTier =
      segment.type === 'tool_call'
        ? ((segment.safetyTier as SafetyTierLabel | undefined) ?? deriveSafetyTier(segment.name, segment.input))
        : undefined;

    return (
      <CollapsibleBlock
        key={idx}
        type={segment.type}
        name={segment.name}
        input={segment.input}
        isClosed={isClosed}
        themeColors={colors}
        themeSizes={sizes}
        accentHex={accentHex}
        safetyTier={safetyTier}
        onToggle={() => {
          // #154 anchor: maintainVisibleContentPosition keeps viewport anchored on
          // height collapse/expand; no manual offset correction needed here.
        }}
      >
        {hasChildren ? (
          <View style={{ gap: 4, width: '100%' }}>
            {segment.children.map((child: any, childIdx: number) => renderSegment(child, childIdx))}
          </View>
        ) : isThoughtOrIntent ? null : (
          <Text style={[styles.rawText, { color: colors.text, fontSize: sizes.sub, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}>
            {segment.content || (segment.type === 'skill' ? '(Executing skill...)' : '(Executing...)')}
          </Text>
        )}
      </CollapsibleBlock>
    );
  };

  return (
    <LinearGradient
      colors={[colors.skyTop, colors.skyBottom]}
      style={styles.container}
    >
      <View pointerEvents="none" style={styles.auroraGlow}>
        <LinearGradient
          colors={[aurora.glow, 'transparent']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 0.6 }}
        />
      </View>
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}
      style={styles.screen}
    >
      {activeThreadId ? (
        <View style={styles.chatArea}>
          {/* Horizontal Agent Selector Bar */}
          <Animated.View style={{ height: agentBarHeight, overflow: 'hidden' }}>
            <View style={[styles.agentBar, { borderBottomColor: colors.glassBorder, backgroundColor: colors.glass }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.agentBarScroll}>
                {agents.map((p) => {
                  const isSelected = currentAgentId === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      style={[
                        styles.agentBarCell,
                        { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                        isSelected && { borderColor: aurora.acc1, backgroundColor: aurora.acc1 + '1f' }
                      ]}
                      onPress={() => {
                        setThreadAgent(activeThreadId, p.id);
                      }}
                    >
                      <Text style={[styles.agentBarText, { color: isSelected ? aurora.acc1 : colors.textMuted, fontSize: sizes.sub }]}>
                        {p.icon} {p.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Animated.View>

          {activeMessages.length === 0 ? (
            <View style={styles.emptyMessagesContainer}>
              <Text style={[styles.emptyMessagesText, { color: colors.textDark }]}>
                Send a message to start conversation with {agents.find(p => p.id === currentAgentId)?.name || 'Vela'}.
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={reversedChatItems}
              inverted
              onScroll={handleScroll}
              scrollEventThrottle={16}
              contentContainerStyle={styles.messagesList}
              keyExtractor={(item) => item.type === 'date_divider' ? item.id : item.message.id}
              removeClippedSubviews={false}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              getItemLayout={undefined}
              windowSize={5}
              maxToRenderPerBatch={5}
              updateCellsBatchingPeriod={50}
              initialNumToRender={6}
              renderItem={({ item }) => {
                if (item.type === 'date_divider') {
                  return <DateDividerPill label={item.label} colors={colors} />;
                }
                const message = item.message;
                const isUser = message.role === 'user';
                const showActionBar = activeMenuMessage?.id === message.id;

                // Hooks are illegal inside this callback (plain function, not a
                // component) — use the module-level cache instead of useMemo.
                const { segments, headerSegments, bubbleContent, sources } = getCachedParse(message.content, isUser);

                return (
                  <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
                    <View style={{ flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
                      {!isUser && headerSegments.length > 0 && (
                        <View style={styles.thoughtNestingContainer}>
                          {headerSegments.map((segment, idx) => renderSegment(segment, idx))}
                        </View>
                      )}

                      <Pressable
                        onLongPress={() => !isCurrentThreadStreaming && setActiveMenuMessage(message)}
                        style={({ pressed }) => [
                          styles.bubble,
                          isUser ? styles.userBubble : styles.assistantBubble,
                          pressed && { opacity: 0.85 },
                          !isUser && { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                          isUser && { backgroundColor: aurora.acc1, borderColor: aurora.acc2 },
                        ]}
                      >
                        {!isUser && (
                          <Text style={[styles.senderLabel, { color: aurora.acc1 }]}>
                            {isLocalMode ? 'Gemma (Local)' : (agents.find(p => p.id === currentAgentId)?.name || 'Vela')}
                          </Text>
                        )}

                        {isUser ? (
                          <Text style={[styles.messageText, { color: aurora.onAccent, fontSize: sizes.text }]}>
                            {message.content}
                          </Text>
                        ) : showRawMap[message.id] ? (
                          <Text style={[styles.rawText, { color: colors.text, fontSize: sizes.text }]}>
                            {message.content}
                          </Text>
                        ) : bubbleContent.length === 0 ? (
                          <RichText
                            content={message.content || '…'}
                            colors={colors}
                            sizes={sizes}
                            accentHex={accentHex}
                            onCopyText={handleCopyText}
                          />
                        ) : (
                          <View style={{ gap: 8 }}>
                            {bubbleContent.map((segment, idx) => {
                              if (segment.type === 'text') {
                                return (
                                  <RichText
                                    key={idx}
                                    content={segment.content || ''}
                                    colors={colors}
                                    sizes={sizes}
                                    accentHex={accentHex}
                                    onCopyText={handleCopyText}
                                  />
                                );
                              }
                              return renderSegment(segment, idx);
                            })}
                          </View>
                        )}
                        <BubbleFooter
                          createdAt={message.created_at}
                          isUser={isUser}
                          isStreaming={!isUser && isCurrentThreadStreaming && activeMessages[activeMessages.length - 1]?.id === message.id}
                          aurora={aurora}
                          colors={colors}
                        />
                      </Pressable>

                      {!isUser && (
                        (() => {
                          
                          if (sources.length === 0) return null;
                          return (
                            <View style={{ marginTop: 8, width: '100%' }}>
                              <Text style={[styles.sourcesTitleLabel, { color: colors.textMuted }]}>
                                Reference Sources
                              </Text>
                              <View style={styles.sourcesContainer}>
                                {sources.map((src, srcIdx) => (
                                  <SourceCard
                                    key={srcIdx}
                                    src={src}
                                    colors={colors}
                                    sizes={sizes}
                                    accentHex={accentHex}
                                  />
                                ))}
                              </View>
                            </View>
                          );
                        })()
                      )}
                    </View>

                    {!isUser && isCurrentThreadStreaming && activeMessages[activeMessages.length - 1]?.id === message.id && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 4 }}>
                        <ActivityIndicator size="small" color={aurora.acc1} />
                        <Text style={{ color: aurora.acc2, fontSize: sizes.sub - 1, fontWeight: 'bold' }}>
                          {isLocalMode ? 'LOCAL MODEL COMPILING...' : 'VELA COMPILING...'}
                        </Text>
                      </View>
                    )}

                    {showActionBar && (
                      <View style={styles.actionBar}>
                        <Pressable style={styles.actionBtn} onPress={() => handleCopyText(message.content)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Copy</Text>
                        </Pressable>
                {!isUser && (
                  <>
                      <Pressable style={styles.actionBtn} onPress={() => setViewerContent(message.content)}>
                      <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>View</Text>
                    </Pressable>
                      <Pressable style={styles.actionBtn} onPress={() => handleCopyCodeBlocks(message.content)}>
                              <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Code</Text>
                            </Pressable>
                            <Pressable style={styles.actionBtn} onPress={() => handleRegenerate(message)}>
                              <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Retry</Text>
                            </Pressable>
                            <Pressable style={styles.actionBtn} onPress={() => toggleRaw(message.id)}>
                              <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Raw</Text>
                            </Pressable>
                          </>
                        )}
                        <Pressable style={styles.actionBtn} onPress={() => handleBranch(message)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Branch</Text>
                        </Pressable>
                        <Pressable style={styles.actionBtn} onPress={() => handleDownloadMd(message)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Download</Text>
                        </Pressable>
                        <Pressable style={styles.actionBtn} onPress={() => handleShowInfo(message)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Info</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              }}
            />
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.welcomeScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.welcomeContainer}>
            <Text style={[styles.welcomeLogo, { color: aurora.acc1 }]}>VELA</Text>

            <Text style={[styles.welcomeTitle, { color: colors.text }]}>
              {welcomeGreeting}, {userName}
            </Text>
            <Text style={[styles.welcomeSubtitle, { color: colors.textMuted }]}>
              How can I help you research today?
            </Text>

            {/* Random Quote */}
            <View style={[styles.quoteContainer, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
              <Text style={[styles.quoteText, { color: colors.text }]}>“{welcomeQuote.text}”</Text>
              <Text style={[styles.quoteAuthor, { color: aurora.acc2 }]}>— {welcomeQuote.author}</Text>
            </View>

            {/* Suggestion Starter Cards */}
            <Text style={[styles.sectionTitleLabel, { color: colors.text, fontSize: sizes.text }]}>Suggestions</Text>
            <View style={styles.suggestionsContainer}>
              {suggestionStarters.map((item, idx) => (
                <Pressable
                  key={idx}
                  style={({ pressed }) => [
                    styles.suggestionCard,
                    { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                    pressed && { borderColor: aurora.acc1, opacity: 0.85 }
                  ]}
                  onPress={() => handleSendWelcome(item.text, item.agent)}
                >
                  <Text style={[styles.suggestionText, { color: colors.text, fontSize: sizes.text - 1 }]}>
                    <Text style={{ color: aurora.acc1, fontWeight: '700' }}>{item.label}</Text>
                    {': '}<Text style={{ color: colors.textMuted }}>"{item.text}"</Text>
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Agent Quick Selector */}
            <Text style={[styles.sectionTitleLabel, { color: colors.text, fontSize: sizes.text, marginTop: 12 }]}>
              Choose Agent
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.agentScrollContainer}>
              {agents.map((p) => {
                const isSelected = currentAgentId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [
                      styles.agentPill,
                      { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder },
                      isSelected && { backgroundColor: aurora.acc1, borderColor: aurora.acc1 },
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => setDefaultAgent(p.id)}
                  >
                    <Text style={[styles.agentPillText, { color: isSelected ? aurora.onAccent : colors.textMuted, fontSize: sizes.sub }]}>
                      {p.icon} {p.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {/* Model Mode Selector */}
      <View style={[styles.modelSwitcherContainer, { backgroundColor: colors.glass, borderTopColor: colors.glassBorder }]}>
        <Pressable
          style={[styles.switcherButton, { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' }]}
          onPress={handleToggleLocalMode}
        >
          <Text style={[styles.switcherLabel, { color: colors.text }]}>
            Engine: {connectionMode === 'local' ? `🤖 Local (${localModelName})` : connectionMode === 'cloud' ? `☁️ Cloud (${activeCloudProvider || 'gemini'})` : `🖥️ Server (${modelName || 'Gemini'})`}
          </Text>
        </Pressable>
        {localModelDownloadProgress !== null && (
          <Text style={[styles.downloadProgressText, { color: aurora.acc2 }]}>
            Downloading model: {localModelDownloadProgress}%
          </Text>
        )}
      </View>

      {/* Active skill indicator */}
      {activeThreadId && activeThreadSkill && SKILL_METADATA[activeThreadSkill] && connectionMode !== 'server' && (
        <Pressable
          style={({ pressed }) => [
            styles.skillIndicator,
            { backgroundColor: aurora.acc1 + '1A', borderColor: aurora.acc1 },
            pressed && { opacity: 0.7 }
          ]}
          onPress={handleDeactivateSkill}
          // Deactivating mid-stream would mutate thread skill state while
          // the in-flight prompt still carries the old skill instructions.
          disabled={isCurrentThreadStreaming}
          accessibilityRole="button"
          accessibilityLabel="Deactivate skill"
        >
          <Text style={[styles.skillIndicatorText, { color: aurora.acc1, fontSize: sizes.sub }]}>
            {SKILL_METADATA[activeThreadSkill].icon} {SKILL_METADATA[activeThreadSkill].name} · tap to stop
          </Text>
        </Pressable>
      )}

      {/* Unifying Input container at bottom */}
      <View
        style={[
          styles.inputContainer,
          { backgroundColor: colors.glass, borderTopColor: colors.glassBorder, paddingBottom: Math.max(12, insets.bottom) }
        ]}
      >
        <TextInput
          style={[styles.input, { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder, color: colors.text, fontSize: sizes.text }]}
          placeholder={activeThreadId ? "Ask a question or request a task..." : "Ask Vela anything..."}
          placeholderTextColor={colors.textDark}
          value={input}
          onChangeText={setInput}
          multiline
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: isCurrentThreadStreaming ? '#ef4444' : aurora.acc1, shadowColor: aurora.acc1 },
            !isCurrentThreadStreaming && !input.trim() && { backgroundColor: colors.textDark, shadowOpacity: 0 },
            pressed && { opacity: 0.8 }
          ]}
          onPress={handleSendPress}
          disabled={!isCurrentThreadStreaming && !input.trim()}
          accessibilityRole="button"
          accessibilityLabel={isCurrentThreadStreaming ? 'Stop generating' : 'Send message'}
        >
          <Text style={[styles.sendButtonText, { fontSize: sizes.text }]}>
            {isCurrentThreadStreaming ? 'Stop' : 'Send'}
          </Text>
        </Pressable>
      </View>

        <MessageOptionsModal
          visible={activeMenuMessage !== null}
          isRaw={activeMenuMessage ? !!showRawMap[activeMenuMessage.id] : false}
          onClose={() => setActiveMenuMessage(null)}
          onDownloadMd={() => activeMenuMessage && handleDownloadMd(activeMenuMessage)}
          onRegenerate={() => activeMenuMessage && handleRegenerate(activeMenuMessage)}
          onToggleRaw={() => activeMenuMessage && toggleRaw(activeMenuMessage.id)}
          onBranch={() => activeMenuMessage && handleBranch(activeMenuMessage)}
          onCopyText={() => activeMenuMessage && handleCopyText(activeMenuMessage.content)}
          onCopyCode={() => activeMenuMessage && handleCopyCodeBlocks(activeMenuMessage.content)}
          onShare={() => activeMenuMessage && handleShareText(activeMenuMessage.content)}
          onShowInfo={() => activeMenuMessage && handleShowInfo(activeMenuMessage)}
          onView={(content) => setViewerContent(content)}
          messageContent={activeMenuMessage?.content}
          themeColors={colors}
        />
        <MarkdownViewerOverlay
          visible={!!viewerContent}
          content={viewerContent || ''}
          onClose={() => setViewerContent(null)}
        />
        {/* #158: in-app permission prompt for device actions requiring
            accessibility. Denying suppresses re-prompts for the session. */}
        <Modal
          visible={permissionPrompt !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setPermissionPrompt(null)}
        >
          <View style={styles.permissionPromptOverlay}>
            <PermissionRequestCard
              permission="accessibility"
              rationale={getRationale('accessibility')}
              onGrant={async () => {
                await requestPermission('accessibility');
                setPermissionPrompt(null);
              }}
              onDeny={() => {
                sessionDeniedPermissionsRef.current.add('accessibility');
                setPermissionPrompt(null);
              }}
              onDontAskAgain={() => {
                sessionDeniedPermissionsRef.current.add('accessibility');
                setPermissionPrompt(null);
              }}
            />
          </View>
        </Modal>
    </KeyboardAvoidingView>
    </LinearGradient>
  );
}
