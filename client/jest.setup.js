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
