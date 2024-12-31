package db

import (
	"errors"
	// "fmt"
	"reflect"
	"time"

	"github.com/davecgh/go-spew/spew"
	"github.com/dolphindb/api-go/model"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	// "github.com/grafana/grafana-plugin-sdk-go/backend/log"
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
	model.DtInt128:        reflect.TypeOf(""),
	model.DtIP:            reflect.TypeOf(""),
	model.DtPoint:         reflect.TypeOf(""),
	model.DtComplex:       reflect.TypeOf(""),
	model.DtFloat:         reflect.TypeOf(float32(0)),
	model.DtUUID:          reflect.TypeOf(""),
	// SymbolExtend 疑似没有枚举？
	145: reflect.TypeOf(""),
	// 补充
	model.DtDecimal32:  reflect.TypeOf(float64(0)),
	model.DtDecimal64:  reflect.TypeOf(float64(0)),
	model.DtDecimal128: reflect.TypeOf(""),
	model.DtBlob:       reflect.TypeOf(""),
	model.DtDuration:   reflect.TypeOf(""),
	model.DtVoid:       reflect.TypeOf(""),
}

func getNull(dt model.DataTypeByte) interface{} {
	switch dt {
	case model.DtVoid:
		return byte(0)
	case model.DtInt:
		return model.NullInt
	case model.DtChar:
		return model.NullChar
	case model.DtCompress:
		return model.NullCompress
	case model.DtBool:
		return model.NullBool
	case model.DtBlob:
		return model.NullBlob
	case model.DtComplex:
		return model.NullComplex
	case model.DtPoint:
		return model.NullPoint
	case model.DtDate,
		model.DtDateHour,
		model.DtDatetime,
		model.DtMinute,
		model.DtMonth,
		model.DtSecond,
		model.DtTime,
		model.DtNanoTime,
		model.DtNanoTimestamp,
		model.DtTimestamp:
		return model.NullTime
	case model.DtDouble:
		return model.NullDouble
	case model.DtFloat:
		return model.NullFloat
	case model.DtDuration:
		return model.NullDuration
	case model.DtLong:
		return model.NullLong
	case model.DtShort:
		return model.NullShort
	case model.DtUUID:
		return model.NullUUID
	case model.DtInt128:
		return model.NullInt
	case model.DtIP:
		return model.NullIP
	case model.DtDecimal32:
		return model.NullDecimal32Value
	case model.DtDecimal64:
		return model.NullDecimal64Value
	case model.DtDecimal128:
		return model.NullDecimal128Value
	case model.DtAny:
		return model.NullAny
	case model.DtString, model.DtCode, model.DtFunction, model.DtHandle:
		return model.NullString
	case model.DtSymbol:
		return model.NullString
	case 145:
		return model.NullString
	default:
		return nil
	}
}

func GetTypeFromMap(t model.DataTypeByte) reflect.Type {
	targetType, ok := typeMap[t]
	if !ok {
		return reflect.TypeOf("")
	}
	return targetType
}

// convertValue 将值转换为指定类型
func ConvertValue(val interface{}, dataType model.DataTypeByte) (reflect.Value, error) {

	switch dataType {
	case model.DtDecimal32:
		val = val.(*model.Decimal32).Value
	case model.DtDecimal64:
		val = val.(*model.Decimal64).Value
	case model.DtDecimal128:
		val = val.(*model.Decimal128).Value
	case model.DtBlob:
		val = string(val.([]byte))
	}

	nullVal := getNull(dataType)
	if nullVal == val {
		return reflect.Value{}, errors.New("a null value of this datatype")
	}
	// 通用转换逻辑，只进行数据转换，不额外操作
	// 如果找不到指定的数据类型或者转换失败，则报错并返回一个空值
	targetType, ok := typeMap[dataType]
	if !ok {
		log.DefaultLogger.Debug("Datatype need to support:")
		log.DefaultLogger.Debug(spew.Sdump(val))
		return reflect.Value{}, errors.New("unsupported data type")
	}

	// 获取目标类型的指针类型
	// ptrType := reflect.PtrTo(targetType)

	// 使用 reflect.ValueOf(val) 获取 val 的 reflect.Value
	valValue := reflect.ValueOf(val)

	// 确保 val 的类型可以转换为 targetType
	if !valValue.Type().ConvertibleTo(targetType) {
		return reflect.ValueOf(nil), errors.New("type assertion failed")
	}

	// 创建目标类型的指针，并将 val 转换为目标类型后赋值给该指针
	ptrValue := reflect.New(targetType).Elem()
	ptrValue.Set(valValue.Convert(targetType))

	// 返回指针类型的 reflect.Value
	return ptrValue.Addr(), nil
}

// convertSlice 转换切片中的元素类型
func ConvertSlice(input []interface{}, vectorType model.DataTypeByte) (interface{}, error) {

	// 通用转换逻辑，只进行数据转换，不额外操作
	// 根据类型映射进行转换
	targetType, ok := typeMap[vectorType]
	// 不支持的数据类型，不转换并报错
	// 上层会直接忽略这一列，不返回 Grafana，这样不影响正常的列的展示。
	if !ok {
		return nil, errors.New("unsupported vector type")
	}
	output := reflect.MakeSlice(reflect.SliceOf(reflect.PointerTo(targetType)), len(input), len(input))
	for i, val := range input {
		convertedValue, err := ConvertValue(val, vectorType)
		if err != nil {
			// 这个值就不设置了
			continue
			// return nil, err
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
	// vectorTypeString := vector.GetDataTypeString()

	// 用于调试数据类型转换
	// log.DefaultLogger.Debug(fmt.Sprintf("%d:%s", vectorType, vectorTypeString))
	// log.DefaultLogger.Debug(spew.Sdump(vectorValue[0]))

	return ConvertSlice(vectorValue, vectorType)
}
