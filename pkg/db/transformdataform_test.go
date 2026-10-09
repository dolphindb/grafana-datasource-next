package db

import (
	"encoding/json"
	"testing"

	"github.com/dolphindb/api-go/v3/model"
)

func newTestVector(t *testing.T, datatype model.DataTypeByte, values interface{}) *model.Vector {
	t.Helper()
	list, err := model.NewDataTypeListFromRawData(datatype, values)
	if err != nil {
		t.Fatal(err)
	}
	return model.NewVector(list)
}

func newTestColumns(t *testing.T, columns ...*model.Vector) *model.Vector {
	t.Helper()
	values := make([]model.DataType, len(columns))
	for i, column := range columns {
		value, err := model.NewDataType(model.DtAny, column)
		if err != nil {
			t.Fatal(err)
		}
		values[i] = value
	}
	return model.NewVector(model.NewDataTypeList(model.DtAny, values))
}

func TestTransformDataFormToValuesSelectWithoutFrom(t *testing.T) {
	for _, tt := range []struct {
		name     string
		datatype model.DataTypeByte
		values   interface{}
		want     string
	}{
		{"string constant", model.DtString, []string{"test1"}, `[{"text":"test1","value":"test1"}]`},
		{"numeric constant", model.DtInt, []int32{1}, `[{"text":"1","value":1}]`},
		{"multiple rows", model.DtString, []string{"test1", "test2"}, `[{"text":"test1","value":"test1"},{"text":"test2","value":"test2"}]`},
		{"empty column", model.DtString, []string{}, `[]`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			column := newTestVector(t, tt.datatype, tt.values)
			// DolphinDB returns VECTOR<ANY>([VECTOR<T>(...)]) for SELECT without FROM.
			result := newTestColumns(t, column)
			values, err := TransformDataFormToValues(result)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(values)
			if err != nil {
				t.Fatal(err)
			}
			if string(encoded) != tt.want {
				t.Fatalf("got %s, want %s", encoded, tt.want)
			}
		})
	}
}

func TestTransformDataFormToValuesExistingForms(t *testing.T) {
	column := newTestVector(t, model.DtString, []string{"test1"})
	value, err := model.NewDataType(model.DtString, "test1")
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range []model.DataForm{
		column,
		model.NewTable([]string{"value"}, []*model.Vector{column}),
		model.NewScalar(value),
	} {
		t.Run(result.GetDataFormString(), func(t *testing.T) {
			values, err := TransformDataFormToValues(result)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(values)
			if err != nil {
				t.Fatal(err)
			}
			if string(encoded) != `[{"text":"test1","value":"test1"}]` {
				t.Fatalf("unexpected values: %s", encoded)
			}
		})
	}
}

func TestTransformDataFormToValuesRejectsMultipleColumns(t *testing.T) {
	column := newTestVector(t, model.DtString, []string{"test1"})
	for _, result := range []model.DataForm{
		newTestColumns(t, column, column),
		model.NewTable([]string{"a", "b"}, []*model.Vector{column, column}),
	} {
		t.Run(result.GetDataFormString(), func(t *testing.T) {
			if _, err := TransformDataFormToValues(result); err == nil {
				t.Fatal("expected an error for multiple columns")
			}
		})
	}
}

func TestTransformDataFormToValuesRejectsUnsupportedAnyVector(t *testing.T) {
	value, err := model.NewDataType(model.DtString, "test1")
	if err != nil {
		t.Fatal(err)
	}
	anyValue, err := model.NewDataType(model.DtAny, model.NewScalar(value))
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range []*model.Vector{
		newTestColumns(t),
		model.NewVector(model.NewDataTypeList(model.DtAny, []model.DataType{anyValue})),
	} {
		if _, err := TransformDataFormToValues(result); err == nil {
			t.Fatal("expected an error for an ANY vector without a column vector")
		}
	}
}
