import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

import { DeviceCapabilityCard } from '../components/ui/DeviceCapabilityCard';
import { RecommendationBanner } from '../components/ui/RecommendationBanner';

describe('DeviceCapabilityCard (#612, #615)', () => {
  const GB = 1024 * 1024 * 1024;
  const getText = (root: renderer.ReactTestInstance) =>
    root
      .findAllByType('Text' as any)
      .map((t) => t.props.children)
      .flat()
      .join(' ')
      .replace(/\s+/g, ' ');

  it('renders "RAM Unknown" badge when ramBytes is 0 or unreadable', () => {
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <DeviceCapabilityCard ramBytes={0} gpuVendor="adreno" />
      );
    });
    const root = component!.root;
    const badge = root.findByProps({ accessibilityLabel: 'Device Tier: RAM Unknown' });
    expect(badge).toBeDefined();

    const texts = getText(root);
    expect(texts).toContain('RAM: Unknown');
    expect(texts).toContain('Manual selection is available with OOM safeguards');
  });

  it('renders Entry tier badge for <= 4 GB devices', () => {
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <DeviceCapabilityCard ramBytes={4 * GB} gpuVendor="mali" freeStorageBytes={10 * GB} architecture="arm64-v8a" />
      );
    });
    const root = component!.root;
    const badge = root.findByProps({ accessibilityLabel: 'Device Tier: Entry (≤4 GB)' });
    expect(badge).toBeDefined();

    const texts = getText(root);
    expect(texts).toContain('4.0 GB physical memory');
    expect(texts).toContain('MALI (VULKAN compute)');
    expect(texts).toContain('10.0 GB free');
    expect(texts).toContain('arm64-v8a');
  });

  it('renders Mid-Tier badge for 6 GB devices', () => {
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <DeviceCapabilityCard ramBytes={6 * GB} gpuVendor="tensor" />
      );
    });
    const root = component!.root;
    const badge = root.findByProps({ accessibilityLabel: 'Device Tier: Mid-Tier (4–6 GB)' });
    expect(badge).toBeDefined();

    const texts = getText(root);
    expect(texts).toContain('6.0 GB physical memory');
    expect(texts).toContain('TENSOR (CPU compute)');
  });

  it('renders Performance badge for 8 GB devices', () => {
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <DeviceCapabilityCard ramBytes={8 * GB} gpuVendor="adreno" freeStorageBytes={35 * GB} architecture="arm64-v8a" />
      );
    });
    const root = component!.root;
    const badge = root.findByProps({ accessibilityLabel: 'Device Tier: Performance (6–8 GB)' });
    expect(badge).toBeDefined();
  });

  it('renders Flagship badge for > 8 GB devices', () => {
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <DeviceCapabilityCard ramBytes={12 * GB} gpuVendor="adreno" />
      );
    });
    const root = component!.root;
    const badge = root.findByProps({ accessibilityLabel: 'Device Tier: Flagship (>8 GB)' });
    expect(badge).toBeDefined();
  });

  it('renders Detecting badge when ramBytes is null and Detecting GPU when gpuVendor is null', () => {
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <DeviceCapabilityCard ramBytes={null} gpuVendor={null} />
      );
    });
    const root = component!.root;
    expect(root.findByProps({ accessibilityLabel: 'Device Tier: Detecting…' })).toBeDefined();
    expect(getText(root)).toContain('Detecting hardware memory profile...');
  });

  it('treats NaN and Infinity ramBytes as RAM Unknown in DeviceCapabilityCard', () => {
    for (const badRam of [NaN, Infinity]) {
      let component: renderer.ReactTestRenderer | undefined;
      act(() => {
        component = renderer.create(
          <DeviceCapabilityCard
            ramBytes={badRam}
            gpuVendor="adreno"
            freeStorageBytes={12 * GB}
            architecture="arm64-v8a"
          />
        );
      });
      const root = component!.root;
      expect(root.findByProps({ accessibilityLabel: 'Device Tier: RAM Unknown' })).toBeDefined();
      const texts = getText(root);
      expect(texts).toContain('RAM: Unknown');
      expect(texts).toContain('ADRENO (OPENCL compute)');
      expect(texts).toContain('12.0 GB free');
      expect(texts).toContain('arm64-v8a');
      expect(texts).not.toContain('NaN GB');
      expect(texts).not.toContain('Infinity GB');
    }
  });

  it('reflects gpuBackendPreference override in DeviceCapabilityCard', () => {
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <DeviceCapabilityCard ramBytes={8 * GB} gpuVendor="adreno" gpuBackendPreference="cpu" />
      );
    });
    expect(getText(component!.root)).toContain('ADRENO (CPU compute)');
  });
});

describe('RecommendationBanner (#612, #615)', () => {
  const GB = 1024 * 1024 * 1024;
  const getText = (root: renderer.ReactTestInstance) =>
    root
      .findAllByType('Text' as any)
      .map((t) => t.props.children)
      .flat()
      .join(' ')
      .replace(/\s+/g, ' ');

  it('returns null when RAM is unreadable (<= 0, NaN, or Infinity)', () => {
    const onAccept = jest.fn();
    for (const badRam of [0, -1, NaN, Infinity]) {
      let component: renderer.ReactTestRenderer | undefined;
      act(() => {
        component = renderer.create(
          <RecommendationBanner ramBytes={badRam} onAccept={onAccept} />
        );
      });
      expect(component!.toJSON()).toBeNull();
    }
  });

  it('renders unapplied recommendation banner with Accept and Customize buttons', () => {
    const onAccept = jest.fn();
    const onCustomize = jest.fn();
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <RecommendationBanner
          ramBytes={6 * GB}
          isApplied={false}
          onAccept={onAccept}
          onCustomize={onCustomize}
        />
      );
    });
    const root = component!.root;
    const texts = getText(root);
    expect(texts).toContain('Recommended Configuration');
    expect(texts).toContain('Optimized for your Mid-Tier device');
    expect(texts).toContain('Qwen2.5 0.5B');
    expect(texts).toContain('2048 tokens');
    expect(texts).toContain('512 tokens');

    const acceptBtn = root.findByProps({ label: 'Accept Recommended' });
    expect(acceptBtn).toBeDefined();
    acceptBtn.props.onPress();
    expect(onAccept).toHaveBeenCalledTimes(1);

    const customizeBtn = root.findByProps({ accessibilityLabel: 'Customize configuration' });
    expect(customizeBtn).toBeDefined();
    customizeBtn.props.onPress();
    expect(onCustomize).toHaveBeenCalledTimes(1);
  });

  it('renders applied status when isApplied is true', () => {
    const onAccept = jest.fn();
    const onCustomize = jest.fn();
    let component: renderer.ReactTestRenderer | undefined;
    act(() => {
      component = renderer.create(
        <RecommendationBanner
          ramBytes={8 * GB}
          isApplied={true}
          onAccept={onAccept}
          onCustomize={onCustomize}
        />
      );
    });
    const root = component!.root;
    const badge = root.findByProps({ accessibilityLabel: 'Recommended configuration applied' });
    expect(badge).toBeDefined();

    const texts = getText(root);
    expect(texts).toContain('Optimized for Performance Tier');
    expect(texts).toContain('Qwen2.5 1.5B (GGUF)');
    expect(texts).toContain('4096 tokens');
    expect(texts).toContain('1024 tokens');
  });
});
