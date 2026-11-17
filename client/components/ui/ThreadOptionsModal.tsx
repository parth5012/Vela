import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Animated,
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  Share,
  KeyboardAvoidingView,
  Alert,
  StyleSheet,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { styles } from './threadOptionsStyles';
import { Thread, useChatStore } from '../../store/useChatStore';
import PressableScale from './PressableScale';
import { DURATIONS, EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface ThreadOptionsModalProps {
  visible: boolean;
  thread: Thread | null;
  onClose: () => void;
}

export default function ThreadOptionsModal({
  visible,
  thread,
  onClose,
}: ThreadOptionsModalProps) {
  const { togglePinThread, renameThread, deleteThread, messages } = useChatStore();
  const [isEditing, setIsEditing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [cachedThread, setCachedThread] = useState<Thread | null>(null);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(64)).current;
  const reducedMotion = useReducedMotion();

  const handleDismiss = useCallback(() => {
    if (reducedMotion) {
      onClose();
      return;
    }
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 160,
        easing: EASING.out,
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: 64,
        duration: 160,
        easing: EASING.out,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        onClose();
      }
    });
  }, [reducedMotion, overlayOpacity, sheetTranslateY, onClose]);

  useEffect(() => {
    if (visible) {
      if (reducedMotion) {
        overlayOpacity.setValue(1);
        sheetTranslateY.setValue(0);
        return;
      }
      overlayOpacity.setValue(0);
      sheetTranslateY.setValue(64);
      const anim = Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: DURATIONS.reveal,
          easing: EASING.out,
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: 0,
          duration: DURATIONS.reveal,
          easing: EASING.out,
          useNativeDriver: true,
        }),
      ]);
      anim.start();
      return () => anim.stop();
    }
  }, [visible, reducedMotion, overlayOpacity, sheetTranslateY]);

  useEffect(() => {
    if (thread) {
      setCachedThread(thread);
    }
  }, [thread]);

  useEffect(() => {
    if (visible && thread) {
      setIsEditing(false);
      setNewTitle(thread.title);
    }
  }, [visible, thread]);

  if (!thread && !cachedThread) {
    return null;
  }

  // Active thread to use for UI and functions (either prop thread or cached fallback)
  const activeThread = thread || cachedThread;

  if (!activeThread) {
    return null;
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Conversation Title: ${activeThread.title}\nID: ${activeThread.id}`,
      });
    } catch (error) {
      console.error('Error sharing thread:', error);
    }
    onClose();
  };

  const handleExportMarkdown = async () => {
    try {
      const threadMsgs = messages[activeThread.id] || [];
      if (threadMsgs.length === 0) {
        Alert.alert('Info', 'This conversation has no messages to export.');
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const cleanTitle = activeThread.title
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()
        .slice(0, 30);
      const filename = `vela-chat-${cleanTitle || 'export'}-${dateStr}.md`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      let mdContent = `# Vela Chat: ${activeThread.title}\n`;
      mdContent += `*Exported on: ${new Date().toLocaleString()}*\n`;
      mdContent += `*Agent: ${activeThread.agent || 'personal assistant'}*\n`;
      mdContent += `*ID: ${activeThread.id}*\n\n`;
      mdContent += `---\n\n`;

      threadMsgs.forEach((msg) => {
        const isUser = msg.role === 'user';
        mdContent += `### ${isUser ? '👤 User' : '🤖 Vela Agent'}\n\n`;
        mdContent += `${msg.content}\n\n`;
        mdContent += `---\n\n`;
      });

      await FileSystem.writeAsStringAsync(fileUri, mdContent, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri, { mimeType: 'text/markdown', dialogTitle: 'Export Chat' });
    } catch (err: any) {
      console.error('Error exporting markdown:', err);
      Alert.alert('Error', 'Failed to export chat.');
    }
    onClose();
  };

  const handleExportJson = async () => {
    try {
      const threadMsgs = messages[activeThread.id] || [];
      if (threadMsgs.length === 0) {
        Alert.alert('Info', 'This conversation has no messages to export.');
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const cleanTitle = activeThread.title
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()
        .slice(0, 30);
      const filename = `vela-chat-${cleanTitle || 'export'}-${dateStr}.json`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      const exportData = {
        thread: {
          id: activeThread.id,
          title: activeThread.title,
          agent: activeThread.agent,
          updated_at: activeThread.updated_at,
        },
        messages: threadMsgs,
        exported_at: new Date().toISOString(),
      };

      const jsonContent = JSON.stringify(exportData, null, 2);

      await FileSystem.writeAsStringAsync(fileUri, jsonContent, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Export Chat as JSON' });
    } catch (err: any) {
      console.error('Error exporting JSON:', err);
      Alert.alert('Error', 'Failed to export chat.');
    }
    onClose();
  };

  const handleTogglePin = () => {
    togglePinThread(activeThread.id);
    onClose();
  };

  const handleSaveRename = () => {
    if (!newTitle.trim()) return;
    renameThread(activeThread.id, newTitle.trim());
    onClose();
  };

  const handleCancelRename = () => {
    setIsEditing(false);
    setNewTitle(activeThread.title);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Conversation',
      'Are you sure you want to delete this conversation? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteThread(activeThread.id);
            onClose();
          },
        },
      ]
    );
  };

  const isSaveDisabled = !newTitle.trim();

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      onRequestClose={handleDismiss}
    >
      <Pressable
        style={styles.overlay}
        accessibilityRole="button"
        accessibilityLabel="Close thread options"
        onPress={handleDismiss}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(2, 6, 23, 0.75)', opacity: overlayOpacity },
          ]}
          pointerEvents="none"
        />
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.keyboardAvoid}
        >
          <Animated.View
            style={[
              styles.modalContent,
              { transform: reducedMotion ? [] : [{ translateY: sheetTranslateY }] },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.dragHandle} />

            {!isEditing ? (
              <View>
                <Text style={styles.title} numberOfLines={1}>
                  {activeThread.title}
                </Text>

                <PressableScale
                  scaleTo={0.97}
                  accessibilityRole="button"
                  accessibilityLabel="Share Conversation"
                  style={({ pressed }) => [
                    styles.optionButton,
                    pressed && styles.optionButtonPressed,
                  ]}
                  onPress={handleShare}
                >
                  <Text style={styles.optionIcon}>📤</Text>
                  <Text style={styles.optionButtonText}>Share Conversation</Text>
                </PressableScale>

                <PressableScale
                  scaleTo={0.97}
                  accessibilityRole="button"
                  accessibilityLabel="Export as Markdown"
                  style={({ pressed }) => [
                    styles.optionButton,
                    pressed && styles.optionButtonPressed,
                  ]}
                  onPress={handleExportMarkdown}
                >
                  <Text style={styles.optionIcon}>📄</Text>
                  <Text style={styles.optionButtonText}>Export as Markdown (.md)</Text>
                </PressableScale>

                <PressableScale
                  scaleTo={0.97}
                  accessibilityRole="button"
                  accessibilityLabel="Export as JSON"
                  style={({ pressed }) => [
                    styles.optionButton,
                    pressed && styles.optionButtonPressed,
                  ]}
                  onPress={handleExportJson}
                >
                  <Text style={styles.optionIcon}>⚙️</Text>
                  <Text style={styles.optionButtonText}>Export as JSON (.json)</Text>
                </PressableScale>

                <PressableScale
                  scaleTo={0.97}
                  accessibilityRole="button"
                  accessibilityLabel={activeThread.is_pinned ? 'Unpin Thread' : 'Pin Thread'}
                  style={({ pressed }) => [
                    styles.optionButton,
                    pressed && styles.optionButtonPressed,
                  ]}
                  onPress={handleTogglePin}
                >
                  <Text style={styles.optionIcon}>📌</Text>
                  <Text style={styles.optionButtonText}>
                    {activeThread.is_pinned ? 'Unpin Thread' : 'Pin Thread'}
                  </Text>
                </PressableScale>

                <PressableScale
                  scaleTo={0.97}
                  accessibilityRole="button"
                  accessibilityLabel="Rename Thread"
                  style={({ pressed }) => [
                    styles.optionButton,
                    pressed && styles.optionButtonPressed,
                  ]}
                  onPress={() => setIsEditing(true)}
                >
                  <Text style={styles.optionIcon}>✏️</Text>
                  <Text style={styles.optionButtonText}>Rename Thread</Text>
                </PressableScale>

                <PressableScale
                  scaleTo={0.97}
                  accessibilityRole="button"
                  accessibilityLabel="Delete Thread"
                  style={({ pressed }) => [
                    styles.optionButton,
                    styles.destructiveButton,
                    pressed && styles.destructiveButtonPressed,
                  ]}
                  onPress={handleDelete}
                >
                  <Text style={[styles.optionIcon, styles.destructiveIcon]}>🗑️</Text>
                  <Text style={[styles.optionButtonText, styles.destructiveButtonText]}>
                    Delete Thread
                  </Text>
                </PressableScale>

                <PressableScale
                  scaleTo={0.96}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  style={({ pressed }) => [
                    styles.cancelButton,
                    pressed && styles.cancelButtonPressed,
                  ]}
                  onPress={handleDismiss}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </PressableScale>
              </View>
            ) : (
              <View>
                <Text style={styles.editHeader}>Rename Thread</Text>
                <TextInput
                  style={styles.textInput}
                  accessibilityLabel="New thread title"
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="Enter new title..."
                  placeholderTextColor="#475569"
                  autoFocus
                  selectTextOnFocus
                />
                <View style={styles.editActionRow}>
                  <PressableScale
                    scaleTo={0.96}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    style={({ pressed }) => [
                      styles.editActionButton,
                      styles.editCancelButton,
                      pressed && styles.editCancelButtonPressed,
                    ]}
                    onPress={handleCancelRename}
                  >
                    <Text style={styles.editCancelButtonText}>Cancel</Text>
                  </PressableScale>
                  <PressableScale
                    scaleTo={0.96}
                    accessibilityRole="button"
                    accessibilityLabel="Save"
                    accessibilityState={{ disabled: isSaveDisabled }}
                    style={({ pressed }) => [
                      styles.editActionButton,
                      styles.editSaveButton,
                      isSaveDisabled && styles.editSaveButtonDisabled,
                      pressed && !isSaveDisabled && styles.editSaveButtonPressed,
                    ]}
                    onPress={handleSaveRename}
                    disabled={isSaveDisabled}
                  >
                    <Text
                      style={[
                        styles.editSaveButtonText,
                        isSaveDisabled && styles.editSaveButtonTextDisabled,
                      ]}
                    >
                      Save
                    </Text>
                  </PressableScale>
                </View>
              </View>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
