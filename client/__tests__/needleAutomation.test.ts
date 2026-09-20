import {
  NEEDLE_DEVICE_TOOLS_JSON,
  NEEDLE_DEVICE_TOOL_NAMES,
  buildNeedleAutomationPrompt,
  parseNeedleCoords,
} from '../utils/needleDeviceTools';

jest.mock('../modules/device-agent', () => ({
  default: {
    getScreenTree: jest.fn().mockResolvedValue(''),
    getDeviceInfo: jest.fn().mockResolvedValue({}),
    takeScreenshot: jest.fn().mockResolvedValue(''),
    performAction: jest.fn().mockResolvedValue(true),
  },
}));
jest.mock('../db/client', () => ({ db: null }));

import { ALLOWED_DEVICE_TOOLS, parseToolCall } from '../utils/localAgentLoop';
import { classifyAction } from '../utils/safetyManager';

describe('needle mobile automation wiring', () => {
  it('exposes all device automation tools as JSON for needle_init', () => {
    const schemas = JSON.parse(NEEDLE_DEVICE_TOOLS_JSON);
    const names = schemas.map((s: any) => s.name);
    for (const tool of NEEDLE_DEVICE_TOOL_NAMES) {
      expect(names).toContain(tool);
    }
    expect(names).toContain('device_open_app');
    expect(names).toContain('device_press_key');
    expect(names).toContain('device_tap');
  });

  it('allows device_tap end-to-end (allowed set + safety classify)', () => {
    expect(ALLOWED_DEVICE_TOOLS.has('device_tap')).toBe(true);
    expect(classifyAction('device_tap', '@e3')).toBe('tap');
    expect(classifyAction('device_click', '@e3')).toBe('tap');
  });

  it('parses needle JSON key/level/direction args into target/value', () => {
    const press = parseToolCall('{"name": "device_press_key", "arguments": {"key": "back"}}');
    expect(press?.toolName).toBe('device_press_key');
    expect(press?.value).toBe('back');

    const vol = parseToolCall('{"name": "device_set_volume", "arguments": {"level": "5"}}');
    expect(vol?.value).toBe('5');

    const scroll = parseToolCall(
      '{"name": "device_scroll", "arguments": {"target": "@e0", "direction": "forward"}}'
    );
    expect(scroll?.target).toBe('@e0');
    expect(scroll?.value).toBe('forward');

    const tap = parseToolCall('{"name": "device_tap", "arguments": {"target": "@e3"}}');
    expect(tap?.toolName).toBe('device_tap');
    expect(tap?.target).toBe('@e3');
  });

  it('wraps prompts with automation instructions so small models stay in tool mode', () => {
    const wrapped = buildNeedleAutomationPrompt('Open Settings');
    expect(wrapped).toContain('device_screen_read');
    expect(wrapped).toContain('Open Settings');
    expect(wrapped).toContain('Owner request');
  });

  it('parses typed x,y coords and rejects @e refs / garbage', () => {
    expect(parseNeedleCoords('540,960')).toEqual({ x: 540, y: 960 });
    expect(parseNeedleCoords('@e3')).toBeNull();
    expect(parseNeedleCoords('not-coords')).toBeNull();
  });
});
