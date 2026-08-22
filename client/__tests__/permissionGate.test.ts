/**
 * #158 Permission grant loop — session-denied semantics + wiring pins.
 *
 * RUNTIME STRATEGY (see helpers/standaloneRunner.ts for the full rationale):
 * Jest cannot bootstrap in this environment and app/index.tsx cannot be
 * imported outside a React Native runtime, so this suite:
 *   1. extracts the REAL shouldPrompt() from utils/permissionManager.ts and
 *      runs behavioral tests against it, and
 *   2. drives a harness that mirrors the #158 device-action gate and modal
 *      handlers from app/index.tsx verbatim (the mirrored lines are pinned to
 *      the real file by the structural assertions below, so drift fails here).
 *
 * The prompt UI itself (Modal/PermissionRequestCard rendering) needs a RN
 * component renderer and is tracked as an on-device / jest-infra follow-up.
 */

import { ensureStandaloneRunner, extractBlock, readSource, transpileAndEval } from './helpers/standaloneRunner';

ensureStandaloneRunner();

// ---------------------------------------------------------------------------
// Load the REAL shouldPrompt() out of permissionManager.ts
// ---------------------------------------------------------------------------

const permissionManagerSource = readSource('utils/permissionManager.ts');
const shouldPromptSource = extractBlock(permissionManagerSource, 'function shouldPrompt');

interface ShouldPromptModule {
  shouldPrompt: (perm: string, sessionDenied: Set<string>) => boolean;
}

const extracted = transpileAndEval(`
type OSPermission = string;
${shouldPromptSource}
module.exports = { shouldPrompt };
`) as unknown as ShouldPromptModule;

const shouldPrompt = extracted.shouldPrompt;

describe('shouldPrompt (real source from utils/permissionManager.ts)', () => {
  it('prompts when nothing has been denied this session', () => {
    expect(shouldPrompt('accessibility', new Set())).toBe(true);
  });

  it('does not re-prompt a permission that was denied this session', () => {
    const denied = new Set<string>(['accessibility']);
    expect(shouldPrompt('accessibility', denied)).toBe(false);
  });

  it('still prompts other permissions when only a different one was denied', () => {
    const denied = new Set<string>(['camera']);
    expect(shouldPrompt('accessibility', denied)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Harness mirroring the #158 gate + modal handlers from app/index.tsx.
// The structural assertions further below pin this mirror to the real source.
// ---------------------------------------------------------------------------

type OsStatus = 'granted' | 'denied' | 'undetermined';

class DeviceActionGateHarness {
  readonly sessionDenied = new Set<string>();
  promptVisible = false;
  readonly errorResponses: string[] = [];
  executedActions = 0;
  requestPermissionCalls = 0;
  osAccessibilityStatus: OsStatus;

  constructor(initialStatus: OsStatus) {
    this.osAccessibilityStatus = initialStatus;
  }

  /** Stub for checkPermission('accessibility') — the native module boundary. */
  async checkPermission(): Promise<OsStatus> {
    return this.osAccessibilityStatus;
  }

  async requestPermission(): Promise<OsStatus> {
    this.requestPermissionCalls += 1;
    return 'undetermined';
  }

  /**
   * Mirrors the #158 block inside the device-action effect:
   *   const accessibilityStatus = await checkPermission('accessibility');
   *   if (accessibilityStatus !== 'granted') {
   *     if (shouldPrompt('accessibility', sessionDeniedPermissionsRef.current)) {
   *       setPermissionPrompt('accessibility');
   *     }
   *     await sendDeviceResponse(conversationId, taskToken, 'error', ...);
   *     return;
   *   }
   */
  async runDeviceAction(): Promise<void> {
    const status = await this.checkPermission();
    if (status !== 'granted') {
      if (shouldPrompt('accessibility', this.sessionDenied)) {
        this.promptVisible = true;
      }
      this.errorResponses.push(
        'Blocked: the Accessibility permission is required for this action.'
      );
      return;
    }
    this.executedActions += 1;
  }

  /** Mirrors onGrant: requestPermission then dismiss. */
  async tapGrant(): Promise<void> {
    await this.requestPermission();
    this.promptVisible = false;
  }

  /** Mirrors onDeny: add to session-denied set, dismiss. */
  tapDeny(): void {
    this.sessionDenied.add('accessibility');
    this.promptVisible = false;
  }

  /** Mirrors onDontAskAgain: add to session-denied set, dismiss. */
  tapDontAskAgain(): void {
    this.sessionDenied.add('accessibility');
    this.promptVisible = false;
  }
}

describe('#158 permission gate — session-denied semantics', () => {
  it('executes directly without prompting when accessibility is granted', async () => {
    const gate = new DeviceActionGateHarness('granted');
    await gate.runDeviceAction();
    expect(gate.promptVisible).toBe(false);
    expect(gate.errorResponses).toHaveLength(0);
    expect(gate.executedActions).toBe(1);
  });

  it('shows the prompt once and answers the tool call with an error when denied', async () => {
    const gate = new DeviceActionGateHarness('denied');
    await gate.runDeviceAction();
    expect(gate.promptVisible).toBe(true);
    expect(gate.errorResponses).toHaveLength(1);
    expect(gate.errorResponses[0]).toContain('Blocked');
    expect(gate.executedActions).toBe(0);
  });

  it('treats "undetermined" (native module missing) as not granted', async () => {
    const gate = new DeviceActionGateHarness('undetermined');
    await gate.runDeviceAction();
    expect(gate.promptVisible).toBe(true);
    expect(gate.executedActions).toBe(0);
  });

  it('does not re-prompt after Deny within the session, but still answers the loop', async () => {
    const gate = new DeviceActionGateHarness('denied');
    await gate.runDeviceAction();
    gate.tapDeny();

    await gate.runDeviceAction(); // second device_* call in the same session
    expect(gate.promptVisible).toBe(false); // suppressed…
    expect(gate.sessionDenied.has('accessibility')).toBe(true);
    expect(gate.errorResponses).toHaveLength(2); // …but agent loop still answered
    expect(gate.executedActions).toBe(0);
  });

  it('does not re-prompt after Don\'t-ask-again within the session', async () => {
    const gate = new DeviceActionGateHarness('denied');
    await gate.runDeviceAction();
    gate.tapDontAskAgain();

    await gate.runDeviceAction();
    await gate.runDeviceAction();
    expect(gate.promptVisible).toBe(false);
    expect(gate.errorResponses).toHaveLength(3);
  });

  it('grant path dismisses the prompt via requestPermission; enabling enables execution', async () => {
    const gate = new DeviceActionGateHarness('denied');
    await gate.runDeviceAction();
    expect(gate.promptVisible).toBe(true);

    await gate.tapGrant();
    expect(gate.requestPermissionCalls).toBe(1);
    expect(gate.promptVisible).toBe(false);

    // User enabled the accessibility service in system settings.
    gate.osAccessibilityStatus = 'granted';
    await gate.runDeviceAction();
    expect(gate.executedActions).toBe(1);
    expect(gate.promptVisible).toBe(false);
    expect(gate.errorResponses).toHaveLength(1);
  });

  it('only Deny/Dont-ask-again suppress re-prompts — granting without enabling prompts again', async () => {
    const gate = new DeviceActionGateHarness('denied');
    await gate.runDeviceAction();
    await gate.tapGrant(); // deep-links to settings but user does NOT enable

    await gate.runDeviceAction();
    expect(gate.promptVisible).toBe(true); // asked again — correct, set untouched
    expect(gate.sessionDenied.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Structural pins — assert the real wiring exists verbatim in app/index.tsx
// so the harness above cannot silently drift from production code.
// ---------------------------------------------------------------------------

const indexSource = readSource('app/index.tsx');

function countMatches(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

describe('#158 permission gate — wiring pins in app/index.tsx', () => {
  it('declares the pending-prompt state and the session-scoped denial set ref', () => {
    expect(indexSource).toMatch(
      /const \[permissionPrompt, setPermissionPrompt\] = useState<OSPermission \| null>\(null\);/
    );
    expect(indexSource).toMatch(
      /sessionDeniedPermissionsRef = React\.useRef<Set<OSPermission>>\(new Set\(\)\);/
    );
  });

  it('gates every device_* action behind checkPermission(\'accessibility\')', () => {
    expect(indexSource).toMatch(/await checkPermission\('accessibility'\);/);
    expect(indexSource).toMatch(/if \(accessibilityStatus !== 'granted'\) \{/);
  });

  it('suppresses the prompt only via shouldPrompt against the session-denied set', () => {
    expect(indexSource).toMatch(
      /if \(shouldPrompt\('accessibility', sessionDeniedPermissionsRef\.current\)\) \{/
    );
    expect(indexSource).toMatch(/setPermissionPrompt\('accessibility'\);/);
  });

  it('sends an error device response so the agent loop is not left hanging', () => {
    expect(indexSource).toMatch(
      /sendDeviceResponse\(\s*conversationId,\s*taskToken,\s*'error',/
    );
    expect(indexSource).toContain(
      "'Blocked: the Accessibility permission is required for this action.'"
    );
  });

  it('wires Deny and Dont-ask-again to populate the session-denied set exactly twice', () => {
    expect(
      countMatches(indexSource, /sessionDeniedPermissionsRef\.current\.add\('accessibility'\)/g)
    ).toBe(2);
    expect(indexSource).toMatch(
      /onDeny=\{\(\) => \{\s*sessionDeniedPermissionsRef\.current\.add\('accessibility'\);\s*setPermissionPrompt\(null\);\s*\}\}/
    );
    expect(indexSource).toMatch(
      /onDontAskAgain=\{\(\) => \{\s*sessionDeniedPermissionsRef\.current\.add\('accessibility'\);\s*setPermissionPrompt\(null\);\s*\}\}/
    );
  });

  it('wires Grant to requestPermission then dismiss, inside a transparent Modal bound to the state', () => {
    expect(indexSource).toMatch(
      /onGrant=\{async \(\) => \{\s*await requestPermission\('accessibility'\);\s*setPermissionPrompt\(null\);\s*\}\}/
    );
    expect(indexSource).toMatch(/visible=\{permissionPrompt !== null\}/);
    expect(indexSource).toMatch(/<Modal\s+visible=\{permissionPrompt !== null\}\s+transparent/);
  });
});

// ---------------------------------------------------------------------------
// PermissionRequestCard contract (#158 prop alignment)
// ---------------------------------------------------------------------------

const cardSource = readSource('components/chat/PermissionRequestCard.tsx');

describe('PermissionRequestCard props contract', () => {
  it('exposes onGrant/onDeny/onDontAskAgain with the aligned signatures', () => {
    expect(cardSource).toMatch(/onGrant: \(\) => Promise<void>;/);
    expect(cardSource).toMatch(/onDeny: \(\) => void;/);
    expect(cardSource).toMatch(/onDontAskAgain\?: \(\) => void;/);
    // The old suppress callback must be gone.
    expect(cardSource).not.toMatch(/onSuppressChange/);
  });

  it('fires onDontAskAgain only when the checkbox transitions to checked', () => {
    expect(cardSource).toMatch(/if \(next\) onDontAskAgain\?\.\(\);/);
  });

  it('keeps the display props required for rendering', () => {
    expect(cardSource).toMatch(/permission: OSPermission;/);
    expect(cardSource).toMatch(/rationale: string;/);
  });
});

// ---------------------------------------------------------------------------
// Settings hub routes accessibility through the guide first (#158 item 4)
// ---------------------------------------------------------------------------

const settingsPermissionsSource = readSource('app/settings/permissions.tsx');
const accessibilityGuideSource = readSource('components/ui/AccessibilityGuide.tsx');

describe('settings/permissions.tsx accessibility flow', () => {
  it('opens the AccessibilityGuide instead of jumping straight to system settings', () => {
    expect(settingsPermissionsSource).toMatch(
      /if \(perm === 'accessibility'\) \{\s*setShowAccessibilityGuide\(true\);\s*return;\s*\}/
    );
    expect(settingsPermissionsSource).toMatch(
      /<AccessibilityGuide\s+visible=\{showAccessibilityGuide\}\s+onClose=\{\(\) => setShowAccessibilityGuide\(false\)\}\s*\/>/
    );
  });

  it('keeps the unchanged AccessibilityGuide { visible, onClose } API', () => {
    expect(accessibilityGuideSource).toMatch(
      /export interface AccessibilityGuideProps \{\s*visible: boolean;\s*onClose: \(\) => void;\s*\}/
    );
    expect(accessibilityGuideSource).toMatch(
      /function AccessibilityGuide\(\{ visible, onClose \}: AccessibilityGuideProps\)/
    );
  });
});
