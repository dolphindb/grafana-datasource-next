import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { ConfigEditor, QueryEditor, VariableEditor } from 'components/components';

export const plugin = new DataSourcePlugin(DataSource)
  .setConfigEditor(ConfigEditor) //@ts-ignore
  .setQueryEditor(QueryEditor)
  .setVariableQueryEditor(VariableEditor);
