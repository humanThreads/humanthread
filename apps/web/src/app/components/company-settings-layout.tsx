"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Boxes, Building2, ChevronDown, Mail, Menu, ServerCog, UsersRound, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type {
  WorkbenchCompanySettingsContext,
  WorkbenchSettingsContext,
} from "../../lib/workbench/workbench-settings-context";

export type CompanySettingsNavKey = "overview" | "members" | "integrations" | "workers" | "worker-images";

function CompanyNavigation({
  activeKey,
  context,
}: {
  activeKey: CompanySettingsNavKey;
  context: WorkbenchCompanySettingsContext;
}) {
  const items = [
    { key: "overview" as const, label: "概览与资料", href: `/companies/${context.company.id}`, icon: Building2 },
    { key: "members" as const, label: "成员与角色", href: `/companies/${context.company.id}/members`, icon: UsersRound },
    ...(context.membership.canManageIntegrations
      ? [{ key: "integrations" as const, label: "公司集成", href: `/companies/${context.company.id}/integrations`, icon: Mail }]
      : []),
    ...(context.membership.canManageIntegrations
      ? [{ key: "workers" as const, label: "Linux Worker", href: `/companies/${context.company.id}/workers`, icon: ServerCog }]
      : []),
    ...(context.membership.canManageIntegrations
      ? [{ key: "worker-images" as const, label: "Worker 镜像", href: `/companies/${context.company.id}/worker-images`, icon: Boxes }]
      : []),
  ];

  return (
    <nav aria-label="公司设置导航" className="grid gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.key === activeKey;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={active
              ? "flex min-h-9 items-center gap-2 rounded-md bg-[#f6f8fa] px-3 text-sm font-semibold text-[#24292f] ring-1 ring-inset ring-[#d0d7de]"
              : "flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#24292f]"}
          >
            <Icon size={16} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function CompanyIdentity({
  context,
  companies,
}: {
  context: WorkbenchCompanySettingsContext;
  companies: WorkbenchSettingsContext["companies"];
}) {
  return (
    <div className="grid gap-3 border-b border-[#d8dee4] pb-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[#24292f]">{context.company.name}</div>
        <div className="mt-1 text-xs text-[#57606a]">当前角色：{context.membership.role}</div>
      </div>
      <details className="group">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-[#d0d7de] bg-white px-3 text-xs font-semibold text-[#24292f]">
          切换公司
          <ChevronDown className="ml-auto transition-transform group-open:rotate-180 motion-reduce:transition-none" size={14} aria-hidden="true" />
        </summary>
        <div className="mt-2 grid gap-1 border-l border-[#d8dee4] pl-2">
          {companies.map((company) => (
            <Link key={company.id} href={`/companies/${company.id}`} className="rounded-md px-2 py-2 text-xs font-medium text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#24292f]">
              {company.name} · {company.role}
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}

function CompanySettingsSidebar({ activeKey, context, companies }: {
  activeKey: CompanySettingsNavKey;
  context: WorkbenchCompanySettingsContext;
  companies: WorkbenchSettingsContext["companies"];
}) {
  return (
    <div className="grid gap-4">
      <CompanyIdentity context={context} companies={companies} />
      <CompanyNavigation activeKey={activeKey} context={context} />
      <Link href="/settings/companies" className="px-3 text-xs font-semibold text-[#0969da] hover:underline">返回公司列表</Link>
    </div>
  );
}

export function CompanySettingsLayout({
  activeKey,
  context,
  companies,
  children,
}: {
  activeKey: CompanySettingsNavKey;
  context: WorkbenchCompanySettingsContext;
  companies: WorkbenchSettingsContext["companies"];
  children?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="hidden border-r border-[#d8dee4] pr-4 lg:block">
        <CompanySettingsSidebar activeKey={activeKey} context={context} companies={companies} />
      </aside>
      <div className="lg:hidden">
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-md border border-[#d0d7de] bg-white px-3 text-left text-sm font-semibold text-[#24292f]">
              <Menu size={17} aria-hidden="true" />
              {context.company.name} · {context.membership.role}
              <ChevronDown className="ml-auto" size={15} aria-hidden="true" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/40" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(88vw,320px)] overflow-y-auto border-r border-[#d0d7de] bg-white p-4 shadow-xl outline-none">
              <div className="mb-4 flex items-center justify-between">
                <Dialog.Title className="text-base font-semibold">公司设置</Dialog.Title>
                <Dialog.Close className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa]" aria-label="关闭公司设置导航"><X size={17} /></Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">切换公司和公司设置页面</Dialog.Description>
              <CompanySettingsSidebar activeKey={activeKey} context={context} companies={companies} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
