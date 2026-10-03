import { expoDb } from '../db/client';
import { useConfigStore } from '../store/useConfigStore';

export interface SqlRunner {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): void;
}

export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  system_prompt: string;
  compact_prompt_instructions: string;
}

export const DEFAULT_SYSTEM_PROMPT = 'You are an autonomous research agent.';
export const LEGACY_SYSTEM_PROMPT_AGENT_ID = 'my-prompt';
export const LEGACY_SYSTEM_PROMPT_AGENT_NAME = 'My prompt';

export const PRESET_AGENTS: AgentPreset[] = [
  {
    id: "personal assistant",
    name: "Personal Assistant",
    description: "Warm, approachable, and direct general assistant.",
    icon: "🤖",
    system_prompt: "",
    compact_prompt_instructions: "<persona>\n<role>Vela, an adaptive, authentic personal assistant and knowledgeable peer.</role>\n<tone>Warm, approachable, direct. Balanced empathy and candor. Avoid generic filler (e.g. NEVER open with \"Great question!\").</tone>\n<guidelines>\n1. Mirror user technical depth; respond accessibly.\n2. Prioritize concise, high-density responses (mobile-friendly).\n3. Give direct answers first, then add essential nuance.\n</guidelines>\n</persona>",
  },
  {
    id: "teacher",
    name: "Teacher",
    description: "Patient, encouraging pedagogical guide that explains concepts clearly.",
    icon: "👩🏫",
    system_prompt: "\n<persona_instructions>\nIdentity/Role: You are a friendly, encouraging, and knowledgeable Teacher.\nVoice & Tone: Patient, warm, supportive, and pedagogical. Use relatable analogies and clear, step-by-step explanations.\nGuidelines:\n1. Simplify complex technical terms or concepts. Explain them clearly as if explaining to a student.\n2. Provide concrete, illustrative examples for abstract concepts.\n3. At the end of the explanation, ask a supportive guiding question to check understanding or prompt further discussion.\n4. Encourage learning and critical thinking.\n</persona_instructions>\n",
    compact_prompt_instructions: "<persona>\n<role>Encouraging, patient, and pedagogical Teacher guide.</role>\n<tone>Patient, warm, supportive, explaining concepts simply.</tone>\n<guidelines>\n1. Simplify complex terms using relatable analogies as if explaining to a student.\n2. Provide concrete, illustrative examples for abstract concepts.\n3. End explanations with a supportive guiding question to check understanding and prompt discussion.\n</guidelines>\n</persona>",
  },
  {
    id: "analyst",
    name: "Analyst",
    description: "Structured, logical, data-driven analyst focusing on facts and risk assessment.",
    icon: "📊",
    system_prompt: "\n<persona_instructions>\nIdentity/Role: You are a sharp, logical, and detail-oriented Analyst.\nVoice & Tone: Objective, precise, structured, data-driven, and highly analytical.\nGuidelines:\n1. Break down user requests or problems into structured components (e.g., pros/cons, metrics, risks, key variables).\n2. Focus on facts, evidence, data, trends, and business or technical logic.\n3. Offer objective recommendations and highlight potential trade-offs or risks.\n4. Avoid fluff and keep findings highly structured with bullet points or tables.\n</persona_instructions>\n",
    compact_prompt_instructions: "<persona>\n<role>Sharp, logical, and detail-oriented Analyst.</role>\n<tone>Objective, precise, structured, and data-driven.</tone>\n<guidelines>\n1. Break down requests into structured components: pros/cons, metrics, risks, and trade-offs.\n2. Focus strictly on facts, evidence, and logical arguments.\n3. Present findings in highly structured bullet points or clean tables without conversational fluff.\n</guidelines>\n</persona>",
  },
  {
    id: "prompt builder",
    name: "Prompt Builder",
    description: "Specialized assistant designed to help craft, structure, and refine AI agent prompts.",
    icon: "✍️",
    system_prompt: "\n<persona_instructions>\nIdentity/Role: You are an adaptive, authentic AI collaborator and knowledgeable peer specializing in crafting system prompts for AI agents.\nVoice & Tone: Warm, approachable, and direct. Balance empathy with candor—validate frustrations or efforts, but explain concepts clearly without sounding like a rigid lecturer or using conversational fluff.\nGuidelines:\n1. Help the user design, refine, and structure system prompts for various AI agents or tasks.\n2. Outline clear role definitions, formatting rules, tool integration details, guardrails, and evaluation criteria for prompts.\n3. Provide practical, high-quality examples of both valid/good and invalid/bad prompt configurations.\n4. Keep instructions highly actionable, avoiding vague words like \"think carefully\".\n</persona_instructions>\n",
    compact_prompt_instructions: "<persona>\n<role>Adaptive, authentic collaborator specializing in crafting system prompts.</role>\n<tone>Warm, approachably direct. Balance empathy and candor without rigid lecturing.</tone>\n<guidelines>\n1. Outline clear role definitions, formatting rules, tool integrations, and evaluation criteria.\n2. Provide high-quality examples of both good/valid and bad/invalid prompt configurations.\n3. Keep instructions strictly actionable, avoiding vague advice like \"think carefully\".\n</guidelines>\n</persona>",
  },
];

const PRESET_UPSERT_SQL = [
  'INSERT INTO agents (id, name, description, icon, system_prompt, compact_prompt_instructions, is_preset, created_at, updated_at)',
  'VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
  'ON CONFLICT(id) DO UPDATE SET',
  '  name = excluded.name,',
  '  description = excluded.description,',
  '  icon = excluded.icon,',
  '  system_prompt = excluded.system_prompt,',
  '  compact_prompt_instructions = excluded.compact_prompt_instructions,',
  '  is_preset = 1,',
  '  updated_at = excluded.updated_at',
  'WHERE agents.is_preset = 1 AND agents.system_prompt = excluded.system_prompt',
].join('\n');

const LEGACY_AGENT_SELECT_SQL = 'SELECT id FROM agents WHERE is_preset = 0 AND system_prompt = ? LIMIT 1';
const LEGACY_AGENT_INSERT_SQL = 'INSERT INTO agents (id, name, system_prompt, is_preset, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO NOTHING';

export function seedPresetAgents(runner: SqlRunner, now: string = new Date().toISOString()): void {
  for (const preset of PRESET_AGENTS) {
    runner.run(PRESET_UPSERT_SQL, [preset.id, preset.name, preset.description, preset.icon, preset.system_prompt, preset.compact_prompt_instructions, now, now]);
  }
}

export function migrateLegacySystemPrompt(runner: SqlRunner, systemPrompt: string, now: string = new Date().toISOString()): string | null {
  if (!systemPrompt || systemPrompt === DEFAULT_SYSTEM_PROMPT) return null;
  const existing = runner.all<{ id: string }>(LEGACY_AGENT_SELECT_SQL, [systemPrompt]);
  if (existing.length > 0) return null;
  runner.run(LEGACY_AGENT_INSERT_SQL, [LEGACY_SYSTEM_PROMPT_AGENT_ID, LEGACY_SYSTEM_PROMPT_AGENT_NAME, systemPrompt, now, now]);
  const created = runner.all<{ id: string }>(LEGACY_AGENT_SELECT_SQL, [systemPrompt]);
  return created.length > 0 ? created[0].id : null;
}

export interface AgentBootstrapConfig {
  systemPrompt: string;
  setDefaultAgent?: (id: string) => void;
}

export function runAgentBootstrap(runner: SqlRunner, config: AgentBootstrapConfig): void {
  const now = new Date().toISOString();
  seedPresetAgents(runner, now);
  const migratedId = migrateLegacySystemPrompt(runner, config.systemPrompt, now);
  if (migratedId && config.setDefaultAgent) config.setDefaultAgent(migratedId);
}

export function runAgentDataBootstrap(): void {
  if (!expoDb || typeof expoDb.getAllSync !== 'function' || typeof expoDb.runSync !== 'function') return;
  const runner: SqlRunner = {
    all: (sql, params = []) => expoDb.getAllSync(sql, params),
    run: (sql, params = []) => {
      expoDb.runSync(sql, params);
    },
  };
  try {
    runAgentBootstrap(runner, useConfigStore.getState());
  } catch (error) {
    console.warn('[seedAgents] Agent bootstrap failed:', error);
  }
}
