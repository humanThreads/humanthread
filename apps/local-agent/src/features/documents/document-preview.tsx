import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

function normalizeMarkdownBullets(markdown: string): string {
  let fenced = false;
  return markdown.split("\n").map((line) => {
    if (/^\s*```/u.test(line)) fenced = !fenced;
    if (fenced) return line;
    return line.replace(/^(\s*)[•▪·]\s+/u, "$1- ");
  }).join("\n");
}

const components: Components = {
  a({ href, children, ...props }) {
    const external = Boolean(href && /^https?:\/\//iu.test(href));
    return (
      <a
        {...props}
        href={href}
        {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      >
        {children}
      </a>
    );
  },
};

export function DocumentPreview(props: { markdown: string; className?: string }) {
  return (
    <div
      className={`document-preview-scroll${props.className ? ` ${props.className}` : ""}`}
      data-testid="document-preview"
    >
      <article className="document-markdown">
        <ReactMarkdown
          components={components}
          remarkPlugins={[remarkGfm, remarkBreaks]}
        >
          {normalizeMarkdownBullets(props.markdown)}
        </ReactMarkdown>
      </article>
    </div>
  );
}
