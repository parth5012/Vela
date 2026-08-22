// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';
import { parseMessage } from '../utils/messageParser';
import { healXmlTags } from '../utils/xmlHealer';

/**
 * Wayfinder #148 runtime smoke test.
 *
 * Structural lint catches hook-order violations statically; this test mounts
 * the actual component variants that render chat segments so the
 * "Invalid hook call" crash class (#143/#148) fails here in Jest too.
 *
 * It also drives the exact streaming transition that used to crash: a row is
 * re-rendered from a partial stream payload to its healed final content.
 */

const themeColors = { card: '#fff', border: '#ccc', text: '#000', textMuted: '#666', textDark: '#333' };
const themeSizes = { text: 14, sub: 12 };
const accentHex = '#6366f1';

function mountBlock(variant: {
  type: 'thought' | 'tool_call' | 'intent' | 'skill';
  name?: string;
  input?: string;
  isClosed: boolean;
}) {
  let component: renderer.ReactTestRenderer | undefined;
  act(() => {
    component = renderer.create(
      <CollapsibleBlock
        type={variant.type}
        name={variant.name}
        input={variant.input}
        isClosed={variant.isClosed}
        themeColors={themeColors}
        themeSizes={themeSizes}
        accentHex={accentHex}
      >
        <mock-children />
      </CollapsibleBlock>
    );
  });
  expect(component).toBeDefined();
  expect(component!.toJSON()).toBeTruthy();
}

describe('CollapsibleBlock mount smoke (#148)', () => {
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
  });

  it('mounts the thought variant open and closed', () => {
    mountBlock({ type: 'thought', isClosed: false });
    mountBlock({ type: 'thought', isClosed: true });
  });

  it('mounts the tool_call variant open and closed', () => {
    mountBlock({ type: 'tool_call', name: 'web_search', input: '{"query":"rn"}', isClosed: false });
    mountBlock({ type: 'tool_call', name: 'web_search', input: '{"query":"rn"}', isClosed: true });
  });

  it('mounts the intent variant closed', () => {
    mountBlock({ type: 'intent', isClosed: true });
  });

  it('survives the streamed-partial -> healed-final transition', () => {
    const finalContent =
      '<thought>User asked: what is the capital of France.</thought>[PERSONA] The capital of France is Paris.';

    // Simulate appendToken-style growth over the raw stream...
    for (let end = 1; end <= finalContent.length; end += 7) {
      const partial = finalContent.slice(0, end);
      const parsed = parseMessage(partial);
      expect(Array.isArray(parsed)).toBe(true);
      const block = parsed.find((s) => s.type === 'thought');
      if (block) {
        mountBlock({ type: 'thought', isClosed: block.isClosed });
      }
    }

    // ...then the healed final content that gets persisted.
    const healed = healXmlTags(finalContent);
    const segments = parseMessage(healed);
    const thought = segments.find((s) => s.type === 'thought');
    expect(thought?.isClosed).toBe(true);
    mountBlock({ type: 'thought', isClosed: true });
  });
});

