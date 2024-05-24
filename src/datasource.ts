import { DataSourceInstanceSettings, CoreApp, DataQueryResponse, MetricFindValue, DataQueryRequest, LiveChannelScope } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv, getGrafanaLiveSrv, getTemplateSrv } from '@grafana/runtime';

import { DdbDataQuery, MyDataSourceOptions, DEFAULT_QUERY } from './types';
import { Observable } from 'rxjs';

export class DataSource extends DataSourceWithBackend<DdbDataQuery, MyDataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    console.log(instanceSettings)
    super(instanceSettings);
  }

  query(request: DataQueryRequest<DdbDataQuery>): Observable<DataQueryResponse> {
    const { range: { from, to }, scopedVars } = request

    // 非流
    const commonQueriesTargets = request.targets.filter(query => !query.is_streaming).map(query => {
      const code = query.queryText ?? '';
      const tplsrv = getTemplateSrv();
      (from as any)._isUTC = false;
      (to as any)._isUTC = false;
      const code_ = tplsrv
        .replace(
          code //@ts-ignore
            .replaceAll(
              /\$(__)?timeFilter\b/g,
              () =>
                'pair(' +
                from.format('YYYY.MM.DD HH:mm:ss.SSS') +
                ', ' +
                to.format('YYYY.MM.DD HH:mm:ss.SSS') +
                ')'
            ).replaceAll(
              /\$__interval\b/g,
              () =>
                tplsrv.replace('$__interval', scopedVars).replace(/h$/, 'H')
            ),
          scopedVars,
          var_formatter
        )
      return {
        ...query, queryText: code_
      }
    });
    const streamingQueries = request.targets.filter(query => query.is_streaming);

    return new Observable<DataQueryResponse>(subscriber => {
      /**
       * 处理非流数据
       */
      const commonRequest = { ...request, targets: commonQueriesTargets };
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

      /**
       * 处理流数据
       */
      const observables = streamingQueries.map((query) => {
        return getGrafanaLiveSrv().getDataStream({
          addr: {
            scope: LiveChannelScope.DataSource,
            namespace: this.uid,
            path: `ws/streaming-${query.refId}`, 
            data: {
              ...query,
            },
          },
        });
      });

      observables.forEach(ob => {
        ob.subscribe({
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
        })
      })
    })



  }

  getDefaultQuery(_: CoreApp): Partial<DdbDataQuery> {
    return DEFAULT_QUERY;
  }

  override async metricFindQuery(query: string, options: any): Promise<MetricFindValue[]> {
    console.log('metricFindQuery:', { query, options })
    const queryText = getTemplateSrv().replace(query, {}, var_formatter)

    return new Promise((res, rej) => {
      const respObservalbe = getBackendSrv().fetch({
        url: `/api/datasources/${this.id}/resources/metricFindQuery`,
        method: 'POST', data: {
          query: queryText
        }
      })

      respObservalbe.subscribe({
        next(data) {
          const metricFindValues = data.data as MetricFindValue[];
          res(metricFindValues)
        },
        error(err) {
          console.log("MFQ Error", err)
          // 传递错误给上层的 subscriber
          rej(err)
        },
      })
    })
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

// 迁移过来的格式化函数，用于变量查询
function var_formatter(value: string | string[], variable: any, default_formatter: Function) {
  if (typeof value === 'string')
    return value

  if (Array.isArray(variable))
    return JSON.stringify(variable)

  return default_formatter(value, 'json', variable)
}