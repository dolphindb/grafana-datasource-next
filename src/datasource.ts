import { DataSourceInstanceSettings, CoreApp, ScopedVars, DataQueryResponse, MetricFindValue } from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';

import { MyQuery, MyDataSourceOptions, DEFAULT_QUERY } from './types';
import { Observable, merge } from 'rxjs';


export class DataSource extends DataSourceWithBackend<MyQuery, MyDataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    console.log(instanceSettings)
    super(instanceSettings);
  }

  query(request: any): Observable<DataQueryResponse> {
    return super.query(request);


    /**
     * Streaming，待研究
     */
    // const observables = request.targets.map((query) => {
    //   return getGrafanaLiveSrv().getDataStream({
    //     addr: {
    //       scope: LiveChannelScope.DataSource,
    //       namespace: this.uid,
    //       path: `my-ws/custom-${query.lowerLimit}-${query.upperLimit}`, // this will allow each new query to create a new connection
    //       data: {
    //         ...query,
    //       },
    //     },
    //   });
    // });

    // return merge(...observables);
  }

  getDefaultQuery(_: CoreApp): Partial<MyQuery> {
    return DEFAULT_QUERY;
  }

  override async metricFindQuery(query: string, options: any): Promise<MetricFindValue[]> {
    console.log('metricFindQuery:', { query, options })

    return [{ text: '123', value: '123' }]
  }

  // applyTemplateVariables(query: MyQuery, scopedVars: ScopedVars): Record<string, any> {
  //   return {
  //     ...query,
  //     queryText: getTemplateSrv().replace(query.queryText, scopedVars),
  //   };
  // }

  filterQuery(query: MyQuery): boolean {
    // if no query has been provided, prevent the query from being executed
    return !!query.queryText;
  }
}
