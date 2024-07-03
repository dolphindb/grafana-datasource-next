import { DataSourceInstanceSettings, CoreApp, DataQueryResponse, MetricFindValue, DataQueryRequest, LiveChannelScope } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv, getGrafanaLiveSrv, getTemplateSrv } from '@grafana/runtime';

import { DdbDataQuery, DataSourceOptions, DEFAULT_QUERY, IQueryRespData } from './types';
import { Observable, merge, retry } from 'rxjs';

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

      /**
       * 处理非流数据
       */
      const commonRequest = { ...request, targets: commonQueriesTargets };
      const result = super.query(commonRequest);

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

      return merge(result,...observables)
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
    {return value}

  if (Array.isArray(variable))
    {return JSON.stringify(variable)}

  return default_formatter(value, 'json', variable)
}

function convertQueryRespTime(data: IQueryRespData) {
  return data.map(item => {
    return {
      ...item, fields: item.fields.map(field => {
        if (field.type === 'time') {
          return { ...field, values: field.values.map((t: number) => timestampToUTC(t)) }
        } return field
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
