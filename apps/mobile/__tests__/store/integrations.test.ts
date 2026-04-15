import { act } from 'react';
import { useIntegrationsStore, type IntegrationStatusEntry } from '../../store/integrations';

function entry(id: string, status: IntegrationStatusEntry['status'] = 'connected'): IntegrationStatusEntry {
  return { id, status, lastSuccessfulCall: null, lastError: null };
}

beforeEach(() => {
  useIntegrationsStore.setState({ statuses: [] });
});

describe('useIntegrationsStore', () => {
  it('starts with empty statuses', () => {
    expect(useIntegrationsStore.getState().statuses).toHaveLength(0);
  });

  it('setStatuses replaces the entire statuses array', () => {
    act(() => {
      useIntegrationsStore.getState().setStatuses([
        entry('gmail', 'connected'),
        entry('hubspot', 'disconnected'),
      ]);
    });
    const statuses = useIntegrationsStore.getState().statuses;
    expect(statuses).toHaveLength(2);
    expect(statuses[0].id).toBe('gmail');
    expect(statuses[1].id).toBe('hubspot');
  });

  it('setStatuses replaces previous statuses (not merges)', () => {
    act(() => { useIntegrationsStore.getState().setStatuses([entry('gmail')]); });
    act(() => { useIntegrationsStore.getState().setStatuses([entry('hubspot')]); });
    const statuses = useIntegrationsStore.getState().statuses;
    expect(statuses).toHaveLength(1);
    expect(statuses[0].id).toBe('hubspot');
  });

  it('updateStatus patches the matching integration by id', () => {
    act(() => {
      useIntegrationsStore.getState().setStatuses([
        entry('gmail', 'connected'),
        entry('hubspot', 'disconnected'),
      ]);
    });
    act(() => {
      useIntegrationsStore.getState().updateStatus('gmail', {
        status: 'degraded',
        lastError: 'Rate limited',
      });
    });
    const statuses = useIntegrationsStore.getState().statuses;
    const gmail = statuses.find(s => s.id === 'gmail')!;
    expect(gmail.status).toBe('degraded');
    expect(gmail.lastError).toBe('Rate limited');
  });

  it('updateStatus leaves non-matching entries untouched', () => {
    act(() => {
      useIntegrationsStore.getState().setStatuses([
        entry('gmail', 'connected'),
        entry('hubspot', 'connected'),
      ]);
    });
    act(() => {
      useIntegrationsStore.getState().updateStatus('gmail', { status: 'degraded' });
    });
    const hubspot = useIntegrationsStore.getState().statuses.find(s => s.id === 'hubspot')!;
    expect(hubspot.status).toBe('connected');
  });

  it('updateStatus on unknown id is a no-op (no throw)', () => {
    act(() => {
      useIntegrationsStore.getState().setStatuses([entry('gmail')]);
    });
    expect(() => {
      act(() => {
        useIntegrationsStore.getState().updateStatus('no-such', { status: 'disconnected' });
      });
    }).not.toThrow();
    expect(useIntegrationsStore.getState().statuses).toHaveLength(1);
  });

  it('updateStatus preserves fields that were not in the update', () => {
    act(() => {
      useIntegrationsStore.getState().setStatuses([
        { id: 'twilio', status: 'connected', lastSuccessfulCall: '2024-01-01', lastError: null },
      ]);
    });
    act(() => {
      useIntegrationsStore.getState().updateStatus('twilio', { status: 'degraded' });
    });
    const twilio = useIntegrationsStore.getState().statuses[0];
    expect(twilio.lastSuccessfulCall).toBe('2024-01-01');
  });
});
