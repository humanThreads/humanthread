import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination, usePaginatedItems } from "./pagination";

describe("desktop pagination", () => {
  it("paginates local collections and exposes page controls", async () => {
    const user = userEvent.setup();
    function Harness() {
      const pagination = usePaginatedItems(Array.from({ length: 35 }, (_, index) => index + 1), { initialPageSize: 10 });
      return <><span>{pagination.items.join(",")}</span><Pagination label="项目列表分页" pagination={pagination} /></>;
    }
    render(<Harness />);
    expect(screen.getByText("1,2,3,4,5,6,7,8,9,10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "项目列表分页下一页" }));
    expect(screen.getByText("11,12,13,14,15,16,17,18,19,20")).toBeInTheDocument();
    expect(screen.getByText("35 条")).toBeInTheDocument();
    vi.clearAllMocks();
  });
});
