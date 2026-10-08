/**
 * Module: client/utils/deriveSafetyTier
 * Intent: Derive the safety-tier pill label for tool_call segments (extracted verbatim from app/index.tsx).
 * Responsibilities: map classifyAction + configured device-agent permission tier + sensitive-word
 *   escalation to 'auto' | 'ask' | 'blocked', without triggering any approval flow.
 * Public API: deriveSafetyTier(name?, input?) → SafetyTierLabel; type SafetyTierLabel.
 * Invariants: Mirrors evaluateSafety's sensitive-word escalation so the pill reflects what
 *   execution will actually do (#160) — keep in sync with utils/safetyManager.ts.
 * Side Effects: none beyond reading useConfigStore state (getState).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { useConfigStore } from '../store/useConfigStore';
import { classifyAction } from './safetyManager';

// #160: Derive the safety tier shown on a tool_call pill from the same policy
// inputs evaluateSafety consumes (classifyAction + configured tier), without
// triggering any approval flow. Mirrors evaluateSafety's sensitive-word
// escalation so the pill reflects what execution will actually do.
export type SafetyTierLabel = 'auto' | 'ask' | 'blocked';

export function deriveSafetyTier(name?: string, input?: string): SafetyTierLabel {
  let target: string | undefined;
  let value: string | undefined;
  if (input) {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed?.target === 'string') target = parsed.target;
      if (typeof parsed?.value === 'string') value = parsed.value;
    } catch {
      // Non-JSON input: fall back to raw text so keyword checks still apply.
      target = input;
    }
  }

  const permissions = useConfigStore.getState().deviceAgentPermissions;
  const category = classifyAction(name || '', target, value);
  const tier = permissions[category] || 'auto';
  if (tier === 'deny') return 'blocked';
  if (tier === 'confirm') return 'ask';

  // Auto tiers escalate on sensitive words (same heuristic as evaluateSafety).
  const targetLower = target ? target.toLowerCase() : '';
  const valueLower = value ? value.toLowerCase() : '';
  const sensitiveWords = ['delete', 'buy', 'pay', 'purchase', 'send', 'call', 'remove', 'clear'];
  if (sensitiveWords.some((word) => valueLower.includes(word))) {
    return 'ask';
  }
  return 'auto';
}
