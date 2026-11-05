/**
 * Module: client/components/ui/settingsKitStyles
 * Intent: Static stylesheet for the settingsKit UI primitives (Flair redesign).
 * Public API: styles.
 * Invariants: Shared styles object for AuroraScreen/Card/Section/Field/Pill/Chip/Button primitives.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet } from 'react-native';
import { DEFAULT_ELEVATION, edgeLight } from '../../utils/elevation';

// VELA "Flair" design language: soft tonal surfaces, oversized rounded shapes,
// full-radius pills and buttons, gentle elevation instead of glass-dark fills.
export const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backBtn: {
    minWidth: 72,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 999,
  },
  backText: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerTitle: {
    fontWeight: '900',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  subtitle: {
    lineHeight: 19,
    paddingHorizontal: 22,
    marginBottom: 14,
    opacity: 0.9,
  },
  content: {
    padding: 20,
    paddingBottom: 56,
    gap: 16,
  },
  nonScrollContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
    gap: 14,
    ...edgeLight,
    shadowColor: DEFAULT_ELEVATION.e1.shadowColor,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 2,
  },
  sectionTitle: {
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    opacity: 0.85,
  },
  input: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 50,
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
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  pillText: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 38,
  },
  chipText: {
    fontWeight: '600',
  },
  primary: {
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryText: {
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  secondary: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryText: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  danger: {
    backgroundColor: 'rgba(217, 72, 43, 0.1)',
    borderColor: 'rgba(217, 72, 43, 0.3)',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  dangerText: {
    color: '#B8381F',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  accentDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
