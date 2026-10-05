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
}

const useForegroundTaskStore = create<ForegroundTaskState>(() => ({
  execution_id: null,
  task_plan: null,
  currentStep: 0,
  isRunning: false,
  isCancelled: false,
  isPaused: false,
  awaitingApproval: false,
  lastAction: '',
}));

export default useForegroundTaskStore;
