/**
 * #298 — On-device JSON extraction ("local Jev", option 1 of #290).
 *
 * Schema-as-only-tool: the pasted schema is wrapped as the single tool handed
 * to needle_init/needle_complete, so the decode grammar admits exactly one
 * call and conformance is guaranteed rather than requested (upstream needle
 * structured-extraction contract). Surface function_calls[0].arguments +
 * confidence from #295's parseToolCall — no second parser, no prose.
 *
 * Terminal states covered here: success / refusal / parse failure / engine
 * error (needle_last_error) / invalid schema / mock fallback (honesty: mock
 * text is never presented as a real extraction).
 */

jest.mock('../utils/safetyManager', () => ({
  evaluateSafety: jest.fn(async () => ({ status: 'success', result: 'allowed' })),
}));

jest.mock('../utils/deviceActionExecutor', () => ({
  executeDeviceAction: jest.fn(async () => ({ outcome: 'executed', observation: 'observation' })),
}));

jest.mock('../db/client', () => ({
  db: null,
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../modules/needle', () => {
  const SUCCESS_ENVELOPE =
    '{"type":"call","function_calls":[{"name":"record","arguments":{"vendor":"Acme Corp","total":1200}}],' +
    '"reasoning":"Values are spans of the invoice.","confidence":0.91}';
  return {
    __esModule: true,
    default: {
      isAvailable: jest.fn(() => true),
      hasNativeLibrary: jest.fn(() => true),
      init: jest.fn(async () => true),
      complete: jest.fn(async () => ({ text: SUCCESS_ENVELOPE, toolCalls: SUCCESS_ENVELOPE })),
      reset: jest.fn(async () => true),
      unload: jest.fn(async () => {}),
      addListener: jest.fn(() => ({ remove: () => {} })),
    },
  };
});

import * as fs from 'fs';
import * as path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NeedleModule from '../modules/needle';
import { useConfigStore } from '../store/useConfigStore';
import {
  EXTRACTION_TOOL_NAME,
  EXTRACTION_MAX_TOKENS,
  MAX_INPUT_CHARS,
  buildSchemaOnlyToolsJson,
  parseExtractionEnvelope,
  getExtractionMockState,
  runJsonExtraction,
} from '../utils/jsonExtraction';
import { initializeLocalModel, unloadLocalModel, isLocalModelLoaded } from '../utils/localLlm';

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    vendor: { type: 'string' },
    total: { type: 'number' },
    due_date: { type: 'string' },
  },
  required: ['vendor', 'total'],
});
const SOURCE = 'Invoice from Acme Corp, $1,200.00, due 2026-09-01';

const SUCCESS_ENVELOPE =
  '{"type":"call","function_calls":[{"name":"record","arguments":{"vendor":"Acme Corp","total":1200}}],' +
  '"reasoning":"Values are spans of the invoice.","confidence":0.91}';
const REFUSAL_ENVELOPE =
  '{"type":"call","function_calls":[],"reasoning":"No record in this text.","confidence":0.12}';

describe('jsonExtraction — schema-as-only-tool helper (#298)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await unloadLocalModel();
    useConfigStore.setState({ localModelName: 'Needle-2 45M' });
    await AsyncStorage.setItem(
      'local_model_downloaded_Needle-2 45M_path',
      'file:///data/local/tmp/needle2.cact'
    );
  });

  afterEach(async () => {
    await unloadLocalModel();
  });

  describe('buildSchemaOnlyToolsJson', () => {
    it('wraps the pasted schema as the ONLY tool (needle_init tools_json shape)', () => {
      const built = buildSchemaOnlyToolsJson(SCHEMA);
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const tools = JSON.parse(built.toolsJson);
      expect(Array.isArray(tools)).toBe(true);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe(EXTRACTION_TOOL_NAME);
      expect(typeof tools[0].description).toBe('string');
      expect(tools[0].description.length).toBeGreaterThan(0);
      expect(tools[0].parameters).toEqual(JSON.parse(SCHEMA));
    });

    it('rejects input that is not valid JSON with a readable error', () => {
      const built = buildSchemaOnlyToolsJson('{ not json');
      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.error).toMatch(/not valid JSON/i);
    });

    it('rejects non-object schemas (array / primitive)', () => {
      expect(buildSchemaOnlyToolsJson('[1,2,3]').ok).toBe(false);
      expect(buildSchemaOnlyToolsJson('"hello"').ok).toBe(false);
      expect(buildSchemaOnlyToolsJson('42').ok).toBe(false);
      expect(buildSchemaOnlyToolsJson('').ok).toBe(false);
    });

    it('rejects a schema whose type is not "object"', () => {
      const built = buildSchemaOnlyToolsJson('{"type":"string"}');
      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.error).toMatch(/object/i);
    });
  });

  describe('parseExtractionEnvelope (reuses #295 parseToolCall)', () => {
    it('returns typed arguments + pretty JSON + engine confidence on success', () => {
      const res = parseExtractionEnvelope(SUCCESS_ENVELOPE);
      expect(res.status).toBe('success');
      expect(res.mock).toBe(false);
      expect(res.data).toEqual({ vendor: 'Acme Corp', total: 1200 });
      expect(res.json).toBe(JSON.stringify({ vendor: 'Acme Corp', total: 1200 }, null, 2));
      expect(JSON.parse(res.json || '')).toEqual(res.data);
      expect(res.confidence).toBe(0.91);
      expect(res.reasoning).toBe('Values are spans of the invoice.');
    });

    it('leaves confidence undefined when the engine did not report one (never invents)', () => {
      const res = parseExtractionEnvelope(
        '{"type":"call","function_calls":[{"name":"record","arguments":{"vendor":"Acme"}}]}'
      );
      expect(res.status).toBe('success');
      expect(res.confidence).toBeUndefined();
    });

    it('flags an empty function_calls envelope as a refusal, not a result', () => {
      const res = parseExtractionEnvelope(REFUSAL_ENVELOPE);
      expect(res.status).toBe('refusal');
      expect(res.message).toBe('No record in this text.');
      expect(res.json).toBeUndefined();
      expect(res.data).toBeUndefined();
    });

    it('flags prose / non-envelope output as a parse failure', () => {
      const res = parseExtractionEnvelope('The invoice looks like it is from Acme Corp.');
      expect(res.status).toBe('parse_failure');
      expect(res.data).toBeUndefined();
      expect(parseExtractionEnvelope('').status).toBe('parse_failure');
    });

    it('flags an engine "Error: ..." payload as an engine error with the detail', () => {
      const res = parseExtractionEnvelope('Error: needle_complete failed (code -3)');
      expect(res.status).toBe('engine_error');
      expect(res.message).toContain('needle_complete failed');
    });
  });

  describe('getExtractionMockState (capability honesty)', () => {
    it('reports mock when the native Needle library is absent', () => {
      (NeedleModule.hasNativeLibrary as jest.Mock).mockReturnValueOnce(false);
      const state = getExtractionMockState();
      expect(state.mock).toBe(true);
      expect(state.reason).toMatch(/native library/i);
    });

    it('reports real when the native library is present and no fallback is active', () => {
      const state = getExtractionMockState();
      expect(state.mock).toBe(false);
      expect(state.reason).toBeNull();
    });
  });

  describe('runJsonExtraction lifecycle (needle_load -> init -> complete -> reset)', () => {
    it('declares the schema as the only tool at init + complete, then resets and releases', async () => {
      const built = buildSchemaOnlyToolsJson(SCHEMA);
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const res = await runJsonExtraction(SCHEMA, SOURCE);

      expect(res.status).toBe('success');
      expect(res.data).toEqual({ vendor: 'Acme Corp', total: 1200 });
      expect(res.confidence).toBe(0.91);

      expect(NeedleModule.init).toHaveBeenCalledWith(
        '/data/local/tmp/needle2.cact',
        expect.any(Number),
        '',
        '',
        built.toolsJson
      );
      expect(NeedleModule.complete).toHaveBeenCalledWith(SOURCE, built.toolsJson, EXTRACTION_MAX_TOKENS);
      expect(NeedleModule.reset).toHaveBeenCalled();
      // Engine released afterwards so the chat path re-initializes with the
      // default (tool-free) declaration — no schema leakage into the agent loop.
      expect(NeedleModule.unload).toHaveBeenCalled();
      expect(isLocalModelLoaded).toBe(false);
    });

    it('never touches the engine for an invalid schema', async () => {
      const res = await runJsonExtraction('{ not json', SOURCE);
      expect(res.status).toBe('invalid_schema');
      expect(res.message).toMatch(/not valid JSON/i);
      expect(NeedleModule.init).not.toHaveBeenCalled();
      expect(NeedleModule.complete).not.toHaveBeenCalled();
    });

    it('short-circuits to an explicit mock state instead of faking an extraction', async () => {
      (NeedleModule.hasNativeLibrary as jest.Mock).mockReturnValueOnce(false);
      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('mock');
      expect(res.mock).toBe(true);
      expect(res.mockReason).toMatch(/native library/i);
      expect(res.json).toBeUndefined();
      expect(res.data).toBeUndefined();
      expect(res.confidence).toBeUndefined();
      expect(NeedleModule.init).not.toHaveBeenCalled();
      expect(NeedleModule.complete).not.toHaveBeenCalled();
    });

    it('short-circuits to mock when a previous init already fell back (fallback reason)', async () => {
      (NeedleModule.init as jest.Mock).mockRejectedValueOnce(new Error('needle exploded'));
      await initializeLocalModel();

      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('mock');
      expect(res.mock).toBe(true);
      expect(res.mockReason).toContain('needle exploded');
      expect(NeedleModule.complete).not.toHaveBeenCalled();
    });

    it('surfaces needle_last_error as an engine error when init throws', async () => {
      (NeedleModule.init as jest.Mock).mockRejectedValueOnce(
        new Error('needle_init: static prefix exceeds context window')
      );

      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('engine_error');
      expect(res.message).toContain('static prefix exceeds context');
      expect(NeedleModule.complete).not.toHaveBeenCalled();
      expect(NeedleModule.reset).toHaveBeenCalled();
    });

    it('treats a false init result (no last_error detail) as an engine error', async () => {
      (NeedleModule.init as jest.Mock).mockResolvedValueOnce(false);
      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('engine_error');
      expect(res.message).toBeTruthy();
      expect(NeedleModule.complete).not.toHaveBeenCalled();
    });

    it('surfaces an "Error: ..." completion payload as an engine error', async () => {
      (NeedleModule.complete as jest.Mock).mockResolvedValueOnce({
        text: 'Error: needle_complete failed (code -3)',
      });
      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('engine_error');
      expect(res.message).toContain('needle_complete failed');
      expect(NeedleModule.reset).toHaveBeenCalled();
    });

    it('reports an engine error (not a crash) when no model has been downloaded', async () => {
      await AsyncStorage.removeItem('local_model_downloaded_Needle-2 45M_path');
      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('engine_error');
      expect(res.message).toMatch(/download/i);
      expect(NeedleModule.init).not.toHaveBeenCalled();
    });

    it('refuses to run against a non-Needle (.cact) selected model', async () => {
      await AsyncStorage.setItem(
        'local_model_downloaded_Needle-2 45M_path',
        'file:///data/local/tmp/qwen.task'
      );
      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('engine_error');
      expect(res.message).toMatch(/\.cact/i);
      expect(NeedleModule.init).not.toHaveBeenCalled();
    });

    it('releases a previously-loaded engine so chat re-initializes cleanly', async () => {
      await initializeLocalModel();
      expect(isLocalModelLoaded).toBe(true);

      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('success');
      expect(NeedleModule.unload).toHaveBeenCalled();
      expect(isLocalModelLoaded).toBe(false);
    });

    it('reports a refusal from the engine as its own terminal state', async () => {
      (NeedleModule.complete as jest.Mock).mockResolvedValueOnce({ text: REFUSAL_ENVELOPE });
      const res = await runJsonExtraction(SCHEMA, SOURCE);
      expect(res.status).toBe('refusal');
      expect(res.message).toBe('No record in this text.');
      expect(res.json).toBeUndefined();
    });

    it('rejects oversized input before anything crosses JNI', async () => {
      (NeedleModule.complete as jest.Mock).mockClear();
      const res = await runJsonExtraction(SCHEMA, 'x'.repeat(MAX_INPUT_CHARS + 1));
      expect(res.status).toBe('input_too_large');
      expect(res.message).toContain(`${MAX_INPUT_CHARS} characters`);
      expect(NeedleModule.complete).not.toHaveBeenCalled();
    });
  });

  describe('settings wiring (#298 screen registered with its siblings)', () => {
    const settingsDir = path.join(__dirname, '..', 'app', 'settings');

    it('ships app/settings/extract.tsx', () => {
      expect(fs.existsSync(path.join(settingsDir, 'extract.tsx'))).toBe(true);
    });

    it('links the screen from the settings index under Local AI', () => {
      const indexSource = fs.readFileSync(path.join(settingsDir, 'index.tsx'), 'utf8');
      expect(indexSource).toContain("'/settings/extract'");
    });
  });
});
