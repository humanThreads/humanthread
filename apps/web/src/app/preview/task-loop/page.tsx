import type { Metadata } from "next";
import { TaskLoopPreview } from "../../components/preview/task-loop-preview";

export const metadata: Metadata = {
  title: "任务执行页面预览 · HumanThread",
  description: "任务独立页面与 Loop 启动配置的界面预览",
};

export default function TaskLoopPreviewPage() {
  return <TaskLoopPreview />;
}
