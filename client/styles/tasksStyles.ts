/**
 * Module: client/app/tasksStyles
 * Intent: Static stylesheet for the Tasks route (extracted verbatim from tasks.tsx).
 * Responsibilities: Owns the `styles` object only; all values are literals.
 * Public API: styles.
 * Invariants: No component-scope references — safe to move without behavior change.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 12,
    gap: 8,
  },
  filterTab: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  listContainer: {
    flex: 1,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  emptyText: {
    textAlign: 'center',
    marginVertical: 40,
    fontSize: 14,
    letterSpacing: 0.2,
    lineHeight: 22,
  },
  taskCard: {
    padding: 18,
    marginBottom: 16,
    borderRadius: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  taskTitle: {
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  taskDesc: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
  },
  statusIndicator: {
    marginLeft: 10,
  },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    overflow: 'hidden',
    letterSpacing: 0.8,
  },
  cardMeta: {
    borderTopWidth: 1,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
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
    fontWeight: '600',
    marginRight: 8,
    letterSpacing: 0.2,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
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
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginVertical: 20,
    letterSpacing: 0.3,
  },
  inputGroup: {
    marginBottom: 18,
    width: '100%',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  textInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  recurrencePills: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  rPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 40,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
  },
  rPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 110,
    textAlignVertical: 'top',
    letterSpacing: 0.2,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 24,
    alignItems: 'center',
  },
  cancelBtn: {
    flex: 1,
    marginLeft: 8,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  detailHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  detailMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 12,
  },
  runCard: {
    padding: 16,
    marginBottom: 14,
    borderRadius: 16,
  },
  runCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  outputContainer: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
  },
});
