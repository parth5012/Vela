import { OmniStreamController } from '../utils/omniStream';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState: number = 0; // CONNECTING
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }
}

describe('OmniStreamController', () => {
  let originalWebSocket: any;

  beforeEach(() => {
    MockWebSocket.instances = [];
    originalWebSocket = (global as any).WebSocket;
    (global as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    (global as any).WebSocket = originalWebSocket;
  });

  it('connects to ws endpoint with token and receives session_ready', async () => {
    const controller = new OmniStreamController();
    const readyPromise = new Promise<string>((resolve) => {
      controller.on('session_ready', (evt) => resolve(evt.sessionId));
    });

    await controller.connect('http://localhost:8000', 'test-api-key');
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    expect(ws.url).toBe('ws://localhost:8000/ws/omni?token=test-api-key');

    // Simulate server greeting
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'session_ready',
        session_id: 'session-xyz-123',
        model: 'liquid-lfm-omni',
      }),
    });

    const sessionId = await readyPromise;
    expect(sessionId).toBe('session-xyz-123');
    expect(controller.isConnected()).toBe(true);
  });

  it('sends text prompt and accumulates transcript tokens', async () => {
    const controller = new OmniStreamController();
    await controller.connect('https://api.vela.example', 'my-key');
    const ws = MockWebSocket.instances[0];

    const tokens: string[] = [];
    controller.on('transcript_token', (evt) => tokens.push(evt.text));

    const turnPromise = new Promise<string>((resolve) => {
      controller.on('turn_complete', (evt) => resolve(evt.fullTranscript));
    });

    controller.sendTextPrompt('What is Liquid LFM?');
    expect(ws.sent).toContain(JSON.stringify({ type: 'text_prompt', text: 'What is Liquid LFM?' }));

    // Server sends back streaming tokens
    ws.onmessage?.({
      data: JSON.stringify({ type: 'transcript_token', text: 'Liquid' }),
    });
    ws.onmessage?.({
      data: JSON.stringify({ type: 'transcript_token', text: ' LFM' }),
    });
    ws.onmessage?.({
      data: JSON.stringify({ type: 'turn_complete', fullTranscript: 'Liquid LFM' }),
    });

    const full = await turnPromise;
    expect(tokens).toEqual(['Liquid', ' LFM']);
    expect(full).toBe('Liquid LFM');
  });

  it('sends audio frame and keyframe payloads', async () => {
    const controller = new OmniStreamController();
    await controller.connect('http://localhost:8000', 'key');
    const ws = MockWebSocket.instances[0];

    controller.sendAudioFrame('base64pcmdata...', true);
    expect(ws.sent).toContain(
      JSON.stringify({ type: 'audio_frame', data: 'base64pcmdata...', end_of_speech: true })
    );

    controller.sendKeyframe('base64jpeg...');
    expect(ws.sent).toContain(
      JSON.stringify({ type: 'image_frame', data: 'base64jpeg...' })
    );
  });

  it('triggers barge-in interrupt', async () => {
    const controller = new OmniStreamController();
    await controller.connect('http://localhost:8000', 'key');
    const ws = MockWebSocket.instances[0];

    let interrupted = false;
    controller.on('interrupted', () => {
      interrupted = true;
    });

    controller.interrupt();
    expect(ws.sent).toContain(JSON.stringify({ type: 'interrupt' }));

    ws.onmessage?.({ data: JSON.stringify({ type: 'interrupted' }) });
    expect(interrupted).toBe(true);
  });

  it('cleans up on disconnect', async () => {
    const controller = new OmniStreamController();
    await controller.connect('http://localhost:8000', 'key');
    const ws = MockWebSocket.instances[0];

    controller.disconnect();
    expect(ws.readyState).toBe(3);
    expect(controller.isConnected()).toBe(false);
  });
});
