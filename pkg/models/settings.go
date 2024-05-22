package models

import (
	"encoding/json"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type PluginSettings struct {
	Path     string   `json:"path"`
	JSONData JSONData `json:"jsonData"`
}

type JSONData struct {
	Autologin bool   `json:"autologin"`
	Password  string `json:"password"`
	Python    bool   `json:"python"`
	URL       string `json:"url"`
	Username  string `json:"username"`
	Verbose   bool   `json:"verbose"`
}

func LoadPluginSettings(source backend.DataSourceInstanceSettings) (*PluginSettings, error) {
	settings := PluginSettings{}
	err := json.Unmarshal(source.JSONData, &settings.JSONData)
	if err != nil {
		return nil, fmt.Errorf("could not unmarshal PluginSettings json: %w", err)
	}

	return &settings, nil
}