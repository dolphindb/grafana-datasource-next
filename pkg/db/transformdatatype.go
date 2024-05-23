package db

import (
	"errors"
	"fmt"
	"reflect"
	"time"

	"github.com/davecgh/go-spew/spew"
	"github.com/dolphindb/api-go/model"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// 类型映射，将 model.DataType 映射到对应的 Go 类型
// 映射的值必须是一个 Grafana 支持的数据类型
// 简单的值可以直接用通用逻辑转换，不能用通用逻辑的，在这里写下构造切片要用的数据类型，然后去 convertValue 里面单独处理！
var typeMap = map[model.DataTypeByte]reflect.Type{
	model.DtBool:          reflect.TypeOf(true),
	model.DtString:        reflect.TypeOf(""),
	model.DtChar:          reflect.TypeOf(""),
	model.DtSymbol:        reflect.TypeOf(""),
	model.DtDate:          reflect.TypeOf(time.Time{}),
	model.DtTime:          reflect.TypeOf(time.Time{}),
	model.DtMonth:         reflect.TypeOf(time.Time{}),
	model.DtMinute:        reflect.TypeOf(time.Time{}),
	model.DtSecond:        reflect.TypeOf(time.Time{}),
	model.DtDatetime:      reflect.TypeOf(time.Time{}),
	model.DtDateHour:      reflect.TypeOf(time.Time{}),
	model.DtTimestamp:     reflect.TypeOf(time.Time{}),
	model.DtNanoTime:      reflect.TypeOf(time.Time{}),
	model.DtNanoTimestamp: reflect.TypeOf(time.Time{}),
	model.DtDouble:        reflect.TypeOf(float64(0)),
	model.DtLong:          reflect.TypeOf(int64(0)),
	model.DtShort:         reflect.TypeOf(int16(0)),
	model.DtInt:           reflect.TypeOf(int32(0)),
	model.DtFloat:         reflect.TypeOf(float32(0)),
	model.DtUUID:          reflect.TypeOf(""),
	// 不知道为什么会出现一个 SymbolExtend
	145: reflect.TypeOf(""),
}

// convertValue 将值转换为指定类型
func convertValue(val interface{}, vectorType model.DataTypeByte) (reflect.Value, error) {

	// 通用转换逻辑，只进行数据转换，不额外操作
	// 如果找不到指定的数据类型或者转换失败，则报错并返回一个空值
	targetType, ok := typeMap[vectorType]
	if !ok {
		return reflect.Value{}, errors.New("unsupported data type")
	}
	value := reflect.ValueOf(val)
	if !value.Type().ConvertibleTo(targetType) {
		return reflect.Value{}, errors.New("type assertion failed")
	}

	// 转换
	return value.Convert(targetType), nil
}

// convertSlice 转换切片中的元素类型
func convertSlice(input []interface{}, vectorType model.DataTypeByte) (interface{}, error) {

	// 通用转换逻辑，只进行数据转换，不额外操作
	// 根据类型映射进行转换
	targetType, ok := typeMap[vectorType]
	// 不支持的数据类型，不转换并报错
	// 上层会直接忽略这一列，不返回 Grafana，这样不影响正常的列的展示。
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
	log.DefaultLogger.Debug(fmt.Sprintf("%d:%s", vectorType, vectorTypeString))
	log.DefaultLogger.Debug(spew.Sdump(vectorValue[0]))

	return convertSlice(vectorValue, vectorType)
}
