import { DataSourceInstanceSettings, CoreApp, DataQueryResponse, MetricFindValue, DataQueryRequest, LiveChannelScope } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv, getGrafanaLiveSrv, getTemplateSrv } from '@grafana/runtime';

import { DdbDataQuery, DataSourceOptions, DEFAULT_QUERY, IQueryRespData } from './types';
import { Observable, retry } from 'rxjs';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc)
dayjs.extend(timezone)

export class DataSource extends DataSourceWithBackend<DdbDataQuery, DataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<DataSourceOptions>) {
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
    const isHaveStreamingQuery = streamingQueries.length > 0

    return new Observable<DataQueryResponse>(subscriber => {
      /**
       * 处理非流数据
       */
      const commonRequest = { ...request, targets: commonQueriesTargets };
      const result = super.query(commonRequest);
      // 订阅 result 并将其数据传递给上层的 subscriber
      result.subscribe({
        next(data) {
          data = { ...data, data: convertQueryRespTime(data.data) }
          // 将数据传递给上层的 subscriber
          subscriber.next(data);
        },
        error(err) {
          // 传递错误给上层的 subscriber
          subscriber.error(err);
        },
        complete() {
          // 通知上层的 subscriber 数据流已完成
          // 有流数据共存的情况，这里会怎样？
          // 有流数据就不能 complete，在数据源只有 DDB 的时候问题不大，但是要是 Mixed 就不能同时存在任何流数据
          // 这是 Grafana 设计的 bug，Mixed 必须要 subscriber.complete 才能完成查询，否则一直 pending
          // 但是流数据又要求不能将 subscriber complete, 否则接受不了后面的数据
          if (!isHaveStreamingQuery)
            subscriber.complete();
        }
      });

      const isHide = streamingQueries.map(e => e.hide ?? false);

      /**
       * 处理流数据
       */
      const observables = streamingQueries.map((query) => {
        return getGrafanaLiveSrv().getDataStream({
          addr: {
            scope: LiveChannelScope.DataSource,
            namespace: this.uid,
            path: `ws/streaming-${query.refId}-${query.streaming?.table ?? ''}`,
            data: {
              ...query,
            },
          },
        });
      });

      const subscribes = observables.map((ob, index) => {
        return ob.subscribe({
          next(data) {
            data = { ...data, data: convertQueryRespTime(data.data) }
            // 将数据传递给上层的 subscriber
            if (!isHide[index])
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

      return () => {
        // 取消流数据的订阅
        subscribes.forEach(sub => sub.unsubscribe())
      }

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
          const converted = metricFindValues.map(e => {
            if (isValidISO8601(e?.value ?? "")) {
              const trueTime = timestampToUTC(dayjs(e.value ?? 0).valueOf());
              const trueTimeObj = dayjs(trueTime);
              return {
                text: trueTimeObj.format(),
                value: trueTimeObj.toISOString()
              }
            }
            return e;
          })
          console.log(converted)
          res(converted)
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
    // return !!query.queryText;
    return true;
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

function convertQueryRespTime(data: IQueryRespData) {
  return data.map(item => {
    return {
      ...item, fields: item.fields.map(field => {
        if (field.type === 'time') {
          return { ...field, values: field.values.map((t: number) => timestampToUTC(t)) }
        } return {
          ...field, values: field.values.map((item) => {
            if (item === "__DDB_DS_UDT" || item === "__DDB_DS_TAF") {
              return null
            }
            return item;
          })
        }
      })
    }
  })
}

function timestampToUTC(timestamp: number) {
  const time = dayjs(timestamp)
  const timeString = time.utc().format('YYYY-MM-DD HH:mm:ss:SSS')
  const trueTime = dayjs(timeString).tz(dayjs.tz.guess(), true)
  return trueTime.valueOf()
}

function isValidISO8601(value: string | number): boolean {
  const regex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
  return regex.test(value.toString());
}