import { useState, type FormEvent } from "react";
import { FileText, FolderKanban, ListTodo, X } from "lucide-react";

type CreateKind = "task" | "project" | "document";
const CREATE_LABELS: Record<CreateKind, string> = {
  task: "任务",
  project: "项目",
  document: "文档",
};

function commandId(): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `desktop:create:${id}`;
}

export function QuickCreateDialog(props: {
  onClose: () => void;
  createTask: (input: { commandId: string; title: string }) => Promise<void>;
  createProject: (input: { name: string; objective: string }) => Promise<void>;
  createDocument: (input: { title: string }) => Promise<void>;
}) {
  const [kind, setKind] = useState<CreateKind>("task");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedObjective = objective.trim();
    if (!normalizedTitle) {
      setError(`请填写${CREATE_LABELS[kind]}标题`);
      return;
    }
    if (kind === "project" && !normalizedObjective) {
      setError("请填写项目目标");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (kind === "task") await props.createTask({ commandId: commandId(), title: normalizedTitle });
      if (kind === "project") await props.createProject({ name: normalizedTitle, objective: normalizedObjective });
      if (kind === "document") await props.createDocument({ title: normalizedTitle });
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    } finally {
      setPending(false);
    }
  }

  function selectKind(nextKind: CreateKind) {
    setKind(nextKind);
    setError(null);
  }

  return (
    <div className="desktop-overlay" role="presentation">
      <section className="quick-create" aria-label="快速新建" aria-modal="true" role="dialog">
        <header><h2>快速新建</h2><button aria-label="关闭快速新建" onClick={props.onClose} type="button"><X size={18} /></button></header>
        <div className="quick-create-kinds" role="tablist">
          <button aria-selected={kind === "task"} disabled={pending} onClick={() => selectKind("task")} role="tab" type="button"><ListTodo size={16} />任务</button>
          <button aria-selected={kind === "project"} disabled={pending} onClick={() => selectKind("project")} role="tab" type="button"><FolderKanban size={16} />项目</button>
          <button aria-selected={kind === "document"} disabled={pending} onClick={() => selectKind("document")} role="tab" type="button"><FileText size={16} />文档</button>
        </div>
        <form noValidate onSubmit={submit}>
          <label className="desktop-field">
            <span>{CREATE_LABELS[kind]}标题</span>
            <input aria-label={`${CREATE_LABELS[kind]}标题`} autoFocus onChange={(event) => setTitle(event.target.value)} required value={title} />
          </label>
          {kind === "project" ? <label className="desktop-field"><span>项目目标</span><textarea onChange={(event) => setObjective(event.target.value)} required value={objective} /></label> : null}
          {error ? <p role="alert">{error}</p> : null}
          <footer><button disabled={pending} onClick={props.onClose} type="button">取消</button><button disabled={pending} type="submit">{pending ? "创建中" : `创建${CREATE_LABELS[kind]}`}</button></footer>
        </form>
      </section>
    </div>
  );
}
