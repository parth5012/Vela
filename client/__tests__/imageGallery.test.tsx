import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { useImageGalleryStore } from '../store/useImageGalleryStore';
import { useChatStore } from '../store/useChatStore';
import ImageGalleryScreen from '../app/gallery';
import { ImageViewerModal } from '../components/gallery/ImageViewerModal';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    navigate: mockNavigate,
    push: mockNavigate,
    back: jest.fn(),
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-doc-dir/',
  getInfoAsync: jest.fn().mockImplementation((path: string) =>
    Promise.resolve({ exists: true, uri: path })
  ),
  makeDirectoryAsync: jest.fn().mockResolvedValue(true),
  writeAsStringAsync: jest.fn().mockResolvedValue(true),
  copyAsync: jest.fn().mockResolvedValue(true),
  deleteAsync: jest.fn().mockResolvedValue(true),
  EncodingType: { UTF8: 'utf8' },
}));

jest.mock('expo-file-system/legacy', () => require('expo-file-system'));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

describe('useImageGalleryStore', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    useImageGalleryStore.setState({
      images: [],
      unlimitedStorage: false,
      maxCapacity: 100,
      searchQuery: '',
      hasHydrated: true,
    });
  });

  it('saves generated image with metadata and prepends to list', async () => {
    const store = useImageGalleryStore.getState();
    const item = await store.saveGeneratedImage({
      prompt: 'A neon cyberpunk city in the rain',
      model: 'Stable Diffusion 1.5 (INT8)',
      width: 512,
      height: 512,
      steps: 20,
      seed: 42,
      sourceUri: 'file:///mock-doc-dir/temp-img.png',
    });

    expect(item).toBeDefined();
    expect(item.prompt).toBe('A neon cyberpunk city in the rain');
    expect(item.seed).toBe(42);
    expect(useImageGalleryStore.getState().images.length).toBe(1);
    expect(useImageGalleryStore.getState().images[0].id).toBe(item.id);
  });

  it('filters images by search query', async () => {
    const store = useImageGalleryStore.getState();
    await store.saveGeneratedImage({
      prompt: 'Cyberpunk neon cat',
      sourceUri: 'file:///mock-doc-dir/img1.png',
    });
    await store.saveGeneratedImage({
      prompt: 'Pastoral mountain meadow',
      sourceUri: 'file:///mock-doc-dir/img2.png',
    });

    expect(store.filteredImages().length).toBe(2);

    act(() => {
      useImageGalleryStore.getState().setSearchQuery('cat');
    });
    expect(useImageGalleryStore.getState().filteredImages().length).toBe(1);
    expect(useImageGalleryStore.getState().filteredImages()[0].prompt).toContain('cat');

    act(() => {
      useImageGalleryStore.getState().setSearchQuery('nomatch');
    });
    expect(useImageGalleryStore.getState().filteredImages().length).toBe(0);
  });

  it('toggles pin status on image', async () => {
    const store = useImageGalleryStore.getState();
    const item = await store.saveGeneratedImage({
      prompt: 'Pinned sunset',
      sourceUri: 'file:///mock-doc-dir/img-pin.png',
    });

    expect(useImageGalleryStore.getState().images[0].isPinned).toBe(false);

    act(() => {
      useImageGalleryStore.getState().togglePinImage(item.id);
    });
    expect(useImageGalleryStore.getState().images[0].isPinned).toBe(true);

    act(() => {
      useImageGalleryStore.getState().togglePinImage(item.id);
    });
    expect(useImageGalleryStore.getState().images[0].isPinned).toBe(false);
  });

  it('respects LRU eviction policy at max capacity without evicting pinned items', async () => {
    useImageGalleryStore.setState({ maxCapacity: 3, unlimitedStorage: false });
    const store = useImageGalleryStore.getState();

    // Add 3 images
    const item1 = await store.saveGeneratedImage({
      prompt: 'Oldest item 1',
      sourceUri: 'file:///mock-doc-dir/img1.png',
    });
    const item2 = await store.saveGeneratedImage({
      prompt: 'Middle item 2',
      sourceUri: 'file:///mock-doc-dir/img2.png',
    });
    const item3 = await store.saveGeneratedImage({
      prompt: 'Item 3',
      sourceUri: 'file:///mock-doc-dir/img3.png',
    });

    expect(useImageGalleryStore.getState().images.length).toBe(3);

    // Pin item1 so it cannot be auto-evicted
    act(() => {
      useImageGalleryStore.getState().togglePinImage(item1.id);
    });

    // Add 4th item: should evict oldest unpinned (item2)
    const item4 = await store.saveGeneratedImage({
      prompt: 'New item 4',
      sourceUri: 'file:///mock-doc-dir/img4.png',
    });

    const currentIds = useImageGalleryStore.getState().images.map((x) => x.id);
    expect(currentIds).toContain(item1.id); // pinned, preserved
    expect(currentIds).not.toContain(item2.id); // evicted
    expect(currentIds).toContain(item3.id);
    expect(currentIds).toContain(item4.id);
  });

  it('never evicts newly saved image even when pinned items saturate capacity', async () => {
    useImageGalleryStore.setState({ maxCapacity: 2, unlimitedStorage: false });
    const store = useImageGalleryStore.getState();

    // Add 2 items and pin BOTH
    const item1 = await store.saveGeneratedImage({
      prompt: 'Pinned 1',
      sourceUri: 'file:///mock-doc-dir/p1.png',
    });
    const item2 = await store.saveGeneratedImage({
      prompt: 'Pinned 2',
      sourceUri: 'file:///mock-doc-dir/p2.png',
    });
    act(() => {
      useImageGalleryStore.getState().togglePinImage(item1.id);
      useImageGalleryStore.getState().togglePinImage(item2.id);
    });

    // Add 3rd item when capacity is saturated with pinned items
    const item3 = await store.saveGeneratedImage({
      prompt: 'New item 3',
      sourceUri: 'file:///mock-doc-dir/p3.png',
    });

    // Newly saved item must NOT be evicted
    const currentImages = useImageGalleryStore.getState().images;
    const currentIds = currentImages.map((x) => x.id);
    expect(currentIds).toContain(item3.id);
    expect(currentIds).toContain(item1.id);
    expect(currentIds).toContain(item2.id);
  });

  it('handles SVG data URI and plain SVG correctly without corrupting', async () => {
    const store = useImageGalleryStore.getState();
    const svgDataUri = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>';

    const item = await store.saveGeneratedImage({
      prompt: 'Vector icon',
      sourceUri: svgDataUri,
    });

    expect(item.uri).toContain('generated-images/gen_');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      expect.stringContaining('generated-images/gen_'),
      expect.stringContaining('<svg'),
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('reuses existing file uri if sourceUri is already in GALLERY_DIR', async () => {
    const store = useImageGalleryStore.getState();
    const existingUri = 'file:///mock-doc-dir/generated-images/img_existing.png';

    const item = await store.saveGeneratedImage({
      prompt: 'Existing image',
      sourceUri: existingUri,
    });

    expect(item.uri).toBe(existingUri);
  });

  it('updates maxCapacity and triggers eviction when capacity shrinks', async () => {
    useImageGalleryStore.setState({ maxCapacity: 5, unlimitedStorage: false });
    const store = useImageGalleryStore.getState();

    await store.saveGeneratedImage({ prompt: '1', sourceUri: 'file:///img1.png' });
    await store.saveGeneratedImage({ prompt: '2', sourceUri: 'file:///img2.png' });
    await store.saveGeneratedImage({ prompt: '3', sourceUri: 'file:///img3.png' });
    expect(useImageGalleryStore.getState().images.length).toBe(3);

    act(() => {
      useImageGalleryStore.getState().setMaxCapacity(2);
    });

    // Evicted down to 2
    expect(useImageGalleryStore.getState().images.length).toBe(2);
  });

  it('unlimited storage preserves all images beyond capacity', async () => {
    useImageGalleryStore.setState({ maxCapacity: 2, unlimitedStorage: true });
    const store = useImageGalleryStore.getState();

    await store.saveGeneratedImage({ prompt: '1', sourceUri: 'file:///img1.png' });
    await store.saveGeneratedImage({ prompt: '2', sourceUri: 'file:///img2.png' });
    await store.saveGeneratedImage({ prompt: '3', sourceUri: 'file:///img3.png' });

    expect(useImageGalleryStore.getState().images.length).toBe(3);
  });

  it('deletes image and unlinks file', async () => {
    const store = useImageGalleryStore.getState();
    const item = await store.saveGeneratedImage({
      prompt: 'To delete',
      sourceUri: 'file:///mock-doc-dir/delete.png',
    });

    expect(useImageGalleryStore.getState().images.length).toBe(1);

    await act(async () => {
      await useImageGalleryStore.getState().deleteImage(item.id);
    });

    expect(useImageGalleryStore.getState().images.length).toBe(0);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(item.uri, { idempotent: true });
  });

  it('clears all images', async () => {
    const store = useImageGalleryStore.getState();
    await store.saveGeneratedImage({ prompt: 'A', sourceUri: 'file:///a.png' });
    await store.saveGeneratedImage({ prompt: 'B', sourceUri: 'file:///b.png' });

    expect(useImageGalleryStore.getState().images.length).toBe(2);

    await act(async () => {
      await useImageGalleryStore.getState().clearAllImages();
    });

    expect(useImageGalleryStore.getState().images.length).toBe(0);
  });
});

describe('ImageViewerModal', () => {
  let tree: any = null;
  const sampleImage = {
    id: 'test_123',
    prompt: 'Cosmic nebula with glowing stars',
    negativePrompt: 'blurry, low quality',
    model: 'Stable Diffusion 1.5 (INT8)',
    timestamp: 1700000000000,
    width: 512,
    height: 512,
    steps: 25,
    seed: 9999,
    uri: 'file:///mock-doc-dir/cosmic.png',
    isPinned: false,
  };

  afterEach(() => {
    if (tree) {
      act(() => {
        tree.unmount();
      });
      tree = null;
    }
    jest.clearAllMocks();
  });

  it('renders modal details correctly when visible', () => {
    act(() => {
      tree = renderer.create(
        <ImageViewerModal image={sampleImage} visible={true} onClose={jest.fn()} />
      );
    });

    const root = tree.root;
    expect(root.findByProps({ testID: 'image-viewer-modal' })).toBeDefined();

    const promptText = root.find(
      (n: any) => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.includes('Cosmic nebula')
    );
    expect(promptText).toBeDefined();

    const negativeText = root.find(
      (n: any) => n.type === 'Text' && n.props.children === 'blurry, low quality'
    );
    expect(negativeText).toBeDefined();

    const dimText = root.find(
      (n: any) => n.type === 'Text' && n.props.children === '512×512'
    );
    expect(dimText).toBeDefined();
  });

  it('copies prompt text on Copy button press', async () => {
    act(() => {
      tree = renderer.create(
        <ImageViewerModal image={sampleImage} visible={true} onClose={jest.fn()} />
      );
    });

    const root = tree.root;
    const copyBtn = root.find((n: any) => n.props.accessibilityLabel === 'Copy prompt text');
    await act(async () => {
      copyBtn.props.onPress();
    });

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Cosmic nebula with glowing stars');
  });

  it('triggers sharing on Share press', async () => {
    act(() => {
      tree = renderer.create(
        <ImageViewerModal image={sampleImage} visible={true} onClose={jest.fn()} />
      );
    });

    const root = tree.root;
    const shareBtn = root.find((n: any) => n.props.accessibilityLabel === 'Share image');
    await act(async () => {
      shareBtn.props.onPress();
    });

    expect(Sharing.shareAsync).toHaveBeenCalledWith(sampleImage.uri, expect.anything());
  });

  it('regenerates prompt in chat and navigates', () => {
    const onClose = jest.fn();
    act(() => {
      tree = renderer.create(
        <ImageViewerModal image={sampleImage} visible={true} onClose={onClose} />
      );
    });

    const root = tree.root;
    const regenBtn = root.find(
      (n: any) => n.props.accessibilityLabel === 'Regenerate prompt in chat'
    );
    act(() => {
      regenBtn.props.onPress();
    });

    expect(useChatStore.getState().pendingPrompt).toBe(sampleImage.prompt);
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('prompts delete alert on delete press', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    act(() => {
      tree = renderer.create(
        <ImageViewerModal image={sampleImage} visible={true} onClose={jest.fn()} />
      );
    });

    const root = tree.root;
    const deleteBtn = root.find((n: any) => n.props.accessibilityLabel === 'Delete image');
    act(() => {
      deleteBtn.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Image',
      expect.stringContaining('Are you sure you want to delete'),
      expect.any(Array)
    );
  });
});

describe('ImageGalleryScreen', () => {
  let tree: any = null;

  beforeEach(() => {
    jest.clearAllMocks();
    useImageGalleryStore.setState({
      images: [],
      unlimitedStorage: false,
      maxCapacity: 100,
      searchQuery: '',
      hasHydrated: true,
    });
  });

  afterEach(() => {
    if (tree) {
      act(() => {
        tree.unmount();
      });
      tree = null;
    }
  });

  it('renders empty state when no images are present', () => {
    act(() => {
      tree = renderer.create(<ImageGalleryScreen />);
    });

    const root = tree.root;
    const emptyTitle = root.find(
      (n: any) => n.type === 'Text' && n.props.children === 'No generated images yet'
    );
    expect(emptyTitle).toBeDefined();

    const openChatBtn = root.find(
      (n: any) => n.props.accessibilityLabel === 'Go to chat to generate images'
    );
    expect(openChatBtn).toBeDefined();
    act(() => {
      openChatBtn.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('renders grid of images and opens viewer modal on tap', async () => {
    const item = await useImageGalleryStore.getState().saveGeneratedImage({
      prompt: 'A golden retriever in autumn leaves',
      sourceUri: 'file:///mock-doc-dir/retriever.png',
    });

    act(() => {
      tree = renderer.create(<ImageGalleryScreen />);
    });

    const root = tree.root;
    const countText = root.find(
      (n: any) => n.type === 'Text' && typeof n.props.children === 'object' && n.props.children?.includes?.('image')
    );
    expect(countText).toBeDefined();

    const flatList = root.findByProps({ testID: 'gallery-flat-list' });
    expect(flatList.props.data.length).toBe(1);

    let cellTree: any = null;
    act(() => {
      cellTree = renderer.create(flatList.props.renderItem({ item }));
    });
    const cell = cellTree.root.find(
      (n: any) =>
        n.props.accessibilityLabel === 'View image for A golden retriever in autumn leaves'
    );
    expect(cell).toBeDefined();
  });

  it('toggles search bar and filters results', async () => {
    await useImageGalleryStore.getState().saveGeneratedImage({
      prompt: 'Blue ocean waves',
      sourceUri: 'file:///mock-doc-dir/ocean.png',
    });
    await useImageGalleryStore.getState().saveGeneratedImage({
      prompt: 'Red desert dunes',
      sourceUri: 'file:///mock-doc-dir/desert.png',
    });

    act(() => {
      tree = renderer.create(<ImageGalleryScreen />);
    });

    const root = tree.root;
    const searchToggle = root.find((n: any) => n.props.accessibilityLabel === 'Toggle search');
    act(() => {
      searchToggle.props.onPress();
    });

    const searchInput = root.find(
      (n: any) => n.props.placeholder === 'Search prompt, model, or tags...'
    );
    expect(searchInput).toBeDefined();

    act(() => {
      searchInput.props.onChangeText('ocean');
    });

    const flatList = root.findByProps({ testID: 'gallery-flat-list' });
    expect(flatList.props.data.length).toBe(1);
    expect(flatList.props.data[0].prompt).toBe('Blue ocean waves');
  });

  it('opens storage settings modal and switches between 100 cap and unlimited', () => {
    act(() => {
      tree = renderer.create(<ImageGalleryScreen />);
    });

    const root = tree.root;
    const settingsBtn = root.find((n: any) => n.props.accessibilityLabel === 'Gallery settings');
    act(() => {
      settingsBtn.props.onPress();
    });

    const settingsTitle = root.find(
      (n: any) => n.type === 'Text' && n.props.children === 'Storage & Retention'
    );
    expect(settingsTitle).toBeDefined();

    const unlimitedOption = root.find(
      (n: any) => n.props.accessibilityLabel === 'Select unlimited local storage'
    );
    act(() => {
      unlimitedOption.props.onPress();
    });

    expect(useImageGalleryStore.getState().unlimitedStorage).toBe(true);

    const capOption = root.find(
      (n: any) => n.props.accessibilityLabel === 'Select 100 image capacity with LRU auto eviction'
    );
    act(() => {
      capOption.props.onPress();
    });

    expect(useImageGalleryStore.getState().unlimitedStorage).toBe(false);
  });
});
