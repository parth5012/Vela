/**
 * Module: client/app/indexStyles
 * Intent: Static stylesheet for the Chat route (extracted verbatim from app/index.tsx).
 * Responsibilities: Owns the `styles` object only; values are literals.
 * Public API: styles.
 * Invariants: No component-scope references — safe to move without behavior change.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { Platform, StyleSheet } from 'react-native';
import { FONT_SIZES } from '../utils/theme';
import { DEFAULT_ELEVATION } from '../utils/elevation';

export const styles = StyleSheet.create({
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
  agentBar: {
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  agentBarScroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  agentBarCell: {
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  agentBarText: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  emptyThreadContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  // WF-447-06: the empty-chat block. One headline, one line of subtext, one
  // primary CTA; starters and agent picker sit quiet below it.
  emptyContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  emptyHeadline: {
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  emptySubtext: {
    textAlign: 'center',
    maxWidth: 340,
    marginBottom: 26,
  },
  emptyCta: {
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    // Certified e2 token (offset 4, opacity 0.24, radius 10, elevation 4) —
    // no ad-hoc values alongside it.
    ...DEFAULT_ELEVATION.e2,
  },
  emptyCtaText: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // WF-447-06 peak device: the assistant answer arrives once (opacity + slight
  // rise), then fills in as one composed block. Wrapper is layout-only.
  answerEntrance: {
    width: '100%',
  },
  // WF-447-06 authored silence: the quiet single line held while the first
  // tokens stream. Colour/size come from the theme at the call site.
  quietStreamLine: {
    marginTop: 12,
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  messageRow: {
    marginVertical: 8,
    width: '100%',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    maxWidth: '88%',
    shadowColor: '#1D1B20',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  userBubble: {
    borderTopRightRadius: 8,
  },
  assistantBubble: {
    borderTopLeftRadius: 8,
  },
  senderLabel: {
    fontSize: FONT_SIZES.small.sub,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  messageText: {
    lineHeight: FONT_SIZES.medium.lineHeight,
    letterSpacing: FONT_SIZES.medium.letterSpacing,
  },
  rawText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: FONT_SIZES.medium.lineHeight,
  },
  thoughtNestingContainer: {
    width: '100%',
    marginBottom: 8,
  },
  sourcesTitleLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sourcesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 4,
  },
  actionBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  welcomeScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 36,
  },
  welcomeContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  welcomeLogo: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 10,
    marginBottom: 16,
  },
  sectionTitleLabel: {
    alignSelf: 'flex-start',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  suggestionsContainer: {
    width: '100%',
    gap: 10,
    marginBottom: 20,
  },
  suggestionCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    shadowColor: DEFAULT_ELEVATION.e2.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  suggestionText: {
    lineHeight: FONT_SIZES.medium.lineHeight,
    letterSpacing: FONT_SIZES.medium.letterSpacing,
  },
  agentScrollContainer: {
    gap: 10,
    paddingVertical: 6,
  },
  agentPill: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  agentPillText: {
    fontWeight: '600',
    letterSpacing: 0.2,
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
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 36,
    justifyContent: 'center',
  },
  switcherLabel: {
    fontSize: FONT_SIZES.small.text,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  downloadProgressText: {
    fontSize: FONT_SIZES.small.text,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  skillIndicator: {
    marginHorizontal: 14,
    marginTop: 8,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  skillIndicatorText: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  inputWrapper: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
    shadowColor: DEFAULT_ELEVATION.e2.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 4,
  },
  input: {
    flex: 1,
    paddingHorizontal: 0,
    paddingVertical: 8,
    maxHeight: 120,
  },
  sendButton: {
    borderRadius: 22,
    minWidth: 44,
    height: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  permissionPromptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
    padding: 16,
  },
});
