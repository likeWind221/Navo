import type { DesktopResourceFailure } from "../../../../shared/resource.js";

const messages: Record<DesktopResourceFailure["code"], string> = {
  "invalid-request": "资料库请求无效，请返回上级后重试。",
  "project-unavailable": "项目暂时不可用，请重新打开项目后重试。",
  "resource-unavailable": "资料库暂时不可用，请稍后重试。",
  "folder-unavailable": "当前目录暂时不可用，请返回上级或重试。",
  "path-conflict": "目录状态已变化，请重新打开当前目录。",
  "revision-conflict": "资料版本已变化，请重新打开当前目录。",
  "operation-conflict": "资料库正在处理其他操作，请稍后重试。",
  "query-changed": "资料库内容已变化，请重新打开当前目录。",
  internal: "资料库服务暂时不可用，请稍后重试。",
  cancelled: "资料库订阅已停止，请重新打开目录。",
  "host-unavailable": "资料库服务未连接，请确认桌面服务后重试。",
  "invalid-input": "资料库路径无效，请返回上级后重试。",
  "invalid-output": "资料库返回的数据无效，请稍后重试。",
  "bridge-closed": "资料库连接已关闭，请重新打开项目。",
};

export function resourceFailureMessage(failure: DesktopResourceFailure): string {
  return messages[failure.code];
}
