import { DataSourceInstanceSettings, CoreApp, DataQueryResponse, MetricFindValue, DataQueryRequest, LiveChannelScope, LegacyMetricFindQueryOptions, TimeRange, dateTime } from '@grafana/data';
import { DataSourceWithBackend, getGrafanaLiveSrv, getTemplateSrv } from '@grafana/runtime';

import { DdbDataQuery, DataSourceOptions, DEFAULT_QUERY, IQueryRespData } from './types';
import { isQueryConfigured } from './queryUtils';
import { Observable } from 'rxjs';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc)
dayjs.extend(timezone)

type GrafanaTimezone = 'browser' | 'utc' | string

// export const nulls = [
//   -0x80,  // -128
//   -0x80_00,  // -32768
//   -0x80_00_00_00,  // -21_4748_3648
//   -0x80_00_00_00_00_00_00_00n,  // -922_3372_0368_5477_5808
//   -0x80_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00n,  // -170_1411_8346_0469_2317_3168_7303_7158_8410_5728
//   -9223372036854776000, // long
//   -3.4028234663852886e+38,
//   /** -Number.MAX_VALUE */
//   -Number.MAX_VALUE,
//   Uint8Array.from(
//     new Array(16).fill(0)
//   )
// ]

export class DataSource extends DataSourceWithBackend<DdbDataQuery, DataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<DataSourceOptions>) {
    console.log(instanceSettings)
    super(instanceSettings);
  }

  query(request: DataQueryRequest<DdbDataQuery>): Observable<DataQueryResponse> {
    const { range, scopedVars } = request
    const { timezone } = request

    // 非流
    const commonQueriesTargets = request.targets.filter(query => !query.is_streaming).map(query => {
      const code = query.queryText ?? '';
      const tplsrv = getTemplateSrv();
      const code_ = tplsrv
        .replace(
          replaceTimeFilter(code, range) //@ts-ignore
            .replaceAll(
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
          data = { ...data, data: convertQueryRespTime(data.data ,timezone) }
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
          if (!isHaveStreamingQuery) {
            subscriber.complete();
          }
        }
      });

      const isHide = streamingQueries.map(e => e.hide ?? false);

      /**
       * 处理流数据
       */
      const observables = streamingQueries.map((query) => {
        // Grafana 12.4+ renamed LiveChannelAddress.namespace to .stream, pass both for compatibility
        const addr = {
          scope: LiveChannelScope.DataSource,
          namespace: this.uid,
          stream: this.uid,
          path: `streaming-${query.refId}-${query.streaming?.table ?? ''}`,
          data: {
            ...query,
          },
        } as any;
        return getGrafanaLiveSrv().getDataStream({ addr });
      });

      const subscribes = observables.map((ob, index) => {
        return ob.subscribe({
          next(data) {
            data = { ...data, data: convertQueryRespTime(data.data, timezone) }
            // 将数据传递给上层的 subscriber
            if (!isHide[index]) {
              subscriber.next(data);
            }
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

  override async metricFindQuery(query: string, options: LegacyMetricFindQueryOptions = {}): Promise<MetricFindValue[]> {
    const queryText = getTemplateSrv().replace(replaceTimeFilter(query, options.range), options.scopedVars ?? {}, var_formatter)

    try {
      // Let Grafana select the supported resource route using the datasource UID.
      const values = await this.postResource<MetricFindValue[]>('metricFindQuery', { query: queryText });
      return values.map(e => {
        if (isValidISO8601(e?.value ?? "")) {
          const trueTime = timestampConvert(dayjs(e.value ?? 0).valueOf(), 'browser');
          const trueTimeObj = dayjs(trueTime);
          return {
            text: trueTimeObj.format(),
            value: trueTimeObj.toISOString()
          }
        }
        return e;
      });
    } catch (error) {
      // Fetch errors are plain objects; variable previews need an Error with a message.
      if (error instanceof Error) {
        throw error;
      }
      const response = error as { data?: { error?: unknown; message?: unknown } | string; message?: unknown; statusText?: unknown } | null;
      const messages = [
        typeof response?.data === 'string' ? response.data : response?.data?.error,
        typeof response?.data === 'object' ? response.data?.message : undefined,
        response?.message,
        response?.statusText,
        error,
      ];
      const message = messages.find(value => typeof value === 'string' && value.trim().length > 0);
      throw new Error(typeof message === 'string' ? message : 'Variable query failed');
    }
  }

  // applyTemplateVariables(query: MyQuery, scopedVars: ScopedVars): Record<string, any> {
  //   return {
  //     ...query,
  //     queryText: getTemplateSrv().replace(query.queryText, scopedVars),
  //   };
  // }

  filterQuery(query: DdbDataQuery): boolean {
    return isQueryConfigured(query);
  }
}

function replaceTimeFilter(query: string, range?: TimeRange): string {
  if (!range) {
    return query;
  }

  // Preserve panel time formatting on copies so Grafana's shared range is not mutated.
  const from = dateTime(range.from);
  const to = dateTime(range.to);
  (from as any)._isUTC = false;
  (to as any)._isUTC = false;
  return query.replace(/\$(__)?timeFilter\b/g, () =>
    `pair(${from.format('YYYY.MM.DD HH:mm:ss.SSS')}, ${to.format('YYYY.MM.DD HH:mm:ss.SSS')})`
  );
}

// 迁移过来的格式化函数，用于变量查询
function var_formatter(value: string | string[], variable: any, default_formatter: Function) {
  if (typeof value === 'string') {
    return value
  }

  if(Array.isArray(value)){
    return JSON.stringify(value)
  }

  return JSON.stringify(value)
}

function convertQueryRespTime(data: IQueryRespData, targetTimezone: GrafanaTimezone) {
  return data.map(item => {
    return {
      ...item, fields: item.fields.map(field => {
        if (field.type === 'time') {
          return { ...field, values: field.values.map((t: number | null) => { return t?timestampConvert(t, targetTimezone): null }) }
        } return field
      })
    }
  })
}

function timestampConvert(timestamp: number, targetTimezone: GrafanaTimezone) {
  let target = targetTimezone
  if(targetTimezone === 'browser'){
    target = dayjs.tz.guess()
  }
  const time = dayjs(timestamp)
  const timeString = time.utc().format('YYYY-MM-DD HH:mm:ss:SSS')
  const trueTime = dayjs.tz(timeString, target) // @ts-ignore
  const trueTimestramp = trueTime.$d.getTime();
  return trueTimestramp
}

function isValidISO8601(value: string | number): boolean {
  const regex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
  return regex.test(value.toString());
}
