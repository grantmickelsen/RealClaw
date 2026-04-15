import { act } from 'react';
import { useWsStore } from '../../store/ws';

beforeEach(() => {
  useWsStore.setState({
    status: 'disconnected',
    socket: null,
    pendingCorrelationIds: new Set(),
  });
});

describe('useWsStore', () => {
  it('starts disconnected with no socket and empty pending set', () => {
    const state = useWsStore.getState();
    expect(state.status).toBe('disconnected');
    expect(state.socket).toBeNull();
    expect(state.pendingCorrelationIds.size).toBe(0);
  });

  it('setStatus updates the status field', () => {
    act(() => { useWsStore.getState().setStatus('connecting'); });
    expect(useWsStore.getState().status).toBe('connecting');

    act(() => { useWsStore.getState().setStatus('connected'); });
    expect(useWsStore.getState().status).toBe('connected');

    act(() => { useWsStore.getState().setStatus('error'); });
    expect(useWsStore.getState().status).toBe('error');
  });

  it('setSocket stores the socket reference', () => {
    const fakeSock = { readyState: 1 } as unknown as WebSocket;
    act(() => { useWsStore.getState().setSocket(fakeSock); });
    expect(useWsStore.getState().socket).toBe(fakeSock);
  });

  it('setSocket(null) clears the socket', () => {
    const fakeSock = { readyState: 1 } as unknown as WebSocket;
    act(() => { useWsStore.getState().setSocket(fakeSock); });
    act(() => { useWsStore.getState().setSocket(null); });
    expect(useWsStore.getState().socket).toBeNull();
  });

  it('addPending adds correlationId to the set', () => {
    act(() => { useWsStore.getState().addPending('corr-1'); });
    expect(useWsStore.getState().pendingCorrelationIds.has('corr-1')).toBe(true);
  });

  it('addPending with duplicate correlationId is idempotent', () => {
    act(() => {
      useWsStore.getState().addPending('corr-1');
      useWsStore.getState().addPending('corr-1');
    });
    expect(useWsStore.getState().pendingCorrelationIds.size).toBe(1);
  });

  it('addPending supports multiple distinct correlationIds', () => {
    act(() => {
      useWsStore.getState().addPending('c1');
      useWsStore.getState().addPending('c2');
      useWsStore.getState().addPending('c3');
    });
    expect(useWsStore.getState().pendingCorrelationIds.size).toBe(3);
  });

  it('removePending removes the correlationId', () => {
    act(() => {
      useWsStore.getState().addPending('corr-1');
      useWsStore.getState().addPending('corr-2');
    });
    act(() => { useWsStore.getState().removePending('corr-1'); });
    const ids = useWsStore.getState().pendingCorrelationIds;
    expect(ids.has('corr-1')).toBe(false);
    expect(ids.has('corr-2')).toBe(true);
  });

  it('removePending on non-existent id is a no-op', () => {
    act(() => { useWsStore.getState().addPending('c1'); });
    act(() => { useWsStore.getState().removePending('no-such'); });
    expect(useWsStore.getState().pendingCorrelationIds.size).toBe(1);
  });
});
