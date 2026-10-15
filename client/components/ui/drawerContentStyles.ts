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
    backgroundColor: '#0e0d0b',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2c2724',
  },
  logo: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 5,
    marginBottom: 4,
  },
  nodeStatus: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
  browserRow: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 6,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
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
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: 16,
    marginVertical: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 2,
  },
  newChatButtonPressed: {
    opacity: 0.85,
  },
  newChatButtonText: {
    fontWeight: '700',
    fontSize: 14,
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
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingLeft: 6,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
  },
  threadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activeThreadItem: {
    borderWidth: 1,
  },
  threadTextCol: {
    flex: 1,
    marginRight: 8,
    gap: 3,
  },
  threadTitle: {
    fontSize: 14,
    flex: 1,
    letterSpacing: 0.2,
  },
  threadTimestamp: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  pinnedThreadTitle: {
    fontWeight: '600',
  },
  activeThreadTitle: {
    fontWeight: '600',
  },
  deleteButton: {
    padding: 6,
  },
  deleteButtonText: {
    fontSize: 12,
  },
  footer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 4,
  },
  settingsButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'transparent',
    minHeight: 44,
  },
  settingsButtonPressed: {
    opacity: 0.8,
  },
  settingsButtonText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
