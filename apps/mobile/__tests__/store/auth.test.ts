import { act } from 'react';
import { useAuthStore } from '../../store/auth';

// Reset Zustand store state between tests
beforeEach(() => {
  useAuthStore.setState({
    status: 'loading',
    accessToken: null,
    refreshToken: null,
    userId: null,
    tenantId: null,
    expiresAt: null,
  });
});

describe('useAuthStore', () => {
  it('starts in loading state with all nulls', () => {
    const state = useAuthStore.getState();
    expect(state.status).toBe('loading');
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.tenantId).toBeNull();
    expect(state.expiresAt).toBeNull();
  });

  it('setTokens transitions to authenticated and stores all values', () => {
    const before = Date.now();
    act(() => {
      useAuthStore.getState().setTokens({
        accessToken: 'acc-token',
        refreshToken: 'ref-token',
        userId: 'user-1',
        tenantId: 'tenant-abc',
        expiresIn: 900,  // 15 minutes
      });
    });
    const after = Date.now();
    const state = useAuthStore.getState();

    expect(state.status).toBe('authenticated');
    expect(state.accessToken).toBe('acc-token');
    expect(state.refreshToken).toBe('ref-token');
    expect(state.userId).toBe('user-1');
    expect(state.tenantId).toBe('tenant-abc');
    // expiresAt should be roughly now + 900s
    expect(state.expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(state.expiresAt).toBeLessThanOrEqual(after + 900_000 + 50);
  });

  it('clearTokens transitions to unauthenticated and nulls all fields', () => {
    // Set tokens first
    act(() => {
      useAuthStore.getState().setTokens({
        accessToken: 'acc',
        refreshToken: 'ref',
        userId: 'u1',
        tenantId: 't1',
        expiresIn: 900,
      });
    });

    act(() => {
      useAuthStore.getState().clearTokens();
    });

    const state = useAuthStore.getState();
    expect(state.status).toBe('unauthenticated');
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.tenantId).toBeNull();
    expect(state.expiresAt).toBeNull();
  });

  it('setTokens can be called multiple times — last call wins', () => {
    act(() => {
      useAuthStore.getState().setTokens({
        accessToken: 'first',
        refreshToken: 'r1',
        userId: 'u1',
        tenantId: 't1',
        expiresIn: 900,
      });
    });
    act(() => {
      useAuthStore.getState().setTokens({
        accessToken: 'second',
        refreshToken: 'r2',
        userId: 'u2',
        tenantId: 't2',
        expiresIn: 1800,
      });
    });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('second');
    expect(state.userId).toBe('u2');
  });
});
