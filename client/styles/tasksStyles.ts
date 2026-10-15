/**
 * Module: client/app/tasksStyles
 * Intent: Static stylesheet for the Tasks route following Modern Precision standards.
 * Responsibilities: Owns the `styles` object only; all values are literals.
 * Public API: styles.
 * Invariants: No component-scope references — safe to move without behavior change.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet, Platform } from 'react-native';

export const styles = StyleSheet.create({
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginVertical: 12,
    gap: 8,
    paddingHorizontal: 2,
  },
  filterTab: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTabText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  listContainer: {
    flex: 1,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  emptyText: {
    textAlign: 'center',
    marginVertical: 40,
    fontSize: 14,
    letterSpacing: -0.2,
  },
  taskCard: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  taskTitle: {
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  taskDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  statusIndicator: {
    marginLeft: 8,
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardMeta: {
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  metaText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: -0.1,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 12,
    marginRight: 8,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 36,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  modalScreen: {
    flex: 1,
    alignItems: 'center',
  },
  modalScroll: {
    width: '100%',
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginVertical: 20,
  },
  inputGroup: {
    marginBottom: 16,
    width: '100%',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  textInput: {
    height: 42,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  recurrencePills: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  rPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
  },
  rPillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  detailMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  runCard: {
    padding: 12,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  runCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  outputContainer: {
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#09090b',
    marginTop: 6,
  },
});
