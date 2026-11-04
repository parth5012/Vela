import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useConfigStore } from '../store/useConfigStore';
import { THEME_COLORS, FONT_SIZES, ACCENT_COLORS, getAurora } from '../utils/theme';
import { OmniStreamController } from '../utils/omniStream';

export default function OmniLiveSessionScreen() {
  const router = useRouter();
  const { theme, fontSize, accentColor, apiUrl, apiKey } = useConfigStore();
  const colors = THEME_COLORS[theme] || THEME_COLORS.berry;
  const sizes = FONT_SIZES[fontSize] || FONT_SIZES.medium;
  const accentHex = ACCENT_COLORS[accentColor] || ACCENT_COLORS.indigo;
  const aurora = getAurora(accentColor, theme);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>(
    'connecting'
  );
  const [modelName, setModelName] = useState<string>('Liquid LFM-Omni');
  const [transcript, setTranscript] = useState<string>('');
  const [inputText, setInputText] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const controllerRef = useRef<OmniStreamController | null>(null);

  useEffect(() => {
    // Pulse animation for active session
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  useEffect(() => {
    const controller = new OmniStreamController();
    controllerRef.current = controller;

    const unsubs = [
      controller.on('session_ready', (evt) => {
        setStatus('connected');
        if (evt.model) setModelName(evt.model);
      }),
      controller.on('transcript_token', (evt) => {
        setIsSpeaking(true);
        setTranscript((prev) => prev + evt.text);
      }),
      controller.on('turn_complete', (evt) => {
        setIsSpeaking(false);
        if (evt.fullTranscript) {
          setTranscript(evt.fullTranscript);
        }
      }),
      controller.on('audio_chunk', () => {
        setIsSpeaking(true);
      }),
      controller.on('interrupted', () => {
        setIsSpeaking(false);
        setTranscript((prev) => prev + ' [interrupted]');
      }),
      controller.on('error', () => {
        setStatus('error');
      }),
      controller.on('close', () => {
        setStatus('disconnected');
      }),
    ];

    const hostUrl = apiUrl || 'http://localhost:8000';
    const authKey = apiKey || 'vela5012';

    controller
      .connect(hostUrl, authKey)
      .catch(() => {
        setStatus('error');
      });

    return () => {
      unsubs.forEach((u) => u());
      controller.disconnect();
    };
  }, [apiUrl, apiKey]);

  const handleSendPrompt = useCallback(() => {
    if (!inputText.trim() || !controllerRef.current || status !== 'connected') return;
    setTranscript('');
    controllerRef.current.sendTextPrompt(inputText.trim());
    setInputText('');
  }, [inputText, status]);

  const handleInterrupt = useCallback(() => {
    controllerRef.current?.interrupt();
  }, []);

  const handleEndSession = useCallback(() => {
    controllerRef.current?.disconnect();
    router.back();
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Session Bar */}
      <View style={[styles.headerBar, { borderBottomColor: colors.glassBorder }]}>
        <View style={styles.statusRow}>
          <Animated.View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  status === 'connected' ? '#10b981' : status === 'error' ? '#ef4444' : '#f59e0b',
                transform: [{ scale: status === 'connected' ? pulseAnim : 1 }],
              },
            ]}
          />
          <Text style={[styles.statusText, { color: colors.text, fontSize: sizes.sub }]}>
            {status === 'connected'
              ? `Live • ${modelName}`
              : status === 'connecting'
              ? 'Connecting to Omni stream...'
              : status === 'error'
              ? 'Connection Error'
              : 'Session Ended'}
          </Text>
        </View>

        <Pressable
          testID="omni-end-button"
          onPress={handleEndSession}
          style={[styles.endButton, { backgroundColor: '#ef4444' }]}
        >
          <Text style={styles.endButtonText}>End</Text>
        </Pressable>
      </View>

      {/* Main Viewport: Waveform & Visualizer */}
      <View style={styles.centerViewport}>
        <View style={[styles.visualizerOrb, { borderColor: aurora.acc1, backgroundColor: colors.glass }]}>
          <Animated.View
            style={[
              styles.innerPulse,
              {
                backgroundColor: aurora.acc2,
                opacity: isSpeaking ? 0.8 : 0.35,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
          <Text style={{ fontSize: 44 }}>{isSpeaking ? '🗣️' : '🎙️'}</Text>
        </View>

        {/* Live Subtitle Transcript Card */}
        <View
          style={[
            styles.transcriptCard,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <Text style={[styles.transcriptLabel, { color: aurora.acc1 }]}>Live Transcript</Text>
          <Text style={[styles.transcriptText, { color: colors.text, fontSize: sizes.text }]}>
            {transcript || (status === 'connected' ? 'Listening...' : 'Waiting for connection...')}
          </Text>
        </View>
      </View>

      {/* Controls Bar */}
      <View style={[styles.controlsBar, { borderTopColor: colors.glassBorder }]}>
        {/* Quick text input */}
        <View style={styles.inputRow}>
          <TextInput
            testID="omni-text-input"
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a prompt for Omni..."
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                backgroundColor: colors.glass,
                color: colors.text,
                borderColor: colors.glassBorder,
                fontSize: sizes.text,
              },
            ]}
            onSubmitEditing={handleSendPrompt}
          />
          <Pressable
            testID="omni-send-button"
            onPress={handleSendPrompt}
            disabled={status !== 'connected' || !inputText.trim()}
            style={[
              styles.sendButton,
              { backgroundColor: accentHex, opacity: status === 'connected' && inputText.trim() ? 1 : 0.5 },
            ]}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Send</Text>
          </Pressable>
        </View>

        {/* Interactive Controls */}
        <View style={styles.buttonsRow}>
          <Pressable
            testID="omni-mute-button"
            onPress={() => setIsMuted(!isMuted)}
            style={[
              styles.controlBtn,
              { backgroundColor: isMuted ? '#ef4444' : colors.glass, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={{ fontSize: 18 }}>{isMuted ? '🔇 Muted' : '🎤 Mute'}</Text>
          </Pressable>

          <Pressable
            testID="omni-interrupt-button"
            onPress={handleInterrupt}
            style={[styles.controlBtn, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
          >
            <Text style={{ fontSize: 18, color: colors.text }}>⚡ Interrupt</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  headerBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontWeight: '600',
  },
  endButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  endButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  centerViewport: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  visualizerOrb: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    position: 'relative',
  },
  innerPulse: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  transcriptCard: {
    width: '100%',
    minHeight: 110,
    maxHeight: 220,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  transcriptLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  transcriptText: {
    lineHeight: 22,
  },
  controlsBar: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginRight: 8,
  },
  sendButton: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  controlBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
