import { DataQueryRequest, DataSourceInstanceSettings, toUtc, TimeRange } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv, setBackendSrv, setTemplateSrv } from '@grafana/runtime';
import { firstValueFrom, of, throwError } from 'rxjs';

import { DataSource } from './datasource';
import { DataSourceOptions, DdbDataQuery } from './types';

// Markdown rendering is unrelated to datasource requests and ships as ESM.
jest.mock('marked', () => ({ marked: { use: jest.fn() } }));
jest.mock('@grafana/ui', () => ({ attachDebugger: jest.fn(), createLogger: () => ({ log: jest.fn() }) }));

describe('metricFindQuery', () => {
  const fetch = jest.fn();
  const replace = jest.fn((query: string) => query);
  let datasource: DataSource;

  beforeEach(() => {
    jest.clearAllMocks();
    setBackendSrv({ fetch } as unknown as ReturnType<typeof getBackendSrv>);
    setTemplateSrv({ replace } as unknown as Parameters<typeof setTemplateSrv>[0]);
    datasource = new DataSource({
      id: 0,
      uid: 'ddb-variables',
      type: 'dolphindb-datasource',
      jsonData: {},
      meta: {},
    } as DataSourceInstanceSettings<DataSourceOptions>);
  });

  it('uses the UID resource route and returns the single-column table values', async () => {
    const values = [1, 2, 3].map(value => ({ text: String(value), value }));
    fetch.mockReturnValue(of({ data: values }));

    await expect(datasource.metricFindQuery('select * from table(1..3 as a)', {})).resolves.toEqual(values);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/datasources/uid/ddb-variables/resources/metricFindQuery',
      method: 'POST',
      data: { query: 'select * from table(1..3 as a)' },
    }));
  });

  it('interpolates variables before sending the query', async () => {
    replace.mockReturnValueOnce('table(1..3 as a)');
    fetch.mockReturnValue(of({ data: [] }));
    await expect(datasource.metricFindQuery('table($values as a)', {})).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ data: { query: 'table(1..3 as a)' } }));
  });

  function timeRange(from: string, to: string): TimeRange {
    return { from: toUtc(from), to: toUtc(to), raw: { from, to } };
  }

  it.each(['$__timeFilter', '$timeFilter'])('expands every %s before template interpolation and the resource request', async macro => {
    const range = timeRange('2026-01-27T00:00:00.123Z', '2026-01-27T23:59:59.999Z');
    const query = `select addTime from loadTable("dfs://webNotice","data") where addTime between ${macro} or addTime between ${macro}`;
    const pair = 'pair(2026.01.27 00:00:00.123, 2026.01.27 23:59:59.999)';
    const expected = query.split(macro).join(pair);
    fetch.mockReturnValue(of({ data: [] }));

    await datasource.metricFindQuery(query, { range });

    expect(replace).toHaveBeenCalledWith(expected, {}, expect.any(Function));
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ data: { query: expected } }));
  });

  it('uses the new time range on each variable refresh', async () => {
    fetch.mockReturnValue(of({ data: [] }));
    const query = 'select addTime from trades where addTime between $__timeFilter';

    await datasource.metricFindQuery(query, { range: timeRange('2026-01-27T00:00:00Z', '2026-01-27T23:59:59Z') });
    await datasource.metricFindQuery(query, { range: timeRange('2026-01-28T00:00:00Z', '2026-01-28T23:59:59Z') });

    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { query: 'select addTime from trades where addTime between pair(2026.01.28 00:00:00.000, 2026.01.28 23:59:59.000)' },
    }));
  });

  it('passes scoped variables to template interpolation together with the expanded time range', async () => {
    const range = timeRange('2026-01-27T00:00:00Z', '2026-01-27T23:59:59Z');
    const scopedVars = { symbol: { text: 'AAPL', value: 'AAPL' } };
    fetch.mockReturnValue(of({ data: [] }));

    await datasource.metricFindQuery('select * from trades where symbol = "$symbol" and time between $__timeFilter', { range, scopedVars });

    expect(replace).toHaveBeenCalledWith(
      'select * from trades where symbol = "$symbol" and time between pair(2026.01.27 00:00:00.000, 2026.01.27 23:59:59.000)',
      scopedVars,
      expect.any(Function)
    );
  });

  it('expands time filters identically in panel and variable queries without changing the range', async () => {
    const range = timeRange('2026-01-27T00:00:00Z', '2026-01-27T23:59:59Z');
    const before = [range.from.format(), range.to.format()];
    const queryText = 'select addTime from trades where addTime between $__timeFilter';
    const panelQuery = jest.spyOn(DataSourceWithBackend.prototype, 'query').mockReturnValue(of({ data: [] }));
    fetch.mockReturnValue(of({ data: [] }));

    try {
      await firstValueFrom(datasource.query({
        range, scopedVars: {}, timezone: 'utc', targets: [{ refId: 'A', queryText, is_streaming: false }],
      } as DataQueryRequest<DdbDataQuery>));
      await datasource.metricFindQuery(queryText, { range });

      const panelRequest = panelQuery.mock.calls[0][0] as DataQueryRequest<DdbDataQuery>;
      expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ data: { query: panelRequest.targets[0].queryText } }));
      expect(panelRequest.targets[0].queryText).toContain('pair(2026.01.27 00:00:00.000, 2026.01.27 23:59:59.000)');
      expect([range.from.format(), range.to.format()]).toEqual(before);
    } finally {
      panelQuery.mockRestore();
    }
  });

  it.each([
    [{ data: { error: 'table contains more than one column' } }, 'table contains more than one column'],
    [{ data: { message: 'Data source not found' } }, 'Data source not found'],
    [{ data: 'Database unavailable' }, 'Database unavailable'],
    [{ message: 'Network error' }, 'Network error'],
    [{ statusText: 'Not Found' }, 'Not Found'],
    [new Error('Query failed'), 'Query failed'],
    [{}, 'Variable query failed'],
  ])('reports a readable error for %p', async (error, message) => {
    fetch.mockReturnValue(throwError(() => error));
    await expect(datasource.metricFindQuery('bad query', {})).rejects.toThrow(message);
  });

  it('rejects malformed responses instead of leaving the preview pending', async () => {
    fetch.mockReturnValue(of({ data: {} }));
    await expect(datasource.metricFindQuery('1', {})).rejects.toThrow();
  });
});
