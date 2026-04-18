/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',

  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],

  // Allow Jest to transform Expo and React Native packages (they ship as ESM)
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '(jest-)?react-native' +
      '|@react-native(-community)?' +
      '|expo(nent)?' +
      '|@expo(nent)?/.*' +
      '|@expo-google-fonts/.*' +
      '|react-navigation' +
      '|@react-navigation/.*' +
      '|@unimodules/.*' +
      '|unimodules' +
      '|@shopify/flash-list' +
      '|react-native-reanimated' +
      '|react-native-gesture-handler' +
      '|react-native-safe-area-context' +
      '|react-native-screens' +
    '))',
  ],

  moduleNameMapper: {
    // Resolve monorepo package to local source — Metro isn't involved in tests
    '^@realclaw/types$': '<rootDir>/../../packages/types/src/index.ts',
    // Support the @/ path alias from tsconfig.json
    '^@/(.*)$': '<rootDir>/$1',
  },

  testMatch: [
    '**/__tests__/**/*.{ts,tsx}',
    '**/?(*.)+(spec|test).{ts,tsx}',
  ],

  collectCoverageFrom: [
    'store/**/*.ts',
    'lib/**/*.ts',
    'components/**/*.{ts,tsx}',
    '!**/node_modules/**',
    '!**/__tests__/**',
  ],

  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
};
