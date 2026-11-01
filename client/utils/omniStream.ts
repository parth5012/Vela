/**
 * Real-time full-duplex omnimodal streaming client (audio, keyframes, text).
 * Interfaces with Liquid LFM-Omni / LFM-Voice via Vela's /ws/omni endpoint.
 */

export type OmniEventType =
  | 'session_ready'
  | 'transcript_token'
  | 'audio_chunk'
  | 'turn_complete'
  | 'interrupted'
  | 'error'
  | 'close';

export type OmniEventHandler = (data: any) => void;

export class OmniStreamController {
  private ws: WebSocket | null = null;
  private listeners: Map<OmniEventType, Set<OmniEventHandler>> = new Map();
  private connected: boolean = false;
  private sessionId: string | null = null;

  public on(event: OmniEventType, handler: OmniEventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  private emit(event: OmniEventType, data?: any): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`[OmniStreamController] Error in listener for ${event}:`, e);
      }
    });
  }

  public isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === 1;
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public async connect(apiUrl: string, apiKey: string): Promise<void> {
    this.disconnect();

    const cleanUrl = (apiUrl || '').trim().replace(/\/+$/, '');
    const wsProto = cleanUrl.startsWith('https') ? 'wss' : 'ws';
    const host = cleanUrl.replace(/^https?:\/\//i, '');
    const wsUrl = `${wsProto}://${host}/ws/omni?token=${encodeURIComponent(apiKey)}`;

    return new Promise<void>((resolve, reject) => {
      try {
        const socket = new WebSocket(wsUrl);
        this.ws = socket;

        socket.onopen = () => {
          this.connected = true;
          resolve();
        };

        socket.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            const type = parsed.type;

            if (type === 'session_ready') {
              this.sessionId = parsed.session_id;
              this.emit('session_ready', { sessionId: this.sessionId, model: parsed.model });
            } else if (type === 'transcript_token') {
              this.emit('transcript_token', { text: parsed.text });
            } else if (type === 'audio_chunk') {
              this.emit('audio_chunk', { data: parsed.data, format: parsed.format });
            } else if (type === 'turn_complete') {
              this.emit('turn_complete', {
                fullTranscript: parsed.full_transcript ?? parsed.fullTranscript ?? '',
                error: parsed.error,
              });
            } else if (type === 'interrupted') {
              this.emit('interrupted');
            }
          } catch {
            // Ignore non-json or unparsed frame
          }
        };

        socket.onerror = (err) => {
          this.emit('error', err);
          if (!this.connected) {
            reject(new Error('WebSocket connection failed'));
          }
        };

        socket.onclose = () => {
          this.connected = false;
          this.emit('close');
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public sendTextPrompt(text: string): void {
    if (!this.isConnected()) return;
    this.ws?.send(JSON.stringify({ type: 'text_prompt', text }));
  }

  public sendAudioFrame(base64Pcm: string, endOfSpeech = false): void {
    if (!this.isConnected()) return;
    this.ws?.send(
      JSON.stringify({
        type: 'audio_frame',
        data: base64Pcm,
        end_of_speech: endOfSpeech,
      })
    );
  }

  public sendKeyframe(base64Jpeg: string): void {
    if (!this.isConnected()) return;
    this.ws?.send(JSON.stringify({ type: 'image_frame', data: base64Jpeg }));
  }

  public interrupt(): void {
    if (!this.isConnected()) return;
    this.ws?.send(JSON.stringify({ type: 'interrupt' }));
  }

  public disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
    this.sessionId = null;
  }
}

export const omniStreamController = new OmniStreamController();
