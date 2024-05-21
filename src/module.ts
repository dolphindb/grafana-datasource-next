import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { MyQuery, MyDataSourceOptions } from './types';
import { ConfigEditor, QueryEditor, VariableEditor } from 'components/components';

export const plugin = new DataSourcePlugin(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor)
  .setVariableQueryEditor(VariableEditor);
