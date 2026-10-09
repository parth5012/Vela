/**
 * Module: client/components/ui/threadOptionsStyles
 * Intent: Static stylesheet for ThreadOptionsModal (extracted verbatim).
 * Public API: styles.
 * Invariants: No component-scope references — safe to move without behavior change.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { Platform, StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
    justifyContent: 'flex-end',
  },
  keyboardAvoid: {
    width: '100%',
  },
  modalContent: {
    backgroundColor: '#0b1329',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#1e294b',
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    width: '100%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#334155',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 20,
    textAlign: 'center',
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#111a36',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e294b',
  },
  optionButtonPressed: {
    backgroundColor: '#1b254b',
  },
  optionIcon: {
    fontSize: 18,
  },
  optionButtonText: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 12,
  },
  destructiveButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  destructiveButtonPressed: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  destructiveIcon: {
    // optional adjustments
  },
  destructiveButtonText: {
    color: '#f87171',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: 'transparent',
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cancelButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cancelButtonText: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '600',
  },
  // Rename view styles
  editHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 16,
    textAlign: 'center',
  },
  textInput: {
    backgroundColor: '#070b19',
    borderWidth: 1,
    borderColor: '#1e294b',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#f8fafc',
    fontSize: 15,
    marginBottom: 20,
  },
  editActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  editActionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  editCancelButton: {
    backgroundColor: '#111a36',
    borderColor: '#1e294b',
    marginRight: 10,
  },
  editCancelButtonPressed: {
    backgroundColor: '#1b254b',
  },
  editSaveButton: {
    backgroundColor: '#6366f1',
    borderColor: '#818cf8',
    marginLeft: 10,
  },
  editSaveButtonPressed: {
    backgroundColor: '#4f46e5',
  },
  editSaveButtonDisabled: {
    backgroundColor: 'rgba(99, 102, 241, 0.5)',
    borderColor: 'rgba(129, 140, 248, 0.5)',
    opacity: 0.5,
  },
  editCancelButtonText: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '600',
  },
  editSaveButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  editSaveButtonTextDisabled: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
});
