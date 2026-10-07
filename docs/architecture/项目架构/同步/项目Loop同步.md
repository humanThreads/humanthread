# 项目 Loop 同步

代码入口：packages/project-loop-sync 及 Local Agent runtime。负责快照、初始化、路由、离线续传、Worker 转移和 Git 恢复；采用快照加 outbox，服务端版本为权威。
