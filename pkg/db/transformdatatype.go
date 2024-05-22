package db

import (
	"errors"
	"reflect"
	"time"

	"github.com/davecgh/go-spew/spew"
	"github.com/dolphindb/api-go/model"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// 类型映射，将 model.DataType 映射到对应的 Go 类型
var typeMap = map[model.DataTypeByte]reflect.Type{
	model.DtDate:   reflect.TypeOf(time.Time{}),
	model.DtTime:   reflect.TypeOf(time.Time{}),
	model.DtDouble: reflect.TypeOf(float64(0)),
	model.DtSymbol: reflect.TypeOf("string"),
	// 不知道为什么会出现一个 SymbolExtend
	145: reflect.TypeOf("string"),
}

// convertValue 将值转换为指定类型
func convertValue(val interface{}, vectorType model.DataTypeByte) (reflect.Value, error) {

	// 通用转换逻辑，只进行数据转换，不额外操作
	targetType, ok := typeMap[vectorType]
	if !ok {
		return reflect.Value{}, errors.New("unsupported data type")
	}
	value := reflect.ValueOf(val)
	if !value.Type().ConvertibleTo(targetType) {
		return reflect.Value{}, errors.New("type assertion failed")
	}
	return value.Convert(targetType), nil
}

// convertSlice 转换切片中的元素类型
func convertSlice(input []interface{}, vectorType model.DataTypeByte) (interface{}, error) {

	// 通用转换逻辑，只进行数据转换，不额外操作
	// 根据类型映射进行转换
	targetType, ok := typeMap[vectorType]
	if !ok {
		return nil, errors.New("unsupported vector type")
	}
	output := reflect.MakeSlice(reflect.SliceOf(targetType), len(input), len(input))
	for i, val := range input {
		convertedValue, err := convertValue(val, vectorType)
		if err != nil {
			return nil, err
		}
		output.Index(i).Set(convertedValue)
	}
	return output.Interface(), nil
}

// TransformVector 将 Vector 转换为一个包含具体类型元素的切片
func TransformVector(vector *model.Vector) (interface{}, error) {
	// 获取类型
	vectorType := vector.GetDataType()
	vectorValue := vector.GetRawValue()
	vectorTypeString := vector.GetDataTypeString()

	// 用于调试数据类型转换
	log.DefaultLogger.Debug(spew.Sdump(vectorType))
	log.DefaultLogger.Debug(spew.Sdump(vectorTypeString))

	return convertSlice(vectorValue, vectorType)
}
