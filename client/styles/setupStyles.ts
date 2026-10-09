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
    fontSize: 24,
    fontWeight: '900',
    color: '#818cf8',
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
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 20,
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
    fontSize: 32,
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
    lineHeight: 18,
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
    fontSize: 14,
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
    fontSize: 12,
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
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  localSubtitle: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 20,
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
    fontSize: 14,
  },
  modelHint: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 4,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
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
});
