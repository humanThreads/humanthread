# Web 服务端 API

代码位于 apps/web/src/app/api 与服务端领域模块，负责认证、权限、项目、任务、文档、Loop、Worker 和 MCP 请求；写操作使用事务和版本校验。

文档附件上传继续复用 `DocumentAttachment` 私有存储与文档读写授权。附件白名单包含 XMind 和 Visio 工作簿类型；浏览器未提供标准 MIME 时，仅对 `.xmind`、`.vsdx` 和 `.vsd` 扩展名做受控归一化。附件读取响应不内联这两类工作簿，前端通过受保护接口按需解析只读预览。
