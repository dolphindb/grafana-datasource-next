package db

import (
	"errors"

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
	frame := data.NewFrame("response")
	return frame, errors.New("unable to determine the data type of dataform")
}

func transformTable(table *model.Table) *data.Frame {
	// columns count
	columns := table.Columns()
	rows := table.ColNames

	frame := data.NewFrame("response")

	log.DefaultLogger.Info("Frame")
	log.DefaultLogger.Info(spew.Sdump(frame))

	for i := 0; i < columns; i++ {
		columnData := table.GetColumnByIndex(i)
		columnValues, err := TransformVector(columnData)
		if err != nil {
			log.DefaultLogger.Error("column transform error, %v", err)
		} else {
			frame.Fields = append(frame.Fields, data.NewField(rows[i], nil, columnValues))
		}
	}

	return frame
}
