import { DataSourceInstanceSettings } from '@grafana/data';
import { getBackendSrv, setBackendSrv, setTemplateSrv } from '@grafana/runtime';
import { of, throwError } from 'rxjs';

import { DataSource } from './datasource';
import { DataSourceOptions } from './types';

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
