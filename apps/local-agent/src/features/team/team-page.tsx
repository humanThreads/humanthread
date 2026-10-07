import {
  desktopTeamResponseSchema,
  type DesktopTeamResponse,
} from "@humanthread/workbench-client";
import { CheckCircle2, Clock3, ListTodo, UserRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { useDesktopReadModel } from "../read-first/read-model-query";
import { ReadModelError, ReadModelLoading } from "../read-first/read-model-state";
import { Pagination, usePaginatedItems } from "../../ui/pagination";

type TeamData = DesktopTeamResponse["data"];
type TeamMember = TeamData["members"][number];

function dateTimeLabel(value: string | null): string {
  if (!value) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(value: string): string {
  if (value === "active") return "正常";
  if (value === "disabled") return "已停用";
  return value;
}

function MemberDetail(props: { member: TeamMember }) {
  return (
    <section aria-labelledby="team-member-title" className="team-member-detail">
      <header>
        <span className="read-domain-avatar" aria-hidden="true">
          {props.member.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2 id="team-member-title">{props.member.name}</h2>
          <span>{props.member.email ?? "未公开邮箱"}</span>
        </div>
        <em data-status={props.member.status}>{statusLabel(props.member.status)}</em>
      </header>
      <dl className="team-member-facts">
        <div><dt><ListTodo size={15} />待处理</dt><dd>{props.member.queueLength}</dd></div>
        <div><dt><Clock3 size={15} />最近在线</dt><dd>{dateTimeLabel(props.member.lastSeenAt)}</dd></div>
      </dl>
      <div className="team-current-task">
        <span>当前任务</span>
        {props.member.currentTask ? (
          <Link aria-label={props.member.currentTask.title} to={props.member.currentTask.route}>
            <strong>{props.member.currentTask.title}</strong>
            <small>{props.member.currentTask.projectName} · {props.member.currentTask.status}</small>
          </Link>
        ) : (
          <p>当前没有进行中的任务。</p>
        )}
      </div>
    </section>
  );
}

export function TeamView(props: { data: TeamData; selectedMemberId?: string }) {
  if (props.data.members.length === 0) {
    return (
      <div className="read-domain-empty">
        <UserRound aria-hidden="true" size={22} />
        <strong>当前工作空间暂无团队成员</strong>
        <span>切换到其他公司或个人空间后再查看。</span>
      </div>
    );
  }

  const selected = props.data.members.find((member) => member.id === props.selectedMemberId)
    ?? props.data.members[0];
  const pagination = usePaginatedItems(props.data.members, {
    initialPageSize: 20,
    resetKey: props.selectedMemberId ?? "none",
  });

  return (
    <div className="team-workspace">
      <header className="read-domain-toolbar">
        <div><strong>{props.data.team?.name ?? "个人工作空间"}</strong><span>{props.data.members.length} 位成员</span></div>
        <span><CheckCircle2 aria-hidden="true" size={15} />成员状态来自当前工作空间</span>
      </header>
      <div className="team-layout">
        <nav aria-label="团队成员" className="team-member-list">
          {pagination.items.map((member) => (
            <Link
              aria-current={selected?.id === member.id ? "true" : undefined}
              key={member.id}
              to={member.route}
            >
              <span className="read-domain-avatar" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{member.name}</strong><small>待处理 {member.queueLength}</small></span>
              <em data-status={member.status}>{statusLabel(member.status)}</em>
            </Link>
          ))}
        </nav>
        {selected ? <MemberDetail member={selected} /> : null}
      </div>
      <Pagination label="团队成员分页" pagination={pagination} />
    </div>
  );
}

export function TeamPage() {
  const [searchParams] = useSearchParams();
  const selectedMemberId = searchParams.get("member") ?? undefined;
  const query = useDesktopReadModel({
    domain: "team",
    endpoint: "/api/desktop/team",
    schema: desktopTeamResponseSchema,
  });

  if (query.isPending) return <ReadModelLoading label="正在加载团队" />;
  if (query.isError) return <ReadModelError message={query.error.message} onRetry={() => void query.refetch()} />;
  return (
    <TeamView
      data={query.data.data}
      {...(selectedMemberId ? { selectedMemberId } : {})}
    />
  );
}
