import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  AppState,
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Alert,
  ScrollView,
  Animated,
  Modal,
} from 'react-native';
import { FlashList, type FlashListRef, type FlashListProps } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import PressableScale from '../components/ui/PressableScale';
import { DURATIONS, EASING } from '../utils/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import MessageOptionsModal from '../components/ui/MessageOptionsModal';
import MarkdownViewerOverlay from '../components/ui/MarkdownViewerOverlay';
import { useActiveStreamStore } from '../store/useActiveStreamStore';
import { healXmlTags } from '../utils/xmlHealer';
import { useConfigStore } from '../store/useConfigStore';
import type { ConnectionMode, SuggestionStarter } from '../store/useConfigStore';
import { useChatStore, Message, Thread } from '../store/useChatStore';
import { useAurora } from '../hooks/useAurora';
import RichText from '../components/chat/RichText';
import MessageItem from '../components/chat/MessageItem';
import MessageRow from '../components/chat/MessageRow';
import BubbleFooter from '../components/chat/BubbleFooter';
import DateDividerPill from '../components/chat/DateDividerPill';
import { buildChatFeedItems, type ChatFeedItem } from '../utils/chatFeed';
import { runServerStream } from '../utils/serverStream';
import { streamController } from '../utils/streamController';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';
import { getCachedParse } from '../utils/parseCache';
import SourceCard from '../components/chat/SourceCard';
import Grain from '../components/ui/Grain';
import { styles } from '../styles/indexStyles';
import { useRouter } from 'expo-router';
import { useBrowserStore } from '../store/useBrowserStore';
import { useGoogleAuthStore } from '../store/useGoogleAuthStore';
import { perfTracker } from '../utils/perfTracker';

// Importing local mode modules
import { initializeLocalModel, streamLocalLlmResponse, isLocalLlmDown, isStoredModelUsable, localModelStorageKey, LOCAL_MODELS } from '../utils/localLlm';
import { compileLocalPrompt } from '../utils/promptCompiler';
import { parseAndExecuteTools } from '../utils/toolProxy';
import { streamCloudResponse } from '../utils/providers';
import { buildContextMessages } from '../utils/providers/context';
import { buildLocalPromptBlock } from '../utils/standalonePrompt';
import { buildVercelCloudTools } from '../utils/cloudTools';
import { saveMemory, deleteMemory } from '../db/memoryRepository';
import { filterAvailable } from '../utils/toolRegistry';
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
import { getMissingSetupPermissions, getMissingSetupIntegrations } from '../utils/setupPermissions';
import { deriveShizukuState, type ShizukuStatus } from '../utils/shizuku';
import DeviceAgentNative from '../modules/device-agent';
import PermissionRequestCard from '../components/chat/PermissionRequestCard';

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

import { resolveAgentPrompt, resolveNewThreadAgent } from '../utils/agents';
import type { Agent } from '../utils/agents';
import { overlayRemoteAgents, getCachedAgents } from '../db/agentRepository';
import { saveMessages } from '../db/chatRepository';
import { useAgents } from '../hooks/useAgents';
import { useMessageActions } from '../hooks/useMessageActions';
import { generateUlid } from '../utils/syncIds';

// WF-447-06: the empty chat state is one authored feeling-curve beat, not a
// generic placeholder. One headline (<= 8 words), one line of subtext
// (<= 20 words), one primary CTA. Word caps are pinned by
// __tests__/emptyState.test.tsx; copy rules are pinned by docs/DESIGN.md.
export const EMPTY_HEADLINE = 'Ask once. It does the thing.';
export const EMPTY_SUBTEXT =
  'Describe what you need. Vela answers in one composed reply and can run the task on your device.';
export const EMPTY_CTA_LABEL = 'Ask your first question';

const generateId = (_prefix: string) => {
  // T5 (#253): cursor-safe IDs are pure ULIDs. The prefix argument is kept so
  // existing call sites stay readable (`generateId('msg_user')`), but it is
  // intentionally NOT embedded: any constant prefix would make
  // `sync_pull`'s `id > cursor ORDER BY id` sort by type first and skip rows
  // across pages (finding-009). See utils/syncIds.ts.
  return generateUlid();
};

// Shared implementation of the local prompt compiling, token streaming, and tool execution
export const streamLocalResponse = async (threadId: string, userQuery: string, historyList: Message[]) => {
  try {
    await streamController.startStream(threadId, async (signal) => {
      try {
        if (signal.aborted) return;
        await initializeLocalModel();
        if (signal.aborted) return;

        let currentHistory = [...historyList];
        let hasMoreIterations = true;
        let iterationCount = 0;

        while (hasMoreIterations && iterationCount < 5) {
          if (signal.aborted) return;
          iterationCount++;
          hasMoreIterations = false;

          const activeThread = useChatStore.getState().threads.find((t) => t.id === threadId);
          const selectedAgentId = activeThread?.agent || 'personal assistant';
          const agents = getCachedAgents();
          const agentPrompt = resolveAgentPrompt(selectedAgentId, agents);

          // Inject active skill prompt if set (standalone mode)
          const threadSkill = activeThread?.active_skill as SkillId | undefined;
          let skillAugmented = threadSkill && SKILL_PROMPTS[threadSkill]
            ? `${agentPrompt}\n\n# Active Skill Instructions\n${SKILL_PROMPTS[threadSkill]}`
            : agentPrompt;

          const localToolsBlock = buildLocalPromptBlock();
          if (localToolsBlock) {
            skillAugmented = `${skillAugmented}\n\n# Available Tools\n${localToolsBlock}`;
          }

          const { localModelName, apiUrl, apiKey, connectionMode } = useConfigStore.getState();

          // 2. Compile prompt using LLM native chat template
          const compiledPrompt = compileLocalPrompt({
            systemPrompt: skillAugmented,
            history: currentHistory,
            query: userQuery,
            compactInstructions: "Format calls as <call name=\"tool\">PARAMS</call>.",
            toolDeclarations: filterAvailable('local').map((t) => t.name),
            modelName: localModelName,
          });

          // 3. Stream response from local inference engine
          const STREAM_TIMEOUT_MS = 120000; // 2 minutes max per iteration
          const streamStartTime = Date.now();

          const generator = streamLocalLlmResponse(
            compiledPrompt,
            (token) => {
              if (!signal.aborted) {
                streamController.appendChunk(threadId, token);
              }
            },
            signal
          );

          try {
            for await (const _ of generator) {
              if (signal.aborted) break;
              if (Date.now() - streamStartTime > STREAM_TIMEOUT_MS) {
                console.warn('[streamLocalResponse] Stream timeout reached, forcing stop');
                break;
              }
            }
          } catch (genError: any) {
            if (signal.aborted) return;
            console.warn('[streamLocalResponse] Generator error:', genError);
          }

          if (signal.aborted) return;

          // Flush any pending token chunks before checking tools
          streamController.flush(threadId);

          // 4. Check if generated content contains tool invocation requests
          const currentMessagesSnapshot = useChatStore.getState().messages[threadId] || [];
          const lastMessageSnapshot = currentMessagesSnapshot[currentMessagesSnapshot.length - 1];

          if (lastMessageSnapshot && lastMessageSnapshot.role === 'assistant') {
            if (signal.aborted) return;

            const { hasInvocations, updatedContent } = await parseAndExecuteTools(
              lastMessageSnapshot.content,
              threadId,
              apiUrl,
              apiKey,
              connectionMode
            );

            if (signal.aborted) return;

            if (hasInvocations) {
              // Update local message state with response content directly without going through guarded setHistory
              const updatedLastMessage = { ...lastMessageSnapshot, content: updatedContent };
              const updatedHistory = [...currentMessagesSnapshot.slice(0, -1), updatedLastMessage];
              useChatStore.setState((s) => ({
                messages: {
                  ...s.messages,
                  [threadId]: updatedHistory,
                },
              }));
              saveMessages(threadId, updatedHistory).catch(() => {});

              // Fetch latest history and loop back for another model reasoning pass
              currentHistory = updatedHistory;
              hasMoreIterations = true;
            }
          }
        }
      } catch (e: any) {
        if (signal.aborted) return;
        console.error("[Local Stream Error]:", e);
        streamController.appendChunk(threadId, `\n\n⚠️ **Local Inference Error:** ${e?.message || 'Inference engine failed.'}`);
      }
    });
  } catch (e: any) {
    console.error('[streamLocalResponse] Error:', e);
  }
};

// Shared implementation of cloud model prompt compiling, token streaming, and tool execution
export const streamCloudChatResponse = async (
  threadId: string,
  historyList: Message[]
) => {
  try {
    await streamController.startStream(threadId, async (signal) => {
      const config = useConfigStore.getState();
      const provider = config.activeCloudProvider || 'gemini';
      const providerConfig = config.cloudProviders?.[provider];
      const apiKey = config.cloudApiKeys?.[provider] || '';

      const threads = useChatStore.getState().threads;
      const activeThread = threads.find((t) => t.id === threadId);
      const selectedAgentId = activeThread?.agent || 'personal assistant';
      const agents = getCachedAgents();
      const activeAgent = agents.find((candidate) => candidate.id === selectedAgentId);
      const agentPrompt = resolveAgentPrompt(selectedAgentId, agents);

      // Inject active skill prompt if set (standalone mode)
      const cloudThreadSkill = activeThread?.active_skill as SkillId | undefined;
      const cloudSkillAugmented = cloudThreadSkill && SKILL_PROMPTS[cloudThreadSkill]
        ? `${agentPrompt}\n\n# Active Skill Instructions\n${SKILL_PROMPTS[cloudThreadSkill]}`
        : agentPrompt;

      const systemPromptToUse = config.systemPromptEnabled === false ? undefined : cloudSkillAugmented;

      const contextMessages = buildContextMessages(historyList, {
        maxMessages: config.contextCompression ? 30 : 100,
      });

      const cloudTools = buildVercelCloudTools(
        {},
        {
          evaluateSafety,
          memoryStore: {
            saveMemory: (_convId, fact) => saveMemory(threadId, fact),
            deleteMemory: (_convId, fact) => deleteMemory(threadId, fact),
          },
        },
        {
          onToolCall: (call) => {
            if (signal.aborted) {
              const err = new Error('AbortError');
              err.name = 'AbortError';
              throw err;
            }
            streamController.appendChunk(threadId, `\n\n🔧 *Executing ${call.toolName}...*\n`);
          },
          onToolResult: (res) => {
            if (signal.aborted) {
              const err = new Error('AbortError');
              err.name = 'AbortError';
              throw err;
            }
            if (!res.result?.success) {
              streamController.appendChunk(threadId, `\n⚠️ *Tool output: ${res.result?.output}*\n`);
            }
          },
        }
      );

      try {
        await streamCloudResponse({
          provider,
          apiKey,
          model: activeAgent?.model?.trim() || providerConfig?.model || 'gemini-1.5-flash',
          baseUrl: providerConfig?.baseUrl,
          systemPrompt: systemPromptToUse,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          messages: contextMessages,
          tools: cloudTools,
          signal,
          onToken: (chunk) => {
            if (!signal.aborted) {
              streamController.appendChunk(threadId, chunk);
            }
          },
          onDone: () => {},
          onError: (error: any) => {
            if (signal.aborted) return;
            const errText = `⚠️ **[${provider.toUpperCase()} Error]** ${error?.message || 'Cloud inference failed.'}`;
            const cur = useChatStore.getState().messages[threadId] || [];
            const last = cur[cur.length - 1];
            if (last?.role === 'assistant') {
              streamController.appendChunk(threadId, `\n\n${errText}`);
            } else {
              useChatStore.getState().addMessage(threadId, {
                id: generateId('msg_assistant'),
                role: 'assistant',
                content: errText,
                created_at: new Date().toISOString(),
              });
            }
          },
        });
      } catch (e: any) {
        if (signal.aborted || e?.name === 'AbortError') return;
        console.error('[Cloud Stream Error]:', e);
        const errText = `⚠️ **[${provider.toUpperCase()} Error]** ${e?.message || 'Cloud inference failed.'}`;
        const cur = useChatStore.getState().messages[threadId] || [];
        const last = cur[cur.length - 1];
        if (last?.role === 'assistant') {
          streamController.appendChunk(threadId, `\n\n${errText}`);
        } else {
          useChatStore.getState().addMessage(threadId, {
            id: generateId('msg_assistant'),
            role: 'assistant',
            content: errText,
            created_at: new Date().toISOString(),
          });
        }
      }
    });
  } catch (e: any) {
    console.error('[streamCloudChatResponse] Error:', e);
  }
};

export function handleSendPressAction(params: {
  isCurrentThreadStreaming: boolean;
  activeThreadId: string | null;
  input: string;
  onStop: (threadId: string) => void | Promise<void>;
  onSend: () => void | Promise<void>;
  onSendWelcome: (input: string) => void | Promise<void>;
}): void {
  // While streaming, the button acts as "Stop" — onStop owns the abort path.
  if (params.isCurrentThreadStreaming && params.activeThreadId) {
    params.onStop(params.activeThreadId);
    return;
  }
  if (params.activeThreadId) {
    Promise.resolve(params.onSend()).catch((err) => console.error('[handleSendPress] error:', err));
    return;
  }
  if (!params.input.trim()) return;
  Promise.resolve(params.onSendWelcome(params.input)).catch((err) => console.error('[handleSendPress] error:', err));
}

type AuroraBundle = ReturnType<typeof useAurora>;

/**
 * WF-447-06: the empty chat state, rendered both on the no-thread welcome
 * screen and inside a thread with zero messages. Recognition beat of the
 * feeling curve: the brand, one headline, one line of subtext and exactly one
 * primary action; starters and the agent picker stay quiet below it. The whole
 * block is the state's single animated element: one ease-out entrance
 * (opacity + slight rise, reveal duration, native driver). Reduced motion
 * keeps the fade and drops the travel.
 */
export function EmptyChatState({
  colors,
  sizes,
  aurora,
  onPressAsk,
  starters,
  onSelectStarter,
  agents,
  currentAgentId,
  onSelectAgent,
}: {
  colors: AuroraBundle['colors'];
  sizes: AuroraBundle['sizes'];
  aurora: AuroraBundle['aurora'];
  onPressAsk: () => void;
  /** Welcome variant only: quiet starter prompts under the primary action. */
  starters?: SuggestionStarter[];
  onSelectStarter?: (starter: SuggestionStarter) => void;
  agents?: Agent[];
  currentAgentId?: string;
  onSelectAgent?: (agentId: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const entrance = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: DURATIONS.reveal,
      easing: EASING.out,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const showStarters = !!starters?.length && !!onSelectStarter;
  const showAgents = !!agents?.length && !!onSelectAgent;

  return (
    <Animated.View
      testID="empty-state-root"
      style={[
        styles.emptyContainer,
        {
          opacity: entrance,
          transform: [
            {
              translateY: reducedMotion
                ? 0
                : entrance.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
            },
          ],
        },
      ]}
    >
      <Text style={[styles.welcomeLogo, { color: aurora.acc1 }]}>VELA</Text>
      <Text
        testID="empty-headline"
        style={[styles.emptyHeadline, { color: colors.text, fontSize: sizes.title, letterSpacing: sizes.titleLetterSpacing }]}
      >
        {EMPTY_HEADLINE}
      </Text>
      <Text
        testID="empty-subtext"
        style={[styles.emptySubtext, { color: colors.textMuted, fontSize: sizes.text, lineHeight: sizes.lineHeight, letterSpacing: sizes.letterSpacing }]}
      >
        {EMPTY_SUBTEXT}
      </Text>

      <PressableScale
        testID="empty-cta"
        accessibilityLabel={EMPTY_CTA_LABEL}
        accessibilityRole="button"
        onPress={onPressAsk}
        style={[styles.emptyCta, { backgroundColor: aurora.acc1 }]}
      >
        <Text style={[styles.emptyCtaText, { color: aurora.onAccent, fontSize: sizes.text }]}>
          {EMPTY_CTA_LABEL}
        </Text>
      </PressableScale>

      {showStarters && (
        <>
          <Text style={[styles.sectionTitleLabel, { color: colors.text, fontSize: sizes.text }]}>Suggestions</Text>
          <View style={styles.suggestionsContainer}>
            {starters!.map((item, idx) => (
              <PressableScale
                key={idx}
                scaleTo={0.98}
                accessibilityLabel={`Suggestion: ${item.label}`}
                style={({ pressed }) => [
                  styles.suggestionCard,
                  { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 999 },
                  pressed && { borderColor: aurora.acc1, backgroundColor: aurora.acc1 + '1A', opacity: 0.95 }
                ]}
                onPress={() => onSelectStarter!(item)}
              >
                <Text style={[styles.suggestionText, { color: colors.text, fontSize: sizes.text - 1 }]}>
                  <Text style={{ color: aurora.acc1, fontWeight: '700' }}>{item.label}</Text>
                  {': '}<Text style={{ color: colors.textMuted }}>"{item.text}"</Text>
                </Text>
              </PressableScale>
            ))}
          </View>
        </>
      )}

      {showAgents && (
        <>
          <Text style={[styles.sectionTitleLabel, { color: colors.text, fontSize: sizes.text }]}>
            Choose Agent
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.agentScrollContainer}>
            {agents!.map((p) => {
              const isSelected = currentAgentId === p.id;
              return (
                <PressableScale
                  key={p.id}
                  scaleTo={0.96}
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${p.name} agent`}
                  style={({ pressed }) => [
                    styles.agentPill,
                    { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 999 },
                    isSelected && { backgroundColor: aurora.acc1, borderColor: aurora.acc1 },
                    pressed && { opacity: 0.85 }
                  ]}
                  onPress={() => onSelectAgent!(p.id)}
                >
                  <Text style={[styles.agentPillText, { color: isSelected ? aurora.onAccent : colors.textMuted, fontSize: sizes.sub }]}>
                    {p.icon} {p.name}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </>
      )}
    </Animated.View>
  );
}

/**
 * WF-447-06 peak device: bubble entrance. The assistant answer arrives ONCE
 * with a single ease-out entrance (opacity + slight rise, reveal duration,
 * native driver) and then fills in as one composed block. The other two peak
 * devices are deliberately static: no streaming progress bar exists, and the
 * send button is a plain Send/Stop state swap. The entrance plays only when
 * the row mounts while its message is the one currently streaming, so history
 * bubbles never re-animate. Reduced motion keeps the fade, drops the rise.
 */
function AssistantAnswerEntrance({
  animate,
  reducedMotion,
  children,
}: {
  animate: boolean;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATIONS.reveal,
      easing: EASING.out,
      useNativeDriver: true,
    }).start();
  }, [animate, progress]);

  return (
    <Animated.View
      style={[
        styles.answerEntrance,
        {
          opacity: progress,
          transform: [
            {
              translateY: reducedMotion
                ? 0
                : progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

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

  // #556: persistent "finish setup later" banner — shown while any onboarding
  // permission was explicitly denied during setup; links to Settings →
  // Permissions. Derived from the store so it hides as soon as everything
  // requested is granted.
  const osPermissions = useConfigStore((state) => state.osPermissions);
  const missingSetupPermissions = getMissingSetupPermissions(osPermissions);
  const googleSetupPending = useConfigStore((state) => state.googleSetupPending);
  const googleBackendConnected = useGoogleAuthStore((state) => state.backendConnected);
  const googleIsConnected = useGoogleAuthStore((state) => state.isConnected);
  const [shizukuStatusForBanner, setShizukuStatusForBanner] = React.useState<ShizukuStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const readStatus = async () => {
      try {
        const native = DeviceAgentNative as any;
        if (native && typeof native.getShizukuStatus === 'function') {
          const s = await native.getShizukuStatus();
          if (!cancelled) setShizukuStatusForBanner(s ?? null);
        }
      } catch {
        // ignore — unknown state surfaces nothing
      }
    };
    void readStatus();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void readStatus();
      }
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  const shizukuStateForBanner: string = shizukuStatusForBanner
    ? deriveShizukuState(shizukuStatusForBanner)
    : 'unknown';
  const missingSetupIntegrations = getMissingSetupIntegrations({
    connectionMode,
    googlePending: googleSetupPending,
    googleConnected: googleBackendConnected === true || googleIsConnected,
    shizukuState: shizukuStateForBanner,
  });

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
  // WF-455 overlay lifecycle: fold any stale overlay text into its owning
  // message BEFORE starting a new overlay stream. Without this, a second
  // thread's startStream would wipe the first stream's diverted tokens
  // (cross-thread background streaming edge).
  const beginStreamOverlay = useCallback((messageId: string) => {
    const activeStream = useActiveStreamStore.getState();
    if (
      activeStream.isStreaming &&
      activeStream.streamingMessageId &&
      activeStream.streamingMessageId !== messageId &&
      activeStream.streamingText.trim() !== ''
    ) {
      const staleId = activeStream.streamingMessageId;
      const allMsgs = useChatStore.getState().messages;
      for (const [tid, msgs] of Object.entries(allMsgs)) {
        const stale = msgs.find((m) => m.id === staleId);
        if (stale && stale.role === 'assistant') {
          useChatStore.getState().updateLastMessageContent(
            tid,
            healXmlTags((stale.content || '') + activeStream.streamingText)
          );
          break;
        }
      }
    }
    activeStream.startStream(messageId);
  }, []);
  const setThreads = useChatStore((state) => state.setThreads);
  const setHistory = useChatStore((state) => state.setHistory);
  const branchThread = useChatStore((state) => state.branchThread);
  const truncateThreadHistory = useChatStore((state) => state.truncateThreadHistory);

  // Local/UI States
  const [input, setInput] = useState('');
  // WF-447-06: the empty state's primary CTA focuses the composer — the one
  // action the screen asks for is the first question.
  const inputRef = React.useRef<TextInput | null>(null);
  const focusComposer = React.useCallback(() => {
    inputRef.current?.focus();
  }, []);
  // #357: agents come from the shared DB-backed selector (no local copy).
  const agents = useAgents();
  const currentThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId),
    [threads, activeThreadId]
  );
  const currentAgentId = currentThread?.agent || defaultAgent;
  const [showRawMap, setShowRawMap] = useState<Record<string, boolean>>({});
  const [activeMenuMessage, setActiveMenuMessage] = useState<Message | null>(null);
  const [authRequired, setAuthRequired] = useState<Record<string, boolean>>({});
  const [viewerContent, setViewerContent] = useState<string | null>(null);
  // #158: pending OS-permission prompt + session-scoped denial set so a denied
  // permission is not re-prompted until the app restarts.
  const [permissionPrompt, setPermissionPrompt] = useState<OSPermission | null>(null);
  const sessionDeniedPermissionsRef = React.useRef<Set<OSPermission>>(new Set());

  // Theme values — Aurora: theme = atmosphere (colors), accent = energy (aurora)
  const { colors, sizes, aurora, theme } = useAurora();
  const accentHex = aurora.acc1;

  // Refs
  const flashListRef = React.useRef<FlashListRef<ChatFeedItem> | null>(null);
  const lastOffsetY = React.useRef(0);
  const isAgentBarVisible = React.useRef(true);

  const triggerAutoScroll = useCallback(() => {
    if (lastOffsetY.current < 120) {
      setTimeout(() => {
        flashListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 50);
    }
  }, []);
  const AGENT_BAR_HEIGHT = 58;
  // WF-447-04: bar collapse is transform/opacity only — the layout height is a
  // static prop switched once at animation end; the bar itself slides out via
  // translateY on the native driver. Under reduced motion the state flips
  // without any position animation.
  const agentBarSlide = React.useRef(new Animated.Value(0)).current;
  const [agentBarShown, setAgentBarShown] = React.useState(true);
  const reduceMotion = useReducedMotion();

  // 180ms sits inside every motion cap (press 120–180, transitions ≤300).
  const slideAgentBar = React.useCallback(
    (toValue: number, onDone?: () => void) => {
      if (reduceMotion) {
        agentBarSlide.setValue(toValue);
        if (onDone) onDone();
      } else {
        Animated.timing(agentBarSlide, {
          toValue,
          duration: 180,
          easing: EASING.out,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && onDone) onDone();
        });
      }
    },
    [agentBarSlide, reduceMotion]
  );

  const handleScroll = useCallback((event: any) => {
    const currentOffset = event.nativeEvent.contentOffset.y;
    const diff = currentOffset - lastOffsetY.current;

    if (currentOffset > 30) {
      if (diff > 10 && isAgentBarVisible.current) {
        // Scrolling down: Hide agent bar
        isAgentBarVisible.current = false;
        slideAgentBar(-AGENT_BAR_HEIGHT, () => setAgentBarShown(false));
      } else if (diff < -10 && !isAgentBarVisible.current) {
        // Scrolling up: Show agent bar
        isAgentBarVisible.current = true;
        setAgentBarShown(true);
        slideAgentBar(0);
      }
    } else if (currentOffset <= 5 && !isAgentBarVisible.current) {
      isAgentBarVisible.current = true;
      setAgentBarShown(true);
      slideAgentBar(0);
    }

    lastOffsetY.current = currentOffset;
  }, [slideAgentBar]);

  React.useEffect(() => {
    setStreamingThread(activeThreadId || '', false);
  }, []);

  React.useEffect(() => {
    return () => {
      // Unmount cleanup must not destructively abort server producer (map #480 locked decision / 481a466a)
      streamController.abortAll({ notifyBackend: false });
    };
  }, []);

  // Backgrounding mid-stream aborts local streams without cancelling server producer (map #480 locked decision / 481a466a)
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        streamController.abortAll({ notifyBackend: false });
      }
    });
    return () => sub.remove();
  }, []);

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

  const handleMessageLongPress = useCallback((msg: Message) => {
    if (!isCurrentThreadStreaming) {
      setActiveMenuMessage(msg);
    }
  }, [isCurrentThreadStreaming]);

  const toggleRaw = useCallback((msgId: string) => {
    setShowRawMap(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  }, []);

  const handleSend = useCallback(async () => {
    if (!activeThreadId) return;

    // Stop-streaming must be checked BEFORE the empty-input guard: the input is
    // cleared on send, so requiring text here would make "Stop" unreachable.
    if (isCurrentThreadStreaming) {
      Keyboard.dismiss();
      await streamController.stopStream(activeThreadId);
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

    const syncStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const userMsgId = generateId('msg_user');
    const assistantMsgId = generateId('msg_assistant');
    const nowIso = new Date().toISOString();

    const originalHistory = messages[activeThreadId] || [];

    // Instantaneous optimistic state commit (< 4ms synchronous blocking invariant)
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

    beginStreamOverlay(assistantMsgId);
    setStreamingThread(activeThreadId, true);
    triggerAutoScroll();

    const syncDuration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - syncStart;
    perfTracker.recordMetric('sync_blocking_invariant_ms', syncDuration, 'ms');

    try {
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
        setThreads,
        setAuthRequired,
      });
    } catch (err: any) {
      console.error('[handleSend] Stream error:', err);
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
    beginStreamOverlay,
    setThreads,
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

    beginStreamOverlay(assistantMsgId);
    setStreamingThread(activeThreadId, true);

    try {
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
        setThreads,
        setAuthRequired,
      });
    } catch (err: any) {
      console.error('[handleRegenerate] Stream error:', err);
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
    beginStreamOverlay,
    setThreads,
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

    beginStreamOverlay(assistantMsgId);
    setStreamingThread(newThreadId, true);
    triggerAutoScroll();

    try {
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
        setThreads,
        setAuthRequired,
      });
    } catch (err: any) {
      console.error('[handleSendWelcome] Stream error:', err);
    }
  }, [
    apiUrl,
    apiKey,
    createThread,
    addMessage,
    beginStreamOverlay,
    setStreamingThread,
    isLocalMode,
    connectionMode,
    triggerAutoScroll,
    handleSkillCommand,
  ]);

  const handleSendPress = () => {
    handleSendPressAction({
      isCurrentThreadStreaming,
      activeThreadId,
      input,
      onStop: (threadId) => {
        streamController.stopStream(threadId);
      },
      onSend: handleSend,
      onSendWelcome: handleSendWelcome,
    });
  };


  const handleToggleLocalMode = async () => {
    const nextMode = !isLocalMode;
    if (nextMode) {
      if (isLocalLlmDown) {
        Alert.alert('Local Model Down', 'The local LLM is currently down/unavailable.');
        return;
      }
      const selectedModel = LOCAL_MODELS.find(m => m.name === localModelName);
      if (!selectedModel) {
        Alert.alert('Error', 'Selected model not found.');
        return;
      }

      // Check if model already downloaded. A stale file from a previous model
      // list (e.g. a `.task` bundle after the switch to GGUF) is not usable.
      const storageKey = localModelStorageKey(localModelName);
      const [downloadedFlag, storedPath] = await Promise.all([
        AsyncStorage.getItem(storageKey),
        AsyncStorage.getItem(`${storageKey}_path`),
      ]);
      if (isStoredModelUsable(selectedModel, downloadedFlag, storedPath)) {
        setConnectionMode('local');
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

  // #556: persistent "finish setup later" banner, shown in both the thread
  // view and the welcome screen while any onboarding permission was denied.
  const setupPermissionsBanner = missingSetupPermissions.length > 0 ? (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Finish setup: review permissions"
      style={[styles.setupBanner, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
      onPress={() => router.push('/settings/permissions')}
    >
      <Text style={[styles.setupBannerTitle, { color: colors.text, fontSize: sizes.text }]}>
        Finish setup later
      </Text>
      <Text style={[styles.setupBannerText, { color: colors.textMuted, fontSize: sizes.sub }]}>
        {missingSetupPermissions.length} permission{missingSetupPermissions.length > 1 ? 's' : ''} still need your OK. Tap to review in Settings.
      </Text>
    </PressableScale>
  ) : null;

  // #557: persistent "finish setup later" banner for integration gaps
  // (Google Workspace / Shizuku) recorded by the onboarding wizard.
  const setupIntegrationsBanner = missingSetupIntegrations.length > 0 ? (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Finish setup: review integrations"
      style={[styles.setupBanner, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
      onPress={() => {
        const hasGoogle = missingSetupIntegrations.some((g) => g.kind === 'google');
        if (hasGoogle) router.push('/settings/connection' as any);
        else router.push('/settings/shizuku' as any);
      }}
    >
      <Text style={[styles.setupBannerTitle, { color: colors.text, fontSize: sizes.text }]}>
        Finish setup later
      </Text>
      <Text style={[styles.setupBannerText, { color: colors.textMuted, fontSize: sizes.sub }]}>
        {missingSetupIntegrations.length} integration{missingSetupIntegrations.length > 1 ? 's' : ''} still need attention. Tap to review in Settings.
      </Text>
    </PressableScale>
  ) : null;

  return (
    <LinearGradient
      colors={[colors.skyTop, colors.skyBottom]}
      style={styles.container}
    >
      <Grain />
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
          {setupPermissionsBanner}
          {setupIntegrationsBanner}
          {/* Horizontal Agent Selector Bar */}
          <View style={{ height: agentBarShown ? AGENT_BAR_HEIGHT : 0, overflow: 'hidden' }}>
            <Animated.View style={{ transform: [{ translateY: agentBarSlide }] }}>
            <View style={[styles.agentBar, { borderBottomColor: colors.glassBorder, backgroundColor: colors.glass }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.agentBarScroll}>
                {agents.map((p) => {
                  const isSelected = currentAgentId === p.id;
                  return (
                    <PressableScale
                      key={p.id}
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${p.name} agent`}
                      style={[
                        styles.agentBarCell,
                        { borderColor: colors.border, backgroundColor: colors.card },
                        isSelected && { borderColor: aurora.acc1, backgroundColor: aurora.acc1 + '1f' }
                      ]}
                      onPress={() => {
                        setThreadAgent(activeThreadId, p.id);
                      }}
                    >
                      <Text style={[styles.agentBarText, { color: isSelected ? aurora.acc1 : colors.textMuted, fontSize: sizes.sub }]}>
                        {p.icon} {p.name}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
            </Animated.View>
          </View>

          {activeMessages.length === 0 ? (
            <View style={styles.emptyThreadContainer}>
              <EmptyChatState colors={colors} sizes={sizes} aurora={aurora} onPressAsk={focusComposer} />
            </View>
          ) : (
            <FlashList
              ref={flashListRef}
              data={reversedChatItems}
              inverted
              getItemType={(item) => (item.type === 'date_divider' ? 'date_divider' : item.message.role)}
              estimatedItemSize={110}
              drawDistance={Platform.OS === 'android' ? 300 : 250}
              keyExtractor={(item) => (item.type === 'date_divider' ? item.id : item.message.id)}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              contentContainerStyle={styles.messagesList}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                // getCachedParse(message.content, isUser) delegated to memoized MessageRow (WF-455-03)
                if (item.type === 'date_divider') {
                  return (
                    <MessageRow
                      key={item.id}
                      item={item}
                      colors={colors}
                      sizes={sizes}
                      aurora={aurora}
                      theme={theme}
                      isStreamingMessage={false}
                    />
                  );
                }
                const message = item.message;
                const isUser = message.role === 'user';
                const showActionBar = activeMenuMessage?.id === message.id;
                const isStreamingThis = !isUser && isCurrentThreadStreaming && activeMessages[activeMessages.length - 1]?.id === message.id;

                // WF-447-06 authored silence: while the first tokens stream, the
                // answer holds one quiet, static single line — no spinner, no
                // pulse, no competing motion. It yields to the composed block the
                // moment content arrives. (Formal MessageRow prop keeps the old
                // `compilingIndicator` name.)
                const quietStreamIntro =
                  isStreamingThis && !message.content.trim() ? (
                    <Text style={[styles.quietStreamLine, { color: colors.textMuted, fontSize: sizes.sub, lineHeight: sizes.subLineHeight }]}>
                      {isLocalMode ? 'Composing on-device.' : 'Writing your answer.'}
                    </Text>
                  ) : null;

                const actionBar = showActionBar ? (
                  <View style={styles.actionBar}>
                    <PressableScale accessibilityLabel="Copy message text" style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleCopyText(message.content)}>
                      <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Copy</Text>
                    </PressableScale>
                    {!isUser && (
                      <>
                        <PressableScale accessibilityLabel="View message source" style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setViewerContent(message.content)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>View</Text>
                        </PressableScale>
                        <PressableScale accessibilityLabel="Copy code blocks" style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleCopyCodeBlocks(message.content)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Code</Text>
                        </PressableScale>
                        <PressableScale accessibilityLabel="Regenerate response" style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleRegenerate(message)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Retry</Text>
                        </PressableScale>
                        <PressableScale accessibilityLabel="Toggle raw view" style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => toggleRaw(message.id)}>
                          <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Raw</Text>
                        </PressableScale>
                      </>
                    )}
                    <PressableScale accessibilityLabel="Branch conversation" style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleBranch(message)}>
                      <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Branch</Text>
                    </PressableScale>
                    <PressableScale accessibilityLabel="Download as Markdown" style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleDownloadMd(message)}>
                      <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Download</Text>
                    </PressableScale>
                    <PressableScale accessibilityLabel="Message details" style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleShowInfo(message)}>
                      <Text style={[styles.actionBtnText, { color: colors.textMuted, fontSize: sizes.sub }]}>Info</Text>
                    </PressableScale>
                  </View>
                ) : null;

                return (
                  <AssistantAnswerEntrance
                    key={message.id}
                    animate={!isUser && isStreamingThis}
                    reducedMotion={reduceMotion}
                  >
                    <MessageRow
                      item={item}
                      colors={colors}
                      sizes={sizes}
                      aurora={aurora}
                      theme={theme}
                      accentHex={accentHex}
                      isLocalMode={isLocalMode}
                      agentName={agents.find(p => p.id === currentAgentId)?.name || 'Vela'}
                      showRaw={showRawMap[message.id]}
                      isStreamingMessage={isStreamingThis}
                      inViewport={true}
                      onLongPress={handleMessageLongPress}
                      onCopyText={handleCopyText}
                      renderSegment={renderSegment}
                      actionBar={actionBar}
                      compilingIndicator={quietStreamIntro}
                    />
                  </AssistantAnswerEntrance>
                );
              }}
            />
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.welcomeScroll} keyboardShouldPersistTaps="handled">
          {setupPermissionsBanner}
          {setupIntegrationsBanner}
          <EmptyChatState
            colors={colors}
            sizes={sizes}
            aurora={aurora}
            onPressAsk={focusComposer}
            starters={suggestionStarters}
            onSelectStarter={(item) => handleSendWelcome(item.text, item.agent)}
            agents={agents}
            currentAgentId={currentAgentId}
            onSelectAgent={setDefaultAgent}
          />
        </ScrollView>
      )}

      {/* Model Mode Selector */}
      <View style={[styles.modelSwitcherContainer, { backgroundColor: colors.glass, borderTopColor: colors.glassBorder }]}>
        <PressableScale
          accessibilityLabel="Toggle engine mode"
          style={({ pressed }) => [
            styles.switcherButton,
            { borderColor: colors.border, backgroundColor: colors.card },
            pressed && { opacity: 0.85 }
          ]}
          onPress={handleToggleLocalMode}
        >
          <Text style={[styles.switcherLabel, { color: colors.text }]}>
            Engine: {connectionMode === 'local' ? `🤖 Local (${localModelName})` : connectionMode === 'cloud' ? `☁️ Cloud (${activeCloudProvider || 'gemini'})` : `🖥️ Server (${modelName || 'Gemini'})`}
          </Text>
        </PressableScale>
        {localModelDownloadProgress !== null && (
          <Text style={[styles.downloadProgressText, { color: aurora.acc2 }]}>
            Downloading model: {localModelDownloadProgress}%
          </Text>
        )}
      </View>

      {/* Active skill indicator */}
      {activeThreadId && activeThreadSkill && SKILL_METADATA[activeThreadSkill] && connectionMode !== 'server' && (
        <PressableScale
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
        </PressableScale>
      )}

      {/* Unifying Input container at bottom */}
      <View
        style={[
          styles.inputWrapper,
          { backgroundColor: colors.background, borderTopColor: colors.glassBorder, paddingBottom: Math.max(12, insets.bottom) }
        ]}
      >
        <View
          style={[
            styles.inputContainer,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 28, minHeight: 48 }
          ]}
        >
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.text, fontSize: sizes.text, backgroundColor: 'transparent' }]}
            placeholder={activeThreadId ? "Ask a question or request a task..." : "Ask Vela anything..."}
            placeholderTextColor={colors.textDark}
            value={input}
            onChangeText={setInput}
            multiline
          />
          <PressableScale
            accessibilityState={{ busy: isCurrentThreadStreaming || false }}
            style={({ pressed }) => [
              styles.sendButton,
              {
                borderRadius: 999,
                width: 48,
                height: 48,
                minWidth: 48,
                paddingHorizontal: 0,
                overflow: 'hidden',
                backgroundColor: isCurrentThreadStreaming
                  ? '#ef4444'
                  : input.trim()
                    ? 'transparent'
                    : colors.textDark,
                shadowColor: isCurrentThreadStreaming ? '#ef4444' : aurora.acc1,
                shadowOpacity: isCurrentThreadStreaming || input.trim() ? 0.4 : 0,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: isCurrentThreadStreaming || input.trim() ? 8 : 0,
              },
              pressed && { opacity: 0.85 }
            ]}
            scaleTo={0.94}
            onPress={handleSendPress}
            disabled={!isCurrentThreadStreaming && !input.trim()}
            accessibilityLabel={isCurrentThreadStreaming ? 'Stop generating' : 'Send message'}
          >
            {isCurrentThreadStreaming || !input.trim() ? (
              <Text style={[styles.sendButtonText, { fontSize: sizes.text, color: '#ffffff' }]}>
                {isCurrentThreadStreaming ? 'Stop' : 'Send'}
              </Text>
            ) : (
              <LinearGradient
                colors={[aurora.acc1, aurora.acc2]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 999, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={[styles.sendButtonText, { fontSize: sizes.text, color: aurora.onAccent }]}>
                  Send
                </Text>
              </LinearGradient>
            )}
          </PressableScale>
        </View>
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
