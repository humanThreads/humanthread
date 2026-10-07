import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { DocumentDiagramPreview, getDocumentDiagramKind, isDocumentDiagramAttachmentHref } from "./document-diagram-preview";

function isExternalHref(href: string | undefined) {
  return Boolean(href && /^https?:\/\//iu.test(href));
}

export function normalizeDocumentMarkdown(markdown: string) {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/u.test(line)) fenced = !fenced;
      if (fenced || !/^\s*•\s+/u.test(line)) return line;
      return line.replace(/^(\s*)•\s+/u, "$1- ");
    })
    .join("\n");
}

function classes(base: string, supplied?: string) {
  return supplied ? `${base} ${supplied}` : base;
}

function renderMermaidDiagram(value: string) {
  const labels = new Map<string, string>();
  const edges: Array<[string, string]> = [];
  for (const line of value.split("\n")) {
    const match = line.match(/([A-Za-z0-9_-]+)\s*\[([^\]]+)\]\s*-->\s*([A-Za-z0-9_-]+)\s*\[([^\]]+)\]/u);
    if (!match) continue;
    const [, fromId, fromLabel, toId, toLabel] = match;
    if (!fromId || !fromLabel || !toId || !toLabel) continue;
    labels.set(fromId, fromLabel);
    labels.set(toId, toLabel);
    edges.push([fromId, toId]);
  }
  const nodes = [...labels.entries()];
  if (!nodes.length) return <pre className="my-5 overflow-x-auto rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-4 text-[13px]">{value}</pre>;
  const width = Math.max(420, nodes.length * 190);
  return (
    <div data-diagram="mermaid" className="my-5 overflow-x-auto rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-4" role="img" aria-label="Mermaid 流程图">
      <svg width={width} height="150" viewBox={`0 0 ${width} 150`} className="max-w-none" aria-hidden="true">
        <defs><marker id="ht-mermaid-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#0969da" /></marker></defs>
        {edges.map(([from, to]) => {
          const fromIndex = nodes.findIndex(([id]) => id === from);
          const toIndex = nodes.findIndex(([id]) => id === to);
          return <line key={`${from}-${to}`} x1={80 + fromIndex * 180} y1="75" x2={80 + toIndex * 180} y2="75" stroke="#0969da" strokeWidth="2" markerEnd="url(#ht-mermaid-arrow)" />;
        })}
        {nodes.map(([id, label], index) => <g key={id}><rect x={index * 180 + 10} y="45" width="140" height="60" rx="10" fill="#ddf4ff" stroke="#0969da" /><text x={index * 180 + 80} y="80" textAnchor="middle" fill="#24292f" fontSize="14">{label}</text></g>)}
      </svg>
    </div>
  );
}

function elementProps<Props extends { node?: unknown }>(props: Props): Omit<Props, "node"> {
  const result = { ...props };
  delete result.node;
  return result;
}

export function DocumentMarkdownRenderer({ markdown }: { markdown: string }) {
  return (
    <article className="document-markdown min-w-0 overflow-wrap-anywhere text-[15px] leading-7 text-[#24292f]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: (props) => <h1 {...elementProps(props)} className={classes("mb-5 mt-1 break-words border-b border-[#d8dee4] pb-3 text-[28px] font-semibold leading-9", props.className)} />,
          h2: (props) => <h2 {...elementProps(props)} className={classes("mb-3 mt-8 break-words border-b border-[#d8dee4] pb-2 text-[22px] font-semibold leading-8", props.className)} />,
          h3: (props) => <h3 {...elementProps(props)} className={classes("mb-2 mt-6 break-words text-lg font-semibold leading-7", props.className)} />,
          h4: (props) => <h4 {...elementProps(props)} className={classes("mb-2 mt-5 break-words text-base font-semibold", props.className)} />,
          p: (props) => <p {...elementProps(props)} className={classes("my-3 break-words", props.className)} />,
          ul: (props) => <ul {...elementProps(props)} className={classes("my-3 list-disc space-y-1 pl-6 marker:text-[#656d76]", props.className)} />,
          ol: (props) => <ol {...elementProps(props)} className={classes("my-3 list-decimal space-y-1 pl-6 marker:text-[#656d76]", props.className)} />,
          li: (props) => <li {...elementProps(props)} className={classes("pl-1 [&>p]:my-1", props.className)} />,
          input: (props) => <input {...elementProps(props)} className={classes("mr-2 h-4 w-4 align-[-2px] accent-[#1f883d]", props.className)} />,
          blockquote: (props) => <blockquote {...elementProps(props)} className={classes("my-4 border-l-4 border-[#8c959f] bg-[#f6f8fa] px-4 py-2 text-[#57606a]", props.className)} />,
          table: (props) => <div className="my-5 max-w-full overflow-x-auto rounded-md border border-[#d0d7de]"><table {...elementProps(props)} className={classes("w-full border-collapse text-sm", props.className)} /></div>,
          th: (props) => <th {...elementProps(props)} className={classes("border-b border-r border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 text-left font-semibold last:border-r-0", props.className)} />,
          td: (props) => <td {...elementProps(props)} className={classes("border-b border-r border-[#d0d7de] px-3 py-2 align-top last:border-r-0", props.className)} />,
          pre: (props) => {
            const code = typeof props.children === "object" && props.children !== null && "props" in props.children
              ? (props.children as { props?: { className?: string; children?: React.ReactNode } }).props
              : null;
            const text = typeof code?.children === "string" ? code.children : null;
            if (code?.className === "language-mermaid" && text) return renderMermaidDiagram(text);
            return <pre {...elementProps(props)} className={classes("my-5 max-w-full overflow-x-auto rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-4 text-[13px] leading-6", props.className)} />;
          },
          code: (props) => (
            <code {...elementProps(props)} className={props.className ?? "break-words rounded bg-[#eff1f3] px-1.5 py-0.5 font-mono text-[0.9em]"} />
          ),
          a: (props) => {
            const label = typeof props.children === "string" ? props.children : "";
            const diagramKind = getDocumentDiagramKind(label, props.href);
            if (diagramKind && isDocumentDiagramAttachmentHref(props.href)) {
              return <DocumentDiagramPreview kind={diagramKind} label={label} href={props.href!} />;
            }
            return (
              <a
                {...elementProps(props)}
                className={classes("break-words font-medium text-[#0969da] underline decoration-[#0969da]/30 underline-offset-4 hover:decoration-[#0969da]", props.className)}
                {...(isExternalHref(props.href) ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              />
            );
          },
          img: (props) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img {...elementProps(props)} alt={props.alt ?? ""} className={classes("my-5 max-h-[680px] max-w-full rounded-md border border-[#d0d7de] object-contain", props.className)} />
          ),
          hr: () => <hr className="my-8 border-0 border-t border-[#d8dee4]" />,
        }}
      >
        {normalizeDocumentMarkdown(markdown)}
      </ReactMarkdown>
    </article>
  );
}
