import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface PaginationState<T> {
  items: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  setPage(page: number): void;
  setPageSize(pageSize: number): void;
}

export function usePaginatedItems<T>(
  source: readonly T[],
  input: { initialPageSize?: number; resetKey?: string | number } = {},
): PaginationState<T> {
  const [pageSize, setPageSize] = useState(input.initialPageSize ?? 20);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(source.length / pageSize));

  useEffect(() => setPage(1), [input.resetKey, pageSize]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

  const items = useMemo(() => {
    const start = (page - 1) * pageSize;
    return source.slice(start, start + pageSize);
  }, [page, pageSize, source]);

  return { items, page, pageCount, pageSize, total: source.length, setPage, setPageSize };
}

export function Pagination<T>(props: {
  label: string;
  pagination: PaginationState<T>;
  pageSizeOptions?: readonly number[];
}) {
  const pageNumbers = visiblePageNumbers(props.pagination.page, props.pagination.pageCount);
  return (
    <nav aria-label={props.label} className="desktop-pagination">
      <span>{props.pagination.total} 条</span>
      <div>
        <label>
          <span>每页</span>
          <select
            aria-label={`${props.label}每页条数`}
            onChange={(event) => props.pagination.setPageSize(Number(event.target.value))}
            value={props.pagination.pageSize}
          >
            {(props.pageSizeOptions ?? [10, 20, 50]).map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button aria-label={`${props.label}上一页`} disabled={props.pagination.page <= 1} onClick={() => props.pagination.setPage(props.pagination.page - 1)} type="button"><ChevronLeft aria-hidden="true" size={16} /></button>
        {pageNumbers.map((page) => <button aria-current={page === props.pagination.page ? "page" : undefined} key={page} onClick={() => props.pagination.setPage(page)} type="button">{page}</button>)}
        <button aria-label={`${props.label}下一页`} disabled={props.pagination.page >= props.pagination.pageCount} onClick={() => props.pagination.setPage(props.pagination.page + 1)} type="button"><ChevronRight aria-hidden="true" size={16} /></button>
      </div>
    </nav>
  );
}

function visiblePageNumbers(page: number, pageCount: number): number[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}
