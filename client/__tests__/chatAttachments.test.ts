// @ts-nocheck
import {
  computeScaledDimensions,
  isTotalUploadOverWarnThreshold,
  compressImage,
  MAX_IMAGE_DIMENSION,
  TOTAL_UPLOAD_WARN_BYTES,
} from '../utils/imageCompression';
import { uploadChatAttachment } from '../utils/chatAttachments';
import { useConfigStore } from '../store/useConfigStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

jest.mock('../db/chatRepository', () => ({
  saveThread: jest.fn(async () => {}),
  saveThreads: jest.fn(async () => {}),
  saveMessage: jest.fn(async () => {}),
  saveMessages: jest.fn(async () => {}),
  deleteThreadLocal: jest.fn(async () => {}),
  deleteMessageLocal: jest.fn(async () => {}),
  replaceThreadMessages: jest.fn(async () => {}),
  hydrateChatFromLocalDb: jest.fn(async () => {}),
  clearChatLocal: jest.fn(async () => {}),
  queueMessageForSync: jest.fn(async () => {}),
  isLocalDbAvailable: jest.fn(() => false),
}));

jest.mock('../utils/localLlm', () => ({
  initializeLocalModel: jest.fn(async () => {}),
  streamLocalLlmResponse: jest.fn(),
  isLocalLlmDown: jest.fn(() => false),
  isStoredModelUsable: jest.fn(async () => true),
  localModelStorageKey: jest.fn(),
  LOCAL_MODELS: {},
}));

jest.mock('../utils/toolProxy', () => ({
  parseAndExecuteTools: jest.fn(),
}));

import { handleSendPressAction } from '../app/index';

describe('Multimodal Chat Attachments (#559, #562)', () => {
  beforeEach(() => {
    useConfigStore.setState({
      maxImagesPerMessage: 2,
      cloudPrivacyConsent: false,
    });
  });

  describe('computeScaledDimensions', () => {
    it('preserves dimensions when width and height are within 1920px', () => {
      const result = computeScaledDimensions(1200, 800, MAX_IMAGE_DIMENSION);
      expect(result).toEqual({ width: 1200, height: 800 });
    });

    it('downscales wide images so max dimension is 1920px preserving aspect ratio', () => {
      // 3840 x 2160 (16:9 4K) -> 1920 x 1080
      const result = computeScaledDimensions(3840, 2160, MAX_IMAGE_DIMENSION);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });

    it('downscales tall images so max dimension is 1920px preserving aspect ratio', () => {
      // 1080 x 3840 -> 540 x 1920
      const result = computeScaledDimensions(1080, 3840, MAX_IMAGE_DIMENSION);
      expect(result.width).toBe(540);
      expect(result.height).toBe(1920);
    });

    it('downscales square images to 1920x1920', () => {
      const result = computeScaledDimensions(3000, 3000, MAX_IMAGE_DIMENSION);
      expect(result).toEqual({ width: 1920, height: 1920 });
    });

    it('handles zero or negative dimensions safely', () => {
      const result = computeScaledDimensions(0, 0, MAX_IMAGE_DIMENSION);
      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isTotalUploadOverWarnThreshold', () => {
    it('returns false when total size is <= 5 MB', () => {
      expect(isTotalUploadOverWarnThreshold([1024 * 1024, 2 * 1024 * 1024])).toBe(false);
      expect(isTotalUploadOverWarnThreshold([TOTAL_UPLOAD_WARN_BYTES])).toBe(false);
    });

    it('returns true when total size exceeds 5 MB', () => {
      expect(isTotalUploadOverWarnThreshold([3 * 1024 * 1024, 3 * 1024 * 1024])).toBe(true);
      expect(isTotalUploadOverWarnThreshold([TOTAL_UPLOAD_WARN_BYTES + 1])).toBe(true);
    });
  });

  describe('useConfigStore multimodal settings', () => {
    it('defaults to 2 images per message and false for privacy consent', () => {
      const state = useConfigStore.getState();
      expect(state.maxImagesPerMessage).toBe(2);
      expect(state.cloudPrivacyConsent).toBe(false);
    });

    it('clamps maxImagesPerMessage between 1 and 10', () => {
      const { setMaxImagesPerMessage } = useConfigStore.getState();

      setMaxImagesPerMessage(5);
      expect(useConfigStore.getState().maxImagesPerMessage).toBe(5);

      setMaxImagesPerMessage(0);
      expect(useConfigStore.getState().maxImagesPerMessage).toBe(1);

      setMaxImagesPerMessage(15);
      expect(useConfigStore.getState().maxImagesPerMessage).toBe(10);
    });

    it('updates cloudPrivacyConsent toggle', () => {
      const { setCloudPrivacyConsent } = useConfigStore.getState();
      setCloudPrivacyConsent(true);
      expect(useConfigStore.getState().cloudPrivacyConsent).toBe(true);
      setCloudPrivacyConsent(false);
      expect(useConfigStore.getState().cloudPrivacyConsent).toBe(false);
    });
  });

  describe('compressImage', () => {
    it('returns a compressed image result with scaled dimensions and size', async () => {
      const result = await compressImage('file:///test/image.jpg', 3840, 2160);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.originalUri).toBe('file:///test/image.jpg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.size).toBeGreaterThan(0);
    });
  });

  describe('uploadChatAttachment', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('posts multipart form data to /chat/attachments with Bearer auth', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'att-123',
          storage_path: 'thread_abc/msg_123/att-123.jpg',
          mime_type: 'image/jpeg',
          file_size: 45000,
          width: 1920,
          height: 1080,
          alt_text: 'sample diagram',
          url: 'https://supabase.co/signed/att-123.jpg',
        }),
      });
      global.fetch = mockFetch;

      const attachment = await uploadChatAttachment({
        apiUrl: 'https://api.vela.local',
        apiKey: 'test-api-key',
        threadId: 'thread_abc',
        messageId: 'msg_123',
        fileUri: 'file:///path/to/img.jpg',
        mimeType: 'image/jpeg',
        filename: 'img.jpg',
        altText: 'sample diagram',
        width: 1920,
        height: 1080,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.vela.local/chat/attachments');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-api-key');
      expect(attachment.storage_path).toBe('thread_abc/msg_123/att-123.jpg');
      expect(attachment.alt_text).toBe('sample diagram');
    });

    it('throws error on failed response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 413,
        text: async () => 'File too large',
      });

      await expect(
        uploadChatAttachment({
          apiUrl: 'https://api.vela.local',
          apiKey: 'key',
          threadId: 't1',
          messageId: 'm1',
          fileUri: 'file:///img.jpg',
          mimeType: 'image/jpeg',
        })
      ).rejects.toThrow('Upload failed (413): File too large');
    });
  });

  describe('handleSendPressAction', () => {
    it('triggers send when input is empty but hasAttachments is true', () => {
      const onSend = jest.fn();
      const onStop = jest.fn();
      const onSendWelcome = jest.fn();

      handleSendPressAction({
        isCurrentThreadStreaming: false,
        activeThreadId: 'thread_1',
        input: '',
        hasAttachments: true,
        onStop,
        onSend,
        onSendWelcome,
      });

      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onStop).not.toHaveBeenCalled();
    });

    it('triggers stop when streaming regardless of attachments or input', () => {
      const onSend = jest.fn();
      const onStop = jest.fn();
      const onSendWelcome = jest.fn();

      handleSendPressAction({
        isCurrentThreadStreaming: true,
        activeThreadId: 'thread_1',
        input: 'some text',
        hasAttachments: true,
        onStop,
        onSend,
        onSendWelcome,
      });

      expect(onStop).toHaveBeenCalledWith('thread_1');
      expect(onSend).not.toHaveBeenCalled();
    });
  });
});
