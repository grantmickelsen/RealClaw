import * as SecureStore from 'expo-secure-store';
import {
  loadStoredTokens,
  storeTokens,
  clearStoredTokens,
} from '../../lib/auth';

// expo-secure-store is mocked globally in jest-setup.ts
const mockGet = SecureStore.getItemAsync as jest.MockedFunction<typeof SecureStore.getItemAsync>;
const mockSet = SecureStore.setItemAsync as jest.MockedFunction<typeof SecureStore.setItemAsync>;
const mockDelete = SecureStore.deleteItemAsync as jest.MockedFunction<typeof SecureStore.deleteItemAsync>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadStoredTokens', () => {
  it('returns null when any required field is missing', async () => {
    // Only some fields present
    mockGet.mockResolvedValueOnce('acc').mockResolvedValueOnce(null);
    const result = await loadStoredTokens();
    expect(result).toBeNull();
  });

  it('returns null when all fields missing', async () => {
    mockGet.mockResolvedValue(null);
    const result = await loadStoredTokens();
    expect(result).toBeNull();
  });

  it('returns StoredTokens when all fields present and token not expired', async () => {
    const futureExpiry = String(Date.now() + 900_000);  // 15 min from now
    mockGet
      .mockResolvedValueOnce('my-access-token')  // ACCESS_TOKEN_KEY
      .mockResolvedValueOnce('my-refresh-token') // REFRESH_TOKEN_KEY
      .mockResolvedValueOnce('user-123')         // USER_ID_KEY
      .mockResolvedValueOnce('tenant-abc')       // TENANT_ID_KEY
      .mockResolvedValueOnce(futureExpiry);      // EXPIRES_AT_KEY

    const result = await loadStoredTokens();
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('my-access-token');
    expect(result!.refreshToken).toBe('my-refresh-token');
    expect(result!.userId).toBe('user-123');
    expect(result!.tenantId).toBe('tenant-abc');
    expect(result!.expiresIn).toBeGreaterThan(0);
  });

  it('returns expiresIn = -1 when token is expired', async () => {
    const pastExpiry = String(Date.now() - 60_000);  // expired 1 min ago
    mockGet
      .mockResolvedValueOnce('access')
      .mockResolvedValueOnce('refresh')
      .mockResolvedValueOnce('uid')
      .mockResolvedValueOnce('tid')
      .mockResolvedValueOnce(pastExpiry);

    const result = await loadStoredTokens();
    expect(result).not.toBeNull();
    expect(result!.expiresIn).toBe(-1);
  });
});

describe('storeTokens', () => {
  it('calls setItemAsync for each field', async () => {
    mockSet.mockResolvedValue(undefined);
    await storeTokens({
      accessToken: 'at',
      refreshToken: 'rt',
      userId: 'u1',
      tenantId: 't1',
      expiresIn: 900,
    });
    // Should have been called 5 times (access, refresh, userId, tenantId, expiresAt)
    expect(mockSet).toHaveBeenCalledTimes(5);
    // Access token stored with WHEN_UNLOCKED option
    expect(mockSet).toHaveBeenCalledWith(
      'rca_access_token',
      'at',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED }),
    );
    // Refresh token stored with WHEN_UNLOCKED_THIS_DEVICE_ONLY option
    expect(mockSet).toHaveBeenCalledWith(
      'rca_refresh_token',
      'rt',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
  });

  it('stores expiresAt as a future timestamp string', async () => {
    mockSet.mockResolvedValue(undefined);
    const before = Date.now();
    await storeTokens({ accessToken: 'a', refreshToken: 'r', userId: 'u', tenantId: 't', expiresIn: 3600 });
    const after = Date.now();

    const expiresAtCall = mockSet.mock.calls.find(c => c[0] === 'rca_expires_at');
    expect(expiresAtCall).toBeDefined();
    const storedValue = parseInt(expiresAtCall![1] as string, 10);
    expect(storedValue).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(storedValue).toBeLessThanOrEqual(after + 3_600_000 + 50);
  });
});

describe('clearStoredTokens', () => {
  it('calls deleteItemAsync for all 5 keys', async () => {
    mockDelete.mockResolvedValue(undefined);
    await clearStoredTokens();
    expect(mockDelete).toHaveBeenCalledTimes(5);
    expect(mockDelete).toHaveBeenCalledWith('rca_access_token');
    expect(mockDelete).toHaveBeenCalledWith('rca_refresh_token');
    expect(mockDelete).toHaveBeenCalledWith('rca_user_id');
    expect(mockDelete).toHaveBeenCalledWith('rca_tenant_id');
    expect(mockDelete).toHaveBeenCalledWith('rca_expires_at');
  });
});
