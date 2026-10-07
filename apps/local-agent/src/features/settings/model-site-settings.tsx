import { KeyRound, Plus, RefreshCw, Save, Server, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_REASONING_EFFORT } from "@humanthread/shared";

import {
  computeLocalMd5,
  modelSiteSchema,
  REASONING_EFFORT_OPTIONS,
  type ModelCatalog,
  type ModelSite,
  type ModelSitesDocument,
  type ReasoningEffort,
} from "../../lib/local-model-configuration";
import type { NativeLocalModelCommands } from "../../lib/native-local-model-commands";

const ADAPTER_LABELS = {
  openai_compatible: "OpenAI Compatible",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  codex_environment: "Codex 环境",
} as const;

type SiteForm = {
  siteId: string;
  name: string;
  adapter: ModelSite["adapter"];
  baseUrl: string;
  credentialSource: "environment" | "independent";
  credentialRef: string;
  apiKey: string;
};

function emptyForm(): SiteForm {
  return {
    siteId: "",
    name: "",
    adapter: "openai_compatible",
    baseUrl: "",
    credentialSource: "environment",
    credentialRef: "",
    apiKey: "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "模型站点配置失败";
}

export function ModelSiteSettings(props: {
  nativeAvailable: boolean;
  commands: NativeLocalModelCommands | null;
}) {
  const [document, setDocument] = useState<ModelSitesDocument>({ schemaVersion: 2, sites: [], accountDefault: null });
  const [catalog, setCatalog] = useState<ModelCatalog>({ schemaVersion: 1, sites: {} });
  const [form, setForm] = useState<SiteForm>(emptyForm);
  const [modelSearch, setModelSearch] = useState("");
  const [pending, setPending] = useState<"load" | "save" | "delete" | "defaults" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const selectedSite = useMemo(
    () => document.sites.find((site) => site.siteId === form.siteId) ?? null,
    [document.sites, form.siteId],
  );
  const selectedModels = form.siteId ? catalog.sites[form.siteId]?.models ?? [] : [];
  const filteredModels = selectedModels.filter((model) => {
    const query = modelSearch.trim().toLowerCase();
    return !query || (model.label + " " + model.name).toLowerCase().includes(query);
  }).slice(0, 200);

  function isKnownAccountDefault(value: ModelSitesDocument["accountDefault"]): boolean {
    if (!value) return true;
    return document.sites.some((site) => site.siteId === value.siteId)
      && Boolean(catalog.sites[value.siteId]?.models.some((model) => model.modelKey === value.modelKey));
  }

  function accountDefaultForSave(): ModelSitesDocument["accountDefault"] {
    if (!document.accountDefault) return null;
    if (!isKnownAccountDefault(document.accountDefault)) {
      throw new Error("账号默认模型不在当前本地目录中，请重新选择");
    }
    return document.accountDefault;
  }

  useEffect(() => {
    if (!props.nativeAvailable || !props.commands) return;
    let disposed = false;
    setPending("load");
    void Promise.all([props.commands.listSites(), props.commands.getCatalog()])
      .then(([nextDocument, nextCatalog]) => {
        if (disposed) return;
        setDocument(nextDocument);
        setCatalog(nextCatalog);
        const first = nextDocument.sites[0];
        if (first) setForm((current) => ({ ...current, siteId: first.siteId, name: first.name, adapter: first.adapter, baseUrl: first.baseUrl ?? "", credentialSource: first.credentialSource, credentialRef: first.credentialRef ?? "" }));
      })
      .catch((error: unknown) => {
        if (!disposed) setNotice({ tone: "error", text: errorMessage(error) });
      })
      .finally(() => { if (!disposed) setPending(null); });
    return () => { disposed = true; };
  }, [props.commands, props.nativeAvailable]);

  function selectSite(site: ModelSite | null) {
    if (!site) {
      setForm(emptyForm());
      setModelSearch("");
      return;
    }
    setForm({
      siteId: site.siteId,
      name: site.name,
      adapter: site.adapter,
      baseUrl: site.baseUrl ?? "",
      credentialSource: site.credentialSource,
      credentialRef: site.credentialRef ?? "",
      apiKey: "",
    });
    setModelSearch("");
    setNotice(null);
  }

  async function saveSite() {
    if (!props.commands || !props.nativeAvailable) return;
    setPending("save");
    setNotice(null);
    try {
      const siteId = form.siteId || computeLocalMd5(form.name.trim() + "\0" + form.baseUrl.trim());
      const credentialRef = form.credentialSource === "independent"
        ? form.credentialRef || computeLocalMd5(siteId + "\0openai_api_key")
        : null;
      const site = modelSiteSchema.parse({
        siteId,
        name: form.name,
        adapter: form.adapter,
        baseUrl: form.adapter === "codex_environment" ? null : form.baseUrl,
        credentialSource: form.credentialSource,
        credentialRef,
        status: selectedSite?.status ?? "untested",
        lastValidatedAt: selectedSite?.lastValidatedAt ?? null,
      });
      if (site.credentialSource === "independent" && form.apiKey.trim()) {
        await props.commands.setCredential({ credentialRef: credentialRef!, kind: "openai_api_key", apiKey: form.apiKey });
      }
      const nextDocument = await props.commands.saveSite(site, accountDefaultForSave());
      setDocument(nextDocument);
      selectSite(site);
      setNotice({ tone: "success", text: "模型站点已保存到此设备" });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }

  async function testAndRefresh() {
    if (!props.commands || !props.nativeAvailable) return;
    setPending("save");
    setNotice(null);
    try {
      const siteId = form.siteId || computeLocalMd5(form.name.trim() + "\0" + form.baseUrl.trim());
      const credentialRef = form.credentialSource === "independent"
        ? form.credentialRef || computeLocalMd5(siteId + "\0openai_api_key")
        : null;
      const site = modelSiteSchema.parse({
        siteId,
        name: form.name,
        adapter: form.adapter,
        baseUrl: form.adapter === "codex_environment" ? null : form.baseUrl,
        credentialSource: form.credentialSource,
        credentialRef,
        status: "untested",
        lastValidatedAt: null,
      });
      const discovered = await props.commands.testAndRefreshSite(
        site,
        undefined,
        form.apiKey.trim() || undefined,
      );
      if (site.credentialSource === "independent" && form.apiKey.trim()) {
        await props.commands.setCredential({ credentialRef: credentialRef!, kind: "openai_api_key", apiKey: form.apiKey });
      }
      const readySite = { ...site, status: "ready" as const, lastValidatedAt: discovered.refreshedAt };
      const nextDocument = await props.commands.saveSite(readySite, accountDefaultForSave());
      setDocument(nextDocument);
      setCatalog((current) => ({ ...current, sites: { ...current.sites, [site.siteId]: discovered } }));
      selectSite(readySite);
      setNotice({ tone: "success", text: "连接成功，已获取 " + discovered.models.length + " 个模型" });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }

  async function deleteSite() {
    if (!props.commands || !selectedSite) return;
    setPending("delete");
    setNotice(null);
    try {
      const nextDocument = await props.commands.deleteSite(selectedSite.siteId);
      setDocument(nextDocument);
      setCatalog((current) => {
        const sites = { ...current.sites };
        delete sites[selectedSite.siteId];
        return { ...current, sites };
      });
      selectSite(nextDocument.sites[0] ?? null);
      setNotice({ tone: "success", text: "模型站点已删除" });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }

  function updateAccountDefault(value: string) {
    setDocument((current) => ({
      ...current,
      accountDefault: value
        ? { siteId: value, modelKey: "", reasoningEffort: current.accountDefault?.reasoningEffort ?? DEFAULT_REASONING_EFFORT }
        : null,
    }));
  }

  function updateAccountDefaultModel(modelKey: string) {
    setDocument((current) => current.accountDefault?.siteId
      ? { ...current, accountDefault: { ...current.accountDefault, modelKey } }
      : current);
  }

  function updateAccountDefaultEffort(reasoningEffort: ReasoningEffort) {
    setDocument((current) => current.accountDefault?.siteId
      ? { ...current, accountDefault: { ...current.accountDefault, reasoningEffort } }
      : current);
  }

  async function saveModelDefaults() {
    if (!props.commands || !props.nativeAvailable) return;
    setPending("defaults");
    setNotice(null);
    try {
      const nextDocument = await props.commands.saveModelDefaults(accountDefaultForSave());
      setDocument(nextDocument);
      setNotice({ tone: "success", text: "账号默认模型已保存到此设备" });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }

  if (!props.nativeAvailable || !props.commands) return null;
  return (
    <section aria-labelledby="model-site-settings-title" className="settings-domain-section model-site-settings">
      <header>
        <span className="settings-section-icon"><Server aria-hidden="true" size={18} /></span>
        <div><h2 id="model-site-settings-title">模型站点</h2><p>站点、目录和模型选择仅保存在当前设备。</p></div>
        <em>{document.sites.length} 个站点</em>
      </header>
      <div className="model-site-settings-control">
        <div className="model-site-toolbar">
          <label><span>已配置站点</span><select aria-label="已配置站点" value={form.siteId} onChange={(event) => selectSite(document.sites.find((site) => site.siteId === event.target.value) ?? null)}><option value="">新增站点</option>{document.sites.map((site) => <option key={site.siteId} value={site.siteId}>{site.name}</option>)}</select></label>
          <button aria-label="新增模型站点" disabled={pending !== null} onClick={() => selectSite(null)} type="button"><Plus aria-hidden="true" size={15} />新增</button>
        </div>
        <div className="model-site-form">
          <label><span>站点名称</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>Adapter</span><select value={form.adapter} onChange={(event) => { const adapter = event.target.value as SiteForm["adapter"]; setForm((current) => adapter === "codex_environment" ? { ...current, adapter, baseUrl: "", credentialSource: "environment", credentialRef: "", apiKey: "" } : { ...current, adapter }); }}>{Object.entries(ADAPTER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="model-site-wide-field"><span>Base URL</span><input inputMode="url" value={form.baseUrl} disabled={form.adapter === "codex_environment"} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://models.example.com/v1" /></label>
          <fieldset className="model-site-credential-fields"><legend>凭据来源</legend><label><input aria-label="模型站点复用系统环境" checked={form.credentialSource === "environment"} onChange={() => setForm((current) => ({ ...current, credentialSource: "environment" }))} type="radio" />复用系统环境</label><label><input aria-label="模型站点使用独立 Key" checked={form.credentialSource === "independent"} disabled={form.adapter === "codex_environment"} onChange={() => setForm((current) => ({ ...current, credentialSource: "independent" }))} type="radio" />使用独立 Key</label></fieldset>
          {form.credentialSource === "independent" ? <label className="model-site-wide-field"><span><KeyRound aria-hidden="true" size={13} />独立 Key {selectedSite?.credentialRef ? "（替换时重新输入）" : ""}</span><input autoComplete="new-password" type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={selectedSite?.credentialRef ? "已配置，不回显" : "输入 API key"} /></label> : null}
        </div>
        <div className="model-site-actions">
          <button disabled={pending !== null || !form.name.trim() || form.adapter === "codex_environment"} onClick={() => void testAndRefresh()} type="button"><RefreshCw aria-hidden="true" size={15} />测试并获取模型</button>
          <button disabled={pending !== null || !form.name.trim()} onClick={() => void saveSite()} type="button"><Save aria-hidden="true" size={15} />仅保存</button>
          <button disabled={pending !== null || !selectedSite} onClick={() => void deleteSite()} type="button"><Trash2 aria-hidden="true" size={15} />删除</button>
        </div>
          <div className="model-site-defaults">
          <strong>账号默认</strong>
          <label><span>站点</span><select aria-label="账号默认站点" value={document.accountDefault?.siteId ?? ""} onChange={(event) => updateAccountDefault(event.target.value)}><option value="">跟随 Codex 环境设置</option>{document.sites.map((site) => <option key={site.siteId} value={site.siteId}>{site.name}</option>)}</select></label>
          <label><span>模型</span><input aria-label="账号默认模型" role="combobox" list="account-model-options" value={document.accountDefault?.modelKey ?? ""} onChange={(event) => updateAccountDefaultModel(event.target.value)} placeholder="选择站点后输入或搜索模型 ID" /><datalist id="account-model-options">{(document.accountDefault?.siteId ? catalog.sites[document.accountDefault.siteId]?.models ?? [] : []).map((model) => <option key={model.modelKey} value={model.modelKey}>{model.label} · {model.name}</option>)}</datalist></label>
          <label><span>推理强度</span><select aria-label="账号默认推理强度" disabled={!document.accountDefault?.siteId} value={document.accountDefault?.reasoningEffort ?? DEFAULT_REASONING_EFFORT} onChange={(event) => updateAccountDefaultEffort(event.target.value as ReasoningEffort)}>{REASONING_EFFORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}{value === DEFAULT_REASONING_EFFORT ? "（产品默认）" : ""}</option>)}</select></label>
          <button disabled={pending !== null || !isKnownAccountDefault(document.accountDefault)} onClick={() => void saveModelDefaults()} type="button"><Save aria-hidden="true" size={14} />保存默认</button>
        </div>
        {selectedSite ? <div className="model-site-catalog"><div><strong>本地目录</strong><span>{selectedModels.length} 个模型</span></div><input aria-label="搜索当前模型" placeholder="搜索当前目录" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} /><ul>{filteredModels.length > 0 ? filteredModels.map((model) => <li key={model.modelKey}><span>{model.label}</span><code>{model.name}</code>{model.manual ? <em>手工</em> : null}</li>) : <li className="model-site-empty">尚未获取模型目录，可手工输入模型 ID。</li>}</ul></div> : null}
        {notice ? <p className="runtime-settings-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}
      </div>
    </section>
  );
}
