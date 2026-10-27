import { useActiveStreamStore } from '../store/useActiveStreamStore';

describe('useActiveStreamStore', () => {
  beforeEach(() => {
    useActiveStreamStore.getState().resetStream();
  });

  it('starts a stream by clearing previous text, setting streamingMessageId and isStreaming: true', () => {
    useActiveStreamStore.getState().appendChunk('stale content');
    expect(useActiveStreamStore.getState().streamingText).toBe('stale content');

    useActiveStreamStore.getState().startStream('msg-123');

    const state = useActiveStreamStore.getState();
    expect(state.streamingMessageId).toBe('msg-123');
    expect(state.streamingText).toBe('');
    expect(state.isStreaming).toBe(true);
  });

  it('concatenates sequential chunks correctly via appendChunk', () => {
    useActiveStreamStore.getState().startStream('msg-456');

    useActiveStreamStore.getState().appendChunk('Hello');
    useActiveStreamStore.getState().appendChunk(' ');
    useActiveStreamStore.getState().appendChunk('world!');

    const state = useActiveStreamStore.getState();
    expect(state.streamingText).toBe('Hello world!');
    expect(state.isStreaming).toBe(true);
  });

  it('resets stream cleanly and returns accumulated text', () => {
    useActiveStreamStore.getState().startStream('msg-789');
    useActiveStreamStore.getState().appendChunk('Final response');

    const returnedContent = useActiveStreamStore.getState().resetStream();

    expect(returnedContent).toBe('Final response');
    const state = useActiveStreamStore.getState();
    expect(state.streamingText).toBe('');
    expect(state.streamingMessageId).toBeNull();
    expect(state.isStreaming).toBe(false);
  });
});
