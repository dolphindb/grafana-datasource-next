// streaming_ha_probe reproduces the backend path used by RunStream against a
// DolphinDB HA streaming table.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/dolphindb/api-go/v3/api"
	"github.com/dolphindb/api-go/v3/model"
	"github.com/dolphindb/api-go/v3/streaming"
)

type config struct {
	address       string
	user          string
	password      string
	table         string
	action        string
	listeningHost string
	listeningPort int
	offset        int64
	duration      time.Duration
	reconnect     bool
	allowExists   bool
	skipProbe     bool
}

type loggingHandler struct {
	count atomic.Int64
}

func (h *loggingHandler) DoEvent(msg streaming.IMessage) {
	count := h.count.Add(1)
	if count <= 5 || count%1000 == 0 {
		logStep(
			"message",
			"count=%d topic=%q offset=%d rows=%d",
			count,
			msg.GetTopic(),
			msg.GetOffset(),
			msg.Size(),
		)
	}
}

func main() {
	cfg := parseFlags()
	logStep(
		"config",
		"address=%s table=%s action=%s listen=%s:%d offset=%d reconnect=%t allowExists=%t duration=%s user=%s",
		cfg.address,
		cfg.table,
		cfg.action,
		cfg.listeningHost,
		cfg.listeningPort,
		cfg.offset,
		cfg.reconnect,
		cfg.allowExists,
		cfg.duration,
		cfg.user,
	)

	if !cfg.skipProbe {
		if err := probeQueryPath(cfg); err != nil {
			exitWithError("ordinary query path", err)
		}
	}

	if err := probeStreamingPath(cfg); err != nil {
		exitWithError("streaming path", err)
	}
}

func parseFlags() config {
	defaultAction := fmt.Sprintf("grafana_ha_probe_%d_%d", os.Getpid(), time.Now().UnixNano())

	var cfg config
	flag.StringVar(&cfg.address, "address", "192.168.0.54:9902", "DolphinDB server address")
	flag.StringVar(&cfg.user, "user", "admin", "DolphinDB user")
	flag.StringVar(&cfg.password, "password", "123456", "DolphinDB password (not printed)")
	flag.StringVar(&cfg.table, "table", "test_ha", "streaming table name")
	flag.StringVar(&cfg.action, "action", defaultAction, "unique subscription action name")
	flag.StringVar(&cfg.listeningHost, "listen-host", "localhost", "streaming client listening host")
	flag.IntVar(&cfg.listeningPort, "listen-port", 8101, "streaming client listening port; ignored by reverse streaming")
	flag.Int64Var(&cfg.offset, "offset", -1, "subscription offset")
	flag.DurationVar(&cfg.duration, "duration", 20*time.Second, "time to keep the subscription alive")
	flag.BoolVar(&cfg.reconnect, "reconnect", true, "enable streaming reconnect")
	flag.BoolVar(&cfg.allowExists, "allow-exists", false, "allow an existing subscription topic")
	flag.BoolVar(&cfg.skipProbe, "skip-query-probe", false, "skip version and table-schema queries")
	flag.Parse()
	return cfg
}

func probeQueryPath(cfg config) error {
	started := time.Now()
	logStep("query.connect", "starting")
	conn, err := api.NewSimpleDolphinDBClient(
		context.Background(),
		cfg.address,
		cfg.user,
		cfg.password,
	)
	if err != nil {
		return fmt.Errorf("connect/login failed after %s: %w", time.Since(started), err)
	}
	defer func() {
		if closeErr := conn.Close(); closeErr != nil {
			logStep("query.close", "error=%v", closeErr)
		}
	}()
	logStep("query.connect", "ok elapsed=%s", time.Since(started))

	if _, err = runAndDescribe(conn, "version", "version()"); err != nil {
		return err
	}

	script := fmt.Sprintf("select top 1 * from %s", cfg.table)
	result, err := runAndDescribe(conn, "table schema", script)
	if err != nil {
		return err
	}
	if result.GetDataForm() != model.DfTable {
		return fmt.Errorf(
			"table schema query returned %s/%s, expected TABLE",
			result.GetDataFormString(),
			result.GetDataTypeString(),
		)
	}

	table := result.(*model.Table)
	logStep("query.schema", "columns=%v", table.ColNames)
	return nil
}

func runAndDescribe(conn api.DolphinDB, label, script string) (model.DataForm, error) {
	started := time.Now()
	logStep("query."+label, "script=%q", script)
	result, err := conn.RunScript(script)
	if err != nil {
		return nil, fmt.Errorf("%s failed after %s: %w", label, time.Since(started), err)
	}
	if result == nil {
		logStep("query."+label, "ok result=<nil> elapsed=%s", time.Since(started))
		return result, nil
	}

	logStep(
		"query."+label,
		"ok form=%s type=%s rows=%d elapsed=%s",
		result.GetDataFormString(),
		result.GetDataTypeString(),
		result.Rows(),
		time.Since(started),
	)
	if result.GetDataForm() == model.DfScalar {
		logStep("query."+label, "value=%s", result.String())
	}
	return result, nil
}

func probeStreamingPath(cfg config) error {
	handler := &loggingHandler{}
	client := streaming.NewGoroutineClient(cfg.listeningHost, cfg.listeningPort)
	defer client.Close()

	req := &streaming.SubscribeRequest{
		Address:     cfg.address,
		UserID:      cfg.user,
		Password:    cfg.password,
		TableName:   cfg.table,
		ActionName:  cfg.action,
		Handler:     handler,
		Offset:      cfg.offset,
		Reconnect:   cfg.reconnect,
		AllowExists: cfg.allowExists,
	}

	started := time.Now()
	logStep("stream.subscribe", "starting address=%s", req.Address)
	if err := client.Subscribe(req); err != nil {
		return fmt.Errorf(
			"Subscribe failed after %s (initialAddress=%s finalAddress=%s): %w",
			time.Since(started),
			cfg.address,
			req.Address,
			err,
		)
	}
	logStep(
		"stream.subscribe",
		"ok elapsed=%s initialAddress=%s finalAddress=%s",
		time.Since(started),
		cfg.address,
		req.Address,
	)

	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	timer := time.NewTimer(cfg.duration)
	defer timer.Stop()

	select {
	case <-signalCtx.Done():
		logStep("stream.wait", "interrupted")
	case <-timer.C:
		logStep("stream.wait", "duration elapsed messages=%d", handler.count.Load())
	}

	logStep("stream.unsubscribe", "starting address=%s", req.Address)
	if err := client.UnSubscribe(req); err != nil {
		return fmt.Errorf("UnSubscribe failed: %w", err)
	}
	logStep("stream.unsubscribe", "ok totalMessages=%d", handler.count.Load())
	return nil
}

func exitWithError(stage string, err error) {
	logStep("error", "stage=%s class=%s error=%v", stage, classifyError(err), err)
	os.Exit(1)
}

func classifyError(err error) string {
	switch message := err.Error(); {
	case strings.Contains(message, "<NotLeader>"):
		return "not-leader"
	case strings.Contains(message, "already subscribed"):
		return "already-subscribed"
	case strings.Contains(message, "database connection is not established yet"):
		return "connection-not-established"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	default:
		return "other"
	}
}

func logStep(step, format string, args ...any) {
	message := fmt.Sprintf(format, args...)
	fmt.Printf("%s step=%s %s\n", time.Now().Format(time.RFC3339Nano), step, message)
}
