import { RefreshCw } from "lucide-react";

export function ReadModelLoading(props: { label: string }) {
  return (
    <div aria-label={props.label} className="feature-loading-state read-model-loading" role="status">
      <span className="loading-line loading-line-wide" />
      <span className="loading-line" />
      <span className="loading-line loading-line-short" />
    </div>
  );
}

export function ReadModelError(props: { message: string; onRetry(): void }) {
  return (
    <div className="read-model-error" role="alert">
      <strong>当前信息暂时无法加载</strong>
      <span>{props.message}</span>
      <button onClick={props.onRetry} type="button">
        <RefreshCw aria-hidden="true" size={15} />
        重新加载
      </button>
    </div>
  );
}
