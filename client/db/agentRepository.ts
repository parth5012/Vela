import { db } from './client';
import { agents, threads, AgentEntity } from './schema';
import { eq, desc, sql } from 'drizzle-orm';
import { useConfigStore } from '../store/useConfigStore';
import { useChatStore } from '../store/useChatStore';
import {
  Agent,
  DEFAULT_AGENTS,
  AgentPatch,
  mergeRemoteAgents,
  normalizeRemoteAgent,
  slugifyAgentId,
} from '../utils/agents';

/**
 * Local-first agent repository (#357).
 *
 * SQLite is the source of truth for agents on the device: presets are seeded
 * at launch (utils/seedAgents.ts), user-created agents are written here, and
 * server-mode payloads are merged over the local rows by id — never replacing
 * them. Every mutation refreshes the shared cache that `useAgents()` renders.
 *
 * Safe to call when the database is unavailable (test / non-native
 * environments): read functions return []/null and writes no-op.
 */

type AgentsListener = () => void;

const listeners = new Set<AgentsListener>();
let cachedAgents: Agent[] | null = null;

export function subscribeAgents(listener: AgentsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedAgents(): Agent[] {
  return cachedAgents && cachedAgents.length > 0 ? cachedAgents : DEFAULT_AGENTS;
}

function notifyAgentsChanged(): void {
  Array.from(listeners).forEach((listener) => listener());
}

function toAgent(row: AgentEntity): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    icon: row.icon || '🤖',
    system_prompt: row.system_prompt,
    compact_prompt_instructions: row.compact_prompt_instructions ?? undefined,
    model: row.model ?? undefined,
    is_preset: !!row.is_preset,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function uniqueAgentId(base: string): Promise<string> {
  const taken = new Set((await listAgents()).map((agent) => agent.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export async function listAgents(): Promise<Agent[]> {
  if (!db) return [];
  // Presets first, in seeded order, then user-created agents.
  const rows = await db.select().from(agents).orderBy(desc(agents.is_preset), sql`rowid ASC`);
  return rows.map(toAgent);
}

export async function getAgent(id: string): Promise<Agent | null> {
  if (!db) return null;
  const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return rows.length > 0 ? toAgent(rows[0]) : null;
}

export interface AgentInput {
  id?: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  system_prompt?: string;
  compact_prompt_instructions?: string | null;
  model?: string | null;
  is_preset?: boolean;
}

export async function insertAgent(input: AgentInput): Promise<Agent | null> {
  if (!db) return null;
  const name = input.name?.trim() || 'Untitled agent';
  const id = input.id?.trim() || (await uniqueAgentId(slugifyAgentId(name)));
  if (await getAgent(id)) return null;

  const now = new Date().toISOString();
  await db.insert(agents).values({
    id,
    name,
    description: input.description ?? null,
    icon: input.icon ?? DEFAULT_AGENTS.find((agent) => agent.id === id)?.icon ?? '🤖',
    system_prompt: input.system_prompt ?? '',
    compact_prompt_instructions: input.compact_prompt_instructions ?? null,
    model: input.model ?? null,
    is_preset: input.is_preset ?? false,
    created_at: now,
    updated_at: now,
  });
  await refreshAgents();
  return getAgent(id);
}

export async function updateAgent(id: string, patch: Partial<AgentInput>): Promise<Agent | null> {
  if (!db) return null;
  const existing = await getAgent(id);
  if (!existing) return null;

  const set: Partial<AgentEntity> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.system_prompt !== undefined) set.system_prompt = patch.system_prompt;
  if (patch.compact_prompt_instructions !== undefined) {
    set.compact_prompt_instructions = patch.compact_prompt_instructions;
  }
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.is_preset !== undefined) set.is_preset = patch.is_preset;

  await db.update(agents).set(set).where(eq(agents.id, id));
  await refreshAgents();
  return getAgent(id);
}

/**
 * Deletes an agent after re-pointing every thread that used it.
 *
 * Threads are repointed at `config.defaultAgent`; if that is the agent being
 * deleted (or points at something no longer present) the first surviving
 * agent wins and becomes the new default. There is deliberately no
 * `|| 'personal assistant'` fallback here: an orphan id would be masked
 * instead of fixed, and the floor of one agent guarantees a valid target.
 */
export async function deleteAgent(id: string): Promise<boolean> {
  if (!db) return false;
  const all = await listAgents();
  if (!all.some((agent) => agent.id === id)) return false;

  const survivors = all.filter((agent) => agent.id !== id);
  if (survivors.length === 0) return false;

  const config = useConfigStore.getState();
  let target = config.defaultAgent;
  if (!target || target === id || !survivors.some((agent) => agent.id === target)) {
    target = survivors[0].id;
  }
  if (target !== config.defaultAgent) config.setDefaultAgent(target);

  await db.update(threads).set({ agent: target }).where(eq(threads.agent, id));
  await db.delete(agents).where(eq(agents.id, id));
  // Keep the in-memory store in sync with the re-point above. Otherwise the
  // next addMessage -> saveThread would write the stale, now-deleted agent id
  // back into SQLite and resurrect it.
  useChatStore.setState((state) => ({
    threads: state.threads.map((t) => (t.agent === id ? { ...t, agent: target } : t)),
  }));
  await refreshAgents();
  return true;
}

/**
 * Copies an agent as a new non-preset row: fresh slug id, "<name> copy".
 */
export async function duplicateAgent(id: string): Promise<Agent | null> {
  if (!db) return null;
  const source = await getAgent(id);
  if (!source) return null;

  const now = new Date().toISOString();
  const newId = await uniqueAgentId(slugifyAgentId(`${source.name} copy`));
  await db.insert(agents).values({
    id: newId,
    name: `${source.name} copy`,
    description: source.description ?? null,
    icon: source.icon || '🤖',
    system_prompt: source.system_prompt ?? '',
    compact_prompt_instructions: source.compact_prompt_instructions ?? null,
    model: source.model ?? null,
    is_preset: false,
    created_at: now,
    updated_at: now,
  });
  await refreshAgents();
  return getAgent(newId);
}

async function upsertAgentRow(agent: Agent): Promise<void> {
  if (!db) return;
  const now = new Date().toISOString();
  const row = {
    id: agent.id,
    name: agent.name,
    description: agent.description ?? null,
    icon: agent.icon || '🤖',
    system_prompt: agent.system_prompt ?? '',
    compact_prompt_instructions:
      agent.compact_prompt_instructions ?? agent.compactPromptInstructions ?? null,
    model: agent.model ?? null,
    is_preset: agent.is_preset ?? false,
    created_at: now,
    updated_at: now,
  };
  await db
    .insert(agents)
    .values(row)
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: row.name,
        description: row.description,
        icon: row.icon,
        system_prompt: row.system_prompt,
        compact_prompt_instructions: row.compact_prompt_instructions,
        model: row.model,
        is_preset: row.is_preset,
        updated_at: row.updated_at,
      },
    });
}

/**
 * Server-mode merge overlay for `GET /chat/personas`.
 *
 * Remote rows overlay local rows by id; local-only rows are never dropped and
 * fields the payload does not carry (system prompt, preset flag, icon) are
 * preserved. Standalone must never call this with remote data.
 */
export async function overlayRemoteAgents(remote: unknown[]): Promise<void> {
  const patches = (Array.isArray(remote) ? remote : [])
    .map(normalizeRemoteAgent)
    .filter((patch): patch is AgentPatch => patch !== null);
  if (patches.length === 0) return;

  if (!db) {
    cachedAgents = mergeRemoteAgents(getCachedAgents(), patches);
    notifyAgentsChanged();
    return;
  }

  const local = await listAgents();
  const merged = mergeRemoteAgents(local, patches);
  const remoteIds = new Set(patches.map((patch) => patch.id));
  for (const agent of merged) {
    if (remoteIds.has(agent.id)) await upsertAgentRow(agent);
  }
  await refreshAgents();
}

export async function refreshAgents(): Promise<Agent[]> {
  const rows = await listAgents();
  cachedAgents = rows.length > 0 ? rows : DEFAULT_AGENTS;
  notifyAgentsChanged();
  return cachedAgents;
}
