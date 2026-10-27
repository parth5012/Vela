import { create } from 'zustand';

export interface ActiveStreamState {
  streamingText: string;
  streamingMessageId: string | null;
  isStreaming: boolean;
  appendChunk: (chunk: string) => void;
  startStream: (messageId: string) => void;
  resetStream: () => string;
}

export const useActiveStreamStore = create<ActiveStreamState>((set, get) => ({
  streamingText: '',
  streamingMessageId: null,
  isStreaming: false,
  startStream: (messageId) =>
    set({ streamingMessageId: messageId, streamingText: '', isStreaming: true }),
  appendChunk: (chunk) =>
    set((state) => ({ streamingText: state.streamingText + chunk })),
  resetStream: () => {
    const final = get().streamingText;
    set({ streamingText: '', streamingMessageId: null, isStreaming: false });
    return final;
  },
}));
