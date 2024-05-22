package db

import (
	"errors"
	"time"

	"github.com/davecgh/go-spew/spew"
	"github.com/dolphindb/api-go/model"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// TransformVector 将 Vector 转换为一个包含具体类型元素的切片
func TransformVector(vector *model.Vector) (interface{}, error) {
	// 获取类型
	vectorType := vector.GetDataType()
	vectorValue := vector.GetRawValue()
	vectorTypeString := vector.GetDataTypeString()

	log.DefaultLogger.Info(spew.Sdump(vectorType))
	log.DefaultLogger.Info(spew.Sdump(vectorTypeString))

	// 根据类型进行转换
	switch vectorType {
	case model.DtDate:
		arr := make([]time.Time, len(vectorValue))
		for i, val := range vectorValue {
			item, ok := val.(time.Time)
			if !ok {
				return nil, errors.New("type assertion to time.Time failed")
			}
			arr[i] = item
		}
		return arr, nil
	case model.DtTime:
		arr := make([]time.Time, len(vectorValue))
		for i, val := range vectorValue {
			item, ok := val.(time.Time)
			if !ok {
				return nil, errors.New("type assertion failed")
			}
			arr[i] = item
		}
		return arr, nil
	case model.DtDouble:
		arr := make([]float64, len(vectorValue))
		for i, val := range vectorValue {
			item, ok := val.(float64)
			if !ok {
				return nil, errors.New("type assertion failed")
			}
			arr[i] = item
		}
		return arr, nil
	}

	return make([]int,len(vectorValue)), errors.New("unable to transform vector")
}
