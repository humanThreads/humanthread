import { ChevronLeft, ChevronRight } from "lucide-react";

export function TaskPagination(props: {
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onPageChange(page: number): void;
  onPageSizeChange(pageSize: number): void;
}) {
  const pageCount = Math.max(1, Math.ceil(props.total / props.pageSize));
  const firstItem = props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1;
  const lastItem = Math.min(props.page * props.pageSize, props.total);

  return (
    <nav aria-label="任务列表分页" className="task-pagination">
      <span>{props.total === 0 ? "共 0 条" : `${firstItem}-${lastItem} / 共 ${props.total} 条`}</span>
      <div className="task-pagination-controls">
        <label>
          <span>每页</span>
          <select
            aria-label="任务每页条数"
            onChange={(event) => props.onPageSizeChange(Number(event.target.value))}
            value={props.pageSize}
          >
            {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button
          aria-label="任务列表上一页"
          disabled={!props.hasPreviousPage}
          onClick={() => props.onPageChange(Math.max(1, props.page - 1))}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        <span aria-current="page">{props.page} / {pageCount}</span>
        <button
          aria-label="任务列表下一页"
          disabled={!props.hasNextPage}
          onClick={() => props.onPageChange(props.page + 1)}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
    </nav>
  );
}
