import { useDeviceSessionStore } from '../store/useDeviceSessionStore';

describe('useDeviceSessionStore', () => {
  beforeEach(() => {
    useDeviceSessionStore.getState().resetSession();
  });

  it('starts and stops automation session cleanly', () => {
    expect(useDeviceSessionStore.getState().isAutomationRunning).toBe(false);

    useDeviceSessionStore.getState().startAutomationSession('device_tap', '@e1', 'click');

    const state = useDeviceSessionStore.getState();
    expect(state.isAutomationRunning).toBe(true);
    expect(state.activeToolName).toBe('device_tap');
    expect(state.activeTarget).toBe('@e1');
    expect(state.activeValue).toBe('click');

    useDeviceSessionStore.getState().stopAutomationSession('Completed');

    const finalState = useDeviceSessionStore.getState();
    expect(finalState.isAutomationRunning).toBe(false);
    expect(finalState.activeToolName).toBeNull();
    expect(finalState.actionHistory.length).toBe(1);
    expect(finalState.actionHistory[0].summary).toContain('Completed');
  });

  it('records actions and enforces the 50-item circular buffer ceiling', () => {
    for (let i = 0; i < 60; i++) {
      useDeviceSessionStore.getState().recordAction({
        toolName: 'device_tap',
        target: `@e${i}`,
        outcome: 'executed',
        summary: `Action ${i} executed`,
      });
    }

    const history = useDeviceSessionStore.getState().actionHistory;
    expect(history.length).toBe(50);
    // Most recent action is first
    expect(history[0].target).toBe('@e59');
  });

  it('triggers kill switch and records [Aborted by User] event', () => {
    useDeviceSessionStore.getState().startAutomationSession('device_type', '@e2', 'hello');

    useDeviceSessionStore.getState().triggerKillSwitch('volume_key');

    const state = useDeviceSessionStore.getState();
    expect(state.isAutomationRunning).toBe(false);
    expect(state.killSwitchTriggered).toBe(true);
    expect(state.killSwitchSource).toBe('volume_key');
    expect(state.actionHistory.length).toBe(1);
    expect(state.actionHistory[0].outcome).toBe('aborted');
    expect(state.actionHistory[0].summary).toContain('[Aborted by User]');
    expect(state.actionHistory[0].summary).toContain('volume_key');
  });

  it('stores and checks session-level bypasses without persistence', () => {
    expect(useDeviceSessionStore.getState().isCategoryBypassed('send_communication')).toBe(false);

    useDeviceSessionStore.getState().setSessionBypass('send_communication', true);

    expect(useDeviceSessionStore.getState().isCategoryBypassed('send_communication')).toBe(true);
    expect(useDeviceSessionStore.getState().isCategoryBypassed('purchases')).toBe(false);
  });

  it('clears history when requested', () => {
    useDeviceSessionStore.getState().recordAction({
      toolName: 'device_info',
      outcome: 'executed',
      summary: 'Fetched device info',
    });
    expect(useDeviceSessionStore.getState().actionHistory.length).toBe(1);

    useDeviceSessionStore.getState().clearSessionHistory();
    expect(useDeviceSessionStore.getState().actionHistory.length).toBe(0);
  });

  it('handles overlapping action dispatches without clearing active session prematurely', () => {
    const store = useDeviceSessionStore.getState();

    // Action 1 starts
    store.startAutomationSession('device_tap', '@button1', 'Click');
    expect(useDeviceSessionStore.getState().isAutomationRunning).toBe(true);
    expect(useDeviceSessionStore.getState().pendingDispatches).toBe(1);

    // Action 2 starts before action 1 finishes
    store.startAutomationSession('device_type', '@field1', 'Text');
    expect(useDeviceSessionStore.getState().isAutomationRunning).toBe(true);
    expect(useDeviceSessionStore.getState().pendingDispatches).toBe(2);

    // Action 1 completes
    store.stopAutomationSession('Action 1 done');
    expect(useDeviceSessionStore.getState().isAutomationRunning).toBe(true);
    expect(useDeviceSessionStore.getState().pendingDispatches).toBe(1);
    expect(useDeviceSessionStore.getState().activeToolName).toBe('device_type');

    // Action 2 completes
    store.stopAutomationSession('Action 2 done');
    expect(useDeviceSessionStore.getState().isAutomationRunning).toBe(false);
    expect(useDeviceSessionStore.getState().pendingDispatches).toBe(0);
    expect(useDeviceSessionStore.getState().activeToolName).toBeNull();
  });
});
