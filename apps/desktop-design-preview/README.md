# HumanThread Desktop 设计预览

该应用是 Desktop 客户端全量重设计与开箱向导的局域网评审稿。它不修改正式 Electron 客户端，也不领取或执行真实业务任务。

## 启动

```bash
pnpm install
pnpm --dir apps/desktop-design-preview dev
```

开发服务器监听 `0.0.0.0:4174`，终端会输出 `Local` 和 `Network` 地址。局域网设备使用 `Network` 地址访问。

默认通过同源 `/api` 开发代理连接：

```text
http://localhost:3000
```

如需连接测试部署：

```bash
HUMANTHREAD_PREVIEW_API_TARGET=https://test.example.com \
  pnpm --dir apps/desktop-design-preview dev
```

## 安全边界

- 密码、访问令牌、刷新令牌和设备令牌只存在于当前页面内存，不写入浏览器存储。
- 浏览器只保存独立的预览安装标识、设备标识、外观偏好和非敏感向导状态。
- 设计预览默认只读，不发送创建、更新、删除、审批或任务领取请求。
- 开箱向导第 8 步只有存在真实成功执行证据时才能完成；当前设计预览没有原生执行器，因此会保持阻塞或待验证。

## 验证

```bash
pnpm --dir apps/desktop-design-preview lint
pnpm --dir apps/desktop-design-preview test
pnpm --dir apps/desktop-design-preview build
pnpm --dir apps/desktop-design-preview verify:lan
pnpm --dir apps/desktop-design-preview verify:visual
```

视觉验证使用本机 Chrome、Playwright、模拟 Desktop API 数据，在 1440px、1024px 和 760px 三个宽度生成评审截图。截图位于 `docs/requirements/assets/desktop-design-preview/`。
