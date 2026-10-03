import { useConfigStore } from '../store/useConfigStore';

export type Agent = {
  id: string;
  name: string;
  description?: string;
  icon: string;
  system_prompt?: string;
  compact_prompt_instructions?: string;
  /** Legacy camelCase key still emitted by older server payloads. */
  compactPromptInstructions?: string;
  model?: string;
  is_preset?: boolean;
  created_at?: string;
  updated_at?: string;
};

/** Shipped id of the built-in default agent (mirrors backend registry). */
export const DEFAULT_AGENT_ID = 'personal assistant';

export const DEFAULT_AGENTS: Agent[] = [
  { id: 'personal assistant', name: 'Personal Assistant', description: 'Warm, approachable, direct general assistant.', icon: '🤖' },
  { id: 'teacher', name: 'Teacher', description: 'Patient, educational instructor helper details examples.', icon: '👩🏫' },
  { id: 'analyst', name: 'Analyst', description: 'Structured, logical, data-driven analyst focusing facts risk assessment.', icon: '📊' },
  { id: 'prompt builder', name: 'Prompt Builder', description: 'Specialized assistant designed help craft, structure, refine agent prompts.', icon: '✍️' },
];

/**
 * Legacy parallel record of compact instructions, kept only as a fallback for
 * agents with no DB row yet. Step 4 (#359) deletes it once send paths read the
 * agents table directly.
 */
export const COMPACT_AGENTS_INSTRUCTIONS: Record<string, string> = {
  "personal assistant": `Vela, adaptive, authentic personal assistant knowledgeable peer.\nVoice: Warm, approachable, direct. Balanced empathy candor. Avoid generic filler.\nGuidelines:\n1. Mirror user technical depth; respond accessibly.\n2. Prioritize concise, high-density responses.\n3. Give direct answers first, then add essential nuance.`,
  "teacher": `Encouraging, patient, pedagogical Teacher guide.\nTone: Patient, warm, supportive, explaining concepts simply.\nGuidelines:\n1. Simplify complex terms using relatable analogies explaining student.\n2. Provide concrete, illustrative examples abstract concepts.\n3. End explanations supportive guiding question check understanding prompt discussion.`,
  "analyst": `Sharp, logical, detail-oriented Analyst.\nTone: Objective, precise, structured, data-driven.\nGuidelines:\n1. Break down requests structured components: pros/cons, metrics, risks, trade-offs.\n2. Focus strictly facts, evidence, logical arguments.\n3. Present findings highly structured bullet points clean tables without conversational fluff.`,
  "prompt builder": `Adaptive, authentic collaborator specializing crafting system prompts.\nTone: Warm, approachably direct. Balance empathy candor without rigid lecturing.\nGuidelines:\n1. Outline clear role definitions, formatting rules, tool integrations, evaluation criteria.\n2. Provide high-quality examples both good/valid bad/invalid prompt configurations.\n3. Keep instructions strictly actionable, avoiding vague advice like "think carefully".`,
  "google_workspace": `Google Workspace automation specialist (Gmail, Calendar, Drive).\nTone: Efficient, precise, action-oriented, helpful.\nGuidelines:\n1. Help users manage email, calendar events, Drive files.\n2. Proactively offer check calendar slots find availability.\n3. Assist searching, drafting, organizing Gmail messages.\n4. Call out scope limitations when request exceeds capabilities.`,
};

/** URL/filename-safe id derived from a human agent name. */
export function slugifyAgentId(input: string): string {
  const slug = (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || 'agent';
}

/**
 * Agent for a brand-new thread: an explicit id (suggestion starter card)
 * wins, otherwise the configured default is read straight from the config
 * store so a new conversation never inherits the previously tapped agent.
 */
export function resolveNewThreadAgent(explicitAgentId?: string): string {
  if (explicitAgentId) return explicitAgentId;
  return useConfigStore.getState().defaultAgent || DEFAULT_AGENT_ID;
}

/**
 * Compact instructions for the active agent. The DB row wins; the legacy
 * record is consulted only when no row exists for that agent id.
 */
export function resolveCompactInstructions(agentId: string, agents: Agent[]): string {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) return COMPACT_AGENTS_INSTRUCTIONS[agentId] || '';
  return agent.compact_prompt_instructions || agent.compactPromptInstructions || '';
}

export type AgentPatch = Partial<Agent> & { id: string };

/** Keeps only the fields a payload actually carried so overlays never blank values. */
function definedFields(patch: AgentPatch): AgentPatch {
  const out: AgentPatch = { id: patch.id };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && key !== 'id') (out as any)[key] = value;
  }
  return out;
}

/** Normalizes one server payload row into a patch, or null when unusable. */
export function normalizeRemoteAgent(raw: unknown): AgentPatch | null {
  const candidate = raw as Record<string, unknown> | null | undefined;
  if (!candidate || typeof candidate.id !== 'string' || !candidate.id.trim()) return null;

  const patch: AgentPatch = { id: candidate.id };
  if (typeof candidate.name === 'string' && candidate.name) patch.name = candidate.name;
  if (typeof candidate.description === 'string') patch.description = candidate.description;
  if (typeof candidate.icon === 'string' && candidate.icon) patch.icon = candidate.icon;
  if (typeof candidate.system_prompt === 'string') patch.system_prompt = candidate.system_prompt;
  if (typeof candidate.compact_prompt_instructions === 'string') {
    patch.compact_prompt_instructions = candidate.compact_prompt_instructions;
  }
  if (typeof candidate.compactPromptInstructions === 'string') {
    patch.compactPromptInstructions = candidate.compactPromptInstructions;
  }
  if (typeof candidate.model === 'string') patch.model = candidate.model;
  if (typeof candidate.is_preset === 'boolean') patch.is_preset = candidate.is_preset;
  return patch;
}

function overlayAgent(base: Agent | undefined, patch: AgentPatch): Agent {
  const seed: Agent = base ?? {
    id: patch.id,
    name: patch.name ?? patch.id,
    icon: '🤖',
    system_prompt: '',
  };
  const merged: Agent = { ...seed, ...definedFields(patch) };
  merged.icon = patch.icon || seed.icon || '🤖';
  return merged;
}

/**
 * Server-mode merge overlay: remote rows lay over local rows by id and
 * local-only rows are never dropped. Order is preserved — remote-only rows
 * are appended.
 */
export function mergeRemoteAgents(local: Agent[], remote: unknown[]): Agent[] {
  const merged = [...local];
  const index = new Map<string, number>(merged.map((agent, position) => [agent.id, position]));

  for (const entry of remote) {
    const patch = normalizeRemoteAgent(entry);
    if (!patch) continue;
    const position = index.get(patch.id);
    if (position === undefined) {
      index.set(patch.id, merged.length);
      merged.push(overlayAgent(undefined, patch));
    } else {
      merged[position] = overlayAgent(merged[position], patch);
    }
  }
  return merged;
}
