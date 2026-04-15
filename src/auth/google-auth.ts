import jwt from 'jsonwebtoken';
import { getPublicKey } from './jwks-client.js';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleIdentityPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

/**
 * Verify a Google ID token (from @react-native-google-signin/google-signin).
 * Validates signature against Google's JWKS, checks issuer and audience.
 */
export async function verifyGoogleIdentityToken(
  idToken: string,
  clientId: string,
): Promise<GoogleIdentityPayload> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Invalid Google ID token — decode failed');
  }

  const { kid } = decoded.header;
  if (!kid) throw new Error('Google ID token missing kid header');

  const publicKey = await getPublicKey(GOOGLE_JWKS_URL, kid);

  const payload = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    issuer: GOOGLE_ISSUERS as [string, ...string[]],
    audience: clientId,
  }) as unknown as GoogleIdentityPayload;

  if (!payload.sub || !payload.email) {
    throw new Error('Google token missing sub or email claim');
  }
  return payload;
}
