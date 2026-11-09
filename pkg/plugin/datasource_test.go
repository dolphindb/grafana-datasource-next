package plugin

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestQueryData(t *testing.T) {
	ds := Datasource{}

	resp, err := ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			PluginContext: backend.PluginContext{
				DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{
					JSONData: json.RawMessage(`{"poolCapacity":"1"}`),
				},
			},
			Queries: []backend.DataQuery{
				{RefID: "A", JSON: json.RawMessage(`{"queryText":"1"}`)},
			},
		},
	)
	if err != nil {
		t.Error(err)
	}

	if len(resp.Responses) != 1 {
		t.Fatal("QueryData must return a response")
	}
}

func TestParseDatasourceSettings(t *testing.T) {
	tests := []struct {
		name     string
		jsonData string
		secure   map[string]string
		password string
	}{
		{"secure password", `{"url":"db:8848","username":"alice","poolCapacity":"5"}`, map[string]string{"password": "secure"}, "secure"},
		{"legacy password", `{"password":"legacy"}`, nil, "legacy"},
		{"secure overrides legacy", `{"password":"legacy"}`, map[string]string{"password": "secure"}, "secure"},
		{"empty secure overrides legacy", `{"password":"legacy"}`, map[string]string{"password": ""}, ""},
		{"unrelated secret preserves legacy", `{"password":"legacy"}`, map[string]string{"other": "value"}, "legacy"},
		{"missing password", `{}`, nil, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config, err := parseDatasourceSettings(backend.DataSourceInstanceSettings{
				JSONData:                json.RawMessage(tt.jsonData),
				DecryptedSecureJSONData: tt.secure,
			})
			if err != nil {
				t.Fatal(err)
			}
			if config.Password != tt.password {
				t.Fatal("unexpected password selection")
			}
			if tt.name == "secure password" && (config.URL != "db:8848" || config.Username != "alice" || config.PoolCapacity != "5") {
				t.Fatal("non-secret connection settings were not preserved")
			}
		})
	}
}

func TestParseDatasourceSettingsRejectsInvalidJSON(t *testing.T) {
	_, err := parseDatasourceSettings(backend.DataSourceInstanceSettings{
		JSONData:                json.RawMessage(`{"url":`),
		DecryptedSecureJSONData: map[string]string{"password": "secure"},
	})
	if err == nil {
		t.Fatal("invalid settings must return an error")
	}
}
