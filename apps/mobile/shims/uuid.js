// Shim for the `uuid` package on web/SSR.
// crypto.randomUUID() is available in modern browsers (Chrome 92+, Firefox 95+, Safari 15.4+)
// and in Node 14.17+. React Native 0.71+ also provides it via globalThis.crypto.
export const v4 = () => globalThis.crypto.randomUUID();
export const v1 = v4; // not a real v1 — satisfies any accidental imports
