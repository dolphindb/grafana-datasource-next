package db

import (
	// "context"
	// "fmt"
	"context"
	"fmt"
	"strconv"
	"sync"

	// "github.com/davecgh/go-spew/spew"
	"github.com/dolphindb/api-go/v3/api"
	"github.com/dolphindb/api-go/v3/model"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type DBConfig struct {
	Autologin    bool
	Password     string
	Python       bool
	URL          string
	Username     string
	Verbose      bool
	PoolCapacity string
}

type DataSourceWithPool struct {
	Conn   *api.DBConnectionPool
	Config DBConfig
}

var (
	dataSourceWithPoolMap     = make(map[string]*DataSourceWithPool)
	dataSourceWithPoolMapLock sync.RWMutex
)

// getDatasource returns a connection for the given UUID and DBConfig.
func GetDatasource(uuid string, config DBConfig) (*api.DBConnectionPool, error) {
	dataSourceWithPoolMapLock.Lock()
	defer dataSourceWithPoolMapLock.Unlock()

	// Check if the datasource already exists
	if ds, exists := dataSourceWithPoolMap[uuid]; exists {
		if ds.Config == config {
			// Config hasn't changed, return the existing connection
			log.DefaultLogger.Info("Reused Connection Pool")
			return ds.Conn, nil
		} else {
			// Config has changed, close the old connection and create a new one
			ds.Conn.Close()
			delete(dataSourceWithPoolMap, uuid)
		}
	}

	// Create a new connection
	log.DefaultLogger.Info("Connecting to Connection Pool")

	capacity, err := strconv.Atoi(config.PoolCapacity)
	if err != nil {
		return nil, fmt.Errorf("pool capacity convert to num error %v", err)
	}

	poolOpt := &api.PoolOption{
		Address:  config.URL,
		UserID:   config.Username,
		Password: config.Password,
		PoolSize: capacity,
	}
	pool, err := api.NewDBConnectionPool(poolOpt)

	if err != nil {
		log.DefaultLogger.Error("Connect to pool failed")
		return nil, err
	}
	log.DefaultLogger.Debug(fmt.Sprintf("Connected to DB connection pool with capacity %d", capacity))
	// Store the new datasource
	dataSourceWithPoolMap[uuid] = &DataSourceWithPool{
		Conn:   pool,
		Config: config,
	}

	return pool, nil
}

// 单独的 ddb 连接，轻量查询

type DataSourceWithSimpleConn struct {
	Conn   api.DolphinDB
	Config DBConfig
}

var (
	dataSourceWithSimpleConnMap     = make(map[string]*DataSourceWithSimpleConn)
	dataSourceWithSimpleConnMapLock sync.RWMutex
)

// getDatasource returns a connection for the given UUID and DBConfig.
func GetDatasourceSimpleConn(uuid string, config DBConfig) (api.DolphinDB, error) {
	dataSourceWithSimpleConnMapLock.Lock()
	defer dataSourceWithSimpleConnMapLock.Unlock()

	// Check if the datasource already exists
	if ds, exists := dataSourceWithSimpleConnMap[uuid]; exists {
		if ds.Config == config {
			// Config hasn't changed, return the existing connection
			log.DefaultLogger.Info("Reused Connection")
			return ds.Conn, nil
		} else {
			// Config has changed, close the old connection and create a new one
			ds.Conn.Close()
			delete(dataSourceWithSimpleConnMap, uuid)
		}
	}

	// Create a new connection
	log.DefaultLogger.Info("Get Connection")
	conn, err := api.NewSimpleDolphinDBClient(context.TODO(), config.URL, config.Username, config.Password)
	if err != nil {
		return nil, err
	}

	// Store the new datasource
	dataSourceWithSimpleConnMap[uuid] = &DataSourceWithSimpleConn{
		Conn:   conn,
		Config: config,
	}

	return conn, nil
}

// Example of how to use getDatasource
// func LoadTableWithDatasource(uuid, dbPath, tbName string, config DBConfig) (interface{}, error) {
// 	conn, err := GetDatasource(uuid, config)
// 	if err != nil {
// 		return nil, err
// 	}

// 	tb, err := conn.RunScript(fmt.Sprintf("select * from loadTable('%s','%s')", dbPath, tbName))
// 	if err != nil {
// 		return nil, err
// 	}

//		return tb, nil
//	}
func RunPoolTasks(tasks []*api.Task, uuid string, config DBConfig) error {
	var err error
	for i := 0; i < 3; i++ {
		conn, err1 := GetDatasource(uuid, config)
		isSuccess := true
		// 只有连接 OK 才能查询
		if err1 != nil {
			isSuccess = false

		} else {
			conn.Execute(tasks)
			for _, task := range tasks {
				if !task.IsSuccess() {
					isSuccess = false
				}
				err1 = task.GetError()
			}
		}
		if err1 == nil && isSuccess {
			// 没有错误
			return nil
		} else {
			log.DefaultLogger.Error(fmt.Sprintf("Error execute task, retring %d time", i+1))
			// 删掉这个连接，重新来
			if conn != nil {
				err1 = conn.Close()
				if err1 != nil {
					log.DefaultLogger.Error("Error close pool connection")
				}
			}
			dataSourceWithPoolMapLock.Lock()
			delete(dataSourceWithPoolMap, uuid)
			dataSourceWithPoolMapLock.Unlock()
		}
		err = err1
	}
	return err
}

func RunSimpleScript(script string, uuid string, config DBConfig) (model.DataForm, error) {
	conn, err := GetDatasourceSimpleConn(uuid, config)
	if err != nil {
		return nil, err
	}
	for i := 0; i < 3; i++ {
		result, err1 := conn.RunScript(script)
		err = err1
		if err1 != nil {
			log.DefaultLogger.Error(fmt.Sprintf("Error run script, retring %d time", i+1))
			// 删掉这个连接，重新来
			err1 = conn.Close()
			if err1 != nil {
				log.DefaultLogger.Error("Error close simple connection")
			}
			dataSourceWithSimpleConnMapLock.Lock()
			delete(dataSourceWithSimpleConnMap, uuid)
			dataSourceWithSimpleConnMapLock.Unlock()
		} else {
			return result, nil
		}
	}

	return nil, err
}
