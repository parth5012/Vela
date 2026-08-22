/**
 * #160 Safety-tier pill derivation — behavioral tests against REAL sources.
 *
 * RUNTIME STRATEGY (see helpers/standaloneRunner.ts for the full rationale):
 * Jest cannot bootstrap in this environment and app/index.tsx drags the whole
 * react-native/expo module graph in, so it cannot be imported under plain
 * Node. Instead this suite extracts, at runtime:
 *   - classifyAction()            from utils/safetyManager.ts  (real policy classifier)
 *   - SafetyTierLabel + deriveSafetyTier() from app/index.tsx   (code under test)
 * and evaluates them in a sandbox where ONLY useConfigStore is stubbed. The
 * stub's default tiers are parsed live from store/useConfigStore.ts (with a
 * drift guard), so tier changes in the real store fail loudly here.
 *
 * renderSegment's "explicit segment.safetyTier ?? derived" preference lives
 * inside a React component and cannot run headlessly; its exact expression is
 * mirrored below AND pinned to the real file by structural assertions, so any
 * drift in index.tsx fails these tests.
 */

import { ensureStandaloneRunner, extractBlock, readSource, transpileAndEval } from './helpers/standaloneRunner';

ensureStandaloneRunner();

// ---------------------------------------------------------------------------
// Extract + assemble the real code under test
// ---------------------------------------------------------------------------

type PolicyTier = 'auto' | 'confirm' | 'deny';
type TierLabel = 'auto' | 'ask' | 'blocked';

const safetyManagerSource = readSource('utils/safetyManager.ts');
const indexSource = readSource('app/index.tsx');
const configStoreSource = readSource('store/useConfigStore.ts');
const messageParserSource = readSource('utils/messageParser.ts');

const classifyActionSource = extractBlock(safetyManagerSource, 'function classifyAction');
const deriveFunctionSource = extractBlock(indexSource, 'function deriveSafetyTier');

const typeAliasMatch = indexSource.match(/type SafetyTierLabel = [^;\n]+;/);
if (!typeAliasMatch) {
  throw new Error("Could not find 'type SafetyTierLabel' in app/index.tsx");
}

/** Default tiers parsed live from the real store initializer. */
function parseDefaultTiers(storeSource: string): Record<string, PolicyTier> {
  const block = extractBlock(storeSource, 'deviceAgentPermissions: {');
  const tiers: Record<string, PolicyTier> = {};
  const pattern = /([a-z_]+):\s*'(auto|confirm|deny)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    tiers[match[1]] = match[2] as PolicyTier;
  }
  return tiers;
}

const parsedDefaults = parseDefaultTiers(configStoreSource);

/**
 * Hardcoded mirror of the production defaults (store/useConfigStore.ts).
 * The drift-guard test fails if the real store ever diverges from this.
 */
const FALLBACK_TIERS: Record<string, PolicyTier> = {
  screen_read: 'auto',
  info: 'auto',
  screenshot: 'auto',
  open_app: 'auto',
  scroll: 'auto',
  swipe: 'auto',
  press_key: 'auto',
  set_volume: 'auto',
  type: 'auto',
  tap: 'auto',
  send_communication: 'confirm',
  calls: 'confirm',
  purchases: 'confirm',
  deletions: 'confirm',
  settings_changes: 'confirm',
  play_installs: 'confirm',
  passwords_otps: 'deny',
  sideloads: 'deny',
  permission_toggles: 'deny',
  root_shizuku: 'deny',
};

interface ExtractedModule {
  deriveSafetyTier: (name?: string, input?: string) => TierLabel;
  fixturePermissions: Record<string, PolicyTier>;
}

const extractedModule = transpileAndEval(`
type PermissionTier = 'auto' | 'confirm' | 'deny';
type DeviceAgentPermissions = Record<string, PermissionTier>;

const fixturePermissions: Record<string, PermissionTier> = ${JSON.stringify(parsedDefaults)};

const useConfigStore = {
  getState(): { deviceAgentPermissions: Record<string, PermissionTier> } {
    return { deviceAgentPermissions: fixturePermissions };
  },
};

${classifyActionSource}

${typeAliasMatch[0]}

${deriveFunctionSource}

export { deriveSafetyTier, fixturePermissions };
`) as unknown as ExtractedModule;

const deriveSafetyTier = extractedModule.deriveSafetyTier;
const fixturePermissions = extractedModule.fixturePermissions;

function resetTiers(): void {
  Object.assign(fixturePermissions, parsedDefaults);
}

/** Builds the JSON `input` payload exactly as the backend emits it. */
const json = (payload: unknown): string => JSON.stringify(payload);

describe('deriveSafetyTier — extraction sanity', () => {
  it('extracted the real function body (references policy inputs)', () => {
    expect(typeof deriveSafetyTier).toBe('function');
    expect(deriveFunctionSource).toContain('deviceAgentPermissions');
    expect(deriveFunctionSource).toContain('classifyAction');
    expect(deriveFunctionSource).toContain("sensitiveWords");
  });

  it('extracted the real classifyAction (deny categories present)', () => {
    expect(classifyActionSource).toContain('root_shizuku');
    expect(classifyActionSource).toContain('passwords_otps');
  });
});

describe('deriveSafetyTier — fixture drift guard', () => {
  it('defaults parsed from useConfigStore.ts match the hardcoded fallback', () => {
    expect(Object.keys(parsedDefaults).length).toBe(Object.keys(FALLBACK_TIERS).length);
    for (const [category, tier] of Object.entries(FALLBACK_TIERS)) {
      expect(parsedDefaults[category]).toBe(tier);
    }
  });
});

describe('deriveSafetyTier — auto tier', () => {
  it('returns auto for base categories configured as auto', () => {
    resetTiers();
    expect(deriveSafetyTier('device_screenshot', json({ target: 'screen capture' }))).toBe('auto');
    expect(deriveSafetyTier('device_tap', json({ target: 'home screen icon' }))).toBe('auto');
    expect(deriveSafetyTier('device_scroll', json({ target: 'news feed' }))).toBe('auto');
  });

  it('returns auto when only the tool name is known', () => {
    resetTiers();
    expect(deriveSafetyTier('device_info')).toBe('auto');
  });

  it('falls back to the tap category (auto) with no arguments at all', () => {
    resetTiers();
    expect(deriveSafetyTier()).toBe('auto');
  });
});

describe('deriveSafetyTier — ask tier from confirm categories', () => {
  it('maps deletions (confirm) to ask', () => {
    resetTiers();
    expect(deriveSafetyTier('device_tap', json({ target: 'delete folder' }))).toBe('ask');
  });

  it('maps play_installs (confirm) to ask', () => {
    resetTiers();
    expect(deriveSafetyTier('device_open_app', json({ target: 'Google Play Store' }))).toBe('ask');
  });

  it('maps send_communication (confirm) to ask', () => {
    resetTiers();
    expect(deriveSafetyTier('device_tap', json({ target: 'send message to John' }))).toBe('ask');
  });

  it('maps settings_changes (confirm) to ask', () => {
    resetTiers();
    expect(deriveSafetyTier('device_open_app', json({ target: 'Settings' }))).toBe('ask');
  });
});

describe('deriveSafetyTier — blocked tier from deny categories', () => {
  it('blocks passwords & OTPs', () => {
    resetTiers();
    expect(deriveSafetyTier('device_type', json({ target: 'enter password', value: '123456' }))).toBe(
      'blocked'
    );
  });

  it('blocks permission toggles (grant/permission keywords)', () => {
    resetTiers();
    expect(deriveSafetyTier('device_tap', json({ target: 'grant camera permission' }))).toBe(
      'blocked'
    );
  });

  it('blocks root/shizuku operations', () => {
    resetTiers();
    expect(deriveSafetyTier('device_tap', json({ target: 'open root explorer' }))).toBe('blocked');
  });

  it('blocks sideloads', () => {
    resetTiers();
    expect(deriveSafetyTier('device_tap', json({ target: 'install apk from unknown source' }))).toBe(
      'blocked'
    );
  });
});

describe('deriveSafetyTier — sensitive-word escalation on auto tiers', () => {
  it('escalates to ask when a value-side sensitive word hits an auto category', () => {
    resetTiers();
    // classifyAction ignores value-side 'clear'/'call' etc., so the category
    // stays 'tap' (auto); only evaluateSafety's escalation heuristic sees it.
    expect(
      deriveSafetyTier('device_tap', json({ target: 'the OK button', value: 'clear the form' }))
    ).toBe('ask');
    expect(
      deriveSafetyTier('device_set_volume', json({ target: 'media', value: 'call volume chime' }))
    ).toBe('ask');
  });

  it('matches sensitive words case-insensitively', () => {
    resetTiers();
    expect(
      deriveSafetyTier('device_tap', json({ target: 'status bar', value: 'CONFIRM PAYMENT' }))
    ).toBe('ask');
  });

  it('does NOT escalate when no sensitive word is present (negative)', () => {
    resetTiers();
    expect(
      deriveSafetyTier('device_tap', json({ target: 'the OK button', value: 'submit the form' }))
    ).toBe('auto');
  });
});

describe('deriveSafetyTier — input parsing edge cases', () => {
  it('treats non-JSON input as raw target text without crashing', () => {
    resetTiers();
    expect(deriveSafetyTier('device_tap', 'open the pod bay doors')).toBe('auto');
  });

  it('still classifies non-JSON input that names a policy category', () => {
    resetTiers();
    expect(deriveSafetyTier('device_tap', 'not json but says delete')).toBe('ask');
  });

  it('ignores JSON arrays and non-string target/value fields', () => {
    resetTiers();
    expect(deriveSafetyTier('device_tap', '[1, 2, 3]')).toBe('auto');
    expect(deriveSafetyTier('device_tap', json({ target: 42, value: true }))).toBe('auto');
  });

  it('only inspects target/value — unknown JSON fields never escalate (negative)', () => {
    resetTiers();
    expect(
      deriveSafetyTier('device_tap', json({ foo: 'delete me', target: 'home screen' }))
    ).toBe('auto');
  });
});

describe('deriveSafetyTier — live policy overrides via the config store', () => {
  it('reflects a tier flipped to deny at runtime', () => {
    resetTiers();
    fixturePermissions.tap = 'deny';
    expect(deriveSafetyTier('device_tap', json({ target: 'home screen icon' }))).toBe('blocked');
    resetTiers();
    expect(deriveSafetyTier('device_tap', json({ target: 'home screen icon' }))).toBe('auto');
  });

  it('reflects a tier flipped to confirm at runtime', () => {
    resetTiers();
    fixturePermissions.screen_read = 'confirm';
    expect(deriveSafetyTier('device_screen_read', json({ target: 'chat window' }))).toBe('ask');
    resetTiers();
  });

  it('short-circuits on deny before the sensitive-word escalation runs', () => {
    resetTiers();
    fixturePermissions.tap = 'deny';
    // 'clear' would escalate an auto tier to ask, but deny wins first —
    // same ordering as evaluateSafety.
    expect(deriveSafetyTier('device_tap', json({ target: 'ok', value: 'clear cache' }))).toBe(
      'blocked'
    );
    resetTiers();
  });
});

// ---------------------------------------------------------------------------
// renderSegment override preference (#160): explicit segment.safetyTier wins
// over the derived tier. Mirrors the exact expression pinned structurally
// further below.
// ---------------------------------------------------------------------------

interface SegmentLike {
  type: string;
  content?: string;
  name?: string;
  input?: string;
  safetyTier?: TierLabel;
}

const resolveRenderSegmentTier = (segment: SegmentLike): TierLabel | undefined =>
  segment.type === 'tool_call'
    ? (segment.safetyTier as TierLabel | undefined) ??
      deriveSafetyTier(segment.name, segment.input)
    : undefined;

describe('renderSegment safety-tier preference (#160)', () => {
  it('prefers an explicit safetyTier over the derived one', () => {
    resetTiers();
    const segment: SegmentLike = {
      type: 'tool_call',
      name: 'device_tap',
      input: json({ target: 'home screen' }), // derives 'auto'
      safetyTier: 'blocked',
    };
    expect(resolveRenderSegmentTier(segment)).toBe('blocked');
  });

  it('keeps an explicit AUTO even when the policy would derive ask (?? not ||)', () => {
    resetTiers();
    const segment: SegmentLike = {
      type: 'tool_call',
      name: 'device_tap',
      input: json({ target: 'delete folder' }), // derives 'ask'
      safetyTier: 'auto',
    };
    expect(resolveRenderSegmentTier(segment)).toBe('auto');
  });

  it('falls back to the derived tier when safetyTier is absent', () => {
    resetTiers();
    const segment: SegmentLike = {
      type: 'tool_call',
      name: 'device_tap',
      input: json({ target: 'delete folder' }),
    };
    expect(resolveRenderSegmentTier(segment)).toBe('ask');
  });

  it('never computes a tier for non-tool_call segments', () => {
    resetTiers();
    expect(resolveRenderSegmentTier({ type: 'text', content: 'hi' })).toBeUndefined();
    expect(resolveRenderSegmentTier({ type: 'thought' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Structural pins — keep the tests honest about the real wiring
// ---------------------------------------------------------------------------

describe('#160 wiring pins', () => {
  it('renderSegment derives the tier only for tool_call and prefers the explicit value', () => {
    expect(indexSource).toMatch(
      /const safetyTier\s*=\s*segment\.type === 'tool_call'\s*\?\s*\(\(segment\.safetyTier as SafetyTierLabel \| undefined\)\s*\?\?\s*deriveSafetyTier\(segment\.name, segment\.input\)\)\s*:\s*undefined;/
    );
  });

  it('passes the computed tier down to CollapsibleBlock', () => {
    expect(indexSource).toContain('safetyTier={safetyTier}');
  });

  it('keeps deriveSafetyTier at module level, outside the component', () => {
    const fnIdx = indexSource.indexOf('function deriveSafetyTier');
    const componentIdx = indexSource.indexOf('export default function ChatScreen');
    expect(fnIdx).toBeGreaterThan(-1);
    expect(componentIdx).toBeGreaterThan(-1);
    expect(fnIdx).toBeLessThan(componentIdx);
  });

  it('MessageSegment carries the optional safetyTier field (type-only parser change)', () => {
    expect(messageParserSource).toMatch(/safetyTier\?:\s*'auto' \| 'ask' \| 'blocked';/);
  });
});
