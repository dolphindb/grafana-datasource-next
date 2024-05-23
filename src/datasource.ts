import { DataSourceInstanceSettings, CoreApp, ScopedVars, DataQueryResponse, MetricFindValue, DataQueryRequest } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv, getTemplateSrv } from '@grafana/runtime';

import { DdbDataQuery, MyDataSourceOptions, DEFAULT_QUERY } from './types';
import { Observable, merge } from 'rxjs';


export class DataSource extends DataSourceWithBackend<DdbDataQuery, MyDataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    console.log(instanceSettings)
    super(instanceSettings);
  }

  query(request: DataQueryRequest<DdbDataQuery>): Observable<DataQueryResponse> {

    // 非流
    const commonQueries = request.targets.filter(query => !query.is_streaming);
    const streamingQueries = request.targets.filter(query => query.is_streaming);

    return new Observable<DataQueryResponse>(subscriber => {
      /**
       * 处理非流数据
       */
      const commonRequest = { ...request, query: commonQueries };
      const result = super.query(commonRequest);
      // 订阅 result 并将其数据传递给上层的 subscriber
      result.subscribe({
        next(data) {
          // 将数据传递给上层的 subscriber
          subscriber.next(data);
        },
        error(err) {
          // 传递错误给上层的 subscriber
          subscriber.error(err);
        },
        complete() {
          // 通知上层的 subscriber 数据流已完成
          // 这里不能这么做，因为还有流式数据
          // subscriber.complete();
        }
      });
    })

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

  getDefaultQuery(_: CoreApp): Partial<DdbDataQuery> {
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

  filterQuery(query: DdbDataQuery): boolean {
    // if no query has been provided, prevent the query from being executed
    return !!query.queryText;
  }
}
