/**
 * Module: client/components/ui/settingsKitStyles
 * Intent: Static stylesheet for the settingsKit UI primitives following Modern Precision standards.
 * Public API: styles.
 * Invariants: Shared styles object for AuroraScreen/Card/Section/Field/Pill/Chip/Button primitives.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet, Platform } from 'react-native';

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
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  backBtn: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  backText: {
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  headerTitle: {
    fontWeight: '600',
    letterSpacing: -0.2,
    textAlign: 'center',
    flexShrink: 1,
  },
  subtitle: {
    lineHeight: 18,
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 10,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  nonScrollContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  sectionTitle: {
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    height: 42,
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
    borderRadius: 8,
    paddingVertical: 9,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    letterSpacing: -0.1,
  },
  primary: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryText: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  secondary: {
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryText: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  dangerText: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
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
