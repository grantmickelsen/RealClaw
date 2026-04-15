import { useWsStore } from '../../store/ws';
import { drainOfflineQueue } from '../../lib/offline-queue';

// Mock the db helpers and API
jest.mock('../../lib/db', () => ({
  dequeueMessages: jest.fn(),
  removeFromQueue: jest.fn().mockResolvedValue(undefined),
  incrementRetry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/api', () => ({
  authedFetch: jest.fn(),
}));

import { dequeueMessages, removeFromQueue, incrementRetry } from '../../lib/db';
import { authedFetch } from '../../lib/api';

const mockDequeue = dequeueMessages as jest.MockedFunction<typeof dequeueMessages>;
const mockRemove = removeFromQueue as jest.MockedFunction<typeof removeFromQueue>;
const mockIncRetry = incrementRetry as jest.MockedFunction<typeof incrementRetry>;
const mockFetch = authedFetch as jest.MockedFunction<typeof authedFetch>;

function makeItem(correlationId: string, retryCount = 0) {
  return {
    correlation_id: correlationId,
    text: 'hello',
    platform: 'mobile',
    retry_count: retryCount,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useWsStore.setState({ status: 'connected', socket: null, pendingCorrelationIds: new Set() });
});

describe('drainOfflineQueue', () => {
  it('does nothing when WS is not connected', async () => {
    useWsStore.setState({ status: 'disconnected', socket: null, pendingCorrelationIds: new Set() });
    await drainOfflineQueue();
    expect(mockDequeue).not.toHaveBeenCalled();
  });

  it('does nothing when queue is empty', async () => {
    mockDequeue.mockResolvedValueOnce([]);
    await drainOfflineQueue();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POSTs each queued message and removes on success', async () => {
    mockDequeue.mockResolvedValueOnce([makeItem('c1'), makeItem('c2')]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await drainOfflineQueue();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockRemove).toHaveBeenCalledWith('c1');
    expect(mockRemove).toHaveBeenCalledWith('c2');
    expect(mockIncRetry).not.toHaveBeenCalled();
  });

  it('increments retry on non-ok response', async () => {
    mockDequeue.mockResolvedValueOnce([makeItem('c1')]);
    mockFetch.mockResolvedValue({ ok: false } as Response);

    await drainOfflineQueue();

    expect(mockIncRetry).toHaveBeenCalledWith('c1');
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('increments retry on fetch error', async () => {
    mockDequeue.mockResolvedValueOnce([makeItem('c1')]);
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await drainOfflineQueue();

    expect(mockIncRetry).toHaveBeenCalledWith('c1');
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('drops messages that have exceeded MAX_RETRY (3) without posting', async () => {
    mockDequeue.mockResolvedValueOnce([makeItem('c1', 3)]);

    await drainOfflineQueue();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith('c1');
    expect(mockIncRetry).not.toHaveBeenCalled();
  });

  it('continues draining after a failure — does not abort the queue', async () => {
    mockDequeue.mockResolvedValueOnce([makeItem('c1'), makeItem('c2')]);
    // c1 fails, c2 succeeds
    mockFetch
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({ ok: true } as Response);

    await drainOfflineQueue();

    expect(mockIncRetry).toHaveBeenCalledWith('c1');
    expect(mockRemove).toHaveBeenCalledWith('c2');
  });

  it('sends POST to /v1/messages with correct body shape', async () => {
    mockDequeue.mockResolvedValueOnce([{
      correlation_id: 'corr-abc',
      text: 'Schedule viewing',
      platform: 'mobile',
      retry_count: 0,
    }]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await drainOfflineQueue();

    expect(mockFetch).toHaveBeenCalledWith('/v1/messages', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        platform: 'mobile',
        content: 'Schedule viewing',
        correlationId: 'corr-abc',
      }),
    }));
  });
});
