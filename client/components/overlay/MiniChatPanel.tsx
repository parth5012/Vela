import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAurora } from '../../hooks/useAurora';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useChatStore, type Message, type ChatAttachment } from '../../store/useChatStore';
import { useConfigStore } from '../../store/useConfigStore';
import { QUICK_CHAT_THREAD_ID, sendQuickChatMessage } from '../../utils/quickChatSync';
import { streamController } from '../../utils/streamController';
import { pickChatImages } from '../../utils/chatAttachments';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import VoiceConsentModal from '../chat/VoiceConsentModal';
import { isDarkTheme } from '../../utils/theme';

interface MiniChatPanelProps {
  onMinimize: () => void;
  onClose: () => void;
}

const EMPTY_MESSAGES: Message[] = [];

export default function MiniChatPanel({ onMinimize, onClose }: MiniChatPanelProps) {
  const { colors, aurora, sizes } = useAurora();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const messages = useChatStore((s) => s.messages[QUICK_CHAT_THREAD_ID] ?? EMPTY_MESSAGES);
  const isStreaming = useChatStore((s) => s.isThreadStreaming(QUICK_CHAT_THREAD_ID));

  const enableVoice = useConfigStore((s) => s.floatingOverlay.enableVoice);
  const enableImages = useConfigStore((s) => s.floatingOverlay.enableImages);
  const maxImages = useConfigStore((s) => s.maxImagesPerMessage) ?? 2;
  const theme = useConfigStore((s) => s.theme);
  const isDark = isDarkTheme(theme);

  const scrollViewRef = useRef<ScrollView>(null);

  // Auto-scroll when messages arrive or stream updates
  const lastMessageContent = messages.length > 0 ? messages[messages.length - 1]?.content : '';
  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: !reducedMotion });
  }, [messages.length, lastMessageContent, isStreaming, reducedMotion]);

  // Voice input integration
  const voice = useVoiceInput({
    onTranscript: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    },
  });

  const isRecording = voice.state.recording;

  // Cleanup voice recording only on unmount (not on periodic waveform re-renders)
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });

  useEffect(() => {
    return () => {
      if (voiceRef.current.state.recording) {
        void voiceRef.current.cancel();
      }
    };
  }, []);

  const handleSend = async () => {
    const textToSend = input.trim();
    if ((!textToSend && attachments.length === 0) || isSubmitting) return;

    setIsSubmitting(true);
    setInput('');
    const currentAttachments = [...attachments];
    setAttachments([]);

    try {
      await sendQuickChatMessage(textToSend, currentAttachments);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStopStream = async () => {
    await streamController.stopStream(QUICK_CHAT_THREAD_ID);
  };

  const handlePickImage = async () => {
    if (attachments.length >= maxImages) return;
    const picked = await pickChatImages(1);
    if (picked.length > 0) {
      const file = picked[0];
      setAttachments((prev) => [
        ...prev,
        {
          storage_path: file.uri,
          mime_type: file.mimeType,
          file_size: file.size ?? 0,
          alt_text: file.name,
        },
      ]);
    }
  };

  const handleToggleVoice = async () => {
    try {
      if (isRecording) {
        await voice.stop();
      } else {
        await voice.start();
      }
    } catch (err) {
      console.warn('[MiniChatPanel] Voice recording error:', err);
    }
  };

  const panelHeight = Math.min(screenHeight * 0.56, 520);
  const syncTextColor = isDark ? '#4ade80' : '#15803d';
  const recordTextColor = isDark ? '#f87171' : '#b91c1c';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      accessibilityViewIsModal={true}
      style={[
        styles.panel,
        {
          height: panelHeight,
          width: Math.min(screenWidth - 32, 420),
          alignSelf: 'center',
          backgroundColor: colors.card,
          borderColor: colors.border,
          bottom: insets.bottom + 16,
        },
      ]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: colors.text, fontSize: sizes.text }]}>
            Quick Chat
          </Text>
          <View style={styles.syncBadge}>
            <View style={styles.syncDot} />
            <Text style={[styles.syncText, { color: syncTextColor, fontSize: sizes.sub }]}>
              Synced
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            onPress={onMinimize}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Minimize Quick Chat panel"
          >
            <Text style={[styles.btnText, { color: colors.textMuted }]}>─</Text>
          </Pressable>

          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Close Quick Chat overlay"
          >
            <Text style={[styles.btnText, { color: colors.textMuted }]}>✕</Text>
          </Pressable>
        </View>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (isStreaming) {
            scrollViewRef.current?.scrollToEnd({ animated: !reducedMotion });
          }
        }}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
              Quick Chat is connected to your main conversation history.
            </Text>
          </View>
        ) : (
          messages.map((m: Message) => {
            const isUser = m.role === 'user';
            return (
              <View
                key={m.id}
                style={[
                  styles.messageRow,
                  isUser ? styles.userRow : styles.assistantRow,
                ]}
              >
                <View
                  style={[
                    styles.messageBubble,
                    isUser
                      ? { backgroundColor: aurora.acc1 }
                      : { backgroundColor: colors.border },
                  ]}
                >
                  {m.attachments && m.attachments.length > 0 && (
                    <View style={styles.messageAttachments}>
                      {m.attachments.map((att, idx) => (
                        <View key={att.id || idx} style={styles.messageAttachmentChip}>
                          <Text
                            style={[
                              styles.messageAttachmentText,
                              { color: isUser ? aurora.onAccent : colors.text },
                            ]}
                          >
                            📷 {att.alt_text || 'Image'}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {m.content ? (
                    <Text
                      style={[
                        styles.messageText,
                        {
                          color: isUser ? aurora.onAccent : colors.text,
                          fontSize: sizes.text,
                        },
                      ]}
                    >
                      {m.content}
                    </Text>
                  ) : !m.attachments || m.attachments.length === 0 ? (
                    <Text
                      style={[
                        styles.messageText,
                        {
                          color: isUser ? aurora.onAccent : colors.text,
                          fontSize: sizes.text,
                        },
                      ]}
                    >
                      {isStreaming ? 'Thinking...' : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
        {isStreaming && (
          <View style={styles.assistantRow}>
            <View style={[styles.messageBubble, { backgroundColor: colors.border }]}>
              <ActivityIndicator size="small" color={aurora.acc1} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Staged attachments */}
      {attachments.length > 0 && (
        <View style={styles.attachmentsRow}>
          {attachments.map((att, idx) => (
            <View key={att.id || idx} style={styles.attachmentChip}>
              <Text style={[styles.attachmentText, { color: colors.text }]} numberOfLines={1}>
                {att.alt_text || 'Image attachment'}
              </Text>
              <Pressable
                onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Remove image attachment"
              >
                <Text style={[styles.removeChip, { color: recordTextColor }]}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Voice status if active */}
      {isRecording && (
        <View style={styles.voiceBar}>
          <ActivityIndicator size="small" color="#dc2626" />
          <Text style={[styles.voiceBarText, { color: recordTextColor, fontSize: sizes.sub }]}>
            Recording voice input... Tap mic to stop
          </Text>
        </View>
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, { borderTopColor: colors.border }]}>
        {enableImages && (
          <Pressable
            onPress={handlePickImage}
            hitSlop={8}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Attach image"
          >
            <Text style={styles.actionIcon}>📎</Text>
          </Pressable>
        )}

        {enableVoice && (
          <Pressable
            onPress={handleToggleVoice}
            hitSlop={8}
            style={[
              styles.actionBtn,
              isRecording && { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
            ]}
            accessibilityRole="button"
            accessibilityLabel={isRecording ? 'Stop voice recording' : 'Start voice recording'}
          >
            <Text style={styles.actionIcon}>{isRecording ? '⏹️' : '🎙️'}</Text>
          </Pressable>
        )}

        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Message Quick Chat..."
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text, fontSize: sizes.text }]}
          multiline
          maxLength={1000}
        />

        {isStreaming ? (
          <Pressable
            onPress={handleStopStream}
            hitSlop={8}
            style={[styles.sendBtn, { backgroundColor: '#dc2626' }]}
            accessibilityRole="button"
            accessibilityLabel="Stop generating response"
          >
            <Text style={[styles.sendIcon, { color: '#ffffff', fontSize: 13 }]}>■</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSend}
            disabled={(!input.trim() && attachments.length === 0) || isSubmitting}
            hitSlop={8}
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  input.trim() || attachments.length > 0
                    ? aurora.acc1
                    : 'rgba(120, 110, 140, 0.2)',
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={aurora.onAccent} />
            ) : (
              <Text style={[styles.sendIcon, { color: aurora.onAccent }]}>↑</Text>
            )}
          </Pressable>
        )}
      </View>
      <VoiceConsentModal
        visible={voice.state.consentProvider !== null}
        provider={voice.state.consentProvider ?? ''}
        onAccept={voice.acceptCloud}
        onDecline={voice.declineCloud}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 20,
    borderWidth: 1,
    zIndex: 9999,
    shadowColor: 'rgba(20, 15, 30, 0.45)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontWeight: '700',
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  syncText: {
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerBtn: {
    padding: 4,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    padding: 12,
    gap: 10,
  },
  emptyState: {
    paddingVertical: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    textAlign: 'center',
    lineHeight: 18,
  },
  messageRow: {
    flexDirection: 'row',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
  },
  messageAttachments: {
    marginBottom: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  messageAttachmentChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  messageAttachmentText: {
    fontSize: 12,
    fontWeight: '500',
  },
  messageText: {
    lineHeight: 20,
  },
  attachmentsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(100, 90, 130, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  attachmentText: {
    maxWidth: 140,
    fontSize: 12,
    color: '#ddd',
  },
  removeChip: {
    fontSize: 12,
    color: '#f87171',
    fontWeight: '700',
  },
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  voiceBarText: {
    fontWeight: '500',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 6,
  },
  actionBtn: {
    padding: 6,
    borderRadius: 16,
  },
  actionIcon: {
    fontSize: 18,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 90,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
});
