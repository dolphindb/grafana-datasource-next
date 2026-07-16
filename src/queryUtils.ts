import type { DdbDataQuery } from './types';

/** Prevent Grafana from issuing backend/live requests for incomplete queries. */
export function isQueryConfigured(query: DdbDataQuery): boolean {
  if (query.is_streaming) {
    return !!query.streaming?.table?.trim();
  }

  return !!query.queryText?.trim();
}
