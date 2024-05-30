# DolphinDB Grafana DataSource Plugin Go

<p align='center'>
    <img src='./ddb.svg' alt='DolphinDB Grafana DataSource' width='256'>
</p>

<p align='center'>
    <a href='https://github.com/dolphindb/api-go/releases' target='_blank'>
        <img alt='Go package version' src='https://img.shields.io/github/v/release/dolphindb/api-go?label=api-go&style=flat-square' />
    </a>
</p>


## [English](./README.md) | 中文

Grafana 是一个开源的数据可视化 Web 应用程序，擅长动态展示时序数据，支持多种数据源。用户通过配置连接的数据源，编写查询脚本，可在浏览器中展示数据图表。

DolphinDB 开发了 Grafana 数据源插件 (dolphindb-datasource-go)，让用户在 Grafana 面板 (dashboard) 上通过编写查询脚本、订阅流数据表的方式，与 DolphinDB 进行交互，实现 DolphinDB 时序数据的可视化。

<img src='./demo.png' width='1200'>

## 安装方法
#### 1. 安装 Grafana
前往 Grafana 官网: https://grafana.com/oss/grafana/ 下载并安装最新的开源版本 (OSS, Open-Source Software)

#### 2. 安装 dolphindb-datasource 插件
在 [releases](https://github.com/dolphindb/grafana-datasource/releases) 中下载最新版本的插件压缩包，如 `dolphindb-datasource.v2.0.900.zip`

将压缩包中的 dolphindb-datasource-go 文件夹解压到以下路径（如果不存在 plugins 目录，可手动创建）:

- Windows: `<grafana 安装目录>/data/plugins/`
- Linux: `/var/lib/grafana/plugins/`

在 plugin 目录下，应形成形如以下的文件结构：

```
plugins
├── dolphindb-datasource-go
│   ├── LICENSE
│   ├── README.md
│   ├── components
│   ├── go_plugin_build_manifest
│   ├── gpx_dolphindb_datasource_windows_amd64.exe
│   ├── img
│   ├── module.js
│   ├── static
│   └── plugin.json
├── other_plugin_1
├── other_plugin_2
└── ...
```

#### 3. 修改 Grafana 配置文件，使其允许加载未签名的 dolphindb-datasource 插件
阅读 https://grafana.com/docs/grafana/latest/administration/configuration/#configuration-file-location  
打开并编辑配置文件： 

在 `[plugins]` 部分下面取消注释 `allow_loading_unsigned_plugins`，并配置为 `dolphindb-datasource-go`，即把下面的
```ini
# Enter a comma-separated list of plugin identifiers to identify plugins to load even if they are unsigned. Plugins with modified signatures are never loaded.
;allow_loading_unsigned_plugins =
```
改为
```ini
# Enter a comma-separated list of plugin identifiers to identify plugins to load even if they are unsigned. Plugins with modified signatures are never loaded.
allow_loading_unsigned_plugins = dolphindb-datasource-go
```

注：每次修改配置项后，需重启 Grafana

#### 4. 启动或重启 Grafana 进程或服务

https://grafana.com/docs/grafana/latest/setup-grafana/start-restart-grafana/

### 验证已加载插件
在 Grafana 启动日志中可以看到类似以下的日志  
```log
WARN [05-19|12:05:48] Permitting unsigned plugin. This is not recommended logger=plugin.signature.validator pluginID=dolphindb-datasource-go pluginDir=<grafana 安装目录>/data/plugins/dolphindb-datasource-go
```

日志文件路径：
- Windows: `<grafana 安装目录>/data/log/grafana.log`
- Linux: `/var/log/grafana/grafana.log`

或者访问下面的链接，看到页面中 DolphinDB 插件是 Installed 状态：  
http://localhost:3000/plugins



## 使用方法
### 1. 打开并登录 Grafana
打开 http://localhost:3000  
初始登入名以及密码均为 admin

### 2. 新建 DolphinDB 数据源
打开 http://localhost:3000/datasources ，或点击左侧导航的 `Configuration > Data sources` 添加数据源，搜索并选择 dolphindb，配置数据源后点 `Save & Test` 保存数据源

### 3. 新建 Panel，通过编写查询脚本或订阅流数据表，可视化 DolphinDB 时序数据
打开或新建 Dashboard，编辑或新建 Panel，在 Panel 的 Data source 属性中选择上一步添加的数据源  

#### 3.1. 编写脚本执行查询，可视化返回的时序表格
1. 将 query 类型设置为 `脚本`  
2. 编写查询脚本，代码的最后一条语句需要返回 table
3. 编写完成后按 `Ctrl + S` 保存，或者点击页面中的刷新按钮 (Refresh dashboard)，可以将 Query 发到 DolphinDB 数据库运行并展示出图表  
4. 代码编辑框的高度通过拖动底部边框进行调整  
5. 点击右上角的保存 `Save` 按钮，保存 panel 配置

dolphindb-datasource 插件支持变量，比如:
- `$__timeFilter` 变量: 值为面板上方的时间轴区间，比如当前的时间轴区间是 `2022-02-15 00:00:00 - 2022.02.17 00:00:00` ，那么代码中的 `$__timeFilter` 会被替换为 `pair(2022.02.15 00:00:00.000, 2022.02.17 00:00:00.000)`
- `$__interval` 和 `$__interval_ms` 变量: 值为 Grafana 根据时间轴区间长度和屏幕像素点自动计算的时间分组间隔。`$__interval` 会被替换为 DolphinDB 中对应的 DURATION 类型; `$__interval_ms` 会被替换为毫秒数 (整型)
- query 变量: 通过 SQL 查询生成动态值或选项列表

更多变量请查看 https://grafana.com/docs/grafana/latest/variables/

#### 3.2. 订阅并实时可视化 DolphinDB 中的流数据表
要求：DolphinDB server 版本不低于 2.00.9 或 1.30.21  
1. 将 query 类型设置为 `流数据表`  
2. 填写要订阅的流数据表表名  
3. 点击暂存按钮  
4. 将时间范围改成 `Last 5 minutes` (需要包含当前时间，如 Last x hour/minutes/seconds，而不是历史时间区间，否则看不到数据)
5. 点击右上角的保存 `Save` 按钮，保存 panel 配置  

### 4. 参考文档学习 Grafana 使用
https://grafana.com/docs/grafana/latest/

### FAQ
Q: 如何设置 dashboard 自动刷新间隔？  
A:   
对于脚本类型，打开 dashboard, 在右上角刷新按钮右侧点击下拉框选择自动刷新间隔  
对于流数据表类型，数据是实时的，无需设置。

如果需要自定义刷新间隔，可以打开 `dashboard settings > Time options > Auto refresh`, 输入自定义的间隔
如果需要定义比 5s 更小的刷新间隔，比如 1s，需要按下面的方法操作:  
修改 Grafana 配置文件
```ini
[dashboards]
min_refresh_interval = 1s
```
修改完后重启 Grafana  
(参考: https://community.grafana.com/t/how-to-change-refresh-rate-from-5s-to-1s/39008/2)


## 构建及开发方法
```shell
# 安装最新版的 nodejs
# https://nodejs.org/en/download/current/

git clone https://github.com/dolphindb/grafana-datasource-go.git

cd grafana-datasource-go

# 安装项目依赖
npm i

# 开发
npm run dev

# 构建
npm run build
mage
# 完成后产物在 dist 文件夹中。将 out 重命名为 dolphindb-datasource-go 后压缩为 .zip 即可
```
