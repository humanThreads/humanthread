# HumanThread 项目架构

本目录是项目架构文档唯一入口，描述当前代码的模块边界、依赖、数据流、运行和验证方式。

## 文档索引

- [主框架](./主框架.md)
- [Web 模块](./web/README.md)
- [Local Agent 模块](../local-agent-electron-migration.md)
- [编排模块](./编排/README.md)
- [同步模块](./同步/README.md)
- [数据模块](./数据/README.md)
- [Worker 模块](./worker/README.md)
- [CLI 模块](./cli/README.md)
- [基础设施模块](./基础设施/README.md)

代码变更影响职责、接口、字段、状态、配置或跨模块数据流时，必须同步更新本目录相关文档与主框架。文档只记录脱敏信息，不记录密码、Token、Cookie、DSN 或连接参数。
