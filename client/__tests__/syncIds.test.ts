import { generateUlid, isUlid, ULID_LENGTH } from '../utils/syncIds';

describe('syncIds (T5 cursor-safe ULIDs)', () => {
  it('generates 26-char Crockford Base32 ULIDs', () => {
    const id = generateUlid();
    expect(id).toHaveLength(ULID_LENGTH);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isUlid(id)).toBe(true);
  });

  it('rejects legacy prefixed ids and garbage', () => {
    expect(isUlid('msg_user_abc_1234567890')).toBe(false);
    expect(isUlid('devicestep_1234567890_abcd')).toBe(false);
    expect(isUlid('')).toBe(false);
    expect(isUlid('not-a-ulid')).toBe(false);
    // Lowercase Crockford is not canonical ULID output.
    expect(isUlid(generateUlid().toLowerCase())).toBe(false);
  });

  it('sorts lexicographically in creation-time order (cursor-safe)', () => {
    const base = 1750000000000;
    const ids = [0, 1, 2, 3, 4].map((i) => generateUlid(base + i));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('generates unique ids in bulk', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateUlid()));
    expect(ids.size).toBe(1000);
  });
});
