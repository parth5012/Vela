import {
  DEFAULT_AGENTS,
  COMPACT_AGENTS_INSTRUCTIONS,
  mergeRemoteAgents,
  resolveCompactInstructions,
  resolveNewThreadAgent,
  slugifyAgentId,
} from '../utils/agents';
import { useConfigStore } from '../store/useConfigStore';

describe('agents utility module (#357)', () => {
  beforeEach(() => {
    useConfigStore.getState().setDefaultAgent('personal assistant');
  });

  it('should export DEFAULT_AGENTS with required properties', () => {
    expect(Array.isArray(DEFAULT_AGENTS)).toBe(true);
    expect(DEFAULT_AGENTS.length).toBeGreaterThan(0);

    DEFAULT_AGENTS.forEach((agent) => {
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('icon');
      expect(typeof agent.id).toBe('string');
      expect(typeof agent.name).toBe('string');
      expect(typeof agent.icon).toBe('string');
    });
  });

  it('should include key agents (personal assistant, teacher, analyst, prompt builder)', () => {
    const ids = DEFAULT_AGENTS.map((a) => a.id);
    expect(ids).toContain('personal assistant');
    expect(ids).toContain('teacher');
    expect(ids).toContain('analyst');
    expect(ids).toContain('prompt builder');
  });

  it('should provide COMPACT_AGENTS_INSTRUCTIONS for default agents', () => {
    expect(COMPACT_AGENTS_INSTRUCTIONS).toHaveProperty('personal assistant');
    expect(COMPACT_AGENTS_INSTRUCTIONS).toHaveProperty('teacher');
    expect(COMPACT_AGENTS_INSTRUCTIONS).toHaveProperty('analyst');
  });

  describe('resolveNewThreadAgent', () => {
    it('reads the configured default agent when no explicit agent is given', () => {
      useConfigStore.getState().setDefaultAgent('analyst');
      expect(resolveNewThreadAgent()).toBe('analyst');
    });

    it('keeps reading the configured default regardless of earlier selections', () => {
      useConfigStore.getState().setDefaultAgent('analyst');
      expect(resolveNewThreadAgent('teacher')).toBe('teacher');
      expect(resolveNewThreadAgent()).toBe('analyst');
    });

    it('falls back to the shipped default only when no default is configured', () => {
      useConfigStore.getState().setDefaultAgent('');
      expect(resolveNewThreadAgent()).toBe('personal assistant');
    });
  });

  describe('resolveCompactInstructions', () => {
    const row = {
      id: 'analyst',
      name: 'Analyst',
      icon: '📊',
      compact_prompt_instructions: 'row version',
    };

    it('prefers the DB row compact instructions over the legacy record', () => {
      expect(resolveCompactInstructions('analyst', [row])).toBe('row version');
    });

    it('prefers the camelCase remote field when the snake_case field is absent', () => {
      const remote = { id: 'teacher', name: 'Teacher', icon: '👩🏫', compactPromptInstructions: 'camel' };
      expect(resolveCompactInstructions('teacher', [remote])).toBe('camel');
    });

    it('falls back to the legacy record only when the DB row is missing', () => {
      expect(resolveCompactInstructions('analyst', [])).toBe(
        COMPACT_AGENTS_INSTRUCTIONS['analyst']
      );
      expect(resolveCompactInstructions('unknown-agent', [])).toBe('');
    });

    it('does not mask an existing row that has no compact instructions', () => {
      const bare = { id: 'analyst', name: 'Analyst', icon: '📊' };
      expect(resolveCompactInstructions('analyst', [bare])).toBe('');
    });
  });

  describe('mergeRemoteAgents (server-mode overlay)', () => {
    const localOnly = { id: 'my-custom', name: 'My Custom', icon: '✨', compact_prompt_instructions: 'local' };
    const preset = { id: 'analyst', name: 'Analyst', icon: '📊', compact_prompt_instructions: 'local preset' };

    it('never drops local-only rows', () => {
      const merged = mergeRemoteAgents([preset, localOnly], [
        { id: 'analyst', name: 'Analyst (server)', compact_prompt_instructions: 'server preset' },
      ]);
      expect(merged.map((a) => a.id)).toEqual(['analyst', 'my-custom']);
      expect(merged.find((a) => a.id === 'my-custom')).toEqual(localOnly);
    });

    it('overlays remote rows onto local rows by id', () => {
      const merged = mergeRemoteAgents([preset, localOnly], [
        { id: 'analyst', name: 'Analyst (server)', compact_prompt_instructions: 'server preset' },
      ]);
      expect(merged[0].name).toBe('Analyst (server)');
      expect(merged[0].compact_prompt_instructions).toBe('server preset');
      expect(merged[0].icon).toBe('📊');
    });

    it('appends remote-only rows and fills in a default icon', () => {
      const merged = mergeRemoteAgents([preset], [
        { id: 'google_workspace', name: 'Workspace', compact_prompt_instructions: 'remote' },
      ]);
      const added = merged.find((a) => a.id === 'google_workspace');
      expect(added).toBeDefined();
      expect(added!.icon).toBe('🤖');
      expect(merged).toHaveLength(2);
    });

    it('ignores remote rows without an id', () => {
      const merged = mergeRemoteAgents([preset], [null, {}, { name: 'no id' }]);
      expect(merged).toHaveLength(1);
    });
  });

  describe('slugifyAgentId', () => {
    it('lowercases and joins words with dashes', () => {
      expect(slugifyAgentId('My Great Agent')).toBe('my-great-agent');
    });

    it('strips characters that are not slug safe', () => {
      expect(slugifyAgentId('  Step-by-step (v2)!  ')).toBe('step-by-step-v2');
    });

    it('never returns an empty id', () => {
      expect(slugifyAgentId('!!!')).toBe('agent');
    });
  });
});
