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
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import MessageOptionsModal from '../components/ui/MessageOptionsModal';
import { useConfigStore } from '../store/useConfigStore';
import { useChatStore, Message, Thread } from '../store/useChatStore';
import { THEME_COLORS, FONT_SIZES, ACCENT_COLORS } from '../utils/theme';
import RichText from '../components/chat/RichText';
import { streamAgentResponse } from '../utils/sse';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';
import { parseMessage } from '../utils/messageParser';
import { parseSearchContent, SearchSource } from '../utils/sourceParser';
import { healXmlTags } from '../utils/xmlHealer';
import { useRouter } from 'expo-router';
import { useBrowserStore } from '../store/useBrowserStore';
import { useGoogleAuthStore } from '../store/useGoogleAuthStore';

// Importing local mode modules
import { initializeLocalModel, isLocalModelLoaded, streamLocalLlmResponse } from '../utils/localLlm';
import { compileLocalPrompt } from '../utils/promptCompiler';
import { parseAndExecuteTools } from '../utils/toolProxy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const DEFAULT_PERSONAS = [
  { id: 'personal assistant', name: 'Personal Assistant', description: 'Warm, approachable, direct general assistant.', icon: '🤖' },
  { id: 'teacher', name: 'Teacher', description: 'Patient, educational instructor helper details examples.', icon: '👩🏫' },
  { id: 'analyst', name: 'Analyst', description: 'Structured, logical, data-driven analyst focusing facts risk assessment.', icon: '📊' },
  { id: 'prompt builder', name: 'Prompt Builder', description: 'Specialized assistant designed help craft, structure, refine agent prompts.', icon: '✍️' }
];

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
        { backgroundColor: colors.card, borderColor: colors.border },
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
              {getInitials(src.siteName)}
            </Text>
          </View>
        )}
        <Text style={[styles.sourceSiteName, { color: colors.text, fontSize: sizes.sub }]} numberOfLines={1}>
          {src.siteName || 'Web Page'}
        </Text>
      </View>
      <Text style={[styles.sourceTitle, { color: colors.text, fontSize: sizes.text }]} numberOfLines={2}>
        {src.title}
      </Text>
    </Pressable>
  );
}

export default function ChatScreen() {
  const router = useRouter();

  // Config State
  const apiUrl = useConfigStore((state) => state.apiUrl);
  const apiKey = useConfigStore((state) => state.apiKey);
  const theme = useConfigStore((state) => state.theme);
  const fontSize = useConfigStore((state) => state.fontSize);
  const accentColor = useConfigStore((state) => state.accentColor);
  const modelName = useConfigStore((state) => state.modelName);
  const defaultPersona = useConfigStore((state) => state.defaultPersona);
  const userName = useConfigStore((state) => state.userName);
  const suggestionStarters = useConfigStore((state) => state.suggestionStarters);
  const userSystemPrompt = useConfigStore((state) => state.systemPrompt);

  // Local mode states
  const isLocalMode = useConfigStore((state) => state.isLocalMode);
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

  // Theme values
  const colors = THEME_COLORS[theme] || THEME_COLORS.deep;
  const sizes = FONT_SIZES[fontSize] || FONT_SIZES.medium;
  const accentHex = ACCENT_COLORS[accentColor] || ACCENT_COLORS.indigo;

  // Refs
  const flatListRef = React.useRef<FlatList | null>(null);
  const lastOffsetY = React.useRef(0);
  const isPersonaBarVisible = React.useRef(true);
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
      `Model: ${isLocalMode ? 'Gemma-2B (Local)' : (modelName || 'gemini-1.5-flash')}\nWords: ${wordCount}\nCharacters: ${charCount}`
    );
  }, [modelName, isLocalMode]);

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

      while (hasMoreIterations && iterationCount < 5) {
        iterationCount++;
        hasMoreIterations = false;

        // 2. Compile prompt using XML schema
        const compiledPrompt = compileLocalPrompt({
          systemPrompt: userSystemPrompt,
          history: currentHistory,
          query: userQuery,
          compactInstructions: "Format calls as <call name=\"tool\">PARAMS</call>.",
          toolDeclarations: ["webview_browser", "consolidate", "oauth_token"]
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
        const generator = streamLocalLlmResponse(compiledPrompt, (token) => {
          pendingTokensMapRef.current[threadId] = (pendingTokensMapRef.current[threadId] || '') + token;
        });

        for await (const _ of generator) {
          // Tokens are captured inside callback & throttle timer
        }

        // Clean up throttle and apply healing
        cleanUpThrottleAndHeal(threadId);

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
          }
        }
      }
    } catch (e: any) {
      console.error("[Local Stream Error]:", e);
      appendToken(threadId, `\n\n⚠️ **Local Inference Error:** ${e?.message || 'Inference engine failed.'}`);
    } finally {
      setStreamingThread(threadId, false);
      cleanUpThrottleAndHeal(threadId);
    }
  };

  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeThreadId) return;
    if (!isLocalMode && (!apiUrl || !apiKey)) {
      Alert.alert('Configuration Required', 'Please configure API URL and Key in Settings.');
      return;
    }

    Keyboard.dismiss();

    if (isCurrentThreadStreaming) {
      if (abortControllersRef.current[activeThreadId]) {
        abortControllersRef.current[activeThreadId].abort();
        delete abortControllersRef.current[activeThreadId];
      }
      cleanUpThrottleAndHeal(activeThreadId);
      setStreamingThread(activeThreadId, false);
      return;
    }

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
          const errMsg = error?.message || (typeof error === 'string' ? error : '') || 'Failed to stream response.';
          appendToken(activeThreadId, `\n\n⚠️ **Error:** ${errMsg}`);
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
      appendToken(activeThreadId, `\n\n⚠️ **Network Error:** ${err.message || 'Verification aborted.'}`);
    }
  }, [
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
          const errMsg = error?.message || (typeof error === 'string' ? error : '') || 'Failed to stream response.';
          appendToken(activeThreadId, `\n\n⚠️ **Error:** ${errMsg}`);
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
      appendToken(activeThreadId, `\n\n⚠️ **Network Error:** ${err.message || 'Verification aborted.'}`);
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
          if (newTitle) {
            useChatStore.getState().renameThread(newThreadId, newTitle);
          }
        },
        (error) => {
          setStreamingThread(newThreadId, false);
          delete abortControllersRef.current[newThreadId];
          cleanUpThrottleAndHeal(newThreadId);
          const errMsg = error?.message || (typeof error === 'string' ? error : '') || 'Failed to stream response.';
          appendToken(newThreadId, `\n\n⚠️ **Error:** ${errMsg}`);
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
      appendToken(newThreadId, `\n\n⚠️ **Network Error:** ${err.message || 'Verification aborted.'}`);
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
  ]);

  const handleSendPress = () => {
    if (activeThreadId) {
      handleSend();
    } else {
      handleSendWelcome(input);
    }
  };

  const handleToggleLocalMode = async () => {
    const nextMode = !isLocalMode;
    if (nextMode) {
      // Check if model already downloaded
      const isDownloaded = await AsyncStorage.getItem('local_model_downloaded');
      if (isDownloaded === 'true') {
        setIsLocalMode(true);
        return;
      }

      // Check space
      try {
        const freeBytes = await FileSystem.getFreeDiskStorageAsync();
        const freeGB = freeBytes / (1024 * 1024 * 1024);
        if (freeGB < 2.0) {
          Alert.alert('Low StorageSpace', 'You need at least 2.0GB of free space to download the Gemma model.');
          return;
        }
      } catch (err) {
        console.warn('Failed to verify free space:', err);
      }

      // Warn/Prompt about cellular if wifiOnlyDownload is active
      const downloadModel = async () => {
        setIsLocalMode(true);
        // Start simulated download progress
        setLocalModelDownloadProgress(1);
        for (let i = 2; i <= 100; i += 2) {
          await new Promise(resolve => setTimeout(resolve, 40));
          setLocalModelDownloadProgress(i);
        }
        await AsyncStorage.setItem('local_model_downloaded', 'true');
        setLocalModelDownloadProgress(null);
        Alert.alert('Download Complete', 'Local LLM model downloaded and ready.');
      };

      if (wifiOnlyDownload) {
        Alert.alert(
          'Confirm Cellular Download',
          'You are on a cellular connection. Continuing will download 1.6GB. Proceed?',
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
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {activeThreadId ? (
        <View style={styles.chatArea}>
          {/* Horizontal Persona Selector Bar */}
          <Animated.View style={{ height: personaBarHeight, overflow: 'hidden' }}>
            <View style={[styles.personaBar, { borderBottomColor: colors.border, backgroundColor: colors.background, height: '100%', justifyContent: 'center' }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.personaBarScroll}>
                {personas.map((p) => {
                  const isSelected = selectedAgent === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      style={[
                        styles.personaBarCell,
                        { borderColor: colors.border, backgroundColor: colors.card },
                        isSelected && { borderColor: accentHex, backgroundColor: accentHex + '15' }
                      ]}
                      onPress={() => {
                        setSelectedAgent(p.id);
                        setThreadPersona(activeThreadId, p.id);
                      }}
                    >
                      <Text style={[styles.personaBarText, { color: isSelected ? accentHex : colors.textMuted, fontSize: sizes.sub }]}>
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
              renderItem={({ item }) => {
                const isUser = item.role === 'user';
                const showActionBar = activeMenuMessage?.id === item.id;

                const segments = isUser ? [] : parseMessage(item.content);
                const headerSegments = segments.filter(s => s.type === 'thought' || s.type === 'intent');
                const bubbleContent = segments.filter(s => s.type !== 'thought' && s.type !== 'intent');

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
                        style={[
                          styles.bubble,
                          isUser ? styles.userBubble : styles.assistantBubble,
                          !isUser && { backgroundColor: colors.bubbleBack || 'rgba(99, 102, 241, 0.03)' }
                        ]}
                      >
                        {!isUser && (
                          <Text style={[styles.senderLabel, { color: colors.textDark }]}>
                            {isLocalMode ? 'Gemma (Local)' : (personas.find(p => p.id === selectedAgent)?.name || 'Vela')}
                          </Text>
                        )}

                        {isUser ? (
                          <Text style={[styles.messageText, { color: colors.text, fontSize: sizes.text }]}>
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
                                    content={segment.content}
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
                          const sources = parseSearchContent(item.content);
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
                        <ActivityIndicator size="small" color={accentHex} />
                        <Text style={{ color: colors.textDark, fontSize: sizes.sub - 1, fontWeight: 'bold' }}>
                          {isLocalMode ? 'LOCAL MODEL COMPILING...' : 'VELA COMPILING...'}
                        </Text>
                      </View>
                    )}

                    {showActionBar && (
                      <View style={styles.actionBar}>
                        <Pressable style={styles.actionBtn} onPress={() => handleCopyText(item.content)}>
                          <Text style={[styles.actionBtnText, { color: colors.textDark, fontSize: sizes.sub }]}>Copy</Text>
                        </Pressable>
                        {!isUser && (
                          <>
                            <Pressable style={styles.actionBtn} onPress={() => handleCopyCodeBlocks(item.content)}>
                              <Text style={[styles.actionBtnText, { color: colors.textDark, fontSize: sizes.sub }]}>Code</Text>
                            </Pressable>
                            <Pressable style={styles.actionBtn} onPress={() => handleRegenerate(item)}>
                              <Text style={[styles.actionBtnText, { color: colors.textDark, fontSize: sizes.sub }]}>Retry</Text>
                            </Pressable>
                            <Pressable style={styles.actionBtn} onPress={() => toggleRaw(item.id)}>
                              <Text style={[styles.actionBtnText, { color: colors.textDark, fontSize: sizes.sub }]}>Raw</Text>
                            </Pressable>
                          </>
                        )}
                        <Pressable style={styles.actionBtn} onPress={() => handleBranch(item)}>
                          <Text style={[styles.actionBtnText, { color: colors.textDark, fontSize: sizes.sub }]}>Branch</Text>
                        </Pressable>
                        <Pressable style={styles.actionBtn} onPress={() => handleDownloadMd(item)}>
                          <Text style={[styles.actionBtnText, { color: colors.textDark, fontSize: sizes.sub }]}>Download</Text>
                        </Pressable>
                        <Pressable style={styles.actionBtn} onPress={() => handleShowInfo(item)}>
                          <Text style={[styles.actionBtnText, { color: colors.textDark, fontSize: sizes.sub }]}>Info</Text>
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
            <Text style={styles.welcomeLogo}>VELA</Text>

            <Text style={[styles.welcomeTitle, { color: colors.text }]}>
              {welcomeGreeting}, {userName}
            </Text>
            <Text style={[styles.welcomeSubtitle, { color: colors.textMuted }]}>
              How can I help you research today?
            </Text>

            {/* Random Quote */}
            <View style={[styles.quoteContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.quoteText, { color: colors.text }]}>“{welcomeQuote.text}”</Text>
              <Text style={[styles.quoteAuthor, { color: colors.textMuted }]}>— {welcomeQuote.author}</Text>
            </View>

            {/* Suggestion Starter Cards */}
            <Text style={[styles.sectionTitleLabel, { color: colors.text, fontSize: sizes.text }]}>Suggestions</Text>
            <View style={styles.suggestionsContainer}>
              {suggestionStarters.map((item, idx) => (
                <Pressable
                  key={idx}
                  style={({ pressed }) => [
                    styles.suggestionCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={() => handleSendWelcome(item.text, item.persona)}
                >
                  <Text style={[styles.suggestionText, { color: colors.text, fontSize: sizes.text - 1 }]}>
                    {item.label}: <Text style={{ color: colors.textMuted }}>"{item.text}"</Text>
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
                    style={[
                      styles.personaPill,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      isSelected && { backgroundColor: accentHex, borderColor: accentHex }
                    ]}
                    onPress={() => setSelectedAgent(p.id)}
                  >
                    <Text style={[styles.personaPillText, { color: isSelected ? '#ffffff' : colors.textMuted, fontSize: sizes.sub }]}>
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
      <View style={[styles.modelSwitcherContainer, { backgroundColor: colors.background }]}>
        <Pressable
          style={[styles.switcherButton, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={handleToggleLocalMode}
        >
          <Text style={[styles.switcherLabel, { color: colors.text }]}>
            Engine: {isLocalMode ? '🤖 Local (Gemma)' : '☁️ Cloud (Gemini)'}
          </Text>
        </Pressable>
        {localModelDownloadProgress !== null && (
          <Text style={[styles.downloadProgressText, { color: colors.textMuted }]}>
            Downloading model: {localModelDownloadProgress}%
          </Text>
        )}
      </View>

      {/* Unifying Input container at bottom */}
      <View style={[styles.inputContainer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, fontSize: sizes.text }]}
          placeholder={activeThreadId ? "Ask a question or request a task..." : "Ask Vela anything..."}
          placeholderTextColor={colors.textDark}
          value={input}
          onChangeText={setInput}
          multiline
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: accentHex },
            !input.trim() && { backgroundColor: colors.border },
            pressed && { backgroundColor: accentHex + 'cc' }
          ]}
          onPress={handleSendPress}
          disabled={!input.trim()}
        >
          <Text style={[styles.sendButtonText, { fontSize: sizes.text }]}>Send</Text>
        </Pressable>
      </View>

      <MessageOptionsModal
        visible={activeMenuMessage !== null}
        onClose={() => setActiveMenuMessage(null)}
        onDownloadMd={() => activeMenuMessage && handleDownloadMd(activeMenuMessage)}
        onRegenerate={() => activeMenuMessage && handleRegenerate(activeMenuMessage)}
        onToggleRaw={() => activeMenuMessage && toggleRaw(activeMenuMessage.id)}
        onBranch={() => activeMenuMessage && handleBranch(activeMenuMessage)}
        onCopyText={() => activeMenuMessage && handleCopyText(activeMenuMessage.content)}
        onCopyCode={() => activeMenuMessage && handleCopyCodeBlocks(activeMenuMessage.content)}
        onShare={() => activeMenuMessage && handleShareText(activeMenuMessage.content)}
        onShowInfo={() => activeMenuMessage && handleShowInfo(activeMenuMessage)}
        themeColors={colors}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    backgroundColor: '#818cf8',
    borderColor: '#6366f1',
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
    borderRadius: 8,
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
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    backgroundColor: '#f4f4f5',
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
    color: '#6366f1',
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
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
});
