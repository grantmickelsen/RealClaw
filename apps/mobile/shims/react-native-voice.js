// Stub for @react-native-voice/voice when native module is unavailable (Expo Go).
const Voice = {
  onSpeechResults: undefined,
  onSpeechError: undefined,
  async start() { throw new Error('Voice recognition requires a development build.'); },
  async stop() {},
  async destroy() {},
};
export default Voice;
