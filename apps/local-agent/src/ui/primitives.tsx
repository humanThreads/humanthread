import type { ReactNode } from "react";

export function PageHeader(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="desktop-page-header">
      <div>
        <h1 className="sr-only">{props.title}</h1>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.actions ? <div className="toolbar-actions">{props.actions}</div> : null}
    </header>
  );
}

export function SurfacePanel(props: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={props.label}
      className={`surface-panel${props.className ? ` ${props.className}` : ""}`}
    >
      {props.children}
    </section>
  );
}
