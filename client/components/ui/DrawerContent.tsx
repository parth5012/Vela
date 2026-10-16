import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { styles } from './drawerContentStyles';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { useConfigStore } from '../../store/useConfigStore';
import { useChatStore, Thread } from '../../store/useChatStore';
import { useBrowserStore } from '../../store/useBrowserStore';
import ThreadOptionsModal from './ThreadOptionsModal';
import ThreadRow from './ThreadRow';
import { THEME_COLORS, FONT_SIZES, ACCENT_COLORS, getAurora } from '../../utils/theme';
import { syncHistoryWithBackend } from '../../utils/history';

const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Wayfinder #173 Audit — Drawer
 * Recent chats: derived from useChatStore threads sorted pinned-first then updated_at desc (isNaN-guarded).
 * Each thread: title + is_pinned prefix '📌 ' + streaming ActivityIndicator + timestamp via formatDistanceToNow (not date-fns).
 * No swipe-to-delete yet (needs gesture lib); overflow via ThreadOptionsModal onLongPress 450ms (delayLongPress={450}).
 * Browser top placement verified: isBrowserActive accent borderLeft aurora.acc1 — no move.
 * Spec #174: timestamp 'Xm ago' (just now/5m ago/3h ago/2d ago) as threadTimestamp 11px colors.textDark under title; threadItem flex row space-between 10/12 padding 6 radius; active bg colors.card text 500, muted textMuted, pinned 600; footer 4 items Chat/Refresh/Tasks/Settings each Pressable accessibilityRole button minHeight 48 textMuted pressed bg colors.card; sectionTitle 11px 700 uppercase textDark; WCAG AA textMuted #a9a6c8 on bg #0b0b1a >4.5:1.
 */
export default function DrawerContent(_props?: any) {
  const threads = useChatStore((state) => state.threads);
  const activeThreadId = useChatStore((state) => state.activeThreadId);
  const createThread = useChatStore((state) => state.createThread);
  const selectThread = useChatStore((state) => state.selectThread);
  const streamingThreadIds = useChatStore((state) => state.streamingThreadIds);
  const { apiUrl, apiKey, theme, fontSize, accentColor, defaultAgent } = useConfigStore();
  const currentUrl = useBrowserStore((s) => s.currentUrl);
  const pageTitle = useBrowserStore((s) => s.pageTitle);
  const aiStatus = useBrowserStore((s) => s.aiStatus);
  const router = useRouter();
  const navigation = useNavigation<any>();

  const [isSyncing, setIsSyncing] = React.useState(false);

  const handleRefresh = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await syncHistoryWithBackend(apiUrl, apiKey);
    } catch (err) {
      console.error('[DrawerContent] Error refreshing chats:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const colors = THEME_COLORS[theme] || THEME_COLORS.deep;
  const sizes = FONT_SIZES[fontSize] || FONT_SIZES.medium;
  const accentHex = ACCENT_COLORS[accentColor] || ACCENT_COLORS.indigo;
  const aurora = getAurora(accentColor, theme);

  const isBrowserActive = currentUrl !== 'about:blank';
  const displayTitle = pageTitle && pageTitle.trim().length > 0 ? pageTitle : 'Browser';

  const [optionsVisible, setOptionsVisible] = React.useState(false);
  const [selectedThread, setSelectedThread] = React.useState<Thread | null>(null);

  const handleOpenOptions = (thread: Thread) => {
    setSelectedThread(thread);
    setOptionsVisible(true);
  };

  const handleCloseOptions = () => {
    setOptionsVisible(false);
    setSelectedThread(null);
  };

  const handleNewChat = () => {
    selectThread(null);
    router.navigate('/');
    if (typeof navigation.closeDrawer === 'function') {
      navigation.closeDrawer();
    }
  };

  const handleSelectThread = (id: string) => {
    selectThread(id);
    router.navigate('/');
    if (typeof navigation.closeDrawer === 'function') {
      navigation.closeDrawer();
    }
  };

  const handleSettings = () => {
    router.navigate('/settings');
    if (typeof navigation.closeDrawer === 'function') {
      navigation.closeDrawer();
    }
  };

const handleBrowser = () => {
  router.navigate('/browser');
  if (typeof navigation.closeDrawer === 'function') {
    navigation.closeDrawer();
  }
};

const handleTasks = () => {
  router.navigate('/tasks');
  if (typeof navigation.closeDrawer === 'function') {
    navigation.closeDrawer();
  }
};

const handleJournal = () => {
  router.navigate('/journal');
  if (typeof navigation.closeDrawer === 'function') {
    navigation.closeDrawer();
  }
};

  const sortedThreads = React.useMemo(() => {
    const list = Array.isArray(threads) ? threads : [];
    return [...list].sort((a, b) => {
      if (a?.is_pinned && !b?.is_pinned) return -1;
      if (!a?.is_pinned && b?.is_pinned) return 1;
      const timeA = a?.updated_at ? new Date(a.updated_at).getTime() : 0;
      const timeB = b?.updated_at ? new Date(b.updated_at).getTime() : 0;
      // Fallback to 0 if date is invalid (isNaN)
      const valA = isNaN(timeA) ? 0 : timeA;
      const valB = isNaN(timeB) ? 0 : timeB;
      return valB - valA;
    });
  }, [threads]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Pressable
        style={[styles.header, { borderBottomColor: colors.border }]}
        onPress={() => {
          router.navigate('/');
          if (typeof navigation?.closeDrawer === 'function') {
            navigation.closeDrawer();
          }
        }}
      >
        <Text style={[styles.logo, { color: accentHex }]}>VELA</Text>
        <Text style={[styles.nodeStatus, { color: colors.textDark }]} numberOfLines={1}>
          Node: {(apiUrl || '').replace(/^https?:\/\//, '')}
        </Text>
      </Pressable>

      {/* Browser — prominent top placement per #156 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Browser"
        onPress={handleBrowser}
        style={({ pressed }) => [
          styles.browserRow,
          {
            backgroundColor: isBrowserActive ? colors.glass : 'transparent',
            borderColor: isBrowserActive ? aurora.acc1 + '33' : colors.border,
            borderLeftColor: isBrowserActive ? aurora.acc1 : 'transparent',
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.browserRowInner}>
          <Text style={[styles.browserIcon]}>🌐</Text>
          <View style={styles.browserTextCol}>
            <View style={styles.browserTitleRow}>
              {isBrowserActive ? <View style={[styles.browserDot, { backgroundColor: aurora.acc1 }]} /> : null}
              <Text
                style={[
                  styles.browserTitle,
                  { color: isBrowserActive ? colors.text : colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {displayTitle}
              </Text>
            </View>
            {aiStatus !== null ? (
              <View style={styles.browserAiRow}>
                <View style={[styles.pulsingDot, { backgroundColor: aurora.acc1 }]} />
                <Text
                  style={[styles.browserAiText, { color: colors.textMuted }]}
                  numberOfLines={1}
                >
                  {aiStatus}
                </Text>
              </View>
            ) : isBrowserActive ? (
              <Text style={[styles.browserUrl, { color: colors.textDark }]} numberOfLines={1}>
                {currentUrl}
              </Text>
            ) : (
              <Text style={[styles.browserUrl, { color: colors.textDark }]} numberOfLines={1}>
                No page loaded
              </Text>
            )}
          </View>
          {aiStatus !== null ? (
            <ActivityIndicator size="small" color={aurora.acc1} style={{ marginLeft: 8 }} />
          ) : null}
        </View>
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.newChatButton, 
          { backgroundColor: colors.card, borderColor: colors.border },
          pressed && styles.newChatButtonPressed
        ]}
        onPress={handleNewChat}
        accessibilityRole="button"
      >
        <Text style={[styles.newChatButtonText, { color: colors.text }]}>+ New Conversation</Text>
      </Pressable>

      <ScrollView style={styles.threadsContainer} contentContainerStyle={styles.threadsContent}>
        <Text style={[styles.sectionTitle, { color: colors.textDark }]}>Recent Chats</Text>
        {sortedThreads.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textDark }]}>No chats yet</Text>
        ) : (
          sortedThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              streaming={!!streamingThreadIds?.has(thread.id)}
              colors={colors}
              accentHex={accentHex}
              onSelect={handleSelectThread}
              onOpenOptions={handleOpenOptions}
            />
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.settingsButton, 
            pressed && styles.settingsButtonPressed, 
            pressed && { backgroundColor: colors.card },
            { marginBottom: 8, minHeight: 48, justifyContent: 'center' }
          ]}
          onPress={() => {
            router.navigate('/');
            if (typeof navigation.closeDrawer === 'function') {
              navigation.closeDrawer();
            }
          }}
        >
          <Text style={[styles.settingsButtonText, { color: colors.textMuted }]}>💬 Chat</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.settingsButton, 
            pressed && styles.settingsButtonPressed,
            pressed && { backgroundColor: colors.card },
            { marginBottom: 8, flexDirection: 'row', alignItems: 'center', minHeight: 48 }
          ]}
          onPress={handleRefresh}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <ActivityIndicator size="small" color={accentHex} style={{ marginRight: 10 }} />
          ) : (
            <Text style={{ marginRight: 10, fontSize: 14 }}>🔄</Text>
          )}
          <Text style={[styles.settingsButtonText, { color: colors.textMuted }]}>
            {isSyncing ? 'Syncing...' : 'Refresh Chats'}
          </Text>
        </Pressable>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.settingsButton,
          pressed && styles.settingsButtonPressed,
          pressed && { backgroundColor: colors.card },
          { marginBottom: 8, minHeight: 48, justifyContent: 'center' }
        ]}
        onPress={handleTasks}
      >
        <Text style={[styles.settingsButtonText, { color: colors.textMuted }]}>📋 Tasks</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.settingsButton,
          pressed && styles.settingsButtonPressed,
          pressed && { backgroundColor: colors.card },
          { marginBottom: 8, minHeight: 48, justifyContent: 'center' }
        ]}
        onPress={handleJournal}
      >
        <Text style={[styles.settingsButtonText, { color: colors.textMuted }]}>📝 Journal</Text>
      </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.settingsButton, 
            pressed && styles.settingsButtonPressed,
            pressed && { backgroundColor: colors.card },
            { minHeight: 48, justifyContent: 'center' }
          ]}
          onPress={handleSettings}
        >
          <Text style={[styles.settingsButtonText, { color: colors.textMuted }]}>⚙ Settings</Text>
        </Pressable>
      </View>

      <ThreadOptionsModal
        visible={optionsVisible}
        thread={selectedThread}
        onClose={handleCloseOptions}
      />
    </SafeAreaView>
  );
}
