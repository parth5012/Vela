/**
 * Shared Needle (.cact) device-automation tool definitions.
 *
 * Single source of truth for the on-device action schemas the Needle engine
 * is initialized with and the prompt wrapper used at inference time.
 * Imported by `utils/localLlm.ts` (init + complete) and mirrored by
 * `utils/localAgentLoop.ts` ALLOWED_DEVICE_TOOLS for execution gating.
 */

export const NEEDLE_DEVICE_TOOL_NAMES = [
  'device_screen_read',
  'device_info',
  'device_screenshot',
  'device_click',
  'device_tap',
  'device_type',
  'device_scroll',
  'device_swipe',
  'device_press_key',
  'device_set_volume',
  'device_open_app',
] as const;

export type NeedleDeviceToolName = (typeof NEEDLE_DEVICE_TOOL_NAMES)[number];

interface NeedleToolSchema {
  name: string;
  description: string;
  arguments: Record<string, string>;
}

const NEEDLE_TOOL_SCHEMAS: NeedleToolSchema[] = [
  {
    name: 'device_screen_read',
    description: 'Read the current screen accessibility tree (@e refs + bounds). Call first.',
    arguments: {},
  },
  {
    name: 'device_info',
    description: 'Get device brand, model, SDK, release.',
    arguments: {},
  },
  {
    name: 'device_screenshot',
    description: 'Capture a screenshot, returns a file URI.',
    arguments: {},
  },
  {
    name: 'device_click',
    description: 'Tap a node by @e ref (preferred) or absolute x,y pixels.',
    arguments: { target: '@e3 | 540,960', x: 'pixels (with y)', y: 'pixels (with x)' },
  },
  {
    name: 'device_tap',
    description: 'Alias of device_click for an @e ref target.',
    arguments: { target: '@e3' },
  },
  {
    name: 'device_type',
    description: 'Type text into a focused or @e-ref input.',
    arguments: { target: '@e ref (optional)', text: 'text to type' },
  },
  {
    name: 'device_scroll',
    description: 'Scroll forward/backward on a scrollable @e node.',
    arguments: { target: '@e ref', direction: 'forward | backward' },
  },
  {
    name: 'device_swipe',
    description: 'Swipe on a @e node (maps to scroll).',
    arguments: { target: '@e ref', direction: 'forward | backward' },
  },
  {
    name: 'device_press_key',
    description: 'Press a hardware key.',
    arguments: { key: 'back | home | recent' },
  },
  {
    name: 'device_set_volume',
    description: 'Set media volume level 0-15.',
    arguments: { level: '0-15' },
  },
  {
    name: 'device_open_app',
    description: 'Open an app by label or package.',
    arguments: { app: 'Settings | package name' },
  },
];

/** Typed x,y coordinate pair for Needle click targets (replaces "x,y" strings). */
export interface DeviceCoords {
  x: number;
  y: number;
}

/** Parses an "@e ref or x,y" click target into typed coords, or null. */
export function parseNeedleCoords(target?: string): DeviceCoords | null {
  if (!target || target.startsWith('@e')) return null;
  const parts = target.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1] };
}

/** JSON string passed as `tools_json` to needle_init / needle_complete. */
export const NEEDLE_DEVICE_TOOLS_JSON: string = JSON.stringify(NEEDLE_TOOL_SCHEMAS);

export const NEEDLE_AUTOMATION_SYSTEM_PROMPT: string =
  'You are an on-device mobile automation agent. ' +
  'Always respond with exactly one JSON tool call: {"name": "<tool>", "arguments": {...}, "confidence": 0.0-1.0}. ' +
  'Read the screen first (device_screen_read), then act with @e refs. ' +
  'Prefer device_click/device_tap with @e targets over raw x,y. ' +
  'Available tools: device_screen_read, device_info, device_screenshot, ' +
  'device_click, device_tap, device_type, device_scroll, device_swipe, ' +
  'device_press_key, device_set_volume, device_open_app.';

/**
 * Wraps a user prompt with automation instructions + optional screen context
 * so the small Needle model stays in tool-call mode.
 */
export function buildNeedleAutomationPrompt(userPrompt: string, screenTree?: string): string {
  const base = `${NEEDLE_AUTOMATION_SYSTEM_PROMPT}\nOwner request: ${userPrompt}`;
  if (screenTree && screenTree.trim().length > 0) {
    return `${base}\nScreen:\n${screenTree.slice(0, 4000)}`;
  }
  return base;
}
