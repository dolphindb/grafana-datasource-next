package db

import (
	"errors"
	"fmt"
	"reflect"

	"github.com/davecgh/go-spew/spew"
	"github.com/dolphindb/api-go/model"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func TransformDataForm(dataform model.DataForm) (*data.Frame, error) {
	// 获取 dataform 的类型
	dataform_type := dataform.GetDataForm()

	switch dataform_type {
	case model.DfTable:
		return transformTable(dataform.(*model.Table)), nil
	}
	// 现在只支持转换 Table
	frame := data.NewFrame("response")
	return frame, errors.New("unable to determine the data type of dataform")
}

func transformTable(table *model.Table) *data.Frame {
	// columns count
	columns := table.Columns()
	columnnames := table.ColNames

	frame := data.NewFrame("response")

	log.DefaultLogger.Info("Frame")
	log.DefaultLogger.Info(spew.Sdump(frame))

	for i := 0; i < columns; i++ {
		columnData := table.GetColumnByIndex(i)
		columnValues, err := TransformVector(columnData)
		// 如果列转换失败，那就报错，然后不把这一列返回。正常的列依然添加到 Grafana 要返回的数据中，不受影响地被展示。
		if err != nil {
			log.DefaultLogger.Error("column transform error, %v", err)
		} else {
			frame.Fields = append(frame.Fields, data.NewField(columnnames[i], nil, columnValues))
		}
	}

	return frame
}

func TransformDataFormToValues(df model.DataForm) ([]map[string]interface{}, error) {
	// 获取 dataform 的类型
	dataform_type := df.GetDataForm()

	switch dataform_type {
	case model.DfTable:
		return transformTableToValues(df.(*model.Table))
	}
	// 兜底逻辑，什么也不返回
	return []map[string]interface{}{}, errors.New("unable to transform dataform to values")
}

func transformTableToValues(tb *model.Table) ([]map[string]interface{}, error) {
	// 超过一列就报错
	if tb.Columns() > 1 {
		return []map[string]interface{}{}, errors.New("table contains more than one column")
	}

	// 只转换第一列
	columnData := tb.GetColumnByIndex(0)
	columnValues, err := TransformVector(columnData)
	if err != nil {
		return []map[string]interface{}{}, errors.New("unable to transform table to values")
	}
	values := columnValues.(interface{})

	return convertValues(values)
}

// func convert(values interface{}) []map[string]interface{} {
// 	log.DefaultLogger.Debug("Convert table to map")
// 	result := make([]map[string]interface{}, len(values))
// 	for i, v := range values {
// 		result[i] = map[string]interface{}{
// 			"text":  fmt.Sprintf("%v", v), // 将 value 转换为字符串
// 			"value": v,
// 		}
// 	}
// 	return result
// }


func convertValues(columnValues interface{}) ([]map[string]interface{}, error) {
	v := reflect.ValueOf(columnValues)
	if v.Kind() != reflect.Slice {
		return nil, fmt.Errorf("expected a slice, got %T", columnValues)
	}

	result := make([]map[string]interface{}, v.Len())
	for i := 0; i < v.Len(); i++ {
		value := v.Index(i).Interface()
		result[i] = map[string]interface{}{
			"text":  fmt.Sprintf("%v", value),
			"value": value,
		}
	}
	return result, nil
}