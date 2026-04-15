import crypto from 'crypto';

export interface JwksKey {
  kty: string;
  kid: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface JwksCache {
  keys: Map<string, JwksKey>;
  fetchedAt: number;
}

const caches = new Map<string, JwksCache>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch a public key from a JWKS endpoint, identified by kid.
 * Results are cached for 5 minutes.
 */
export async function getPublicKey(jwksUrl: string, kid: string): Promise<string> {
  let cache = caches.get(jwksUrl);

  if (!cache || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    const res = await fetch(jwksUrl);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status} from ${jwksUrl}`);
    const { keys } = await res.json() as { keys: JwksKey[] };
    cache = {
      keys: new Map(keys.map(k => [k.kid, k])),
      fetchedAt: Date.now(),
    };
    caches.set(jwksUrl, cache);
  }

  const key = cache.keys.get(kid);
  if (!key) throw new Error(`JWK not found for kid=${kid} at ${jwksUrl}`);

  return rsaJwkToPem(key);
}

/** Convert an RSA JWK to a PEM public key string. */
function rsaJwkToPem(jwk: JwksKey): string {
  return crypto
    .createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
    .export({ type: 'pkcs1', format: 'pem' }) as string;
}

/** Clear the JWKS cache — used in tests to force a fresh fetch. */
export function clearJwksCache(): void {
  caches.clear();
}
