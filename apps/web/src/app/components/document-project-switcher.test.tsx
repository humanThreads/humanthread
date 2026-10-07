// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentProjectSwitcher } from "./document-project-switcher";

describe("DocumentProjectSwitcher", () => {
  it("uses a select and reports project changes without navigation links", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DocumentProjectSwitcher projects={[{ id: "p1", name: "项目一" }]} selectedProjectId="p1" companyDocumentsHref="/documents" onProjectChange={onChange} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "当前项目" }), "__company__");
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("link", { name: "项目一" })).toBeNull();
  });
});
