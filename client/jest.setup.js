/**
 * Global Jest setup: native-module mocks required by any suite whose import
 * chain reaches the zustand stores (AsyncStorage/SecureStore have no native
 * bridge under Jest). Suites needing custom behavior can re-mock per file.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-token]' })),
  setNotificationChannelAsync: jest.fn(async () => {}),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  AndroidImportance: { MAX: 5, DEFAULT: 3, HIGH: 4 },
  setNotificationHandler: jest.fn(),
}));

if (typeof window !== 'undefined' && typeof window.dispatchEvent !== 'function') {
  window.dispatchEvent = jest.fn();
}

jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { FlatList } = require('react-native');
  const FlashListMock = React.forwardRef((props, ref) => {
    return React.createElement(FlatList, {
      ...props,
      ref,
    });
  });
  return {
    FlashList: FlashListMock,
  };
});
