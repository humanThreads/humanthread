import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  WorkbenchCompanySettingsContext,
  WorkbenchSettingsContext,
} from "../../lib/workbench/workbench-settings-context";
import { CompanySettingsLayout } from "./company-settings-layout";

const companyContext: WorkbenchCompanySettingsContext = {
  company: {
    id: "company_1",
    name: "HumanThread",
    slug: "humanthread",
    logoUrl: null,
    status: "active",
  },
  membership: {
    role: "member",
    canManageProfile: false,
    canManageMembers: false,
    canManageIntegrations: false,
    canTransferOwnership: false,
  },
};

const companies: WorkbenchSettingsContext["companies"] = [
  {
    id: "company_1",
    name: "HumanThread",
    logoUrl: null,
    role: "member",
    canManage: false,
  },
  {
    id: "company_2",
    name: "Delivery Lab",
    logoUrl: null,
    role: "admin",
    canManage: true,
  },
];

describe("company settings layout", () => {
  it("keeps company identity, role and switch targets explicit", () => {
    const markup = renderToStaticMarkup(
      createElement(
        CompanySettingsLayout,
        {
          activeKey: "overview",
          context: companyContext,
          companies,
        },
        "公司正文",
      ),
    );

    expect(markup).toContain("HumanThread");
    expect(markup).toContain("member");
    expect(markup).toContain("/companies/company_1");
    expect(markup).toContain("/companies/company_2");
    expect(markup).toContain("公司正文");
    expect(markup).not.toContain("/companies/company_1/integrations");
  });

  it("adds a company-scoped Worker image catalog entry for company administrators", () => {
    const markup = renderToStaticMarkup(
      createElement(
        CompanySettingsLayout,
        {
          activeKey: "worker-images",
          context: {
            ...companyContext,
            membership: { ...companyContext.membership, role: "admin", canManageIntegrations: true },
          },
          companies,
        },
        "镜像正文",
      ),
    );

    expect(markup).toContain("Worker 镜像");
    expect(markup).toContain("/companies/company_1/worker-images");
    expect(markup).toContain("aria-current=\"page\"");
  });
});
