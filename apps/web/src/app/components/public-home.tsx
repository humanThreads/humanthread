import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  BookOpen,
  Building2,
  Check,
  ChartNoAxesCombined,
  CheckCheck,
  Code2,
  Download,
  FileText,
  Factory,
  Fingerprint,
  Globe2,
  LockKeyhole,
  MessageCircleQuestionMark,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Workflow,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { PublicDeliveryDemo } from "./public-delivery-demo";
import styles from "./public-home.module.css";

export const HOME_PRIMARY_CTA_HREF = "/login?redirectTo=%2Fdashboard";
export const HOME_REGISTER_HREF = "/register?redirectTo=%2Fdashboard";
export const HOME_HELP_HREF = "/help";

/**
 * AGPL-3.0 section 13 requires that users interacting with this service over a
 * network can obtain the corresponding source code. A modified deployment must
 * point this at its own published source; unset falls back to the upstream
 * repository so the default deployment stays compliant.
 */
export const SOURCE_REPOSITORY_ENV_KEY = "HUMANTHREAD_SOURCE_REPOSITORY";

/** Upstream source repository, used when a deployment does not override it. */
export const DEFAULT_SOURCE_REPOSITORY_URL = "https://github.com/humanThreads/humanthread";

export function resolveSourceRepositoryUrl(
  value: string | undefined = process.env.HUMANTHREAD_SOURCE_REPOSITORY
    ?? DEFAULT_SOURCE_REPOSITORY_URL,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

export interface HomeQuickAction {
  key: string;
  label: string;
  description: string;
  href: string;
  icon: typeof Code2;
  external: boolean;
}

export function buildHomeQuickActions(
  sourceRepositoryUrl: string | null,
): readonly HomeQuickAction[] {
  const actions: HomeQuickAction[] = [
    {
      key: "workspace",
      label: "进入工作台",
      description: "登录后继续处理任务、Loop 与项目文档。",
      href: HOME_PRIMARY_CTA_HREF,
      icon: ArrowRight,
      external: false,
    },
    {
      key: "help",
      label: "帮助中心",
      description: "按功能了解 HumanThread 的概念与使用方式。",
      href: HOME_HELP_HREF,
      icon: BookOpen,
      external: false,
    },
  ];
  if (sourceRepositoryUrl) {
    const repository = trimTrailingSlash(sourceRepositoryUrl);
    actions.push(
      {
        key: "source",
        label: "GitHub 仓库",
        description: "查看源码、架构文档与 AGPL-3.0 许可证。",
        href: repository,
        icon: Code2,
        external: true,
      },
      {
        key: "releases",
        label: "下载客户端",
        description: "获取 Desktop、Android 与命令行产物。",
        href: `${repository}/releases`,
        icon: Download,
        external: true,
      },
      {
        key: "issues",
        label: "问题反馈",
        description: "在 GitHub Issues 提交缺陷与改进建议。",
        href: `${repository}/issues`,
        icon: MessageCircleQuestionMark,
        external: true,
      },
    );
  }
  return actions;
}

export const HOME_PRODUCT_MAP = [
  ["需求、文档与知识", "把业务意图、规则、案例和决策整理成执行依据。"],
  ["SOP 与 Loop", "把真实流程定制成可运行的工作线路。"],
  ["AI 与人共同执行", "让 AI 提效，同时保留人的判断和责任。"],
  ["结果与证据", "让交付可以验收、复盘并反哺下一次工作。"],
] as const;

export const PUBLIC_DELIVERY_STAGES = [
  {
    key: "context",
    label: "目标与上下文",
    detail: "需求、文档与规则进入同一条工作线程",
  },
  {
    key: "assigned",
    label: "Loop 已派发",
    detail: "SOP、责任人、工具和验收条件保持可见",
  },
  {
    key: "running",
    label: "AI / 人执行",
    detail: "信息处理和实际动作回到同一条线程",
  },
  {
    key: "approval",
    label: "人工判断",
    detail: "需要取舍或授权的节点明确等待负责人",
  },
  {
    key: "recorded",
    label: "结果与知识",
    detail: "证据回写项目，沉淀为下一次执行依据",
  },
] as const;

const PROBLEMS = [
  {
    number: "01",
    title: "上下文断裂",
    problem: "需求在文档里，执行在聊天里，结果又回到另一个系统。",
    answer: "把目标、规则、文档和验收条件带入同一个 Task 和 Loop。",
  },
  {
    number: "02",
    title: "执行不可见",
    problem: "Agent 做了很多事情，但没人知道依据、权限和真实状态。",
    answer: "记录版本、节点、事件、产物和当前等待的人。",
  },
  {
    number: "03",
    title: "异常无人跟进",
    problem: "失败、超时和外部动作未知时，只能靠人手工催办。",
    answer: "把重试、核对、返工和人工接管设计进工作线路。",
  },
  {
    number: "04",
    title: "结果无法复盘",
    problem: "事情做完了，却说不清为什么这么做、谁确认过。",
    answer: "将决策、证据和结果写回项目与知识，留下可追踪依据。",
  },
] as const;

const PRODUCT_LAYERS = [
  {
    key: "context",
    title: "让需求、文档和知识真正参与执行",
    summary:
      "HumanThread 不把知识库当作静态存档。它将需求、规则、历史案例和项目文档归纳为任务上下文、检查项、约束与验收条件。",
    path: ["需求与目标", "文档与知识", "可执行上下文"],
    facts: ["提取关键约束和缺失信息", "让同一份上下文服务人和 Agent"],
    icon: FileText,
  },
  {
    key: "loop",
    title: "Loop 是定制化 SOP，不是通用按钮",
    summary:
      "每个组织的责任边界、工具权限、例外处理和验收方式都不同。Loop 把这些业务决定固化为可发布、可运行、可审计的工作线路。",
    path: ["业务 SOP", "Loop 版本", "受约束执行"],
    facts: ["节点、门禁和异常路径显式可见", "可以从真实试点持续优化"],
    icon: Workflow,
  },
  {
    key: "human",
    title: "AI 提高产能，人保留决策权",
    summary:
      "AI 适合汇总、提炼、生成、分析和推荐下一步；人负责定义目标、处理歧义、批准高风险动作并对最终结果负责。",
    path: ["AI 产出候选", "Human Gate", "业务验收"],
    facts: ["不把模糊判断伪装成自动化结论", "每个关键交接都有明确责任人"],
    icon: UserRoundCheck,
  },
  {
    key: "evidence",
    title: "让每次执行留下结果和证据",
    summary:
      "运行快照、授权、事件、审批和产物引用回到同一个交付上下文。完成的工作可以验收、复盘，也可以经过审核后沉淀为知识。",
    path: ["运行事件", "结果证据", "知识候选"],
    facts: ["版本和运行状态可重建", "证据不足或冲突时转人工审核"],
    icon: ChartNoAxesCombined,
  },
] as const;

const SCENARIOS = [
  {
    title: "AI 辅助开发",
    audience: "研发与交付团队",
    flow: "需求 → 代码上下文 → Agent 修改 → 测试 → 人工验收 → 发布",
    benefit: "把代码执行、测试证据和发布判断留在同一个任务上下文。",
    icon: Code2,
  },
  {
    title: "跨境运营",
    audience: "运营与增长团队",
    flow: "运营目标 → 商品/广告数据 → 异常分析 → 运营确认 → 执行动作 → 周报复盘",
    benefit: "让多站点运营的分析、审批和动作不再散落在表格与后台。",
    icon: Globe2,
  },
  {
    title: "运营报表",
    audience: "业务与管理团队",
    flow: "报表目标 → 多源取数 → 指标校验 → AI 分析 → 负责人确认 → 报告发布",
    benefit: "把口径、异常解释、确认记录和报告版本串成可复用流程。",
    icon: ChartNoAxesCombined,
  },
  {
    title: "生产协同",
    audience: "质量、供应链与现场团队",
    flow: "质量异常 → 批次/设备资料 → 原因分析 → 质量审批 → 整改任务 → CAPA 归档",
    benefit: "协同异常处理和责任交接，不替代 MES 或设备实时控制。",
    icon: Factory,
  },
] as const;

const SECURITY_MEASURES = [
  {
    title: "Space / Project 隔离",
    detail: "公司与个人 Space 是不同的归属和访问边界，任务与文档继承项目权限。",
    icon: Building2,
  },
  {
    title: "最小权限执行",
    detail: "平台策略、资源权限、自动化授权、设备、预算、网络和凭证状态共同求值。",
    icon: LockKeyhole,
  },
  {
    title: "敏感信息留在设备侧",
    detail: "本地绝对路径、Provider 凭证、Token、Cookie 和不必要的文件内容不上传。",
    icon: Fingerprint,
  },
  {
    title: "Workspace 级限制",
    detail: "Local Agent 每次工具调用前复验真实路径；Workspace 外路径和生产动作需要独立授权。",
    icon: ShieldCheck,
  },
  {
    title: "授权可撤回、运行可审计",
    detail: "授权失效后阻止新的 assignment 和工具调用，运行、审批、事件和结果保留关联。",
    icon: CheckCheck,
  },
  {
    title: "外部动作先核对再重试",
    detail: "邮件、外部 API 和文档写入使用 intent / receipt；结果未知时不会盲目重放。",
    icon: AlertTriangle,
  },
] as const;

const IMPLEMENTATION_STEPS = [
  ["01", "业务梳理", "明确目标、SOP、角色、输入、输出和风险点。"],
  ["02", "知识整理", "整理需求、文档、规则和历史案例。"],
  ["03", "Loop 定制", "配置节点、Agent、工具、Workspace、授权和 Human Gate。"],
  ["04", "真实试点", "在可控工作中观察事件、证据、失败和人工接管。"],
  ["05", "生产固化", "冻结版本，设置权限、预算、通知、审计和恢复策略。"],
  ["06", "持续优化", "根据运行结果、人工反馈和知识候选迭代 SOP。"],
] as const;

function ProductPath({ items }: { items: readonly string[] }) {
  return (
    <div className={styles.productPath} aria-label={items.join(" 到 ")}>
      {items.map((item, index) => (
        <span key={item} className={styles.productPathStep}>
          <span>{item}</span>
          {index < items.length - 1 ? (
            <ArrowRight aria-hidden="true" size={16} strokeWidth={1.75} />
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function PublicHome() {
  const sourceRepositoryUrl = resolveSourceRepositoryUrl();
  const quickActions = buildHomeQuickActions(sourceRepositoryUrl);
  return (
    <main className={styles.publicHome}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="HumanThread 根页">
            <Image src="/brand/humanthread-mark.svg" alt="" width={30} height={30} priority />
            <span>HumanThread</span>
          </Link>
          <nav aria-label="首页导航" className={styles.pageNav}>
            <a href="#how-it-works">工作方式</a>
            <a href="#scenarios">适用场景</a>
            <a href="#security">安全与边界</a>
            <Link href={HOME_HELP_HREF}>帮助中心</Link>
            {sourceRepositoryUrl ? (
              <a
                href={sourceRepositoryUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.navExternal}
                aria-label="GitHub 仓库"
              >
                <Code2 aria-hidden="true" size={15} strokeWidth={1.8} />
                GitHub
              </a>
            ) : null}
          </nav>
          <nav aria-label="账户入口" className={styles.accountNav}>
            <Link href={HOME_PRIMARY_CTA_HREF} className={styles.textLink}>登录</Link>
            <Link href={HOME_REGISTER_HREF} className={styles.compactButton}>
              创建账号
              <ArrowRight aria-hidden="true" size={16} strokeWidth={1.75} />
            </Link>
          </nav>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="public-home-title">
        <div className={styles.heroGrid}>
          <div className={styles.heroIdentity}>
            <p className={styles.kicker}>知识到执行的协同执行层</p>
            <h1 id="public-home-title">HumanThread</h1>
          </div>
          <div className={styles.heroPitch}>
            <p className={styles.heroStatement}>让复杂工作沿着一条线程，从目标走到交付</p>
            <p className={styles.heroBody}>
              把需求、文档、知识、任务、Agent 执行、人工判断和交付证据连接起来，让跨团队、跨系统的工作可执行、可追踪、可恢复。
            </p>
            <div className={styles.heroActions}>
              <Link href={HOME_PRIMARY_CTA_HREF} className={styles.primaryButton}>
                进入工作台
                <ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} />
              </Link>
              <Link href={HOME_REGISTER_HREF} className={styles.secondaryButton}>创建账号</Link>
              <Link href={HOME_HELP_HREF} className={styles.secondaryButton}>帮助中心</Link>
              {sourceRepositoryUrl ? (
                <a
                  href={sourceRepositoryUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={styles.secondaryButton}
                >
                  <Code2 aria-hidden="true" size={17} strokeWidth={1.75} />
                  GitHub 仓库
                </a>
              ) : null}
            </div>
            <p className={styles.heroNote}>AI 提高思考和生产效率，人类保留判断和责任。</p>
          </div>
          <div className={styles.heroDemo}>
            <PublicDeliveryDemo stages={PUBLIC_DELIVERY_STAGES} />
          </div>
        </div>
      </section>

      <section className={styles.quickAccess} aria-labelledby="quick-access-title">
        <div className={styles.quickAccessIntro}>
          <p className={styles.kicker}>QUICK ACCESS</p>
          <h2 id="quick-access-title">快速进入 HumanThread</h2>
          <p>从工作台、帮助文档到源码与客户端，常用入口集中在这里。</p>
        </div>
        <div className={styles.quickAccessGrid}>
          {quickActions.map((action) => {
            const Icon = action.icon;
            const content = (
              <>
                <span className={styles.quickAccessIcon}><Icon aria-hidden="true" size={20} strokeWidth={1.7} /></span>
                <span className={styles.quickAccessBody}>
                  <strong>{action.label}</strong>
                  <span>{action.description}</span>
                </span>
              </>
            );
            return action.external ? (
              <a
                key={action.key}
                href={action.href}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.quickAccessItem}
              >
                {content}
              </a>
            ) : (
              <Link key={action.key} href={action.href} className={styles.quickAccessItem}>
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      <section className={styles.problemBand} aria-labelledby="problem-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>WHY WORK BREAKS</p>
            <h2 id="problem-title">复杂工作，为什么总在交接处断掉？</h2>
          </div>
          <p>HumanThread 先解决工作过程中的断点，再让 AI 参与执行。</p>
        </div>
        <div className={styles.problemGrid}>
          {PROBLEMS.map((item) => (
            <article key={item.number} className={styles.problemItem}>
              <span className={styles.itemNumber}>{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.problem}</p>
              <div className={styles.problemAnswer}>
                <Check aria-hidden="true" size={15} strokeWidth={2} />
                <span>{item.answer}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.story} id="how-it-works" aria-label="HumanThread 工作方式">
        <div className={styles.storyIntro}>
          <p className={styles.kicker}>KNOWLEDGE TO DELIVERY</p>
          <h2>把信息归纳成上下文，把上下文推进成结果</h2>
          <p>需求、文档和知识不再停留在存档层；它们被提炼为下一步行动、检查项和可验证的交付依据。</p>
        </div>

        <div className={styles.storyLayout}>
          <aside className={styles.storyTrack} aria-label="产品工作方式目录">
            <div className={styles.storyRail} aria-hidden="true"><span className={styles.storyProgress} /></div>
            <ol>
              {HOME_PRODUCT_MAP.map(([label], index) => (
                <li key={label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {label}
                </li>
              ))}
            </ol>
          </aside>

          <div className={styles.storyPanels}>
            {PRODUCT_LAYERS.map((layer, index) => {
              const Icon = layer.icon;
              return (
                <article key={layer.key} data-product-layer={layer.key} className={styles.storyPanel}>
                  <div className={styles.panelMeta}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <Icon aria-hidden="true" size={24} strokeWidth={1.5} />
                  </div>
                  <div className={styles.panelBody}>
                    <h3>{layer.title}</h3>
                    <p>{layer.summary}</p>
                    <ProductPath items={layer.path} />
                    <ul className={styles.factList}>
                      {layer.facts.map((fact) => (
                        <li key={fact}><Check aria-hidden="true" size={16} strokeWidth={2} /><span>{fact}</span></li>
                      ))}
                    </ul>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.loopSection} aria-labelledby="loop-title">
        <div className={styles.loopIntro}>
          <p className={styles.kicker}>LOOP IS A CUSTOM SOP</p>
          <h2 id="loop-title">不是一个通用按钮，而是一条属于你的业务线路</h2>
          <p>真正的难点不是让 Agent 调用工具，而是把目标、权限、例外、证据和责任交接变成可验证的流程。</p>
        </div>
        <div className={styles.loopSteps}>
          {IMPLEMENTATION_STEPS.map(([number, title, detail]) => (
            <div key={number} className={styles.loopStep}>
              <span>{number}</span>
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
          ))}
        </div>
        <div className={styles.loopFootnote}>
          <Sparkles aria-hidden="true" size={18} strokeWidth={1.7} />
          <span>可以从模板开始，但每条进入生产的 Loop 都要经过业务梳理、试点和持续优化。</span>
        </div>
      </section>

      <section className={styles.scenarioSection} id="scenarios" aria-labelledby="scenario-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>ONE THREAD, MANY DOMAINS</p>
            <h2 id="scenario-title">不局限于开发，凡是复杂工作都可以被组织起来</h2>
          </div>
          <p>HumanThread 负责工作编排、协作、审批、异常和证据闭环；行业系统仍然负责权威数据和专业操作。</p>
        </div>
        <div className={styles.scenarioList}>
          {SCENARIOS.map((scenario, index) => {
            const Icon = scenario.icon;
            return (
              <article key={scenario.title} className={styles.scenarioRow}>
                <div className={styles.scenarioMeta}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <Icon aria-hidden="true" size={22} strokeWidth={1.6} />
                </div>
                <div>
                  <span className={styles.scenarioAudience}>{scenario.audience}</span>
                  <h3>{scenario.title}</h3>
                </div>
                <div className={styles.scenarioFlow}>
                  <span>{scenario.flow}</span>
                  <p>{scenario.benefit}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.decisionSection} aria-labelledby="decision-title">
        <div className={styles.decisionIntro}>
          <p className={styles.kicker}>AI PRODUCTIVITY, HUMAN JUDGMENT</p>
          <h2 id="decision-title">让 AI 放大思考，不把责任交给黑箱</h2>
          <p>AI 负责处理信息和生成候选结果；人负责目标、取舍、授权、例外和最终验收。</p>
        </div>
        <div className={styles.decisionColumns}>
          <div className={styles.decisionColumn}>
            <div className={styles.decisionHeading}><BrainCircuit aria-hidden="true" size={22} /><span>AI 适合做</span></div>
            <ul>
              <li>汇总需求、文档和运行记录</li>
              <li>提取约束、生成任务和 SOP 草稿</li>
              <li>分析异常、提出方案、生成报告或代码</li>
              <li>识别模式、推荐下一步和相关知识</li>
            </ul>
          </div>
          <div className={styles.decisionColumn}>
            <div className={styles.decisionHeading}><UserRoundCheck aria-hidden="true" size={22} /><span>人必须掌握</span></div>
            <ul>
              <li>定义目标、优先级和成功标准</li>
              <li>判断事实是否正确、风险是否可接受</li>
              <li>选择方案、批准高风险动作和最终验收</li>
              <li>处理歧义、例外、利益权衡和责任归属</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.securitySection} id="security" aria-labelledby="security-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>SECURITY &amp; BOUNDARIES</p>
            <h2 id="security-title">自动化可以加速，但权限和数据边界不能被跳过</h2>
          </div>
          <p>这些举措用于降低越权、误执行和数据泄露风险，不替代客户自身的安全制度和最终责任。</p>
        </div>
        <div className={styles.securityGrid}>
          {SECURITY_MEASURES.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className={styles.securityItem}>
                <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
                <div><h3>{item.title}</h3><p>{item.detail}</p></div>
              </article>
            );
          })}
        </div>
        <div className={styles.boundaryStrip}>
          <div><strong>HumanThread 负责</strong><span>上下文、Task、Loop、授权、协作、恢复和证据闭环</span></div>
          <div><strong>行业系统负责</strong><span>ERP、MES、CRM、BI、CI/CD 与设备系统中的权威数据和专业操作</span></div>
          <div><strong>专业人员负责</strong><span>最终判断、风险接受、高风险动作和业务结果</span></div>
        </div>
      </section>

      <section className={styles.finalAction} aria-label="开始使用 HumanThread">
        <div>
          <p className={styles.kicker}>START WITH ONE REAL THREAD</p>
          <h2>从一项最容易卡住的工作开始，把它推进到结果。</h2>
        </div>
        <div className={styles.finalLinks}>
          <Link href={HOME_PRIMARY_CTA_HREF} className={styles.primaryButton}>进入工作台<ArrowRight aria-hidden="true" size={18} strokeWidth={1.75} /></Link>
          <Link href={HOME_REGISTER_HREF} className={styles.secondaryButton}>创建个人或公司账号</Link>
          <Link href={HOME_HELP_HREF} className={styles.secondaryButton}>查看帮助中心</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <Image src="/brand/humanthread-mark.svg" alt="" width={24} height={24} />
        <span className={styles.footerName}>HumanThread</span>
        <span className={styles.footerDescription}>Human-guided delivery for Agent work.</span>
        <Link href={HOME_HELP_HREF} className={styles.footerLink}>帮助中心</Link>
        {sourceRepositoryUrl ? (
          <a href={sourceRepositoryUrl} target="_blank" rel="noreferrer noopener" className={styles.footerLink}>
            源代码（AGPL-3.0）
          </a>
        ) : null}
      </footer>
    </main>
  );
}
