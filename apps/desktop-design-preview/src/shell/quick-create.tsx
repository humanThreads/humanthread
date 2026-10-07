import { FilePlus2, FolderPlus, ListPlus, X } from "lucide-react";
import { useState } from "react";

type CreateKind = "task" | "project" | "document";

const OPTIONS: Array<{ key: CreateKind; label: string; description: string; icon: typeof ListPlus }> = [
  { key: "task", label: "任务", description: "从标题和验收目标开始", icon: ListPlus },
  { key: "project", label: "项目", description: "建立目标、路线图与协作空间", icon: FolderPlus },
  { key: "document", label: "文档", description: "创建可版本化的 Markdown 文档", icon: FilePlus2 },
];

export function QuickCreate(props: { onClose(): void }) {
  const [kind, setKind] = useState<CreateKind>("task");
  const selected = OPTIONS.find((option) => option.key === kind) ?? OPTIONS[0]!;

  return (
    <div className="overlay-backdrop" onMouseDown={props.onClose}>
      <section
        aria-label="快速新建"
        aria-modal="true"
        className="quick-create-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="dialog-header">
          <div><h2>快速新建</h2><p>设计预览只读，写操作未启用</p></div>
          <button aria-label="关闭快速新建" className="icon-button" onClick={props.onClose} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <div className="quick-create-tabs" role="tablist" aria-label="创建类型">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            return <button aria-selected={kind === option.key} key={option.key} onClick={() => setKind(option.key)} role="tab" type="button"><Icon aria-hidden="true" size={15} />{option.label}</button>;
          })}
        </div>
        <div className="quick-create-form">
          <label className="field"><span>{selected.label}标题</span><input disabled placeholder={`输入${selected.label}标题`} /></label>
          {kind !== "document" ? <label className="field"><span>{kind === "task" ? "验收目标" : "项目目标"}</span><textarea disabled placeholder="描述完成后需要达到的结果" /></label> : null}
          <div className="read-only-note">{selected.description}。预览不会向官网发送创建请求。</div>
          <button className="primary-button" disabled type="button">创建{selected.label}</button>
        </div>
      </section>
    </div>
  );
}
