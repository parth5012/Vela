/**
 * Module: client/components/ui/drawerContentStyles
 * Intent: Static stylesheet for DrawerContent (extracted verbatim).
 * Public API: styles.
 * Invariants: No component-scope references — safe to move without behavior change.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b',
  },
  logo: {
    fontSize: 20,
    fontWeight: '900',
    color: '#818cf8',
    letterSpacing: 4,
    marginBottom: 4,
  },
  nodeStatus: {
    fontSize: 12,
    color: '#71717a',
  },
  browserRow: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 10,
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
    fontSize: 18,
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
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.9,
  },
  browserTitle: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  browserAiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  browserAiText: {
    fontSize: 11,
    flexShrink: 1,
  },
  browserUrl: {
    fontSize: 11,
  },
  newChatButton: {
    backgroundColor: '#18181b',
    borderColor: '#27272a',
    borderWidth: 1,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  newChatButtonPressed: {
    backgroundColor: '#27272a',
  },
  newChatButtonText: {
    color: '#f4f4f5',
    fontWeight: '600',
    fontSize: 14,
  },
  threadsContainer: {
    flex: 1,
  },
  threadsContent: {
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingLeft: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#3f3f46',
    textAlign: 'center',
    marginTop: 20,
  },
  threadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 4,
  },
  activeThreadItem: {
    backgroundColor: '#18181b',
  },
  threadTextCol: {
    flex: 1,
    marginRight: 8,
    gap: 2,
  },
  threadTitle: {
    fontSize: 14,
    color: '#a1a1aa',
    flex: 1,
  },
  threadTimestamp: {
    fontSize: 11,
  },
  pinnedThreadTitle: {
    color: '#e4e4e7',
    fontWeight: '600',
  },
  activeThreadTitle: {
    color: '#f4f4f5',
    fontWeight: '500',
  },
  deleteButton: {
    padding: 4,
  },
  deleteButtonText: {
    color: '#52525b',
    fontSize: 12,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#18181b',
  },
  settingsButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  settingsButtonPressed: {
    backgroundColor: '#18181b',
  },
  settingsButtonText: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '500',
  },
});
