import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { verifyGoogleIdentityToken } from '../../../src/auth/google-auth.js';
import { clearJwksCache } from '../../../src/auth/jwks-client.js';

// ─── Test RSA key pair ───
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const publicKeyJwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string; kty: string };

const TEST_KID = 'test-google-kid-001';
const TEST_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function makeGoogleToken(overrides: Record<string, unknown> = {}): string {
  const payload = {
    sub: 'google-user-sub-99999',
    email: 'user@example.com',
    email_verified: true,
    name: 'Test User',
    iss: 'https://accounts.google.com',
    aud: TEST_CLIENT_ID,
    ...overrides,
  };
  return jwt.sign(payload, privateKeyPem, {
    algorithm: 'RS256',
    keyid: (overrides['_kid'] as string) ?? TEST_KID,
    expiresIn: '1h',
  });
}

const mockJwks = {
  keys: [{
    kty: 'RSA',
    kid: TEST_KID,
    alg: 'RS256',
    use: 'sig',
    n: publicKeyJwk.n,
    e: publicKeyJwk.e,
  }],
};

const server = setupServer(
  http.get(GOOGLE_JWKS_URL, () => HttpResponse.json(mockJwks)),
);

beforeEach(() => {
  clearJwksCache();
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('verifyGoogleIdentityToken', () => {
  it('returns { sub, email, email_verified } for a valid token', async () => {
    const token = makeGoogleToken();
    const result = await verifyGoogleIdentityToken(token, TEST_CLIENT_ID);
    expect(result.sub).toBe('google-user-sub-99999');
    expect(result.email).toBe('user@example.com');
    expect(result.email_verified).toBe(true);
  });

  it('includes optional name and picture when present', async () => {
    const token = makeGoogleToken({ picture: 'https://lh3.googleusercontent.com/photo.jpg' });
    const result = await verifyGoogleIdentityToken(token, TEST_CLIENT_ID);
    expect(result.name).toBe('Test User');
    expect(result.picture).toBe('https://lh3.googleusercontent.com/photo.jpg');
  });

  it('accepts the alternate Google issuer (accounts.google.com)', async () => {
    const token = makeGoogleToken({ iss: 'accounts.google.com' });
    const result = await verifyGoogleIdentityToken(token, TEST_CLIENT_ID);
    expect(result.sub).toBe('google-user-sub-99999');
  });

  it('rejects a token with wrong audience', async () => {
    const token = makeGoogleToken({ aud: 'com.wrong.clientid' });
    await expect(verifyGoogleIdentityToken(token, TEST_CLIENT_ID)).rejects.toThrow();
  });

  it('rejects a token with wrong issuer', async () => {
    const token = makeGoogleToken({ iss: 'https://evil.example.com' });
    await expect(verifyGoogleIdentityToken(token, TEST_CLIENT_ID)).rejects.toThrow();
  });

  it('throws when kid is not found in JWKS', async () => {
    const token = makeGoogleToken({ _kid: 'nonexistent-kid' });
    await expect(verifyGoogleIdentityToken(token, TEST_CLIENT_ID))
      .rejects.toThrow(/JWK not found for kid/);
  });

  it('throws on a completely invalid token string', async () => {
    await expect(verifyGoogleIdentityToken('not.a.jwt', TEST_CLIENT_ID)).rejects.toThrow();
  });

  it('throws when sub or email is missing from payload', async () => {
    // Build a token that passes jwt.verify but lacks sub — done by stripping sub post-sign.
    // Easiest path: use a sub of '' which passes JWT decode but fails our guard.
    const token = makeGoogleToken({ sub: '', email: '' });
    await expect(verifyGoogleIdentityToken(token, TEST_CLIENT_ID))
      .rejects.toThrow(/missing sub or email/);
  });

  it('uses cached JWKS within TTL (fetch called only once)', async () => {
    let fetchCount = 0;
    server.use(
      http.get(GOOGLE_JWKS_URL, () => {
        fetchCount++;
        return HttpResponse.json(mockJwks);
      }),
    );

    const token1 = makeGoogleToken();
    const token2 = makeGoogleToken({ sub: 'other-sub', email: 'other@example.com' });

    await verifyGoogleIdentityToken(token1, TEST_CLIENT_ID);
    await verifyGoogleIdentityToken(token2, TEST_CLIENT_ID);

    expect(fetchCount).toBe(1);
  });
});
