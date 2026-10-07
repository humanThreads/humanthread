# Loop 市场契约

## 目标

Loop 模板库提供两个固定入口：`Loop 市场` 与 `自定义`。模板是复制到项目或 Space 的快捷配置，不与源模板强绑定；项目获得的是复制时的模板快照。

## 功能规则

- 移除“常用模板”和“开发模板”两个旧分类。
- `Loop 市场`展示平台内置且已发布的模板，以及 Space 自定义、已公开、未删除且未标记为废弃的模板。
- `自定义`展示当前 Space 的未删除模板；已删除模板不再显示。
- 自定义模板支持新建、编辑、复制、公开、取消公开和软删除。
- 删除模板时必须同时清除公开状态和公开时间；软删除记录保留用于审计，不再进入列表和市场。
- 模板创建人可以编辑或删除自己的模板；Space `owner`/`admin` 可以管理 Space 内全部自定义模板；其他成员只能查看。
- 平台内置模板只读，只能复制为当前 Space 的自定义模板。
- 自定义模板不再有“草稿/已发布”的操作门槛：创建人或 Space 管理员可持续编辑、公开和删除；公开前仍必须校验关联的项目 Loop、里程碑 Loop、任务 Loop 及节点映射引用均为可用的已发布 Loop 版本。
- 行业标签为固定枚举，可多选：农林牧渔、石油石化、煤炭、金属及金属矿、建材及非金属、基础化工、医药生物、食品饮料、纺织服装、轻工制造、汽车、家用电器、机械设备、航空航天与国防、电力设备、信息技术、建筑业、房地产、金融业、交通运输、仓储及物流业、环保、公用事业、文化传媒、社会服务、商业服务、商贸零售、公共管理、社会保障和社会组织、综合。
- 市场支持列表和卡片两种展示方式；排序支持发布时间和星星数量。
- 每个用户对同一模板最多保留一颗星，可再次点击取消；市场返回当前用户已星标模板 ID。

## 数据契约

`ProjectDevelopmentTemplate` 增加：

- `isPublic`：是否公开到市场。
- `publicAt`：首次或重新公开的时间；取消公开时清空。
- `deletedAt`：软删除时间；非空时模板不可见。
- `industryTags`：行业枚举数组。
- `starCount`：市场星标计数。

新增 `DevelopmentTemplateMarketStar`，用模板 ID 和用户 ID 的 32 位小写 MD5 摘要建立唯一键。新表的标识字段均为固定宽度 `CHAR(32)`，不把平台原始可变长度 ID 直接写入新标识列。

市场查询必须使用以下过滤条件：

1. 平台模板：`origin=platform`、`status=published`、`deletedAt=null`；
2. Space 模板：`origin=space`、`status!=deprecated`、`isPublic=true`、`deletedAt=null`。

## 接口边界

- `GET /api/development-templates/market`：返回市场模板和当前用户星标 ID，支持 `published`/`stars` 排序。
- `PATCH /api/development-templates/:templateId/market`：按修订号 CAS 更新公开状态和行业标签。
- `POST /api/development-templates/:templateId/star`：切换当前用户星标。
- `POST /api/development-templates/:templateId/delete`：按修订号 CAS 执行软删除。

所有写接口都必须经过当前用户身份解析、Space 权限检查和修订号校验；平台模板和非创建人、非 Space 管理员不得修改。

## 安全和审计

模板配置只保存流程结构和 Loop 引用，不保存密码、Token、Cookie、DSN 或其他凭据。命令使用幂等命令号和修订号，冲突返回可识别的版本冲突，不覆盖其他人的修改。

## 验证记录（2026-09-12）

- `pnpm --filter @humanthread/db test`：48 个测试文件通过，554 个测试通过，1 个跳过。
- 新增市场、公开状态、星标和软删除 API 路由测试；与 Web 全量测试合并运行：409 个测试文件通过，1790 个测试通过。
- `pnpm --filter @humanthread/shared test`：20 个测试文件、246 个测试通过。
- `prisma format`、`prisma generate`、`db:push` 已完成；数据库凭据未写入本文档。
