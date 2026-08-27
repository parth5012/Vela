import { DEFAULT_PERSONAS, COMPACT_PERSONAS_INSTRUCTIONS } from '../utils/personas';

describe('personas utility module', () => {
  it('should export DEFAULT_PERSONAS with required properties', () => {
    expect(Array.isArray(DEFAULT_PERSONAS)).toBe(true);
    expect(DEFAULT_PERSONAS.length).toBeGreaterThan(0);
    
    DEFAULT_PERSONAS.forEach((persona) => {
      expect(persona).toHaveProperty('id');
      expect(persona).toHaveProperty('name');
      expect(persona).toHaveProperty('icon');
      expect(typeof persona.id).toBe('string');
      expect(typeof persona.name).toBe('string');
      expect(typeof persona.icon).toBe('string');
    });
  });

  it('should include key personas (personal assistant, teacher, analyst, prompt builder)', () => {
    const ids = DEFAULT_PERSONAS.map((p) => p.id);
    expect(ids).toContain('personal assistant');
    expect(ids).toContain('teacher');
    expect(ids).toContain('analyst');
    expect(ids).toContain('prompt builder');
  });

  it('should provide COMPACT_PERSONAS_INSTRUCTIONS for default personas', () => {
    expect(COMPACT_PERSONAS_INSTRUCTIONS).toHaveProperty('personal assistant');
    expect(COMPACT_PERSONAS_INSTRUCTIONS).toHaveProperty('teacher');
    expect(COMPACT_PERSONAS_INSTRUCTIONS).toHaveProperty('analyst');
  });
});
