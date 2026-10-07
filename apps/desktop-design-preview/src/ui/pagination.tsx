import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface PaginationState<T> {
  items: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  firstItem: number;
  lastItem: number;
  setPage(page: number): void;
  setPageSize(pageSize: number): void;
}

export function usePaginatedItems<T>(
  source: readonly T[],
  input: {
    initialPageSize?: number;
    resetKey?: string | number;
  } = {},
): PaginationState<T> {
  const [pageSize, setPageSizeState] = useState(input.initialPageSize ?? 20);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(source.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [input.resetKey, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const items = useMemo(() => {
    const start = (page - 1) * pageSize;
    return source.slice(start, start + pageSize);
  }, [page, pageSize, source]);

  return {
    items,
    page,
    pageCount,
    pageSize,
    total: source.length,
    firstItem: source.length === 0 ? 0 : (page - 1) * pageSize + 1,
    lastItem: Math.min(page * pageSize, source.length),
    setPage,
    setPageSize: setPageSizeState,
  };
}

export function Pagination<T>(props: {
  label: string;
  pagination: PaginationState<T>;
  pageSizeOptions?: readonly number[];
}) {
  const { pagination } = props;
  const pageSizeOptions = props.pageSizeOptions ?? [10, 20, 50];
  const pageNumbers = visiblePageNumbers(pagination.page, pagination.pageCount);

  return (
    <nav aria-label={props.label} className="pagination">
      <span className="pagination-summary">
        {pagination.total === 0
          ? "共 0 条"
          : `${pagination.firstItem}-${pagination.lastItem} / 共 ${pagination.total} 条`}
      </span>
      <div className="pagination-controls">
        <label className="pagination-size">
          <span>每页</span>
          <select
            aria-label={`${props.label}每页条数`}
            onChange={(event) => pagination.setPageSize(Number(event.target.value))}
            value={pagination.pageSize}
          >
            {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button
          aria-label={`${props.label}上一页`}
          className="icon-button"
          disabled={pagination.page <= 1}
          onClick={() => pagination.setPage(pagination.page - 1)}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        {pageNumbers.map((pageNumber) => (
          <button
            aria-current={pageNumber === pagination.page ? "page" : undefined}
            className="pagination-page"
            key={pageNumber}
            onClick={() => pagination.setPage(pageNumber)}
            type="button"
          >
            {pageNumber}
          </button>
        ))}
        <button
          aria-label={`${props.label}下一页`}
          className="icon-button"
          disabled={pagination.page >= pagination.pageCount}
          onClick={() => pagination.setPage(pagination.page + 1)}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
    </nav>
  );
}

function visiblePageNumbers(page: number, pageCount: number): number[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}
