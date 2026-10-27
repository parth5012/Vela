import {
  getCachedParse,
  clearParseCache,
  getParseCacheSize,
} from '../utils/parseCache';

describe('parseCache hardening (WF-455-03)', () => {
  beforeEach(() => {
    clearParseCache();
  });

  it('memoizes parsed messages for historical entries', () => {
    const entry1 = getCachedParse('Hello world', false, false);
    const entry2 = getCachedParse('Hello world', false, false);

    expect(entry1).toBe(entry2);
    expect(entry1.bubbleContent).toBeDefined();
    expect(entry1.headerSegments).toBeDefined();
    expect(getParseCacheSize().historical).toBe(1);
    expect(getParseCacheSize().streaming).toBe(0);
  });

  it('differentiates user and assistant messages with identical content', () => {
    const userEntry = getCachedParse('Hello', true, false);
    const assistantEntry = getCachedParse('Hello', false, false);

    expect(userEntry).not.toBe(assistantEntry);
    expect(userEntry.sources).toEqual([]);
    expect(getParseCacheSize().historical).toBe(2);
  });

  it('segregates streaming entries from historical cache', () => {
    // Fill historical cache with 10 entries
    for (let i = 0; i < 10; i++) {
      getCachedParse(`Historical message ${i}`, false, false);
    }
    expect(getParseCacheSize().historical).toBe(10);
    expect(getParseCacheSize().streaming).toBe(0);

    // Simulate 300 streaming chunks (surpassing the 256 LRU limit)
    for (let i = 0; i < 300; i++) {
      getCachedParse(`Streaming chunk ${i}`, false, true);
    }

    // Historical entries must not be evicted
    expect(getParseCacheSize().historical).toBe(10);
    // Streaming cache is capped at 32 entries
    expect(getParseCacheSize().streaming).toBeLessThanOrEqual(32);

    // Verify historical messages are still cached
    for (let i = 0; i < 10; i++) {
      // Accessing them should hit the cache without evicting
      getCachedParse(`Historical message ${i}`, false, false);
    }
    expect(getParseCacheSize().historical).toBe(10);
  });

  it('enforces 256-item LRU boundary on historical cache', () => {
    for (let i = 0; i < 260; i++) {
      getCachedParse(`Historical item ${i}`, false, false);
    }

    expect(getParseCacheSize().historical).toBe(256);
  });

  it('clears both caches when clearParseCache is invoked', () => {
    getCachedParse('History', false, false);
    getCachedParse('Stream', false, true);

    expect(getParseCacheSize().historical).toBe(1);
    expect(getParseCacheSize().streaming).toBe(1);

    clearParseCache();

    expect(getParseCacheSize().historical).toBe(0);
    expect(getParseCacheSize().streaming).toBe(0);
  });
});
