import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  tenantId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext {
  return requestContext.getStore() ?? { requestId: 'no-context' };
}
