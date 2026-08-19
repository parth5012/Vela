import { create } from 'zustand';

export interface SafetyTask {
  toolName: string;
  target?: string;
  value?: string;
  thoughts?: string;
  conversationId: string;
  taskToken?: string;
  resolve: (res: { status: 'success' | 'error'; result: string }) => void;
}

interface SafetyStore {
  pendingTask: SafetyTask | null;
  requestApproval: (task: Omit<SafetyTask, 'resolve'>) => Promise<{ status: 'success' | 'error'; result: string }>;
  resolvePending: (status: 'success' | 'error', result: string) => void;
}

export const useSafetyStore = create<SafetyStore>((set, get) => ({
  pendingTask: null,
  requestApproval: (task) => {
    return new Promise((resolve) => {
      set({
        pendingTask: {
          ...task,
          resolve,
        },
      });
    });
  },
  resolvePending: (status, result) => {
    const task = get().pendingTask;
    if (task) {
      task.resolve({ status, result });
      set({ pendingTask: null });
    }
  },
}));
