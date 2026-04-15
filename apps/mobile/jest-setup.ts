import '@testing-library/jest-native/extend-expect';

// Silence the RN act() warning during tests
jest.spyOn(console, 'error').mockImplementation((msg: string, ...rest) => {
  if (typeof msg === 'string' && msg.includes('act(...)')) return;
  console.warn(msg, ...rest);
});

// Mock expo-router navigation so tests don't need a full navigation tree
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
  },
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  Link: 'Link',
  Redirect: 'Redirect',
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(() => Promise.resolve()),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-local-authentication
jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true })),
  hasHardwareAsync: jest.fn(() => Promise.resolve(true)),
  isEnrolledAsync: jest.fn(() => Promise.resolve(true)),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
}));

// Mock expo-device
jest.mock('expo-device', () => ({
  isRootedExperimentalAsync: jest.fn(() => Promise.resolve(false)),
  isDevice: true,
  modelName: 'iPhone 15 Pro',
}));

// Mock expo-sqlite
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(() =>
    Promise.resolve({
      runAsync: jest.fn(() => Promise.resolve({ rowsAffected: 1, lastInsertRowId: 1 })),
      getAllAsync: jest.fn(() => Promise.resolve([])),
      getFirstAsync: jest.fn(() => Promise.resolve(null)),
      execAsync: jest.fn(() => Promise.resolve()),
      closeAsync: jest.fn(() => Promise.resolve()),
    }),
  ),
}));

// Mock expo-notifications
jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  scheduleNotificationAsync: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true }),
  ),
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

// Mock @react-native-voice/voice
jest.mock('@react-native-voice/voice', () => ({
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(() => Promise.resolve()),
  onSpeechResults: null,
  onSpeechError: null,
  onSpeechStart: null,
  onSpeechEnd: null,
}));
