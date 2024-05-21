package db

import (
    "context"
    "fmt"
    "sync"
    "github.com/dolphindb/api-go/api"
)

var (
    conn     api.DolphinDB
    connOnce sync.Once
    connErr  error
)

// GetDolphinDBConn returns a singleton instance of the DolphinDB connection.
func GetDolphinDBConn() (api.DolphinDB, error) {
    connOnce.Do(func() {
        conn, connErr = api.NewSimpleDolphinDBClient(context.TODO(), "localhost:8848", "admin", "123456")
    })
    return conn, connErr
}

// LoadTable loads a table from DolphinDB.
func LoadTable(dbPath, tbName string) (interface{}, error) {
    conn, err := GetDolphinDBConn()
    if err != nil {
        return nil, err
    }

    tb, err := conn.RunScript(fmt.Sprintf("select * from loadTable('%s','%s')", dbPath, tbName))
    if err != nil {
        return nil, err
    }

    return tb, nil
}
