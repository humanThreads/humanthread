import type { Metadata } from "next";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  Building2,
  CalendarClock,
  Check,
  Code2,
  Download,
  FileText,
  FolderKanban,
  ListChecks,
  MonitorPlay,
  Plug,
  Server,
  ShieldCheck,
  UserRoundCheck,
  Workflow,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  DEFAULT_SOURCE_REPOSITORY_URL,
  HOME_PRIMARY_CTA_HREF,
  HOME_REGISTER_HREF,
  resolveSourceRepositoryUrl,
} from "../components/public-home";
import styles from "./help.module.css";

export const metadata: Metadata = {
  title: "帮助中心 | HumanThread",
  description:
    "按功能了解 HumanThread：空间、项目、任务、文档、Agent、Loop、人工确认、知识库、定时任务、Worker、在线会话、MCP 与客户端。",
};

export const HELP_FEATURES = [
  {
    key: "space",
    title: "空间 Space",
    tagline: "归属与访问的起点",
    summary:
      "空间分为个人空间与公司空间，是所有权和访问边界的起点。项目、任务、文档与知识都落在某个空间里，成员关系决定谁可以查看、编辑和管理。",
    steps: [
      "在顶部切换个人空间或已加入的公司空间。",
      "公司空间通过成员邀请与角色分配控制访问范围。",
      "跨空间共享内容时，显式授权或迁移，而不是依赖隐含关系。",
    ],
    note: "个人空间与公司空间互相隔离；把内容放进哪个空间，决定了它的所有权边界。",
    icon: Building2,
  },
  {
    key: "project",
    title: "项目 Project",
    tagline: "承载目标与执行配置",
    summary:
      "项目承载目标、里程碑、成员、任务、文档、知识与执行配置。Loop、Agent 和仓库凭据都以项目为作用域，项目也是知识沉淀的基本单位。",
    steps: [
      "新建项目并写清目标、范围和成功标准。",
      "配置项目成员、仓库与项目环境变量。",
      "在项目内创建任务、文档、知识候选与 Loop。",
    ],
    note: "归档或关闭项目前确认仍有关联的运行、定时任务与外部集成。",
    icon: FolderKanban,
  },
  {
    key: "task",
    title: "任务 Task",
    tagline: "统一人工与大模型执行",
    summary:
      "任务是把工作派发给人和 Agent 的统一单元，负责状态流转、阻塞记录、验收和交付跟进。Agent 与 Loop 的执行结果最终回到同一个任务上下文。",
    steps: [
      "创建任务，写明目标、上下文与验收标准。",
      "派发给成员或 Agent Profile，并记录阻塞原因。",
      "提交验收证据，确认结果后完成任务。",
    ],
    note: "Agent 或 Loop 的运行状态不会替代任务状态，完成与否仍以验收为准。",
    icon: ListChecks,
  },
  {
    key: "document",
    title: "文档 Document",
    tagline: "版本化的项目上下文",
    summary:
      "文档中心支持目录、Markdown 编辑与版本历史，文档既是人的协作载体，也是任务上下文与 Loop 的知识来源。",
    steps: [
      "在文档中心创建目录与文档，按项目组织内容。",
      "编辑保存后自动生成版本，可查看历史与差异。",
      "把文档关联到任务或项目，供 Agent 与 Loop 引用。",
    ],
    note: "文档继承项目权限；密码、Token 与连接串不要写入文档。",
    icon: FileText,
  },
  {
    key: "agent",
    title: "Agent Profile 与 Agent 中心",
    tagline: "定义可被派发的执行者",
    summary:
      "Agent Profile 绑定空间，描述执行端、模型与工具边界；本地 Agent 登录后绑定设备，接收任务与 Loop 节点派发。",
    steps: [
      "在 Agent 中心创建或选择 Agent Profile。",
      "配置执行端类型、模型站点与可用工具范围。",
      "在任务或 Loop 节点中选择该 Profile 执行。",
    ],
    note: "模型凭据保存在设备侧或平台加密存储中，不要写进提示词与文档。",
    icon: Bot,
  },
  {
    key: "loop",
    title: "Loop 编排",
    tagline: "把 SOP 固化成可运行线路",
    summary:
      "Loop 把业务 SOP 固化为图执行流程：节点、人工门禁、子 Loop、失败分类与重试策略都写在版本里，可发布、可复用、可审计。",
    steps: [
      "从空白或模板创建 Loop 与子 Loop。",
      "配置节点、Agent、工具、Workspace 与人工门禁。",
      "发布版本后，在项目或任务上发起运行。",
    ],
    note: "已发布的 Loop 版本不可变；调整流程请发布新版本，保证历史运行可重建。",
    icon: Workflow,
  },
  {
    key: "run",
    title: "Loop 运行与实时执行",
    tagline: "看清每一步执行状态",
    summary:
      "运行记录展示节点进度、事件、产物与失败分类；实时执行页同步终端输出与执行阶段，方便判断卡在哪里、是否需要人工介入。",
    steps: [
      "从 Loop 或任务发起运行，选择执行目标。",
      "在运行详情查看节点状态与实时会话。",
      "失败时按分类重试，或从指定节点恢复运行。",
    ],
    note: "历史会话与当前在线会话使用不同标识，已结束的运行不会显示为等待接入。",
    icon: Activity,
  },
  {
    key: "approval",
    title: "人工确认与工作流交互",
    tagline: "该人判断的地方交给人",
    summary:
      "Agent 在需要取舍、授权或补充信息时，可以发起交互页面。人工确认属于正常交互，不计入失败次数，完成后结果自动回到对应 Agent。",
    steps: [
      "收到通知后，从运行详情进入交互页面。",
      "补充信息、选择方案或批准动作。",
      "提交结果，Agent 从等待点继续执行。",
    ],
    note: "高风险外部动作仍需显式授权，平台不会代替人做最终判断。",
    icon: UserRoundCheck,
  },
  {
    key: "knowledge",
    title: "知识库 Knowledge",
    tagline: "让项目知识参与执行",
    summary:
      "知识库把项目文档与运行结果整理为候选知识，经审核后形成不可变版本，并支持检索、架构视图与自动审核策略。",
    steps: [
      "在项目内发起知识生成或提交候选批次。",
      "审核候选内容，发布为不可变知识版本。",
      "在任务与 Loop 中引用已发布知识。",
    ],
    note: "未审核的候选不会作为权威依据；过期知识需要显式失效。",
    icon: BookOpen,
  },
  {
    key: "schedule",
    title: "定时任务",
    tagline: "按周期自动触发",
    summary:
      "定时任务按周期触发，可绑定 Loop，并选择 Worker 或本地 Agent 执行。每次运行都保留历史日志与运行报告。",
    steps: [
      "新建定时任务，选择执行方式与周期。",
      "填写任务内容并绑定 Loop。",
      "在运行记录中查看结果与失败原因。",
    ],
    note: "执行端离线时任务保持等待，不会伪造成功。",
    icon: CalendarClock,
  },
  {
    key: "worker",
    title: "Worker 与执行端",
    tagline: "把执行能力接到平台上",
    summary:
      "Worker 池承接平台派发的执行任务；池令牌、镜像、模型站点与项目环境共同决定执行边界。标准 Linux Worker、开发 Worker 与项目派生镜像各自独立维护。",
    steps: [
      "在设置中创建 Worker 池并下发池令牌。",
      "在执行端启动 Worker，确认已接入平台。",
      "在运行记录中确认执行目标与产物。",
    ],
    note: "池令牌只证明执行端属于某个池，不会自动获得项目数据权限。",
    icon: Server,
  },
  {
    key: "live-session",
    title: "在线会话",
    tagline: "终端输出与阶段实时同步",
    summary:
      "在线会话把执行端的终端输出和执行阶段实时同步到 Web，支持查看进度，并在持有控制权时发送输入。",
    steps: [
      "从运行详情或在线会话列表进入会话。",
      "查看实时输出与当前执行阶段。",
      "持有控制权时发送输入或调整终端尺寸。",
    ],
    note: "会话内容可能包含敏感输出，访问受项目权限约束。",
    icon: MonitorPlay,
  },
  {
    key: "mcp",
    title: "MCP 接入",
    tagline: "让外部大模型客户端接入项目",
    summary:
      "通过 MCP，外部 AI 客户端可以在项目权限内读取与更新文档、任务、知识与工作流交互，并复用同一套访问与审计规则。",
    steps: [
      "在设置中创建 MCP 凭据。",
      "把服务地址与凭据配置到外部客户端。",
      "按项目边界调用工具并检查审计记录。",
    ],
    note: "MCP 凭据按用户与项目授权，撤销后立即失效。",
    icon: Plug,
  },
  {
    key: "download",
    title: "客户端下载",
    tagline: "Desktop、Android 与 CLI",
    summary:
      "客户端连接同一个部署，负责本地执行、设备绑定与交互。发布的二进制与源码提交一一对应，产物内附带许可证与第三方声明。",
    steps: [
      "从下载页或 GitHub Releases 获取对应平台产物。",
      "安装后填写部署地址并登录账号。",
      "按提示绑定设备与本地执行环境。",
    ],
    note: "未签名或未公证的构建只用于测试；正式分发请使用自有证书重新构建。",
    icon: Download,
  },
  {
    key: "security",
    title: "安全与权限",
    tagline: "边界、凭据与审计",
    summary:
      "平台在 Space / Project 隔离之上，叠加最小权限、凭据加密、授权撤回与运行审计，降低越权和误执行风险。",
    steps: [
      "按最小权限邀请成员，定期检查角色与授权。",
      "把密钥放进项目环境或设备侧，而不是文档与提示词。",
      "通过运行记录与审计信息复核关键动作。",
    ],
    note: "自部署需要自行负责备份、升级与网络边界安全。",
    icon: ShieldCheck,
  },
] as const;

export interface HelpQuickLink {
  key: string;
  label: string;
  href: string;
  external: boolean;
}

export function buildHelpQuickLinks(
  sourceRepositoryUrl: string | null,
): readonly HelpQuickLink[] {
  const links: HelpQuickLink[] = [
    { key: "workspace", label: "进入工作台", href: HOME_PRIMARY_CTA_HREF, external: false },
    { key: "register", label: "创建账号", href: HOME_REGISTER_HREF, external: false },
  ];
  if (sourceRepositoryUrl) {
    const repository = sourceRepositoryUrl.replace(/\/+$/u, "");
    links.push(
      { key: "repository", label: "GitHub 仓库", href: repository, external: true },
      { key: "releases", label: "下载客户端", href: `${repository}/releases`, external: true },
      { key: "issues", label: "问题反馈", href: `${repository}/issues`, external: true },
    );
  }
  return links;
}

export const HELP_QUICK_LINKS = buildHelpQuickLinks(DEFAULT_SOURCE_REPOSITORY_URL);

export default function HelpPage() {
  const sourceRepositoryUrl = resolveSourceRepositoryUrl();
  const quickLinks = buildHelpQuickLinks(sourceRepositoryUrl);
  return (
    <main className={styles.helpPage}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="返回 HumanThread 首页">
            <Image src="/brand/humanthread-mark.svg" alt="" width={30} height={30} priority />
            <span>HumanThread</span>
          </Link>
          <nav aria-label="帮助中心导航" className={styles.pageNav}>
            <Link href="/">首页</Link>
            <Link href={HOME_PRIMARY_CTA_HREF}>进入工作台</Link>
            {sourceRepositoryUrl ? (
              <a
                href={sourceRepositoryUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.externalLink}
                aria-label="GitHub 仓库"
              >
                <Code2 aria-hidden="true" size={15} strokeWidth={1.8} />
                GitHub
              </a>
            ) : null}
          </nav>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="help-title">
        <p className={styles.kicker}>HELP CENTER</p>
        <h1 id="help-title">HumanThread 帮助中心</h1>
        <p className={styles.heroBody}>
          这里按功能说明 HumanThread 是什么、怎么用、需要注意什么。你可以先通读概念，也可以直接跳到正在使用的功能。
        </p>
        <div className={styles.quickLinks}>
          {quickLinks.map((link) =>
            link.external ? (
              <a key={link.key} href={link.href} target="_blank" rel="noreferrer noopener" className={styles.quickLink}>
                {link.label}
                <ArrowRight aria-hidden="true" size={15} strokeWidth={1.75} />
              </a>
            ) : (
              <Link key={link.key} href={link.href} className={styles.quickLink}>
                {link.label}
                <ArrowRight aria-hidden="true" size={15} strokeWidth={1.75} />
              </Link>
            ),
          )}
        </div>
      </section>

      <div className={styles.layout}>
        <aside className={styles.toc} aria-label="功能目录">
          <p>功能目录</p>
          <ol>
            {HELP_FEATURES.map((feature, index) => (
              <li key={feature.key}>
                <a href={`#${feature.key}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {feature.title}
                </a>
              </li>
            ))}
          </ol>
        </aside>

        <div className={styles.features}>
          {HELP_FEATURES.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <article key={feature.key} id={feature.key} className={styles.feature}>
                <div className={styles.featureHeader}>
                  <span className={styles.featureIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.featureIcon}><Icon aria-hidden="true" size={22} strokeWidth={1.6} /></span>
                  <div>
                    <p className={styles.featureTagline}>{feature.tagline}</p>
                    <h2>{feature.title}</h2>
                  </div>
                </div>
                <p className={styles.featureSummary}>{feature.summary}</p>
                <div className={styles.featureBody}>
                  <div className={styles.featureSteps}>
                    <h3>怎么用</h3>
                    <ol>
                      {feature.steps.map((step) => (
                        <li key={step}>
                          <Check aria-hidden="true" size={15} strokeWidth={2} />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <p className={styles.featureNote}>
                    <strong>注意</strong>
                    <span>{feature.note}</span>
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <section className={styles.finalAction} aria-label="从帮助中心开始">
        <div>
          <p className={styles.kicker}>READY TO START</p>
          <h2>选一项真实工作，沿着一条线程把它推进到结果。</h2>
        </div>
        <div className={styles.finalLinks}>
          <Link href={HOME_PRIMARY_CTA_HREF} className={styles.primaryButton}>
            进入工作台
            <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
          </Link>
          <Link href="/" className={styles.secondaryButton}>返回首页</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <Image src="/brand/humanthread-mark.svg" alt="" width={24} height={24} />
        <span className={styles.footerName}>HumanThread</span>
        <span className={styles.footerDescription}>Human-guided delivery for Agent work.</span>
        {sourceRepositoryUrl ? (
          <a href={sourceRepositoryUrl} target="_blank" rel="noreferrer noopener" className={styles.footerLink}>
            源代码（AGPL-3.0）
          </a>
        ) : null}
      </footer>
    </main>
  );
}
