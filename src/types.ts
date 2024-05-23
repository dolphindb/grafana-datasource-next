import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export interface DdbDataQuery extends DataQuery {
  is_streaming: boolean
  queryText?: string
  streaming?: {
      table: string
      action?: string
  }
}

export const DEFAULT_QUERY: Partial<DdbDataQuery> = {
  is_streaming: false
};

export interface DataPoint {
  Time: number;
  Value: number;
}

export interface DataSourceResponse {
  datapoints: DataPoint[];
}

/**
 * These are options configured for each DataSource instance
 */
export interface MyDataSourceOptions extends DataSourceJsonData {
  path?: string;
}

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface MySecureJsonData {
  apiKey?: string;
}
