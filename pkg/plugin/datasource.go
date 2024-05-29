package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"path"
	"reflect"
	"strconv"
	"sync"
	"time"

	// "github.com/davecgh/go-spew/spew"
	"github.com/dolphin-db/dolphindb-datasource/pkg/db"
	"github.com/dolphin-db/dolphindb-datasource/pkg/models"

	// "github.com/dolphin-db/dolphindb-datasource/pkg/websocket"
	"github.com/dolphindb/api-go/api"
	"github.com/dolphindb/api-go/model"
	"github.com/dolphindb/api-go/streaming"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// Make sure Datasource implements required interfaces. This is important to do
// since otherwise we will only get a not implemented error response from plugin in
// runtime. In this example datasource instance implements backend.QueryDataHandler,
// backend.CheckHealthHandler interfaces. Plugin should not implement all these
// interfaces - only those which are required for a particular task.
var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
	_ backend.StreamHandler         = (*Datasource)(nil) // Streaming data source needs to implement this
)

// NewDatasource creates a new datasource instance.
func NewDatasource(_ context.Context, s backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	settings, err := getDatasourceSettings(s)
	if err != nil {
		return nil, err
	}

	return &Datasource{
		channelPrefix: path.Join("ds", s.UID),
		uri:           settings.URI,
	}, nil
}

func getDatasourceSettings(s backend.DataSourceInstanceSettings) (*Options, error) {
	settings := &Options{}

	if err := json.Unmarshal(s.JSONData, settings); err != nil {
		return nil, err
	}

	return settings, nil
}

// Datasource is an example datasource which can respond to data queries, reports
// its health and has streaming skills.
type Datasource struct {
	channelPrefix string
	uri           string
}

type Options struct {
	URI string `json:"uri"`
}

// Dispose here tells plugin SDK that plugin wants to clean up resources when a new instance
// created. As soon as datasource settings change detected by SDK old datasource instance will
// be disposed and a new one will be created using NewSampleDatasource factory function.
func (d *Datasource) Dispose() {
	// Clean up datasource instance resources.
}

// QueryData handles multiple queries and returns multiple responses.
// req contains the queries []DataQuery (where each query contains RefID as a unique identifier).
// The QueryDataResponse contains a map of RefID to the response for each query, and each response
// contains Frames ([]*Frame).
func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {

	// 旧的查询方式，留作参考
	// create response struct
	// response := backend.NewQueryDataResponse()

	// // loop over queries and execute them individually.
	// for _, q := range req.Queries {
	// 	res := d.query(ctx, req.PluginContext, q)

	// 	// save the response in a hashmap
	// 	// based on with RefID as identifier
	// 	response.Responses[q.RefID] = res
	// }

	// return response, nil
	// 参考结束

	// create response struct
	response := backend.NewQueryDataResponse()
	var mu sync.Mutex // mutex to protect concurrent access to response

	// parse datasource settings once
	config, err := parseJSONData(req.PluginContext.DataSourceInstanceSettings.JSONData)
	if err != nil {
		return nil, err
	}

	// create a slice to hold all tasks
	tasks := make([]*api.Task, len(req.Queries))
	queryMap := make(map[*api.Task]backend.DataQuery)

	// create tasks for all queries
	for i, q := range req.Queries {
		var qm queryModel
		err := json.Unmarshal(q.JSON, &qm)
		if err != nil {
			response.Responses[q.RefID] = backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("json unmarshal: %v", err.Error()))
		}

		// skip hidden queries
		if qm.Hide {
			continue
		}

		task := &api.Task{Script: qm.QueryText}
		tasks[i] = task
		queryMap[task] = q
	}

	// execute all tasks in parallel using the connection pool

	err = db.RunPoolTasks(tasks, req.PluginContext.DataSourceInstanceSettings.UID, config)
	if err != nil {
		return nil, err
	}

	// process results
	for _, task := range tasks {
		if task == nil {
			continue
		}

		q := queryMap[task]
		var res backend.DataResponse

		if task.IsSuccess() {
			data := task.GetResult()
			frame, err := db.TransformDataForm(data, fmt.Sprintf("Response %s", q.RefID))
			if err != nil {
				res = backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error transforming dataform: %v", err.Error()))
			} else {
				res.Frames = append(res.Frames, frame)
			}
		} else {
			res = backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error run query task: %v", task.GetError()))
		}

		mu.Lock()
		response.Responses[q.RefID] = res
		mu.Unlock()
	}

	return response, nil
}

type queryModel struct {
	QueryText     string     `json:"queryText"`
	Constant      float64    `json:"constant"` // 保持 float64 类型
	Datasource    Datasource `json:"datasource"`
	IntervalMs    int        `json:"intervalMs"`
	MaxDataPoints int        `json:"maxDataPoints"`
	RefID         string     `json:"refId"`
	Hide          bool       `json:"hide"`
	Streaming     struct {
		Table  string `json:"table"`
		Action string `json:"action,omitempty"`
	} `json:"streaming,omitempty"`
}

func parseJSONData(jsonData json.RawMessage) (db.DBConfig, error) {
	var config db.DBConfig
	err := json.Unmarshal(jsonData, &config)
	return config, err
}

type metricFindQueryModel struct {
	Query string `json:"query"`
}

func parseMetricFindQueryJSONData(jsonData json.RawMessage) (metricFindQueryModel, error) {
	var queryModel metricFindQueryModel
	err := json.Unmarshal(jsonData, &queryModel)
	return queryModel, err
}

// 现在不用这种串行的查询了，全部注释掉，用于参考
// func (d *Datasource) query(_ context.Context, pCtx backend.PluginContext, query backend.DataQuery) backend.DataResponse {
// 	var response backend.DataResponse

// 	// Unmarshal the JSON into our queryModel.
// 	var qm queryModel

// 	err := json.Unmarshal(query.JSON, &qm)

// 	// ！！重要：处理错误的示例
// 	if err != nil {
// 		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("json unmarshal: %v", err.Error()))
// 	}

// 	log.DefaultLogger.Info("Run Query %s", qm.QueryText)
// 	// 如果是隐藏的，那就返回一个空响应
// 	if qm.Hide {
// 		return response
// 	}
// 	// 这是用来展示插件配置文件的
// 	// log.DefaultLogger.Info("Lets see plugin context")
// 	// log.DefaultLogger.Info(spew.Sdump(pCtx))
// 	// 这是用来展示查询时间的
// 	// log.DefaultLogger.Info("Time Range From:", "from", fmt.Sprintf("%v", query.TimeRange.From))
// 	// log.DefaultLogger.Info("Time Range To:", "to", fmt.Sprintf("%v", query.TimeRange.To))

// 	config, err := parseJSONData(pCtx.DataSourceInstanceSettings.JSONData)
// 	if err != nil {
// 		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error parsing datasource settings: %v", err.Error()))
// 	}

// 	conn, err := db.GetDatasource(pCtx.DataSourceInstanceSettings.UID, config)
// 	if err != nil {
// 		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error getting datasource: %v", err.Error()))
// 	}

// 	// tb, err := conn.RunScript(fmt.Sprintf("select * from loadTable('%s','%s')", "dfs://StockDB", "stockPrices"))
// 	task := &api.Task{Script: qm.QueryText}
// 	err = conn.Execute([]*api.Task{task})
// 	if err != nil {
// 		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error run query task: %v", err.Error()))
// 	}
// 	var data model.DataForm
// 	if task.IsSuccess() {
// 		data = task.GetResult()
// 		// log.DefaultLogger.Debug("Task Result %s", spew.Sdump(data))
// 	} else {
// 		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error run query task: %v", task.GetError()))
// 	}
// 	df := data

// 	// create data frame response.
// 	// For an overview on data frames and how grafana handles them:
// 	// https://grafana.com/developers/plugin-tools/introduction/data-frames
// 	frame, err := db.TransformDataForm(df)
// 	if err != nil {
// 		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error transforming dataform: %v", err.Error()))
// 	}

// 	// add the frames to the response.
// 	response.Frames = append(response.Frames, frame)

// 	return response
// }

// CheckHealth handles health checks sent from Grafana to the plugin.
// The main use case for these health checks is the test button on the
// datasource configuration page which allows users to verify that
// a datasource is working as expected.
func (d *Datasource) CheckHealth(_ context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	res := &backend.CheckHealthResult{}
	config, err := models.LoadPluginSettings(*req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		res.Status = backend.HealthStatusError
		res.Message = "Settings parse error"
		return res, nil
	}
	conn, err := db.GetDatasourceSimpleConn(req.PluginContext.DataSourceInstanceSettings.UID, db.DBConfig(config.JSONData))
	if err != nil {
		res.Status = backend.HealthStatusError
		res.Message = fmt.Sprintf("Database connect error: %s", err.Error())
		return res, nil
	}

	// 测试一下执行语句
	_, err = conn.RunScript("1")
	if err != nil {
		res.Status = backend.HealthStatusError
		res.Message = fmt.Sprintf("Database test error: %s", err.Error())
		return res, nil
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Data source is working",
	}, nil
}

func (d *Datasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	if req.Path == "metricFindQuery" {
		// 这里处理 metricFindQuery 的逻辑

		// Plugin Config
		config, err := parseJSONData(req.PluginContext.DataSourceInstanceSettings.JSONData)
		if err != nil {
			log.DefaultLogger.Error("Error parsing JSONData: %v", err)
			return sendErrorResponse(sender, http.StatusBadRequest, err)
		}

		// 执行查询
		queryModel, err := parseMetricFindQueryJSONData(req.Body)
		if err != nil {
			log.DefaultLogger.Error("Error parse metric find query: %v", err)
			return sendErrorResponse(sender, http.StatusBadRequest, err)
		}
		task := &api.Task{Script: queryModel.Query}
		err = db.RunPoolTasks([]*api.Task{task}, req.PluginContext.DataSourceInstanceSettings.UID, config)
		if err != nil {
			log.DefaultLogger.Error("Error run task: %v", err)
			return sendErrorResponse(sender, http.StatusBadRequest, err)
		}
		var df model.DataForm
		if task.IsSuccess() {
			df = task.GetResult()
		} else {
			log.DefaultLogger.Error("Error run task: %v", task.GetError())
			return sendErrorResponse(sender, http.StatusBadRequest, task.GetError())
		}
		// 先看看数据再说
		values, err := db.TransformDataFormToValues(df)
		if err != nil {
			log.DefaultLogger.Error(err.Error())
			return sendErrorResponse(sender, http.StatusBadRequest, err)
		}
		data, err := json.Marshal(values)
		if err != nil {
			return sendErrorResponse(sender, http.StatusBadRequest, err)
		}

		response := backend.CallResourceResponse{
			Status: http.StatusOK,
			Body:   data,
		}
		return sender.Send(&response)
	}

	// NotFound
	return sender.Send(&backend.CallResourceResponse{
		Status: http.StatusNotFound,
	})
}

func sendErrorResponse(sender backend.CallResourceResponseSender, status int, err error) error {
	errorResponse := map[string]string{"error": err.Error()}
	data, _ := json.Marshal(errorResponse)
	response := backend.CallResourceResponse{
		Status: status,
		Body:   data,
	}
	return sender.Send(&response)
}

// 连通性检查，不知道为啥不需要
// func (d *Datasource) canConnect() bool {
// 	c, err := websocket.NewClient(d.uri)
// 	if err != nil {
// 		return false
// 	}
// 	return c.Close() == nil
// }

// SubscribeStream just returns an ok in this case, since we will always allow the user to successfully connect.
// Permissions verifications could be done here. Check backend.StreamHandler docs for more details.
func (d *Datasource) SubscribeStream(_ context.Context, req *backend.SubscribeStreamRequest) (*backend.SubscribeStreamResponse, error) {
	return &backend.SubscribeStreamResponse{
		Status: backend.SubscribeStreamStatusOK,
	}, nil
}

// PublishStream just returns permission denied in this case, since in this example we don't want the user to send stream data.
// Permissions verifications could be done here. Check backend.StreamHandler docs for more details.
func (d *Datasource) PublishStream(context.Context, *backend.PublishStreamRequest) (*backend.PublishStreamResponse, error) {
	return &backend.PublishStreamResponse{
		Status: backend.PublishStreamStatusPermissionDenied,
	}, nil
}

type Message struct {
	Time  int64   `json:"time"`
	Value float64 `json:"value"`
}

type ddbStreamingHandler struct {
	Ch chan []*data.Field
	tb (*model.Table)
}

func (handler *ddbStreamingHandler) DoEvent(msg streaming.IMessage) {

	var fields []*data.Field
	// 拼了
	for _, name := range handler.tb.ColNames {
		colVal := msg.GetValueByName(name)
		sc := colVal.(*model.Scalar).Value()
		retSlice := reflect.MakeSlice(reflect.SliceOf(reflect.TypeOf(sc)), 1, 1)
		retSlice.Index(0).Set(reflect.ValueOf(sc))
		field := data.NewField(name, nil, retSlice.Interface())
		fields = append(fields, field)
	}
	handler.Ch <- fields
}

func (d *Datasource) RunStream(ctx context.Context, req *backend.RunStreamRequest, sender *backend.StreamSender) error {

	log.DefaultLogger.Debug("Run Stream Request")
	// Unmarshal the JSON into our queryModel.
	var qm queryModel

	err := json.Unmarshal(req.Data, &qm)
	if err != nil {
		log.DefaultLogger.Error("Streaming request JSON Parse Error")
	}

	// 接下来的是订阅流数据的代码
	// 流数据订阅的 channel
	ddbChan := make(chan []*data.Field)

	config, err := parseJSONData(req.PluginContext.DataSourceInstanceSettings.JSONData)
	if err != nil {
		return err
	}

	rand.Seed(time.Now().UnixNano())

	// 随机生成 action 数字，用于区分 action
	randomNumber := rand.Intn(1000000) + 1 + time.Now().Second()

	// 将整数转换为字符串
	randomNumberStr := strconv.Itoa(randomNumber)

	// 先获取列名
	df, err := db.RunSimpleScript(fmt.Sprintf("select top 1 * from %s", qm.Streaming.Table), req.PluginContext.DataSourceInstanceSettings.UID, config)

	if err != nil {
		log.DefaultLogger.Error("Error get table structure")
		return err
	}
	tb := df.(*model.Table)

	client := streaming.NewGoroutineClient("localhost", 8101)
	// actionName, _ := uuid.NewUUID()
	// size := 1
	subscribeReq := &streaming.SubscribeRequest{
		Address:    config.URL,
		TableName:  qm.Streaming.Table,
		ActionName: fmt.Sprintf("action%s", randomNumberStr),
		Handler:    &ddbStreamingHandler{Ch: ddbChan, tb: tb},
		Offset:     -1,
		Reconnect:  true,
		// BatchSize:  &size,
		// MsgAsTable: true,
	}
	err = client.Subscribe(subscribeReq)
	if err != nil {
		log.DefaultLogger.Error("unable to subscribe streaming table")
		log.DefaultLogger.Error(fmt.Sprintf("%v", err))
	}

	log.DefaultLogger.Info("Subscribe to DB Streaming table complete.")

	for {
		select {
		case <-ctx.Done():
			// 取消流数据表订阅
			log.DefaultLogger.Debug("Streaming terminated.")
			client.UnSubscribe(subscribeReq)
			return ctx.Err()
		case chanData := <-ddbChan:
			// 收到流推送
			frame := data.NewFrame(
				fmt.Sprintf("Stream %s", qm.RefID),
			)
			frame.Fields = append(frame.Fields, chanData...)

			err := sender.SendFrame(
				frame,
				data.IncludeAll,
			)

			if err != nil {
				log.DefaultLogger.Error("Failed send frame", "error", err)
			}
		}
	}
}
