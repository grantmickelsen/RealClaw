# Mobile App — Claude Notes

## Finding all native-module web errors at once

There are two categories of web incompatibility errors:

**Bundle-time** (Metro can't resolve the module at all) — caught by:
```bash
npm run check:web
# or: npx expo export --platform web
```
Run this before `expo start` to surface every missing module in one pass instead of one crash at a time.

**Runtime** (module loads but throws when a web-unsupported method is called) — these only appear in the browser. Common signature: `"The method or property X is not available on web"`. Fix with a `.web.ts` file (same filename, Metro picks it automatically) that no-ops the relevant functions.

---

## Native-only packages on web (Metro shim pattern)

When `npx expo start` fails on web with errors like:
- `ExpoSecureStore.default.getValueWithKeyAsync is not a function`
- `Cannot read properties of undefined (reading 'v1')`
- `Unable to resolve module ./wa-sqlite/wa-sqlite.wasm`

...the cause is a package that uses native APIs (keychain, Apple/Google SDKs, WASM) unavailable in browsers.

**Fix pattern:** add a shim to `shims/` and register it in `metro.config.js`:

```js
// metro.config.js
const WEB_SHIMS = {
  'some-native-package': 'shims/some-native-package.js',
};
```

The shim implements the same API surface using web equivalents (`localStorage`, `crypto.randomUUID()`, no-op stubs, etc.).

### Currently shimmed packages

| Package | Shim | Web replacement |
|---|---|---|
| `uuid` | `shims/uuid.js` | `crypto.randomUUID()` |
| `expo-secure-store` | `shims/expo-secure-store.js` | `localStorage` |
| `expo-apple-authentication` | `shims/expo-apple-authentication.js` | throws "not available on web" |
| `@react-native-google-signin/google-signin` | `shims/google-signin.js` | throws "not available on web" |

### Runtime-only stubs (`.web.ts` files)

For modules that load on web but throw when specific methods are called, create a `.web.ts` alongside the original file — Metro resolves it automatically:

| File | Stubs |
|---|---|
| `lib/push.web.ts` | `registerPushToken`, `setupNotificationHandlers` — push notifications are iOS/Android only |
| `lib/db.web.ts` | Full SQLite API backed by `localStorage` |

### SQLite on web

`expo-sqlite` imports a `.wasm` file that Metro can't parse as JS. Fix:
- `lib/db.web.ts` — full `localStorage`-backed implementation of the `db.ts` API
- Metro picks `.web.ts` over `.ts` automatically when bundling for web
- `wasm` is also added to `assetExts` in `metro.config.js` as belt-and-suspenders

### Always restart with `-c` after changing metro.config.js

```bash
npx expo start -c
```
