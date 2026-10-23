/**
 * PR #277 follow-up — no model may ship in mock-only form.
 *
 * Every LiteRT `.task` row was replaced by a GGUF equivalent (this build has no
 * MediaPipe engine). Users who downloaded the old `.task` files keep a stale
 * "downloaded" record pointing at a file the packaged engine cannot open, so
 * download status must be validated against the current model list.
 */
import { getModelFileFormat, isStoredModelUsable, LOCAL_MODELS } from '../utils/localLlm';

describe('getModelFileFormat', () => {
  it('maps paths to the engine family the loader will pick', () => {
    expect(getModelFileFormat('file:///data/model.gguf')).toBe('gguf');
    expect(getModelFileFormat('file:///data/model.cact')).toBe('cact');
    expect(getModelFileFormat('file:///data/model.task')).toBe('task');
  });

  it('is case insensitive', () => {
    expect(getModelFileFormat('file:///data/MODEL.GGUF')).toBe('gguf');
    expect(getModelFileFormat('file:///data/MODEL.CACT')).toBe('cact');
  });
});

describe('isStoredModelUsable', () => {
  const gguf = { format: 'gguf' as const };

  it('accepts a matching flag + path', () => {
    expect(isStoredModelUsable(gguf, 'true', 'file:///m.gguf')).toBe(true);
  });

  it('rejects a missing flag or path', () => {
    expect(isStoredModelUsable(gguf, null, 'file:///m.gguf')).toBe(false);
    expect(isStoredModelUsable(gguf, 'true', null)).toBe(false);
    expect(isStoredModelUsable(gguf, 'false', 'file:///m.gguf')).toBe(false);
  });

  it('rejects a stale `.task` file for a GGUF model', () => {
    expect(isStoredModelUsable(gguf, 'true', 'file:///old.task')).toBe(false);
  });

  it('rejects a stale `.gguf` file for a Needle model', () => {
    expect(isStoredModelUsable({ format: 'cact' }, 'true', 'file:///old.gguf')).toBe(false);
  });
});

describe('shipped model list', () => {
  it('contains no mock-only `.task` entries', () => {
    expect(LOCAL_MODELS.filter((m) => m.format === 'task')).toEqual([]);
  });

  it('links every model to the filename its engine expects', () => {
    for (const model of LOCAL_MODELS) {
      if (model.format === 'gguf') {
        expect(model.filename.endsWith('.gguf')).toBe(true);
        expect(model.downloadUrl.endsWith('.gguf')).toBe(true);
      }
      if (model.format === 'cact') {
        expect(model.filename.endsWith('.cact')).toBe(true);
      }
      // The picker renders `size` in GB; it must be parseable for the
      // free-space check in useModelDownload.
      expect(model.size).toMatch(/~[\d.]+ GB/);
    }
  });
});
