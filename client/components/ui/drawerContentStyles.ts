/**
 * Module: client/components/ui/drawerContentStyles
 * Intent: Modern Precision / Shadcn-Linear style static stylesheet for DrawerContent.
 * Responsibilities: Owns the `styles` object with crisp 1px borders, concentric radii, and micro-typography.
 * Public API: styles.
 * Invariants: Pure StyleSheet.create.
 */
import { Platform, StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b',
  },
  logo: {
    fontSize: 18,
    fontWeight: '900',
    color: '#818cf8',
    letterSpacing: 4,
    marginBottom: 6,
  },
  nodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#121215',
    alignSelf: 'flex-start',
  },
  nodeStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  nodeStatus: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#71717a',
    letterSpacing: 0.2,
  },
  browserRow: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  browserRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  browserIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  browserTextCol: {
    flex: 1,
    gap: 2,
  },
  browserTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  browserDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.9,
  },
  browserTitle: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    letterSpacing: 0.2,
  },
  browserAiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  browserAiText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flexShrink: 1,
  },
  browserUrl: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.2,
  },
  newChatButton: {
    backgroundColor: '#121215',
    borderColor: '#27272a',
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  newChatButtonPressed: {
    backgroundColor: '#18181b',
    borderColor: '#3f3f46',
  },
  newChatButtonText: {
    color: '#f4f4f5',
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  threadsContainer: {
    flex: 1,
  },
  threadsContent: {
    paddingHorizontal: 14,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 8,
    paddingLeft: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emptyText: {
    fontSize: 13,
    color: '#52525b',
    textAlign: 'center',
    marginTop: 24,
  },
  threadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
    minHeight: 44,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activeThreadItem: {
    backgroundColor: '#18181b',
    borderColor: '#27272a',
  },
  threadTextCol: {
    flex: 1,
    marginRight: 8,
    gap: 3,
  },
  threadTitle: {
    fontSize: 13,
    color: '#a1a1aa',
    flex: 1,
    fontWeight: '400',
  },
  threadTimestamp: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  pinnedThreadTitle: {
    color: '#e4e4e7',
    fontWeight: '600',
  },
  activeThreadTitle: {
    color: '#f4f4f5',
    fontWeight: '600',
  },
  deleteButton: {
    padding: 6,
  },
  deleteButtonText: {
    color: '#52525b',
    fontSize: 12,
  },
  footer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#18181b',
    gap: 2,
  },
  settingsButton: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 44,
    justifyContent: 'center',
  },
  settingsButtonPressed: {
    backgroundColor: '#18181b',
    borderColor: '#27272a',
  },
  settingsButtonText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
