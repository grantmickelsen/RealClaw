const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the entire workspace so Metro resolves packages/types
config.watchFolders = [workspaceRoot];

// Resolve from workspace root node_modules as fallback
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Ensure .ts/.tsx files in packages/types are included
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];

// Treat .wasm as a binary asset so Metro doesn't try to parse it as JS
// (expo-sqlite's web worker imports wa-sqlite.wasm directly)
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

// On web, redirect native-only packages to localStorage/stub shims.
// These packages use native APIs (keychain, Apple/Google SDKs) unavailable in browsers.
const WEB_SHIMS = {
  'uuid':                                      'shims/uuid.js',
  'expo-secure-store':                         'shims/expo-secure-store.js',
  'expo-apple-authentication':                 'shims/expo-apple-authentication.js',
  '@react-native-google-signin/google-signin': 'shims/google-signin.js',
  'expo-contacts':                             'shims/expo-contacts.js',
  '@react-native-voice/voice':                 'shims/react-native-voice.js',
  'react-native-purchases':                    'shims/react-native-purchases.js',
};

// Packages requiring compiled native modules not present in Expo Go.
// Shimmed on all non-web platforms so the app loads; full functionality
// requires a development build (npx expo run:ios / run:android).
const EXPO_GO_SHIMS = {
  '@react-native-google-signin/google-signin': 'shims/google-signin.js',
  '@react-native-voice/voice':                 'shims/react-native-voice.js',
  'uuid':                                      'shims/uuid.js',
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return {
      filePath: path.resolve(projectRoot, WEB_SHIMS[moduleName]),
      type: 'sourceFile',
    };
  }
  if (platform !== 'web' && EXPO_GO_SHIMS[moduleName]) {
    return {
      filePath: path.resolve(projectRoot, EXPO_GO_SHIMS[moduleName]),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
