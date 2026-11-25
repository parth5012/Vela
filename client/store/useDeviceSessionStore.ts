import { create } from 'zustand';

export interface SessionActionItem {
  id: string;
  timestamp: number;
  toolName: string;
  target?: string;
  value?: string;
  outcome: 'executed' | 'simulated' | 'failed' | 'aborted' | 'indeterminate' | 'unavailable';
  summary: string;
}

export interface SimplifiedDomNode {
  id: string;
  type: 'button' | 'input' | 'text' | 'image' | 'container';
  text?: string;
  bounds: [number, number, number, number];
  clickable: boolean;
  isPassword?: boolean;
  children?: SimplifiedDomNode[];
}

const MAX_HISTORY_ITEMS = 50;

interface DeviceSessionState {
  isAutomationRunning: boolean;
  activeToolName: string | null;
  activeTarget: string | null;
  activeValue: string | null;
  killSwitchTriggered: boolean;
  killSwitchSource: 'floating_button' | 'volume_key' | 'programmatic' | null;
  hasPendingWork: boolean;
  pendingDispatches: number;

  // Session-only ephemeral action history — zero disk persistence
  actionHistory: SessionActionItem[];

  // Session-level bypasses for confirm prompts (e.g. "Don't ask again this session")
  sessionBypasses: Record<string, boolean>;

  // Modals & UI states
  isAccessibilityModalVisible: boolean;
  isMirrorVisible: boolean;
  isHistoryVisible: boolean;
  screenMirrorHierarchy: SimplifiedDomNode[] | null;
  isScreenMirrorLoading: boolean;

  // Actions
  startAutomationSession: (toolName?: string, target?: string, value?: string) => void;
  stopAutomationSession: (reason?: string) => void;
  triggerKillSwitch: (source?: 'floating_button' | 'volume_key' | 'programmatic') => void;
  resetKillSwitch: () => void;
  setPendingWork: (pending: boolean) => void;
  recordAction: (item: Omit<SessionActionItem, 'id' | 'timestamp'>) => void;
  clearSessionHistory: () => void;
  setSessionBypass: (category: string, bypass: boolean) => void;
  isCategoryBypassed: (category: string) => boolean;
  setAccessibilityModalVisible: (visible: boolean) => void;
  setMirrorVisible: (visible: boolean) => void;
  setHistoryVisible: (visible: boolean) => void;
  setScreenMirrorHierarchy: (hierarchy: SimplifiedDomNode[] | null) => void;
  setScreenMirrorLoading: (loading: boolean) => void;
  resetSession: () => void;
}

export const useDeviceSessionStore = create<DeviceSessionState>((set, get) => ({
  isAutomationRunning: false,
  activeToolName: null,
  activeTarget: null,
  activeValue: null,
  killSwitchTriggered: false,
  killSwitchSource: null,
  hasPendingWork: false,
  pendingDispatches: 0,

  actionHistory: [],
  sessionBypasses: {},

  isAccessibilityModalVisible: false,
  isMirrorVisible: false,
  isHistoryVisible: false,
  screenMirrorHierarchy: null,
  isScreenMirrorLoading: false,

  startAutomationSession: (toolName, target, value) => {
    // If pending native work is in flight AND kill switch was triggered,
    // do not allow starting a new session or clearing killSwitchTriggered until that work settles.
    if (get().hasPendingWork && get().killSwitchTriggered) {
      return;
    }
    const currentCount = get().pendingDispatches;
    set((state) => ({
      isAutomationRunning: true,
      pendingDispatches: currentCount + 1,
      activeToolName: toolName || state.activeToolName,
      activeTarget: target || state.activeTarget,
      activeValue: value || state.activeValue,
      ...(currentCount === 0 && {
        killSwitchTriggered: false,
        killSwitchSource: null,
      }),
    }));
  },

  setPendingWork: (hasPendingWork: boolean) => set({ hasPendingWork }),

  stopAutomationSession: (reason) => {
    const nextCount = Math.max(0, get().pendingDispatches - 1);
    if (get().isAutomationRunning && reason && !get().killSwitchTriggered) {
      get().recordAction({
        toolName: get().activeToolName || 'automation_session',
        outcome: 'executed',
        summary: `Session completed: ${reason}`,
      });
    }
    set({
      pendingDispatches: nextCount,
      isAutomationRunning: get().killSwitchTriggered ? false : nextCount > 0,
      hasPendingWork: nextCount > 0,
      ...(nextCount === 0 && {
        activeToolName: null,
        activeTarget: null,
        activeValue: null,
      }),
    });
  },

  triggerKillSwitch: (source = 'programmatic') => {
    const hasWork = get().hasPendingWork;
    const tool = get().activeToolName || 'device_action';
    const target = get().activeTarget || undefined;
    const value = get().activeValue || undefined;

    // If no native dispatch is in-flight, record the abort event immediately into session history.
    // If a dispatch is in-flight, executeDeviceAction records the accurate outcome once the native call settles.
    if (!hasWork) {
      get().recordAction({
        toolName: tool,
        target,
        value,
        outcome: 'aborted',
        summary: `[Aborted by User] Emergency kill switch triggered via ${source}`,
      });
    }

    set({
      isAutomationRunning: false,
      // Keep pendingDispatches unchanged so each in-flight dispatch settlement decrements the count
      activeToolName: null,
      activeTarget: null,
      activeValue: null,
      killSwitchTriggered: true,
      killSwitchSource: source,
    });
  },

  resetKillSwitch: () => {
    // Keep the guard active until pending automation work has fully settled
    if (get().hasPendingWork) {
      return;
    }
    set({ killSwitchTriggered: false, killSwitchSource: null });
  },

  recordAction: (item) => {
    const isSensitive =
      (item.target && /password|pin|otp|secret|credential|cvv/i.test(item.target)) ||
      (item.value && /password|pin|otp|secret|credential|cvv/i.test(item.value));
    const maskedValue = isSensitive && item.value
      ? '••••••••'
      : item.value;

    let processedSummary = item.summary;
    if (isSensitive && item.value && processedSummary) {
      processedSummary = processedSummary.split(item.value).join('••••••••');
    }
    const truncatedSummary =
      processedSummary && processedSummary.length > 300
        ? `${processedSummary.slice(0, 300)}...`
        : processedSummary;

    const fullItem: SessionActionItem = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...item,
      value: maskedValue,
      summary: truncatedSummary,
    };

    set((state) => {
      const next = [fullItem, ...state.actionHistory];
      if (next.length > MAX_HISTORY_ITEMS) {
        next.length = MAX_HISTORY_ITEMS;
      }
      return { actionHistory: next };
    });
  },

  clearSessionHistory: () => {
    set({ actionHistory: [] });
  },

  setSessionBypass: (category, bypass) => {
    set((state) => ({
      sessionBypasses: {
        ...state.sessionBypasses,
        [category]: bypass,
      },
    }));
  },

  isCategoryBypassed: (category) => {
    return Boolean(get().sessionBypasses[category]);
  },

  setAccessibilityModalVisible: (visible) => {
    set({ isAccessibilityModalVisible: visible });
  },

  setMirrorVisible: (visible) => {
    set({ isMirrorVisible: visible });
  },

  setHistoryVisible: (visible) => {
    set({ isHistoryVisible: visible });
  },

  setScreenMirrorHierarchy: (hierarchy) => {
    set({ screenMirrorHierarchy: hierarchy });
  },

  setScreenMirrorLoading: (loading) => {
    set({ isScreenMirrorLoading: loading });
  },

  resetSession: () => {
    set({
      isAutomationRunning: false,
      activeToolName: null,
      activeTarget: null,
      activeValue: null,
      killSwitchTriggered: false,
      killSwitchSource: null,
      hasPendingWork: false,
      pendingDispatches: 0,
      actionHistory: [],
      sessionBypasses: {},
      isAccessibilityModalVisible: false,
      isMirrorVisible: false,
      isHistoryVisible: false,
      screenMirrorHierarchy: null,
      isScreenMirrorLoading: false,
    });
  },
}));
