import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import {
  ImageGenerationConsentDialog,
  shouldPromptImageConsent,
  SD_CONSENT_DONT_ASK_AGAIN_KEY,
} from '../components/chat/ImageGenerationConsentDialog';
import { ImageGenerationCard } from '../components/chat/ImageGenerationCard';
import {
  runImageGenerationPipeline,
  abortActiveImageGeneration,
} from '../utils/imageGenerationManager';
import { useChatStore } from '../store/useChatStore';
import * as SDUtils from '../utils/stableDiffusion';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
  }),
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
  },
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

jest.mock('../hooks/useAurora', () => ({
  useAurora: () => ({
    colors: {
      text: '#ffffff',
      textMuted: '#94a3b8',
      skyBottom: '#0f172a',
      glassBorder: 'rgba(255,255,255,0.1)',
      bubbleAssistant: '#1e293b',
      bubbleAssistantBorder: '#334155',
    },
    sizes: {
      title: 18,
      sub: 14,
    },
    aurora: {
      acc1: '#818cf8',
      acc2: '#c084fc',
    },
  }),
}));

describe('ImageGenerationConsentDialog', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('renders consent dialog elements when visible', () => {
    let tree: any;
    act(() => {
      tree = renderer.create(
        <ImageGenerationConsentDialog
          visible={true}
          steps={20}
          onConfirm={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    });

    const root = tree.root;
    const title = root.find((node: any) =>
      node.type === 'Text' && typeof node.props.children === 'string' && node.props.children.includes('Generate image on this device?')
    );
    expect(title).toBeDefined();
  });

  it('renders warning when steps > 25 or battery is low', () => {
    let tree: any;
    act(() => {
      tree = renderer.create(
        <ImageGenerationConsentDialog
          visible={true}
          steps={30}
          batteryLevel={0.15}
          onConfirm={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    });

    const textNodes = tree.root.findAllByType('Text');
    const warning = textNodes.find((n: any) =>
      typeof n.props.children === 'string' && n.props.children.includes('High step count')
    );
    expect(warning).toBeDefined();
  });

  it('evaluates shouldPromptImageConsent with storage persistence and thresholds', async () => {
    // Default: needs consent
    expect(await shouldPromptImageConsent(20)).toBe(true);

    // After setting don't ask again
    await AsyncStorage.setItem(SD_CONSENT_DONT_ASK_AGAIN_KEY, 'true');
    expect(await shouldPromptImageConsent(20)).toBe(false);

    // Overridden if steps > 25
    expect(await shouldPromptImageConsent(30)).toBe(true);

    // Overridden if battery < 20%
    expect(await shouldPromptImageConsent(20, 0.15)).toBe(true);
  });
});

describe('ImageGenerationCard', () => {
  let activeTree: any = null;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (activeTree) {
      act(() => {
        activeTree.unmount();
      });
      activeTree = null;
    }
  });

  it('renders generating progress and cancel button', () => {
    const onCancelMock = jest.fn();
    act(() => {
      activeTree = renderer.create(
        <ImageGenerationCard
          prompt="a majestic mountain at sunrise"
          status="generating"
          currentStep={10}
          totalSteps={20}
          onCancel={onCancelMock}
        />
      );
    });

    const root = activeTree.root;
    const stepText = root.find((n: any) =>
      n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.includes('Step 10 of 20')
    );
    expect(stepText).toBeDefined();

    const cancelBtn = root.find((n: any) => n.props.accessibilityLabel === 'Cancel image generation');
    expect(cancelBtn).toBeDefined();
    act(() => {
      cancelBtn.props.onPress();
    });
    expect(onCancelMock).toHaveBeenCalled();
  });

  it('renders completed image preview with action buttons', async () => {
    act(() => {
      activeTree = renderer.create(
        <ImageGenerationCard
          prompt="a neon futuristic motorcycle"
          status="completed"
          currentStep={20}
          totalSteps={20}
          imageUri="file:///mock/img_123.png"
          seed={42}
          durationMs={12000}
        />
      );
    });

    const root = activeTree.root;
    const shareBtn = root.find((n: any) => n.props.accessibilityLabel === 'Share image');
    const saveBtn = root.find((n: any) => n.props.accessibilityLabel === 'Save image');
    const copyBtn = root.find((n: any) => n.props.accessibilityLabel === 'Copy prompt');

    expect(shareBtn).toBeDefined();
    expect(saveBtn).toBeDefined();
    expect(copyBtn).toBeDefined();

    await act(async () => {
      await shareBtn.props.onPress();
    });
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///mock/img_123.png', expect.anything());

    await act(async () => {
      await saveBtn.props.onPress();
    });
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///mock/img_123.png', expect.objectContaining({ dialogTitle: 'Save Image' }));

    await act(async () => {
      await copyBtn.props.onPress();
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('a neon futuristic motorcycle');
  });

  it('handles Sharing and Clipboard failures gracefully', async () => {
    (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('Clipboard permission denied'));
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('Sharing cancelled'));

    act(() => {
      activeTree = renderer.create(
        <ImageGenerationCard
          prompt="a mountain landscape"
          status="completed"
          currentStep={20}
          totalSteps={20}
          imageUri="file:///mock/img_error.png"
        />
      );
    });

    const root = activeTree.root;
    const copyBtn = root.find((n: any) => n.props.accessibilityLabel === 'Copy prompt');
    const shareBtn = root.find((n: any) => n.props.accessibilityLabel === 'Share image');

    await act(async () => {
      await copyBtn.props.onPress();
    });

    let errorText = root.find((n: any) =>
      n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.includes('Failed to copy prompt')
    );
    expect(errorText).toBeDefined();

    await act(async () => {
      await shareBtn.props.onPress();
    });

    errorText = root.find((n: any) =>
      n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.includes('Failed to share image')
    );
    expect(errorText).toBeDefined();
  });

  it('renders cancelled or error states with message', () => {
    act(() => {
      activeTree = renderer.create(
        <ImageGenerationCard
          prompt="landscape"
          status="error"
          errorMessage="Native context crashed"
        />
      );
    });

    const root = activeTree.root;
    const errorText = root.find((n: any) =>
      n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.includes('Native context crashed')
    );
    expect(errorText).toBeDefined();
  });
});

describe('imageGenerationManager', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    act(() => {
      useChatStore.getState().clearStore();
      useChatStore.getState().createThread('Test Thread', 'thread-test');
    });
  });

  it('blocks execution when hardware does not meet 6GB RAM floor', async () => {
    jest.spyOn(SDUtils, 'checkSDHardwareReadiness').mockResolvedValueOnce({
      canRun: false,
      reason: 'Device RAM (4GB) is below the 6GB floor',
      ramFloorPassed: false,
      ramBytes: 4 * 1024 * 1024 * 1024,
      batteryWarning: false,
      batteryBlocked: false,
    });

    const result = await runImageGenerationPipeline({
      prompt: 'a scenic lake',
      threadId: 'thread-test',
    });

    expect(result.status).toBe('hardware_blocked');
    expect(result.reason).toContain('below the 6GB floor');
  });

  it('signals needs_consent when consent was not previously given', async () => {
    jest.spyOn(SDUtils, 'checkSDHardwareReadiness').mockResolvedValueOnce({
      canRun: true,
      ramFloorPassed: true,
      ramBytes: 8 * 1024 * 1024 * 1024,
      batteryWarning: false,
      batteryBlocked: false,
    });

    const result = await runImageGenerationPipeline({
      prompt: 'a scenic lake',
      threadId: 'thread-test',
    });

    expect(result.status).toBe('needs_consent');
  });

  it('executes generation and inserts assistant message into chat thread', async () => {
    jest.spyOn(SDUtils, 'checkSDHardwareReadiness').mockResolvedValueOnce({
      canRun: true,
      ramFloorPassed: true,
      ramBytes: 8 * 1024 * 1024 * 1024,
      batteryWarning: false,
      batteryBlocked: false,
    });

    jest.spyOn(SDUtils, 'executeGenerateImageTool').mockResolvedValueOnce({
      success: true,
      imageUri: 'file:///mock/generated.png',
      prompt: 'a serene bamboo forest',
      seed: 999,
      steps: 20,
      width: 512,
      height: 512,
      durationMs: 8500,
    });

    const result = await runImageGenerationPipeline({
      prompt: 'a serene bamboo forest',
      threadId: 'thread-test',
      skipConsent: true,
    });

    expect(result.status).toBe('completed');
    expect(result.result?.imageUri).toBe('file:///mock/generated.png');

    const messages = useChatStore.getState().messages['thread-test'];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments![0].url).toBe('file:///mock/generated.png');
  });

  it('clamps excessive step counts to SD_MAX_STEPS (50) in pipeline', async () => {
    jest.spyOn(SDUtils, 'checkSDHardwareReadiness').mockResolvedValueOnce({
      canRun: true,
      ramFloorPassed: true,
      ramBytes: 8 * 1024 * 1024 * 1024,
      batteryWarning: false,
      batteryBlocked: false,
    });

    const execSpy = jest.spyOn(SDUtils, 'executeGenerateImageTool').mockResolvedValueOnce({
      success: true,
      imageUri: 'file:///mock/generated_50.png',
      prompt: 'excessive steps test',
      seed: 123,
      steps: 50,
      width: 512,
      height: 512,
      durationMs: 9000,
    });

    await runImageGenerationPipeline({
      prompt: 'excessive steps test',
      steps: 200,
      skipConsent: true,
    });

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({ steps: 50 }),
      undefined
    );
  });

  it('aborts active generation', () => {
    const cancelSpy = jest.spyOn(SDUtils, 'cancelSDGeneration');
    abortActiveImageGeneration();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
