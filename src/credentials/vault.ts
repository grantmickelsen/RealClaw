import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { IntegrationId } from '../types/integrations.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT = Buffer.from('claw-vault-v1', 'utf-8');

interface EncryptedEntry {
  iv: string;       // hex
  tag: string;      // hex
  ciphertext: string; // hex
}

interface VaultMetadata {
  integrationId: string;
  key: string;
  storedAt: string;
  expiresAt: string | null;
  rotationDays: number;
}

interface VaultIndex {
  metadata: VaultMetadata[];
}

export class CredentialVault {
  private readonly vaultPath: string;
  private readonly masterKey: Buffer;

  constructor(vaultPath: string = process.env.CLAW_VAULT_PATH ?? '/opt/claw/credentials') {
    this.vaultPath = vaultPath;
    const rawKey = process.env.CLAW_VAULT_MASTER_KEY;
    if (!rawKey) {
      throw new Error('CLAW_VAULT_MASTER_KEY environment variable is required');
    }
    // Derive a 32-byte key from the master key
    this.masterKey = crypto.pbkdf2Sync(
      Buffer.from(rawKey, 'base64'),
      SALT,
      100_000,
      32,
      'sha256',
    );
  }

  async store(integrationId: IntegrationId, key: string, value: string): Promise<void> {
    const encrypted = this.encrypt(value);
    const filePath = this.entryPath(integrationId, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(encrypted), 'utf-8');

    // Update plaintext metadata index (no credential values)
    const rotationDays = parseInt(process.env.CLAW_CREDENTIAL_ROTATION_DAYS ?? '90', 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + rotationDays * 86_400_000);

    await this.updateIndex(integrationId, key, {
      integrationId,
      key,
      storedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      rotationDays,
    });
  }

  async retrieve(integrationId: IntegrationId, key: string): Promise<string | null> {
    const filePath = this.entryPath(integrationId, key);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const entry: EncryptedEntry = JSON.parse(raw);
      return this.decrypt(entry);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async rotate(integrationId: IntegrationId): Promise<void> {
    // Re-encrypt all keys for this integration (no key rotation in v1, just metadata update)
    const index = await this.loadIndex();
    const entries = index.metadata.filter(m => m.integrationId === integrationId);
    const rotationDays = parseInt(process.env.CLAW_CREDENTIAL_ROTATION_DAYS ?? '90', 10);

    for (const entry of entries) {
      const value = await this.retrieve(integrationId as IntegrationId, entry.key);
      if (value !== null) {
        await this.store(integrationId as IntegrationId, entry.key, value);
      }
      const now = new Date();
      entry.storedAt = now.toISOString();
      entry.expiresAt = new Date(now.getTime() + rotationDays * 86_400_000).toISOString();
    }

    await this.saveIndex(index);
  }

  async getMetadata(integrationId: IntegrationId, key: string): Promise<VaultMetadata | null> {
    const index = await this.loadIndex();
    return (
      index.metadata.find(
        m => m.integrationId === integrationId && m.key === key,
      ) ?? null
    );
  }

  async isExpired(integrationId: IntegrationId, key: string): Promise<boolean> {
    const meta = await this.getMetadata(integrationId, key);
    if (!meta?.expiresAt) return false;
    return new Date(meta.expiresAt) < new Date();
  }

  private encrypt(plaintext: string): EncryptedEntry {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
    };
  }

  private decrypt(entry: EncryptedEntry): string {
    const iv = Buffer.from(entry.iv, 'hex');
    const tag = Buffer.from(entry.tag, 'hex');
    const ciphertext = Buffer.from(entry.ciphertext, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext).toString('utf-8') + decipher.final('utf-8');
  }

  private entryPath(integrationId: IntegrationId, key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.vaultPath, integrationId, `${safeKey}.enc`);
  }

  private indexPath(): string {
    return path.join(this.vaultPath, 'index.json');
  }

  private async loadIndex(): Promise<VaultIndex> {
    try {
      const raw = await fs.readFile(this.indexPath(), 'utf-8');
      return JSON.parse(raw) as VaultIndex;
    } catch {
      return { metadata: [] };
    }
  }

  private async saveIndex(index: VaultIndex): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath()), { recursive: true });
    await fs.writeFile(this.indexPath(), JSON.stringify(index, null, 2), 'utf-8');
  }

  private async updateIndex(
    integrationId: IntegrationId,
    key: string,
    meta: VaultMetadata,
  ): Promise<void> {
    const index = await this.loadIndex();
    const existingIdx = index.metadata.findIndex(
      m => m.integrationId === integrationId && m.key === key,
    );
    if (existingIdx >= 0) {
      index.metadata[existingIdx] = meta;
    } else {
      index.metadata.push(meta);
    }
    await this.saveIndex(index);
  }
}
