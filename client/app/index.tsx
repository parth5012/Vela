import React, { useState, useMemo, useCallback } from 'react';
import {
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
  Share,
  Alert,
  ScrollView,
  Animated,
  Image,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import MessageOptionsModal from '../components/ui/MessageOptionsModal';
import MarkdownViewerOverlay from '../components/ui/MarkdownViewerOverlay';
import { useConfigStore } from '../store/useConfigStore';
import { useChatStore, Message, Thread } from '../store/useChatStore';
import { useAurora } from '../hooks/useAurora';
import RichText from '../components/chat/RichText';
import { streamAgentResponse } from '../utils/sse';
import { queueMessageForSync } from '../db/chatRepository';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';
import { parseMessage, hasRenderableContent } from '../utils/messageParser';
import { parseSearchContent, SearchSource } from '../utils/sourceParser';
import { healXmlTags } from '../utils/xmlHealer';
import { useRouter } from 'expo-router';
import { useBrowserStore } from '../store/useBrowserStore';
import { useGoogleAuthStore } from '../store/useGoogleAuthStore';

// Importing local mode modules
import { initializeLocalModel, isLocalModelLoaded, streamLocalLlmResponse, isLocalLlmDown, localModelStorageKey, LOCAL_MODELS } from '../utils/localLlm';
import { compileLocalPrompt } from '../utils/promptCompiler';
import { parseAndExecuteTools } from '../utils/toolProxy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { evaluateSafety } from '../utils/safetyManager';
import { executeDeviceAction, sendDeviceResponse } from '../utils/deviceActionExecutor';

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

import { DEFAULT_PERSONAS, COMPACT_PERSONAS_INSTRUCTIONS } from '../utils/personas';

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

const generateId = (prefix: string) => {
  return prefix + '_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
};

function SourceCard({ src, colors, sizes, accentHex }: { src: SearchSource; colors: any; sizes: any; accentHex: string }) {
  const [imgError, setImgError] = React.useState(false);

  const handlePress = async () => {
    try {
      await Linking.openURL(src.url);
    } catch (error) {
      Alert.alert('Error', 'Could not open link in browser.');
    }
  };

  const getInitials = (siteName: string) => {
    return siteName ? siteName.substring(0, 2).toUpperCase() : 'W';
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.sourceCard,
        { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder },
        pressed && { opacity: 0.8 }
      ]}
      onPress={handlePress}
    >
      <View style={styles.sourceHeader}>
        {src.favicon && !imgError ? (
          <Image
            source={{ uri: src.favicon }}
            style={styles.sourceFavicon}
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[styles.sourceIconFallback, { backgroundColor: accentHex + '20' }]}>
            <Text style={[styles.sourceIconFallbackText, { color: accentHex }]}>
              {getInitials(src.siteName || src.domain)}
            </Text>
          </View>
        )}
        <Text style={[styles.sourceSiteName, { color: colors.text, fontSize: sizes.sub }]} numberOfLines={1}>
          {src.siteName || 'Web Page'}
        </Text>
      </View>
      <Text style={[styles.sourceTitle, { color: colors.textMuted, fontSize: sizes.text }]} numberOfLines={2}>
        {src.title}
      </Text>
    </Pressable>
  );
}

// Module-level parse cache (wayfinder #143 follow-up fix).
// The FlatList renderItem below is a plain callback, NOT a component, so React
// hooks (useMemo) are illegal inside it (Rules of Hooks) and crashed the chat
// on the first rendered message. This content-keyed cache preserves the
// memoization intent of #143: unchanged messages are never re-parsed during
// streaming re-renders (appendToken every 100ms), while the streaming row
// naturally misses cache as its content grows.
type ParsedSegments = ReturnType<typeof parseMessage>;
type ParsedSources = ReturnType<typeof parseSearchContent>;
interface ParsedMessageEntry {
  segments: ParsedSegments;
  headerSegments: ParsedSegments;
  bubbleContent: ParsedSegments;
  sources: ParsedSources;
}
const PARSE_CACHE_LIMIT = 256;
const parseCache = new Map<string, ParsedMessageEntry>();

function getCachedParse(content: string, isUser: boolean): ParsedMessageEntry {
  const key = (isUser ? 'u:' : 'a:') + content;
  let entry = parseCache.get(key);
  if (!entry) {
    const segments = isUser ? ([] as ParsedSegments) : parseMessage(content);
    entry = {
      segments,
      // hasRenderableContent is defense-in-depth (#150): parseMessage already
      // prunes empty closed tool_call/skill segments, but nothing empty may
      // ever reach renderSegment/CollapsibleBlock ("Executed: Tool" phantom).
      headerSegments: segments.filter(
        s => (s.type === 'thought' || s.type === 'intent') && hasRenderableContent(s)
      ),
      bubbleContent: segments.filter(
        s => s.type !== 'thought' && s.type !== 'intent' && hasRenderableContent(s)
      ),
      sources: isUser ? ([] as ParsedSources) : parseSearchContent(content),
    };
    if (parseCache.size >= PARSE_CACHE_LIMIT) {
      // Map preserves insertion order; evict the oldest entry.
      const oldest = parseCache.keys().next().value;
      if (oldest !== undefined) parseCache.delete(oldest);
    }
    parseCache.set(key, entry);
  }
  return entry;
}

export default function ChatScreen() {
  const router = useRouter();
  const executedDeviceToolsRef = React.useRef(new Set());
  const insets = useSafeAreaInsets();

  // Config State
  const apiUrl = useConfigStore((state) => state.apiUrl);
  const apiKey = useConfigStore((state) => state.apiKey);
  const modelName = useConfigStore((state) => state.modelName);
  const defaultPersona = useConfigStore((state) => state.defaultPersona);
  const userName = useConfigStore((state) => state.userName);
  const suggestionStarters = useConfigStore((state) => state.suggestionStarters);
  const userSystemPrompt = useConfigStore((state) => state.systemPrompt);

  // Local mode states
  const isLocalMode = useConfigStore((state) => state.isLocalMode);
  const localModelName = useConfigStore((state) => state.localModelName);
  const localModelDownloadProgress = useConfigStore((state) => state.localModelDownloadProgress);
  const wifiOnlyDownload = useConfigStore((state) => state.wifiOnlyDownload);
  const setIsLocalMode = useConfigStore((state) => state.setIsLocalMode);
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
  const setThreadPersona = useChatStore((state) => state.setThreadPersona);
  const createThread = useChatStore((state) => state.createThread);
  const addMessage = useChatStore((state) => state.addMessage);
  const appendToken = useChatStore((state) => state.appendToken);
  const setThreads = useChatStore((state) => state.setThreads);
  const setHistory = useChatStore((state) => state.setHistory);
  const branchThread = useChatStore((state) => state.branchThread);
  const truncateThreadHistory = useChatStore((state) => state.truncateThreadHistory);

  // Local/UI States
  const [input, setInput] = useState('');
  const [personas, setPersonas] = useState(DEFAULT_PERSONAS);
  const [selectedAgent, setSelectedAgent] = useState(defaultPersona);
  const [welcomeQuote, setWelcomeQuote] = useState(QUOTES[0]);
  const [welcomeGreeting, setWelcomeGreeting] = useState('Hello');
  const [showRawMap, setShowRawMap] = useState<Record<string, boolean>>({});
  const [activeMenuMessage, setActiveMenuMessage] = useState<Message | null>(null);
  const [authRequired, setAuthRequired] = useState<Record<string, boolean>>({});
  const [viewerContent, setViewerContent] = useState<string | null>(null);

  // Theme values — Aurora: theme = atmosphere (colors), accent = energy (aurora)
  const { colors, sizes, aurora } = useAurora();
  const accentHex = aurora.acc1;

  // Refs
  const flatListRef = React.useRef<FlatList | null>(null);
  const lastOffsetY = React.useRef(0);
  const isPersonaBarVisible = React.useRef(true);

  const triggerAutoScroll = useCallback(() => {
    if (lastOffsetY.current < 120) {
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 50);
    }
  }, []);
  const personaBarHeight = React.useRef(new Animated.Value(58)).current;

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
      delete pendingTokensMapRef.current[threadId];
    }

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
      if (diff > 10 && isPersonaBarVisible.current) {
        // Scrolling down: Hide persona bar
        isPersonaBarVisible.current = false;
        Animated.timing(personaBarHeight, {
          toValue: 0,
          duration: 180,
          useNativeDriver: false,
        }).start();
      } else if (diff < -10 && !isPersonaBarVisible.current) {
        // Scrolling up: Show persona bar
        isPersonaBarVisible.current = true;
        Animated.timing(personaBarHeight, {
          toValue: 58,
          duration: 180,
          useNativeDriver: false,
        }).start();
      }
    } else if (currentOffset <= 5 && !isPersonaBarVisible.current) {
      isPersonaBarVisible.current = true;
      Animated.timing(personaBarHeight, {
        toValue: 58,
        duration: 180,
        useNativeDriver: false,
      }).start();
    }

    lastOffsetY.current = currentOffset;
  }, [personaBarHeight]);

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
      Object.values(throttleTimersRef.current).forEach((timer) => {
        clearInterval(timer);
      });
    };
  }, []);

  React.useEffect(() => {
    if (apiUrl && apiKey) {
      const fetchPersonas = async () => {
        try {
          const res = await fetch(`${apiUrl}/chat/personas`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (res.ok) {
            const data = await res.json();
            const mapped = data.map((p: any) => {
              let icon = '🤖';
              if (p.id === 'teacher') icon = '👩🏫';
              else if (p.id === 'analyst') icon = '📊';
              else if (p.id === 'prompt builder') icon = '✍️';
              return { ...p, icon };
            });
            setPersonas(mapped);
          }
        } catch (err) {
          console.error('[fetchPersonas] Failed:', err);
        }
      };
      fetchPersonas();
    }
  }, [apiUrl, apiKey]);

  const activeMessages = (activeThreadId && messages[activeThreadId]) || [];
  const lastMsg = activeMessages[activeMessages.length - 1];

  const isCurrentThreadStreaming = activeThreadId ? isThreadStreaming(activeThreadId) : false;

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
                result = await executeDeviceAction(item.toolName, parsedInput.target, parsedInput.value);
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

  const reversedMessages = useMemo(() => {
    return [...activeMessages].reverse();
  }, [activeMessages]);

  const handleCopyText = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Success', 'Copied to clipboard');
  }, []);

  const handleShareText = useCallback(async (text: string) => {
    try {
      await Share.share({ message: text });
    } catch (err: any) {
      console.error(err);
    }
  }, []);

  const handleDownloadMd = useCallback(async (message: Message) => {
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `vela-response-${message.id}-${dateStr}.md`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      const mdContent = `# Vela Agent Response\n*Date: ${new Date().toLocaleString()}*\n\n${message.content}`;

      await FileSystem.writeAsStringAsync(fileUri, mdContent, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri, { mimeType: 'text/markdown', dialogTitle: 'Download Response' });
    } catch (err: any) {
      Alert.alert('Error', 'Failed to save markdown file.');
    }
  }, []);

  const handleCopyCodeBlocks = useCallback(async (text: string) => {
    const codeBlockRegex = /```[\s\S]*?```/g;
    const matches = text.match(codeBlockRegex);
    if (!matches || matches.length === 0) {
      Alert.alert('Info', 'No code blocks found in message.');
      return;
    }

    const cleanedCodes = matches.map((m) => {
      return m.replace(/^```[a-zA-Z0-9+#-]*\n/, '').replace(/```$/, '');
    }).join('\n\n---\n\n');

    await Clipboard.setStringAsync(cleanedCodes);
    Alert.alert('Success', 'Copied code blocks to clipboard.');
  }, []);

  const handleShowInfo = useCallback((message: Message) => {
    const wordCount = message.content.trim().split(/\s+/).filter(Boolean).length;
    const charCount = message.content.length;
    Alert.alert(
      'Response Metadata',
      `Model: ${isLocalMode ? `Local (${localModelName})` : (modelName || 'gemini-1.5-flash')}\nWords: ${wordCount}\nCharacters: ${charCount}`
    );
  }, [modelName, isLocalMode, localModelName]);

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
        const selectedAgentId = activeThread?.persona || 'personal assistant';
        const activePersona = personas.find((p) => p.id === selectedAgentId);

        let personaPrompt = activePersona?.compact_prompt_instructions || activePersona?.compactPromptInstructions;
        if (!personaPrompt) {
          personaPrompt = COMPACT_PERSONAS_INSTRUCTIONS[selectedAgentId] || '';
        }

        const systemPromptCombined = userSystemPrompt && userSystemPrompt !== 'You autonomous research agent.'
          ? `${userSystemPrompt}\n\n${personaPrompt}`
          : (personaPrompt || userSystemPrompt);

        // 2. Compile prompt using LLM native chat template
        const compiledPrompt = compileLocalPrompt({
          systemPrompt: systemPromptCombined,
          history: currentHistory,
          query: userQuery,
          compactInstructions: "Format calls as <call name=\"tool\">PARAMS</call>.",
          toolDeclarations: ["webview_browser", "consolidate", "oauth_token"],
          modelName: localModelName,
        });

        // 3. Setup throttle timer
        if (!throttleTimersRef.current[threadId]) {
          throttleTimersRef.current[threadId] = setInterval(() => {
            if (pendingTokensMapRef.current[threadId]) {
              appendToken(threadId, pendingTokensMapRef.current[threadId]);
              pendingTokensMapRef.current[threadId] = '';
            }
          }, 100);
        }

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
    useChatStore.getState().removeLastEmptyAssistant(activeThreadId);
      setStreamingThread(activeThreadId, false);
      return;
    }

    if (!input.trim()) return;
    if (!isLocalMode && (!apiUrl || !apiKey)) {
      Alert.alert('Configuration Required', 'Please configure API URL and Key in Settings.');
      return;
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

    const activeThread = threads.find((t) => t.id === activeThreadId);
    const selectedAgent = activeThread?.persona || 'personal assistant';

    const controller = new AbortController();
    abortControllersRef.current[activeThreadId] = controller;

    try {
      await streamAgentResponse(
        apiUrl,
        apiKey,
        activeThreadId,
        userText,
        (chunk) => {
          pendingTokensMapRef.current[activeThreadId] = (pendingTokensMapRef.current[activeThreadId] || '') + chunk;
          if (!throttleTimersRef.current[activeThreadId]) {
            throttleTimersRef.current[activeThreadId] = setInterval(() => {
              if (pendingTokensMapRef.current[activeThreadId]) {
                appendToken(activeThreadId, pendingTokensMapRef.current[activeThreadId]);
                pendingTokensMapRef.current[activeThreadId] = '';
              }
            }, 100);
          }
        },
        (newTitle) => {
          setStreamingThread(activeThreadId, false);
          delete abortControllersRef.current[activeThreadId];
          cleanUpThrottleAndHeal(activeThreadId);
    useChatStore.getState().removeLastEmptyAssistant(activeThreadId);
          if (newTitle) {
            const updatedThreads = threads.map((t) => {
              if (t.id === activeThreadId) {
                return { ...t, title: newTitle };
              }
              return t;
            });
            setThreads(updatedThreads);
            useChatStore.getState().renameThread(activeThreadId, newTitle);
          }
        },
        (error) => {
          setStreamingThread(activeThreadId, false);
          delete abortControllersRef.current[activeThreadId];
          cleanUpThrottleAndHeal(activeThreadId);
    useChatStore.getState().removeLastEmptyAssistant(activeThreadId);
          const errMsg = error?.message || (typeof error === 'string' ? error : '') || 'Failed to stream response.';
          appendToken(activeThreadId, `\n\n⚠️ **Error:** ${errMsg}`);
          queueMessageForSync(activeThreadId, {
            id: userMsgId,
            role: 'user',
            content: userText,
            created_at: nowIso,
          }).catch(() => {});
        },
        controller.signal,
        selectedAgent,
        (provider) => {
          if (provider === 'google' && activeThreadId) {
            setAuthRequired((prev) => ({ ...prev, [activeThreadId]: true }));
          }
        }
      );
    } catch (err: any) {
      setStreamingThread(activeThreadId, false);
      cleanUpThrottleAndHeal(activeThreadId);
    useChatStore.getState().removeLastEmptyAssistant(activeThreadId);
      appendToken(activeThreadId, `\n\n⚠️ **Network Error:** ${err.message || 'Verification aborted.'}`);
      queueMessageForSync(activeThreadId, {
        id: userMsgId,
        role: 'user',
        content: userText,
        created_at: nowIso,
      }).catch(() => {});
    }
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
    triggerAutoScroll,
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
    });

    setStreamingThread(activeThreadId, true);

    if (isLocalMode) {
      await streamLocalResponse(activeThreadId, userPrompt, [...originalHistoryForRegen, { id: generateId('msg_user'), role: 'user', content: userPrompt }]);
      return;
    }

    const controller = new AbortController();
    abortControllersRef.current[activeThreadId] = controller;

    // Get agent/persona for the thread
    const regenerateAgent = threads.find((t) => t.id === activeThreadId)?.persona || 'personal assistant';

    try {
      await streamAgentResponse(
        apiUrl,
        apiKey,
        activeThreadId,
        userPrompt,
        (chunk) => {
          pendingTokensMapRef.current[activeThreadId] = (pendingTokensMapRef.current[activeThreadId] || '') + chunk;
          if (!throttleTimersRef.current[activeThreadId]) {
            throttleTimersRef.current[activeThreadId] = setInterval(() => {
              if (pendingTokensMapRef.current[activeThreadId]) {
                appendToken(activeThreadId, pendingTokensMapRef.current[activeThreadId]);
                pendingTokensMapRef.current[activeThreadId] = '';
              }
            }, 100);
          }
        },
        (newTitle) => {
          setStreamingThread(activeThreadId, false);
          delete abortControllersRef.current[activeThreadId];
          cleanUpThrottleAndHeal(activeThreadId);
    useChatStore.getState().removeLastEmptyAssistant(activeThreadId);
          if (newTitle) {
            const updatedThreads = threads.map((t) => {
              if (t.id === activeThreadId) {
                return { ...t, title: newTitle };
              }
              return t;
            });
            setThreads(updatedThreads);
            useChatStore.getState().renameThread(activeThreadId, newTitle);
          }
        },
        (error) => {
          setStreamingThread(activeThreadId, false);
          delete abortControllersRef.current[activeThreadId];
          cleanUpThrottleAndHeal(activeThreadId);
    useChatStore.getState().removeLastEmptyAssistant(activeThreadId);
          const errMsg = error?.message || (typeof error === 'string' ? error : '') || 'Failed to stream response.';
          appendToken(activeThreadId, `\n\n⚠️ **Error:** ${errMsg}`);
          queueMessageForSync(activeThreadId, {
            id: threadMsgs[userIndex]?.id || generateId('msg_user'),
            role: 'user',
            content: userPrompt,
            created_at: threadMsgs[userIndex]?.created_at,
          }).catch(() => {});
        },
        controller.signal,
        regenerateAgent,
        (provider) => {
          if (provider === 'google' && activeThreadId) {
            setAuthRequired((prev) => ({ ...prev, [activeThreadId]: true }));
          }
        }
      );
    } catch (err: any) {
      setStreamingThread(activeThreadId, false);
      cleanUpThrottleAndHeal(activeThreadId);
    useChatStore.getState().removeLastEmptyAssistant(activeThreadId);
      appendToken(activeThreadId, `\n\n⚠️ **Network Error:** ${err.message || 'Verification aborted.'}`);
      queueMessageForSync(activeThreadId, {
        id: threadMsgs[userIndex]?.id || generateId('msg_user'),
        role: 'user',
        content: userPrompt,
        created_at: threadMsgs[userIndex]?.created_at,
      }).catch(() => {});
    }
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

  const handleSendWelcome = useCallback(async (textToSend: string, personaId?: string) => {
    if (!textToSend.trim()) return;
    if (!isLocalMode && (!apiUrl || !apiKey)) {
      Alert.alert('Configuration Required', 'Please configure API URL and Key in Settings.');
      return;
    }

    Keyboard.dismiss();

    const newThreadId = generateUUID();
    const agent = personaId || selectedAgent;

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

    const controller = new AbortController();
    abortControllersRef.current[newThreadId] = controller;

    try {
      await streamAgentResponse(
        apiUrl,
        apiKey,
        newThreadId,
        textToSend.trim(),
        (chunk) => {
          pendingTokensMapRef.current[newThreadId] = (pendingTokensMapRef.current[newThreadId] || '') + chunk;
          if (!throttleTimersRef.current[newThreadId]) {
            throttleTimersRef.current[newThreadId] = setInterval(() => {
              if (pendingTokensMapRef.current[newThreadId]) {
                appendToken(newThreadId, pendingTokensMapRef.current[newThreadId]);
                pendingTokensMapRef.current[newThreadId] = '';
              }
            }, 100);
          }
        },
        (newTitle) => {
          setStreamingThread(newThreadId, false);
          delete abortControllersRef.current[newThreadId];
          cleanUpThrottleAndHeal(newThreadId);
    useChatStore.getState().removeLastEmptyAssistant(newThreadId);
          if (newTitle) {
            useChatStore.getState().renameThread(newThreadId, newTitle);
          }
        },
        (error) => {
          setStreamingThread(newThreadId, false);
          delete abortControllersRef.current[newThreadId];
          cleanUpThrottleAndHeal(newThreadId);
    useChatStore.getState().removeLastEmptyAssistant(newThreadId);
          const errMsg = error?.message || (typeof error === 'string' ? error : '') || 'Failed to stream response.';
          appendToken(newThreadId, `\n\n⚠️ **Error:** ${errMsg}`);
          queueMessageForSync(newThreadId, {
            id: userMsgId,
            role: 'user',
            content: textToSend.trim(),
            created_at: nowIso,
          }).catch(() => {});
        },
        controller.signal,
        agent,
        (provider) => {
          if (provider === 'google') {
            setAuthRequired((prev) => ({ ...prev, [newThreadId]: true }));
          }
        }
      );
    } catch (err: any) {
      setStreamingThread(newThreadId, false);
      cleanUpThrottleAndHeal(newThreadId);
    useChatStore.getState().removeLastEmptyAssistant(newThreadId);
      appendToken(newThreadId, `\n\n⚠️ **Network Error:** ${err.message || 'Verification aborted.'}`);
      queueMessageForSync(newThreadId, {
        id: userMsgId,
        role: 'user',
        content: textToSend.trim(),
        created_at: nowIso,
      }).catch(() => {});
    }
  }, [
    apiUrl,
    apiKey,
    selectedAgent,
    createThread,
    addMessage,
    appendToken,
    setStreamingThread,
    cleanUpThrottleAndHeal,
    isLocalMode,
    triggerAutoScroll,
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
        setIsLocalMode(true);
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
        setIsLocalMode(true);
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
          setIsLocalMode(false);
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
      setIsLocalMode(false);
    }
  };

  const renderSegment = (segment: any, idx: number) => {
    const isClosed = segment.isClosed;
    const hasChildren = segment.children && segment.children.length > 0;
    const isThoughtOrIntent = segment.type === 'thought' || segment.type === 'intent';

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
          {/* Horizontal Persona Selector Bar */}
          <Animated.View style={{ height: personaBarHeight, overflow: 'hidden' }}>
            <View style={[styles.personaBar, { borderBottomColor: colors.glassBorder, backgroundColor: colors.glass }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.personaBarScroll}>
                {personas.map((p) => {
                  const isSelected = selectedAgent === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      style={[
                        styles.personaBarCell,
                        { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                        isSelected && { borderColor: aurora.acc1, backgroundColor: aurora.acc1 + '1f' }
                      ]}
                      onPress={() => {
                        setSelectedAgent(p.id);
                        setThreadPersona(activeThreadId, p.id);
                      }}
                    >
                      <Text style={[styles.personaBarText, { color: isSelected ? aurora.acc1 : colors.textMuted, fontSize: sizes.sub }]}>
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
                Send a message to start conversation with {personas.find(p => p.id === selectedAgent)?.name || 'Vela'}.
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={reversedMessages}
              inverted
              onScroll={handleScroll}
              scrollEventThrottle={16}
              contentContainerStyle={styles.messagesList}
              keyExtractor={(item) => item.id}
              removeClippedSubviews={false}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              windowSize={11}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={50}
              initialNumToRender={15}
              renderItem={({ item }) => {
                const isUser = item.role === 'user';
                const showActionBar = activeMenuMessage?.id === item.id;

                // Hooks are illegal inside this callback (plain function, not a
                // component) — use the module-level cache instead of useMemo.
                const { segments, headerSegments, bubbleContent, sources } = getCachedParse(item.content, isUser);

                return (
                  <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
                    <View style={{ flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
                      {!isUser && headerSegments.length > 0 && (
                        <View style={styles.thoughtNestingContainer}>
                          {headerSegments.map((segment, idx) => renderSegment(segment, idx))}
                        </View>
                      )}

                      <Pressable
                        onLongPress={() => !isCurrentThreadStreaming && setActiveMenuMessage(item)}
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
                            {isLocalMode ? 'Gemma (Local)' : (personas.find(p => p.id === selectedAgent)?.name || 'Vela')}
                          </Text>
                        )}

                        {isUser ? (
                          <Text style={[styles.messageText, { color: aurora.onAccent, fontSize: sizes.text }]}>
                            {item.content}
                          </Text>
                        ) : showRawMap[item.id] ? (
                          <Text style={[styles.rawText, { color: colors.text, fontSize: sizes.text }]}>
                            {item.content}
                          </Text>
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

                    {!isUser && isCurrentThreadStreaming && activeMessages[activeMessages.length - 1]?.id === item.id && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 4 }}>
                        <ActivityIndicator size="small" color={aurora.acc1} />
                        <Text style={{ color: aurora.acc2, fontSize: sizes.sub - 1, fontWeight: 'bold' }}>
                          {isLocalMode ? 'LOCAL MODEL COMPILING...' : 'VELA COMPILING...'}
                        </Text>
                      </View>
                    )}

                    {showActionBar && (
                      <View style={styles.actionBar}>
                        <Pressable style={styles.actionBtn} onPress={() => handleCopyText(item.content)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Copy</Text>
                        </Pressable>
                        {!isUser && (
                          <>
                            <Pressable style={styles.actionBtn} onPress={() => handleCopyCodeBlocks(item.content)}>
                              <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Code</Text>
                            </Pressable>
                            <Pressable style={styles.actionBtn} onPress={() => handleRegenerate(item)}>
                              <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Retry</Text>
                            </Pressable>
                            <Pressable style={styles.actionBtn} onPress={() => toggleRaw(item.id)}>
                              <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Raw</Text>
                            </Pressable>
                          </>
                        )}
                        <Pressable style={styles.actionBtn} onPress={() => handleBranch(item)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Branch</Text>
                        </Pressable>
                        <Pressable style={styles.actionBtn} onPress={() => handleDownloadMd(item)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Download</Text>
                        </Pressable>
                        <Pressable style={styles.actionBtn} onPress={() => handleShowInfo(item)}>
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
                  onPress={() => handleSendWelcome(item.text, item.persona)}
                >
                  <Text style={[styles.suggestionText, { color: colors.text, fontSize: sizes.text - 1 }]}>
                    <Text style={{ color: aurora.acc1, fontWeight: '700' }}>{item.label}</Text>
                    {': '}<Text style={{ color: colors.textMuted }}>"{item.text}"</Text>
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Persona Quick Selector */}
            <Text style={[styles.sectionTitleLabel, { color: colors.text, fontSize: sizes.text, marginTop: 12 }]}>
              Choose Persona
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.personaScrollContainer}>
              {personas.map((p) => {
                const isSelected = selectedAgent === p.id;
                return (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [
                      styles.personaPill,
                      { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder },
                      isSelected && { backgroundColor: aurora.acc1, borderColor: aurora.acc1 },
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => setSelectedAgent(p.id)}
                  >
                    <Text style={[styles.personaPillText, { color: isSelected ? aurora.onAccent : colors.textMuted, fontSize: sizes.sub }]}>
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
            Engine: {isLocalMode ? `🤖 Local (${localModelName})` : `☁️ Cloud (${modelName || 'Gemini'})`}
          </Text>
        </Pressable>
        {localModelDownloadProgress !== null && (
          <Text style={[styles.downloadProgressText, { color: aurora.acc2 }]}>
            Downloading model: {localModelDownloadProgress}%
          </Text>
        )}
      </View>

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
    </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  auroraGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  chatArea: {
    flex: 1,
  },
  personaBar: {
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  personaBarScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  personaBarCell: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  personaBarText: {
    fontWeight: '500',
  },
  emptyMessagesContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyMessagesText: {
    textAlign: 'center',
    lineHeight: 20,
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageRow: {
    marginVertical: 6,
    width: '100%',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    maxWidth: '85%',
  },
  userBubble: {
    borderTopRightRadius: 4,
  },
  assistantBubble: {
    borderTopLeftRadius: 4,
  },
  senderLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  messageText: {
    lineHeight: 20,
  },
  rawText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 18,
  },
  thoughtNestingContainer: {
    width: '100%',
    marginBottom: 6,
  },
  sourcesTitleLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  sourcesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 4,
  },
  sourceCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    width: 140,
  },
  sourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  sourceFavicon: {
    width: 14,
    height: 14,
    borderRadius: 2,
  },
  sourceIconFallback: {
    width: 14,
    height: 14,
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourceIconFallbackText: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  sourceSiteName: {
    flex: 1,
    fontWeight: '600',
  },
  sourceTitle: {
    fontWeight: '500',
  },
  actionBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  actionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.13)',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  actionBtnText: {
    fontSize: 11,
  },
  welcomeScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 32,
  },
  welcomeContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  welcomeLogo: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 8,
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  quoteContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
  },
  quoteText: {
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  quoteAuthor: {
    fontSize: 12,
    textAlign: 'right',
    fontWeight: '500',
  },
  sectionTitleLabel: {
    alignSelf: 'flex-start',
    fontWeight: 'bold',
    marginBottom: 12,
  },
  suggestionsContainer: {
    width: '100%',
    gap: 8,
    marginBottom: 16,
  },
  suggestionCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  suggestionText: {
    lineHeight: 18,
  },
  personaScrollContainer: {
    gap: 8,
    paddingVertical: 4,
  },
  personaPill: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  personaPillText: {
    fontWeight: '600',
  },
  modelSwitcherContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
  },
  switcherButton: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  switcherLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  downloadProgressText: {
    fontSize: 12,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderTopWidth: 1,
    gap: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxHeight: 100,
  },
  sendButton: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
});
