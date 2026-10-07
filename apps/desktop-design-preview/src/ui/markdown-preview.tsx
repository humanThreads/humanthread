import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

function normalizeMarkdown(markdown: string): string {
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
        {...(external ? { rel: "noreferrer noopener", target: "_blank" } : {})}
      >
        {children}
      </a>
    );
  },
};

export function MarkdownPreview(props: {
  markdown: string;
  className?: string;
}) {
  return (
    <article
      className={`document-markdown${props.className ? ` ${props.className}` : ""}`}
      data-testid="document-markdown"
    >
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm, remarkBreaks]}
      >
        {normalizeMarkdown(props.markdown)}
      </ReactMarkdown>
    </article>
  );
}
