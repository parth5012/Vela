import React from 'react';
import renderer, { act } from 'react-test-renderer';
import OmniLiveSessionScreen from '../app/omni';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

class MockWs {
  url: string;
  onopen: any;
  onmessage: any;
  onerror: any;
  onclose: any;
  readyState = 1;
  sent: string[] = [];
  constructor(url: string) {
    this.url = url;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
}

describe('OmniLiveSessionScreen', () => {
  let origWs: any;

  beforeEach(() => {
    mockBack.mockClear();
    origWs = (global as any).WebSocket;
    (global as any).WebSocket = MockWs;
  });

  afterEach(() => {
    (global as any).WebSocket = origWs;
  });

  it('renders correctly and displays live header status and controls', async () => {
    let component: any;
    await act(async () => {
      component = renderer.create(<OmniLiveSessionScreen />);
      await Promise.resolve();
    });

    const root = component.root;
    expect(root.findByProps({ testID: 'omni-end-button' })).toBeDefined();
    expect(root.findByProps({ testID: 'omni-text-input' })).toBeDefined();
    expect(root.findByProps({ testID: 'omni-send-button' })).toBeDefined();
    expect(root.findByProps({ testID: 'omni-mute-button' })).toBeDefined();
    expect(root.findByProps({ testID: 'omni-interrupt-button' })).toBeDefined();

    // Trigger end button
    act(() => {
      root.findByProps({ testID: 'omni-end-button' }).props.onPress();
    });
    expect(mockBack).toHaveBeenCalled();

    act(() => {
      component.unmount();
    });
  });
});
