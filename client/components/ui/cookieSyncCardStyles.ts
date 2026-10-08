/**
 * Module: client/components/ui/cookieSyncCardStyles
 * Intent: Static stylesheet for CookieSyncCard (extracted verbatim).
 * Public API: styles.
 * Invariants: No component-scope references — safe to move without behavior change.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    lineHeight: 20,
  },
  title: {
    fontWeight: '700',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeText: {
    fontWeight: '600',
  },
  subtitle: {
    lineHeight: 16,
  },
  lastSync: {
    fontStyle: 'italic',
  },
  pickButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  previewCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewTotal: {
    fontWeight: '600',
  },
  selectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    fontWeight: '600',
  },
  domainList: {
    maxHeight: 220,
  },
  domainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  domainInfo: {
    flex: 1,
    gap: 2,
  },
  domainText: {
    fontWeight: '500',
  },
  domainCount: {},
  applyButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  applyText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  statusMsg: {
    textAlign: 'center',
    lineHeight: 16,
  },
  privacyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  privacyCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  privacyTitle: {
    fontWeight: '700',
  },
  privacyBody: {
    lineHeight: 20,
  },
  privacyActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  privacyButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  privacyCancel: {
    backgroundColor: 'transparent',
  },
  privacyButtonText: {
    fontWeight: '600',
    fontSize: 15,
  },
});
