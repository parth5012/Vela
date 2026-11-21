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
import { DEFAULT_ELEVATION } from '../utils/elevation';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF7FE',
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
    color: '#801D78',
    /* Branded wordmark keeps its wide tracking; token only sets the size. */
    letterSpacing: 4,
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1D1B20',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.medium.text,
    color: '#4B4654',
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
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E8E0F2',
  },
  forkCardPressed: {
    backgroundColor: '#F3F0F7',
    borderColor: '#801D78',
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
    color: '#1D1B20',
  },
  forkTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  recommendedBadge: {
    backgroundColor: '#801D7824',
    borderColor: '#801D7866',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  recommendedBadgeText: {
    color: '#5B1155',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  forkSubtitle: {
    fontSize: 13,
    color: '#4B4654',
    lineHeight: FONT_SIZES.medium.subLineHeight,
  },
  forkArrow: {
    fontSize: 24,
    color: '#79747E',
    marginLeft: 8,
  },
  formContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E8E0F2',
    ...DEFAULT_ELEVATION.e1,
  },
  backButton: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: '#801D78',
    fontSize: FONT_SIZES.medium.text,
    fontWeight: '600',
  },
  subtabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3F0F7',
    borderRadius: 12,
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
    backgroundColor: '#FFFFFF',
    ...DEFAULT_ELEVATION.e1,
  },
  subtabText: {
    color: '#4B4654',
    fontSize: 13,
    fontWeight: '600',
  },
  subtabTextActive: {
    color: '#1D1B20',
    fontWeight: '700',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  pill: {
    borderWidth: 1,
    borderColor: '#E8E0F2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F3F0F7',
  },
  pillSelected: {
    borderColor: '#801D78',
    backgroundColor: 'rgba(109, 58, 232, 0.08)',
  },
  pillText: {
    color: '#4B4654',
    fontSize: FONT_SIZES.small.text,
    fontWeight: '600',
  },
  pillTextSelected: {
    color: '#801D78',
    fontWeight: '700',
  },
  localInfoContainer: {
    marginBottom: 16,
  },
  localTitle: {
    color: '#1D1B20',
    fontSize: FONT_SIZES.small.title,
    fontWeight: '700',
    marginBottom: 4,
  },
  localSubtitle: {
    color: '#4B4654',
    fontSize: FONT_SIZES.medium.text,
    lineHeight: FONT_SIZES.medium.lineHeight,
  },
  modelInfoCard: {
    backgroundColor: '#F3F0F7',
    borderWidth: 1,
    borderColor: '#E8E0F2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  modelNameLabel: {
    color: '#801D78',
    fontWeight: '700',
    fontSize: FONT_SIZES.medium.text,
  },
  modelHint: {
    color: '#79747E',
    fontSize: FONT_SIZES.small.text,
    marginTop: 4,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: FONT_SIZES.small.text,
    fontWeight: '700',
    color: '#79747E',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0F2',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#1D1B20',
    fontSize: 15,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#801D78',
    borderRadius: 22,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...DEFAULT_ELEVATION.e1,
  },
  buttonPressed: {
    backgroundColor: '#582bb8',
  },
  buttonDisabled: {
    backgroundColor: '#B59DEB',
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  successText: {
    color: '#16a34a',
    fontSize: 13,
    fontWeight: '600',
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
    borderBottomColor: '#E8E0F2',
  },
  permIcon: {
    fontSize: FONT_SIZES.medium.logo,
    marginTop: 2,
  },
  permTextContainer: {
    flex: 1,
  },
  permTitle: {
    color: '#1D1B20',
    fontSize: FONT_SIZES.medium.text,
    fontWeight: '700',
    marginBottom: 2,
  },
  permRationale: {
    color: '#4B4654',
    fontSize: FONT_SIZES.medium.sub,
    lineHeight: FONT_SIZES.medium.subLineHeight,
    marginBottom: 4,
  },
  permStatus: {
    color: '#79747E',
    fontSize: FONT_SIZES.medium.sub,
    fontWeight: '600',
  },
  permActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  permBtn: {
    backgroundColor: '#801D78',
    borderRadius: 16,
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
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E8E0F2',
    backgroundColor: '#F3F0F7',
  },
  permSkipText: {
    color: '#4B4654',
    fontSize: FONT_SIZES.medium.sub,
    fontWeight: '600',
  },
});
