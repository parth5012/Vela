import { useEffect, useState } from 'react';
import { getCachedAgents, refreshAgents, subscribeAgents } from '../db/agentRepository';
import type { Agent } from '../utils/agents';

/**
 * Shared, DB-backed agent selector (#357).
 *
 * Replaces the hardcoded agent option lists that used to live in
 * `settings/agent.tsx`, `app/index.tsx` and `app/tasks.tsx`: one hook, one
 * source of truth (the `agents` table), refreshed whenever the repository
 * mutates (create/edit/delete/duplicate or the server-mode merge overlay).
 */
export function useAgents(): Agent[] {
  const [agents, setAgents] = useState<Agent[]>(getCachedAgents);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeAgents(() => {
      if (mounted) setAgents(getCachedAgents());
    });

    refreshAgents()
      .then(() => {
        if (mounted) setAgents(getCachedAgents());
      })
      .catch((error) => {
        console.warn('[useAgents] Failed to load agents:', error);
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return agents;
}

export default useAgents;
