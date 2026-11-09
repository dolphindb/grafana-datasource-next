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

// Kept for the scaffolded editor components that still use the old names.
export interface MyQuery extends DdbDataQuery {
  constant?: number
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
export interface DataSourceOptions extends DataSourceJsonData {
  path?: string
  url?: string
  autologin?: boolean
  username?: string
  /** @deprecated Read only for migration; save passwords in secureJsonData.password. */
  password?: string
  python?: boolean
  verbose?: boolean
  poolCapacity?: string
}

export type MyDataSourceOptions = DataSourceOptions

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface DataSourceSecureJsonData {
  password?: string;
}

export type MySecureJsonData = DataSourceSecureJsonData

interface IQueryDataField {
  config: {}
  labels: string
  name: string
  state: {} | null
  type: string
  values: Array<any>
}

export interface IQueryResp {
  fields: IQueryDataField[]
}

export type IQueryRespData = IQueryResp[]
