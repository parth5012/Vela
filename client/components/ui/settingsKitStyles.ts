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
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
  },
  backBtn: {
    minWidth: 64,
    paddingVertical: 8,
  },
  backText: {
    fontWeight: '600',
  },
  headerTitle: {
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  subtitle: {
    lineHeight: 18,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 20,
  },
  nonScrollContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: 2,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontWeight: '500',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {},
  primary: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryText: {
    fontWeight: '600',
  },
  secondary: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryText: {
    fontWeight: '600',
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  dangerText: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '600',
  },
  accentDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
