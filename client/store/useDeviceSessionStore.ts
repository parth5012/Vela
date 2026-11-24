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

  actionHistory: [],
  sessionBypasses: {},

  isAccessibilityModalVisible: false,
  isMirrorVisible: false,
  isHistoryVisible: false,
  screenMirrorHierarchy: null,
  isScreenMirrorLoading: false,

  startAutomationSession: (toolName, target, value) => {
    set({
      isAutomationRunning: true,
      activeToolName: toolName || null,
      activeTarget: target || null,
      activeValue: value || null,
      killSwitchTriggered: false,
      killSwitchSource: null,
    });
  },

  stopAutomationSession: (reason) => {
    const isRunning = get().isAutomationRunning;
    if (isRunning && reason) {
      get().recordAction({
        toolName: get().activeToolName || 'automation_session',
        outcome: 'executed',
        summary: `Session completed: ${reason}`,
      });
    }
    set({
      isAutomationRunning: false,
      activeToolName: null,
      activeTarget: null,
      activeValue: null,
    });
  },

  triggerKillSwitch: (source = 'programmatic') => {
    const tool = get().activeToolName || 'device_action';
    const target = get().activeTarget || undefined;
    const value = get().activeValue || undefined;

    // Record the abort event in session history
    const item: SessionActionItem = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      toolName: tool,
      target,
      value,
      outcome: 'aborted',
      summary: `[Aborted by User] Emergency kill switch triggered via ${source}`,
    };

    set((state) => {
      const nextHistory = [item, ...state.actionHistory];
      if (nextHistory.length > MAX_HISTORY_ITEMS) {
        nextHistory.length = MAX_HISTORY_ITEMS;
      }
      return {
        isAutomationRunning: false,
        activeToolName: null,
        activeTarget: null,
        activeValue: null,
        killSwitchTriggered: true,
        killSwitchSource: source,
        actionHistory: nextHistory,
      };
    });
  },

  resetKillSwitch: () => {
    set({ killSwitchTriggered: false, killSwitchSource: null });
  },

  recordAction: (item) => {
    const fullItem: SessionActionItem = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...item,
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
