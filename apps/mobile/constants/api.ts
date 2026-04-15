declare const __DEV__: boolean;

export const API_BASE_URL: string = __DEV__
  ? 'http://localhost:18789'
  : 'https://api.realclaw.com';

export const WS_URL: string = __DEV__
  ? 'ws://localhost:18789/ws'
  : 'wss://api.realclaw.com/ws';
