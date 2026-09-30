import NeedleModule from '../index';

describe('Needle Expo Module', () => {
  it('exposes the expected interface', () => {
    expect(NeedleModule).toBeDefined();
    expect(typeof NeedleModule.init).toBe('function');
    expect(typeof NeedleModule.complete).toBe('function');
    expect(typeof NeedleModule.reset).toBe('function');
    expect(typeof NeedleModule.unload).toBe('function');
    expect(typeof NeedleModule.hasNativeLibrary).toBe('function');
    expect(typeof NeedleModule.addListener).toBe('function');
    expect(typeof NeedleModule.embed).toBe('function');
  });

  it('initializes and completes in fallback / test mode', async () => {
    const initResult = await NeedleModule.init('/data/local/tmp/model.cact', 256);
    expect(initResult).toBe(true);

    const result = await NeedleModule.complete('Read current screen', '[]');
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.toolCalls).toBeDefined();

    const parsed = JSON.parse(result.toolCalls!);
    expect(parsed.name).toBe('device_screen_read');

    const resetResult = await NeedleModule.reset();
    expect(resetResult).toBe(true);

    await expect(NeedleModule.unload()).resolves.toBeUndefined();
  });

  it('subscribes to stream listener without crashing', () => {
    const sub = NeedleModule.addListener((event) => {
      expect(event).toBeDefined();
    });
    expect(sub).toBeDefined();
    expect(typeof sub.remove).toBe('function');
    sub.remove();
  });

  // #299: needle_embed has no mock implementation — without the native module
  // (Jest / dev client without the engine) embed must answer null, never a
  // fabricated vector.
  it('returns null from embed when the native module is unavailable', async () => {
    await expect(NeedleModule.embed('train delay')).resolves.toBeNull();
  });
});
