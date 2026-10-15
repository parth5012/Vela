/**
 * Module: client/components/ui/settingsKitStyles
 * Intent: Static stylesheet for the settingsKit UI primitives (extracted verbatim).
 * Public API: styles.
 * Invariants: Shared styles object for AuroraScreen/Card/Section/Field/Pill/Chip/Button primitives.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  backBtn: {
    minWidth: 64,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backText: {
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  headerTitle: {
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  subtitle: {
    lineHeight: 20,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  content: {
    padding: 18,
    paddingBottom: 48,
    gap: 18,
  },
  nonScrollContent: {
    flex: 1,
    paddingHorizontal: 18,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 3,
  },
  sectionTitle: {
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    flexGrow: 1,
    flexBasis: '28%',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  pillText: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
  },
  chipText: {
    fontWeight: '500',
  },
  primary: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryText: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondary: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryText: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.28)',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  dangerText: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  accentDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
