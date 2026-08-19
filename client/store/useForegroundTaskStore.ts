import { create } from 'zustand';

interface TaskPlan {
  task_id: string;
  steps: {
    id: string;
    description: string;
    action: string;
  }[];
}

interface ForegroundTaskState {
  execution_id: string | null;
  task_plan: TaskPlan | null;
  currentStep: number;
  isRunning: boolean;
  isCancelled: boolean;
  isPaused: boolean;
  awaitingApproval: boolean;
  lastAction: string;
  // Actions
  setExecutionId: (id: string | null) => void;
  setTaskPlan: (plan: TaskPlan | null) => void;
  setCurrentStep: (step: number) => void;
  startRunning: () => void;
  stopRunning: () => void;
  setCancelled: () => void;
  setPaused: (awaitingApproval?: boolean) => void;
  resume: () => void;
  setLastAction: (action: string) => void;
}

const useForegroundTaskStore = create<ForegroundTaskState>((set) => ({
  execution_id: null,
  task_plan: null,
  currentStep: 0,
  isRunning: false,
  isCancelled: false,
  isPaused: false,
  awaitingApproval: false,
  lastAction: '',

  setExecutionId: (execution_id) =>
    set({ execution_id }),

  setTaskPlan: (task_plan) =>
    set({ task_plan }),

  setCurrentStep: (currentStep) =>
    set({ currentStep }),

  startRunning: () =>
    set({
      isRunning: true,
      isPaused: false,
      isCancelled: false,
      awaitingApproval: false,
    }),

  stopRunning: () =>
    set({
      isRunning: false,
      execution_id: null,
      task_plan: null,
      currentStep: 0,
      lastAction: '',
    }),

  setCancelled: () =>
    set({
      isRunning: false,
      isCancelled: true,
      execution_id: null,
    }),

  setPaused: (awaitingApproval = false) =>
    set({
      isRunning: false,
      isPaused: true,
      awaitingApproval,
    }),

  resume: () =>
    set({
      isRunning: true,
      isPaused: false,
      awaitingApproval: false,
    }),

  setLastAction: (lastAction) =>
    set({ lastAction }),
}));

export default useForegroundTaskStore;
