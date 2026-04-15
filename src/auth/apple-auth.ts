import jwt from 'jsonwebtoken';
import { getPublicKey } from './jwks-client.js';

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

export interface AppleIdentityPayload {
  sub: string;                           // Apple user identifier (stable per user per team)
  email?: string;                        // Only present on first sign-in
  email_verified?: 'true' | 'false';
  is_private_email?: 'true' | 'false';
}

/**
 * Verify an Apple identity token (identityToken from expo-apple-authentication).
 * Validates signature against Apple's JWKS, checks issuer and audience.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  clientId: string,    // App's bundle ID or service ID
): Promise<AppleIdentityPayload> {
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Invalid Apple identity token — decode failed');
  }

  const { kid } = decoded.header;
  if (!kid) throw new Error('Apple identity token missing kid header');

  const publicKey = await getPublicKey(APPLE_JWKS_URL, kid);

  const payload = jwt.verify(identityToken, publicKey, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience: clientId,
  }) as AppleIdentityPayload;

  if (!payload.sub) throw new Error('Apple token missing sub claim');
  return payload;
}
