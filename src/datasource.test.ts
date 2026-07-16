import { isQueryConfigured } from './queryUtils';
import type { DdbDataQuery } from './types';

function query(overrides: Partial<DdbDataQuery>): DdbDataQuery {
  return {
    refId: 'A',
    is_streaming: false,
    ...overrides,
  };
}

describe('isQueryConfigured', () => {
  it.each([undefined, '', '   '])('skips a streaming query with table name %p', table => {
    expect(isQueryConfigured(query({ is_streaming: true, streaming: table === undefined ? undefined : { table } }))).toBe(false);
  });

  it('allows a streaming query with a table name', () => {
    expect(isQueryConfigured(query({ is_streaming: true, streaming: { table: 'trades' } }))).toBe(true);
  });

  it.each([undefined, '', '   '])('skips a script query with query text %p', queryText => {
    expect(isQueryConfigured(query({ queryText }))).toBe(false);
  });

  it('allows a script query with query text', () => {
    expect(isQueryConfigured(query({ queryText: 'select * from trades' }))).toBe(true);
  });
});
