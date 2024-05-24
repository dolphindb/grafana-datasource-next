package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"path"
	"time"

	"github.com/davecgh/go-spew/spew"
	"github.com/dolphin-db/dolphindb-datasource/pkg/db"
	"github.com/dolphin-db/dolphindb-datasource/pkg/models"
	// "github.com/dolphin-db/dolphindb-datasource/pkg/websocket"
	"github.com/dolphindb/api-go/api"
	"github.com/dolphindb/api-go/model"
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
	// create response struct
	response := backend.NewQueryDataResponse()

	// loop over queries and execute them individually.
	for _, q := range req.Queries {
		res := d.query(ctx, req.PluginContext, q)

		// save the response in a hashmap
		// based on with RefID as identifier
		response.Responses[q.RefID] = res
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

func (d *Datasource) query(_ context.Context, pCtx backend.PluginContext, query backend.DataQuery) backend.DataResponse {
	var response backend.DataResponse

	// Unmarshal the JSON into our queryModel.
	var qm queryModel

	err := json.Unmarshal(query.JSON, &qm)

	// ！！重要：处理错误的示例
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("json unmarshal: %v", err.Error()))
	}

	log.DefaultLogger.Info("Run Query %s", qm.QueryText)
	// 如果是隐藏的，那就返回一个空响应
	if qm.Hide {
		return response
	}
	// 这是用来展示插件配置文件的
	// log.DefaultLogger.Info("Lets see plugin context")
	// log.DefaultLogger.Info(spew.Sdump(pCtx))
	// 这是用来展示查询时间的
	// log.DefaultLogger.Info("Time Range From:", "from", fmt.Sprintf("%v", query.TimeRange.From))
	// log.DefaultLogger.Info("Time Range To:", "to", fmt.Sprintf("%v", query.TimeRange.To))

	config, err := parseJSONData(pCtx.DataSourceInstanceSettings.JSONData)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error parsing datasource settings: %v", err.Error()))
	}

	conn, err := db.GetDatasource(pCtx.DataSourceInstanceSettings.UID, config)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error getting datasource: %v", err.Error()))
	}

	// tb, err := conn.RunScript(fmt.Sprintf("select * from loadTable('%s','%s')", "dfs://StockDB", "stockPrices"))
	task := &api.Task{Script: qm.QueryText}
	err = conn.Execute([]*api.Task{task})
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error run query task: %v", err.Error()))
	}
	var data model.DataForm
	if task.IsSuccess() {
		data = task.GetResult()
		// log.DefaultLogger.Debug("Task Result %s", spew.Sdump(data))
	} else {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error run query task: %v", task.GetError()))
	}
	df := data

	// create data frame response.
	// For an overview on data frames and how grafana handles them:
	// https://grafana.com/developers/plugin-tools/introduction/data-frames
	frame, err := db.TransformDataForm(df)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("Error transforming dataform: %v", err.Error()))
	}

	// add the frames to the response.
	response.Frames = append(response.Frames, frame)

	return response
}

// CheckHealth handles health checks sent from Grafana to the plugin.
// The main use case for these health checks is the test button on the
// datasource configuration page which allows users to verify that
// a datasource is working as expected.
func (d *Datasource) CheckHealth(_ context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	res := &backend.CheckHealthResult{}
	config, err := models.LoadPluginSettings(*req.PluginContext.DataSourceInstanceSettings)

	if err != nil {
		res.Status = backend.HealthStatusError
		res.Message = "Unable to load settings"
		return res, nil
	}

	log.DefaultLogger.Info("The Config is")
	log.DefaultLogger.Info(spew.Sdump(config))
	// if config.Secrets.ApiKey == "" {
	// 	res.Status = backend.HealthStatusError
	// 	res.Message = "API key is missing"
	// 	return res, nil
	// }

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

		// 获取连接
		conn, err := db.GetDatasource(req.PluginContext.DataSourceInstanceSettings.UID, config)
		if err != nil {
			log.DefaultLogger.Error("Error getting datasource: %v", err)
			return sendErrorResponse(sender, http.StatusBadRequest, err)
		}

		// 执行查询
		queryModel, err := parseMetricFindQueryJSONData(req.Body)
		if err != nil {
			log.DefaultLogger.Error("Error parse metric find query: %v", err)
			return sendErrorResponse(sender, http.StatusBadRequest, err)
		}
		task := &api.Task{Script: queryModel.Query}
		err = conn.Execute([]*api.Task{task})
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

func (d *Datasource) RunStream(ctx context.Context, req *backend.RunStreamRequest, sender *backend.StreamSender) error {

	log.DefaultLogger.Debug("Run Stream Request")
	// Unmarshal the JSON into our queryModel.
	var qm queryModel

	err := json.Unmarshal(req.Data, &qm)
	if err != nil {
		log.DefaultLogger.Error("Streaming request JSON Parse Error")
	}
	log.DefaultLogger.Debug(spew.Sdump(qm))
	s := rand.NewSource(time.Now().UnixNano())
	r := rand.New(s)

	ticker := time.NewTicker(time.Duration(1000) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.DefaultLogger.Debug("Context Done")
			return ctx.Err()
		case <-ticker.C:
			// we generate a random value using the intervals provided by the frontend
			randomValue := r.Float64()*(10-1) + 1

			// log.DefaultLogger.Debug("Send Stream")
			err := sender.SendFrame(
				data.NewFrame(
					"response",
					data.NewField("time", nil, []time.Time{time.Now()}),
					data.NewField("value", nil, []float64{randomValue})),
				data.IncludeAll,
			)

			if err != nil {
				log.DefaultLogger.Error("Failed send frame", "error", err)
			}
		}
	}
}
