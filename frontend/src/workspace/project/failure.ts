import type { DesktopProjectFailure } from "../../../shared/project.js";

export function projectFailureMessage(failure: DesktopProjectFailure): string {
  switch (failure.code) {
    case "invalid-request":
      return "名称、目标或工作目录不符合要求（名称必填，目标可留空），请检查后重试。";
    case "workspace-conflict":
      return "该目录已被其他项目绑定，请选择其他目录。";
    case "workspace-invalid":
      return "工作目录不存在或不可访问，请重新选择。";
    case "project-not-found":
      return "项目不存在，可能因 Host 重启已被清空。";
    case "project-unavailable":
      return "项目当前不可用，请稍后重试。";
    case "runtime-unavailable":
      return "Agent 运行时暂不可用，请稍后重试。";
    case "auto-run-active":
      return "项目已有自动运行，请恢复已有运行。";
    case "auto-run-not-found":
      return "项目没有可控制的自动运行，请先启动。";
    case "auto-run-not-paused":
      return "自动运行尚未暂停，无法恢复。";
    case "auto-run-unavailable":
      return "自动运行需要已确定的目标和路线图。";
    case "internal":
      return "后端内部错误，请稍后重试。";
    case "node-not-found":
    case "turn-active":
    case "invalid-state":
    case "revision-conflict":
      return `项目操作失败：${failure.message}`;
    case "host-unavailable":
      return "后端未连接，请确认 Kernel Host 已启动。";
    case "invalid-input":
      return "请求无效，请检查填写内容。";
    case "invalid-output":
      return "后端返回了异常数据。";
    case "bridge-closed":
      return "桌面桥接已关闭，请重新启动应用。";
  }
}
