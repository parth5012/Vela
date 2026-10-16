/**
 * Module: client/app/browserStyles
 * Intent: Static stylesheet for the Browser route (extracted verbatim from browser.tsx pilot).
 * Responsibilities: Owns the `styles` object only; theme colors/sizes are applied inline at usage sites.
 * Public API: styles.
 * Invariants: All values are literals; no component-scope references — safe to move without behavior change.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  aiBanner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  aiBannerText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  urlInput: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  goButton: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    gap: 4,
  },
  toolbarButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toolbarButtonDisabled: {
    opacity: 0.4,
  },
  toolbarButtonText: {
    fontSize: 18,
  },
  titleContainer: {
    flex: 1,
    marginHorizontal: 8,
  },
  pageTitle: {
    fontWeight: '500',
  },
  webviewArea: {
    flex: 1,
  },
  emptyOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  auroraGlow: {
    position: 'absolute',
    top: '30%',
    left: '15%',
    right: '15%',
    height: 220,
    borderRadius: 120,
    opacity: 0.18,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 40,
    elevation: 0,
  },
  emptyContent: {
    alignItems: 'center',
    maxWidth: 360,
    width: '100%',
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyTitle: {
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySubtitle: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
    justifyContent: 'center',
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
  },
  quickIcon: {
    fontSize: 14,
  },
  quickLabel: {
    fontWeight: '600',
  },
  loadingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  loadingText: {
    fontWeight: '600',
  },
  errorOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  errorIcon: {
    fontSize: 32,
  },
  errorTitle: {
    fontWeight: '700',
    textAlign: 'center',
  },
  errorMessage: {
    textAlign: 'center',
    lineHeight: 20,
  },
  errorUrl: {
    textAlign: 'center',
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
  errorButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  errorButtonPrimary: {},
  errorButtonText: {
    fontWeight: '700',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalDescription: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: {
    fontWeight: '600',
    fontSize: 15,
  },
  cookieSyncButton: {
    position: 'relative',
    borderWidth: 1,
    borderRadius: 8,
    marginLeft: 2,
  },
  syncBadgeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  cookieModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  cookieModalCard: {
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  cookieModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cookieModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  cookieModalClose: {
    padding: 8,
  },
  cookieModalCloseText: {
    fontSize: 18,
    fontWeight: '700',
  },
});
