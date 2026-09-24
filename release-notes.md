# 3.0.7

## 更新

- 开发环境及 Grafana 前端 SDK 升级至 13.2.2，适配 React 19。
- 修复 Query variable 的资源请求接口和错误信息显示。
- 提供 Windows AMD64、Linux AMD64、Linux ARM64 安装包，明确设置后端可执行权限。

## Updates

- Upgrade the development environment and Grafana frontend SDKs to 13.2.2, with React 19 compatibility.
- Fix query variable resource routing and error messages.
- Provide Windows AMD64, Linux AMD64, and Linux ARM64 packages with explicit backend executable permissions.

---

# 3.0.5

## 新功能

新增对 Grafana 12 的支持。

## 故障修复

修复流数据在新版 Grafana 中无法正常工作的问题。
修复查询完成后数据库连接未及时关闭的问题。

---

## New Features

Added support for Grafana 12.

## Issues Fixed

Fixed an issue where streaming data did not work properly in newer versions of Grafana.
Fixed an issue where database connections were not closed promptly after query completion.
