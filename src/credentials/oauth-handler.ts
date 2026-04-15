import http from 'http';
import { URL } from 'url';
import type { CredentialVault } from './vault.js';
import type { IntegrationId } from '../types/integrations.js';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;  // ISO-8601
  tokenType: string;
}

export class OAuthHandler {
  private readonly vault: CredentialVault;
  private readonly port: number;

  constructor(vault: CredentialVault, callbackPort = 3000) {
    this.vault = vault;
    this.port = callbackPort;
  }

  /** Build the authorization URL for the initial OAuth flow */
  buildAuthUrl(config: OAuthConfig, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${config.authUrl}?${params.toString()}`;
  }

  /** Exchange authorization code for tokens */
  async exchangeCode(config: OAuthConfig, code: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.parseTokenResponse(data);
  }

  /** Refresh an expired access token */
  async refreshToken(
    config: OAuthConfig,
    refreshToken: string,
  ): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.parseTokenResponse(data);
  }

  /** Store tokens in the vault */
  async storeTokens(integrationId: IntegrationId, tokens: TokenSet): Promise<void> {
    await this.vault.store(integrationId, 'access_token', tokens.accessToken);
    if (tokens.refreshToken) {
      await this.vault.store(integrationId, 'refresh_token', tokens.refreshToken);
    }
    if (tokens.expiresAt) {
      await this.vault.store(integrationId, 'expires_at', tokens.expiresAt);
    }
  }

  /** Retrieve and auto-refresh tokens */
  async getValidAccessToken(
    integrationId: IntegrationId,
    config: OAuthConfig,
  ): Promise<string> {
    const expiresAt = await this.vault.retrieve(integrationId, 'expires_at');
    const accessToken = await this.vault.retrieve(integrationId, 'access_token');

    if (!accessToken) {
      throw new Error(`No access token stored for ${integrationId}`);
    }

    // Refresh if expiring within 5 minutes
    if (expiresAt) {
      const expiryMs = new Date(expiresAt).getTime();
      if (Date.now() > expiryMs - 300_000) {
        const refreshToken = await this.vault.retrieve(integrationId, 'refresh_token');
        if (!refreshToken) {
          throw new Error(`Access token expired and no refresh token for ${integrationId}`);
        }
        const newTokens = await this.refreshToken(config, refreshToken);
        await this.storeTokens(integrationId, newTokens);
        return newTokens.accessToken;
      }
    }

    return accessToken;
  }

  /** Spin up a temporary callback server to receive the OAuth code */
  waitForCallback(expectedState: string, timeoutMs = 300_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('OAuth callback timed out'));
      }, timeoutMs);

      const server = http.createServer((req, res) => {
        try {
          const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400);
            res.end('OAuth error: ' + error);
            clearTimeout(timer);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code || state !== expectedState) {
            res.writeHead(400);
            res.end('Invalid callback');
            return;
          }

          res.writeHead(200);
          res.end('Authorization complete. You may close this window.');
          clearTimeout(timer);
          server.close();
          resolve(code);
        } catch (err) {
          res.writeHead(500);
          res.end('Internal error');
          clearTimeout(timer);
          server.close();
          reject(err);
        }
      });

      server.listen(this.port);
    });
  }

  private parseTokenResponse(data: Record<string, unknown>): TokenSet {
    const expiresIn = typeof data['expires_in'] === 'number' ? data['expires_in'] : null;
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    return {
      accessToken: String(data['access_token'] ?? ''),
      refreshToken: data['refresh_token'] ? String(data['refresh_token']) : null,
      expiresAt,
      tokenType: String(data['token_type'] ?? 'Bearer'),
    };
  }
}
