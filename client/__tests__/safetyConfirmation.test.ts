import { evaluateSafety, classifyAction, getCategoryLabel } from '../utils/safetyManager';
import { useConfigStore } from '../store/useConfigStore';
import { useSafetyStore } from '../store/useSafetyStore';
import { useDeviceSessionStore } from '../store/useDeviceSessionStore';

describe('Safety Confirmation & Session Bypass', () => {
  beforeEach(() => {
    useDeviceSessionStore.getState().resetSession();
    // Reset permissions to default
    useConfigStore.setState((s) => ({
      ...s,
      deviceAgentPermissions: {
        ...s.deviceAgentPermissions,
        send_communication: 'confirm',
        purchases: 'confirm',
        deletions: 'confirm',
      },
    }));
  });

  it('classifies sensitive communications and deletions into confirm tiers', () => {
    expect(classifyAction('device_sms')).toBe('send_communication');
    expect(getCategoryLabel('send_communication')).toBe('Send Communications');
    expect(classifyAction('device_open_app', 'Google Play Store')).toBe('play_installs');
  });

  it('bypasses confirmation modal when session bypass is active for category', async () => {
    const requestApprovalSpy = jest.spyOn(useSafetyStore.getState(), 'requestApproval');

    // Without bypass: requests approval
    const pendingPromise = evaluateSafety('device_sms', '1234567890', 'Hello there');
    expect(useSafetyStore.getState().pendingTask).not.toBeNull();

    // Resolve the pending prompt
    useSafetyStore.getState().resolvePending('success', 'User approved');
    const result = await pendingPromise;
    expect(result.status).toBe('success');

    // Enable session bypass for send_communication
    useDeviceSessionStore.getState().setSessionBypass('send_communication', true);

    // Second call: bypasses modal without calling requestApproval
    requestApprovalSpy.mockClear();
    const bypassResult = await evaluateSafety('device_sms', '1234567890', 'Second message');
    expect(bypassResult.status).toBe('success');
    expect(bypassResult.result).toContain('session bypass');
    expect(useSafetyStore.getState().pendingTask).toBeNull();
    expect(requestApprovalSpy).not.toHaveBeenCalled();

    requestApprovalSpy.mockRestore();
  });
});
