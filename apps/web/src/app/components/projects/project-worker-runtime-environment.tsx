"use client";

import { defaultWorkerRuntimeEnvironment, resolveWorkerRuntimeEnvironment, workerRuntimeEnvironmentProfiles, type WorkerRuntimeEnvironment } from "../../../lib/orchestration/worker-runtime-environment";

export function ProjectWorkerRuntimeEnvironment({ value, onChange }: { value?: WorkerRuntimeEnvironment | undefined; onChange: (value: WorkerRuntimeEnvironment) => void }) {
  const configuration = value ?? defaultWorkerRuntimeEnvironment("custom");
  let resolved: ReturnType<typeof resolveWorkerRuntimeEnvironment> | null = null;
  try { resolved = resolveWorkerRuntimeEnvironment(configuration); } catch { resolved = null; }
  const update = (patch: Partial<WorkerRuntimeEnvironment>) => onChange({ ...configuration, ...patch });

  return <section className="grid gap-3 rounded-md border border-[#d0d7de] bg-white p-3">
    <div>
      <h3 className="text-sm font-semibold">项目运行环境</h3>
      <p className="mt-1 text-xs leading-5 text-[#57606a]">选择常用开发环境可快速填入非敏感运行配置。缓存值只填写挂载根目录下的相对子路径，平台会在 Docker volume 或 Kubernetes PVC 挂载后自动拼接。</p>
    </div>
    <label className="grid max-w-md gap-1 text-xs font-semibold">常用开发环境<select aria-label="常用开发环境" value={configuration.profile} onChange={(event) => onChange(defaultWorkerRuntimeEnvironment(event.currentTarget.value as WorkerRuntimeEnvironment["profile"]))} className="rounded border border-[#d0d7de] bg-white px-2 py-2 text-sm font-normal">{workerRuntimeEnvironmentProfiles.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}</select></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold">挂载根目录<input aria-label="挂载根目录" value={configuration.mountPath} onChange={(event) => update({ mountPath: event.currentTarget.value })} className="rounded border border-[#d0d7de] px-2 py-2 font-mono text-sm font-normal" /></label>
      <label className="grid gap-1 text-xs font-semibold">任务目录相对子路径<input aria-label="任务目录相对子路径" value={configuration.taskSubpath} onChange={(event) => update({ taskSubpath: event.currentTarget.value })} className="rounded border border-[#d0d7de] px-2 py-2 font-mono text-sm font-normal" /></label>
    </div>
    <div className="grid gap-2">
      <div className="flex items-center justify-between"><span className="text-xs font-semibold">非敏感运行变量</span><button type="button" className="text-xs font-semibold text-[#0969da]" onClick={() => update({ variables: [...configuration.variables, { name: "", value: "", pathValue: false }] })}>新增运行变量</button></div>
      {configuration.variables.map((variable, index) => <div key={`${variable.name}-${index}`} className="grid gap-2 rounded border border-[#d8dee4] bg-[#f6f8fa] p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input aria-label="运行变量名" value={variable.name} placeholder="变量名" onChange={(event) => update({ variables: configuration.variables.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.currentTarget.value } : item) })} className="rounded border border-[#d0d7de] bg-white px-2 py-1.5 font-mono text-xs" />
        <input aria-label="运行变量值" value={variable.value} placeholder={variable.pathValue ? "/cache" : "值（可为空）"} onChange={(event) => update({ variables: configuration.variables.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.currentTarget.value } : item) })} className="rounded border border-[#d0d7de] bg-white px-2 py-1.5 font-mono text-xs" />
        <div className="flex items-center gap-2 text-[11px]"><label className="flex items-center gap-1"><input type="checkbox" checked={variable.pathValue} onChange={(event) => update({ variables: configuration.variables.map((item, itemIndex) => itemIndex === index ? { ...item, pathValue: event.currentTarget.checked } : item) })} />路径</label><button type="button" className="text-[#cf222e]" onClick={() => update({ variables: configuration.variables.filter((_, itemIndex) => itemIndex !== index) })}>删除</button></div>
      </div>)}
      {configuration.variables.length === 0 ? <p className="text-xs text-[#57606a]">当前环境没有预填变量，可新增自定义非敏感变量。</p> : null}
    </div>
    {resolved ? <div className="rounded border border-[#d8dee4] bg-[#f6f8fa] p-2 text-xs leading-5"><p className="font-semibold">容器内解析结果</p><p className="font-mono">任务目录：{resolved.taskRoot}</p>{Object.entries(resolved.variables).map(([name, resolvedValue]) => <p className="font-mono" key={name}>{name}={resolvedValue}</p>)}</div> : null}
  </section>;
}
