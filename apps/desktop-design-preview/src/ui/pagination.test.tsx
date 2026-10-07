import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Pagination, usePaginatedItems } from "./pagination";

describe("usePaginatedItems", () => {
  it("slices data, clamps the current page and resets when the filter changes", () => {
    const { result, rerender } = renderHook(
      ({ items, resetKey }) => usePaginatedItems(items, { initialPageSize: 10, resetKey }),
      { initialProps: { items: Array.from({ length: 25 }, (_, index) => index + 1), resetKey: "all" } },
    );

    expect(result.current.pageCount).toBe(3);
    act(() => result.current.setPage(3));
    expect(result.current.items).toEqual([21, 22, 23, 24, 25]);

    rerender({ items: [1, 2, 3], resetKey: "filtered" });
    expect(result.current.page).toBe(1);
    expect(result.current.items).toEqual([1, 2, 3]);
  });
});

describe("Pagination", () => {
  it("renders complete page controls and supports changing the page size", async () => {
    const user = userEvent.setup();
    const source = Array.from({ length: 35 }, (_, index) => index + 1);

    function Harness() {
      const pagination = usePaginatedItems(source, { initialPageSize: 10 });
      return <Pagination label="任务列表分页" pagination={pagination} />;
    }

    render(<Harness />);
    expect(screen.getByText("1-10 / 共 35 条")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("任务列表分页每页条数"), "20");
    expect(screen.getByText("1-20 / 共 35 条")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "任务列表分页下一页" }));
    expect(screen.getByText("21-35 / 共 35 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "任务列表分页下一页" })).toBeDisabled();
  });
});
