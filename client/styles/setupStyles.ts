/**
 * Module: client/app/setupStyles
 * Intent: Static stylesheet for the Setup route (extracted verbatim from setup.tsx).
 * Responsibilities: Owns the `styles` object only; all values are hardcoded literals.
 * Public API: styles.
 * Invariants: No component-scope references — safe to move without behavior change.
 * Side Effects: none (StyleSheet.create is pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { StyleSheet } from 'react-native';
import { FONT_SIZES } from '../utils/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  innerContainer: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    fontSize: FONT_SIZES.small.logo,
    fontWeight: '900',
    color: '#818cf8',
    /* Branded wordmark keeps its wide tracking; token only sets the size. */
    letterSpacing: 4,
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#f4f4f5',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.medium.text,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: FONT_SIZES.medium.lineHeight,
    paddingHorizontal: 16,
  },
  forkContainer: {
    gap: 16,
  },
  forkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  forkCardPressed: {
    backgroundColor: '#27272a',
    borderColor: '#6366f1',
  },
  forkIcon: {
    fontSize: FONT_SIZES.medium.logo,
    marginRight: 16,
  },
  forkTextContainer: {
    flex: 1,
  },
  forkTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f4f4f5',
    marginBottom: 4,
  },
  forkSubtitle: {
    fontSize: 13,
    color: '#a1a1aa',
    lineHeight: FONT_SIZES.medium.subLineHeight,
  },
  forkArrow: {
    fontSize: 24,
    color: '#71717a',
    marginLeft: 8,
  },
  formContainer: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  backButton: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: '#818cf8',
    fontSize: FONT_SIZES.medium.text,
    fontWeight: '600',
  },
  subtabContainer: {
    flexDirection: 'row',
    backgroundColor: '#09090b',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  subtab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  subtabActive: {
    backgroundColor: '#27272a',
  },
  subtabText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
  },
  subtabTextActive: {
    color: '#f4f4f5',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  pill: {
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#09090b',
  },
  pillSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
  },
  pillText: {
    color: '#a1a1aa',
    fontSize: FONT_SIZES.small.text,
    fontWeight: '600',
  },
  pillTextSelected: {
    color: '#f4f4f5',
  },
  localInfoContainer: {
    marginBottom: 16,
  },
  localTitle: {
    color: '#f4f4f5',
    fontSize: FONT_SIZES.small.title,
    fontWeight: '700',
    marginBottom: 4,
  },
  localSubtitle: {
    color: '#a1a1aa',
    fontSize: FONT_SIZES.medium.text,
    lineHeight: FONT_SIZES.medium.lineHeight,
  },
  modelInfoCard: {
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  modelNameLabel: {
    color: '#818cf8',
    fontWeight: '700',
    fontSize: FONT_SIZES.medium.text,
  },
  modelHint: {
    color: '#71717a',
    fontSize: FONT_SIZES.small.text,
    marginTop: 4,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: FONT_SIZES.small.text,
    fontWeight: '600',
    color: '#a1a1aa',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#f4f4f5',
    fontSize: 15,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    marginBottom: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonPressed: {
    backgroundColor: '#4f46e5',
  },
  buttonDisabled: {
    backgroundColor: '#3730a3',
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  successText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 14,
    textAlign: 'center',
  },
  // #556: permissions step — independent rows, one OS dialog each.
  permRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  permIcon: {
    fontSize: FONT_SIZES.medium.logo,
    marginTop: 2,
  },
  permTextContainer: {
    flex: 1,
  },
  permTitle: {
    color: '#f4f4f5',
    fontSize: FONT_SIZES.medium.text,
    fontWeight: '700',
    marginBottom: 2,
  },
  permRationale: {
    color: '#a1a1aa',
    fontSize: FONT_SIZES.medium.sub,
    lineHeight: FONT_SIZES.medium.subLineHeight,
    marginBottom: 4,
  },
  permStatus: {
    color: '#71717a',
    fontSize: FONT_SIZES.medium.sub,
    fontWeight: '600',
  },
  permActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  permBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  permBtnPressed: {
    opacity: 0.8,
  },
  permBtnText: {
    color: '#ffffff',
    fontSize: FONT_SIZES.medium.sub,
    fontWeight: '600',
  },
  permSkip: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  permSkipText: {
    color: '#a1a1aa',
    fontSize: FONT_SIZES.medium.sub,
    fontWeight: '600',
  },
});
