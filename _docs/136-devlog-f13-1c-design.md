# F13.1c 用户资料补充与管理接入：技术设计

日期：2026-10-21  
基线：`master`，F13.1b 合并提交 `845b864`（PR #87）  
状态：技术设计已收口，尚未实施。本文只冻结设计与验收边界，不修改生产代码。

## 1. 目标与非目标

### 目标

- 为单机 Navo 增加固定的 User 主体，不引入 UserID、用户表、注册登录或多用户系统。
- 支持用户从可信桌面入口导入单文件、多文件和目录，保留目录相对结构，并复用现有 Resource 与资产生命周期。
- 用户导入资料以 User 作为稳定的原始归属标记，默认对同一 Project 内所有 Node 可用。
- 用户管理权限与 Resource.owner 分开：用户可以管理项目内全部资料，但编辑、替换或删除 Agent 资料不改变其原始 owner。
- 通过版本化 RPC 返回逐文件保存结果；保存成功与 F13.1b 的正文处理结果保持分离。
- 为后续 F13.2 资料浏览与管理交付可信的 User 服务入口，不提前实现 Renderer 页面。

### 非目标

- 不创建 UserID、用户表、登录认证、多用户隔离或账号切换。
- 不新增 `createdBy` / `sourceKind` 字段；创建者和来源类别由稳定的 `owner` 推导。
- 不实现文件夹 CRUD、资料库页面、搜索、Chunk、Embedding、索引或引用 UI。
- 不提供独立的“重试导入失败项”RPC；用户可重新选择失败文件发起新导入。
- 不允许 Agent 通过用户导入 RPC 读取任意本地路径；不新增 Agent 目录导入工具。
- 不重复实现 F13.1a 的原始资产保存，也不重复实现 F13.1b 的正文提取、状态和恢复。

## 2. 当前代码基线与复用边界

F13.1b 已合并到 master。PR #87 的 GitHub Actions CI run `39542644391` 结果为 success；实施记录报告 Node 24 下 typecheck 与 139 个测试文件 / 891 项完整测试通过。

- `src/resource/model.ts`：当前 `ResourcePrincipal` 为 Main / Node 两类；Resource 已有稳定 ID、owner、access、assetGeneration 与 libraryPath。
- `src/resource/access.ts`、`validation.ts`、`history.ts`、`projector.ts`：负责主体规范化、权限判定、历史事件校验与投影。新增 User 时必须同步这些边界，不能只扩展 TypeScript 联合类型。
- `src/resource/lifecycle.ts`：现有创建流程使用 `AssetCreation` / `AssetIntake`，将来源文件暂存并提交不可变资产版本；操作记录会保存请求信息，因此不能把本地绝对路径放入 `sourceRef`。
- `src/resource/library.ts`：已有逻辑路径规范化、大小写不敏感冲突检查和 `numberedLibraryPath`，用于同目录重名编号。
- `src/resource/service.ts`：发布成功后发出 `resource/committed`。新用户导入路径必须保留这一通知，使 F13.1b 的 `ContentProcessor` 自动接手，不得直接写正文表。
- `src/resource/content.ts` 与 `src/storage/content.ts`：F13.1b 已提供内部正文处理、状态和显式重处理能力；本 Step 不新增正文任务表或公开重试 RPC。
- `rpc/project.ts`、`src/host/project.ts`、`src/host/main.ts`：现有版本化 RPC 与 Host 注册方式可作为公共接口形态参考。

## 3. 身份、归属与权限

### 3.1 单一 User 主体

将 `ResourcePrincipal` 扩展为固定的 `{ kind: "user" }`，不附带 ID。它表示当前安装中的本地用户，不代表可切换账号。

User 主体只能由可信的桌面 Main → Host 用户入口建立。RPC 请求不接收任意 `actor` / `owner` 字段来证明调用者是用户；Agent 工具仍从现有 Session / Main / Node 上下文确定主体。

实现时需同步主体规范化、相等比较、历史事件解析、权限与项目校验。通用 Agent 调用路径仍只接受 Main / Node；不能仅因 `ResourcePrincipal` 新增 User 就允许模型在工具参数中伪造用户身份。

### 3.2 只保留 owner，不新增重复字段

`owner` 是稳定的原始归属与来源标记：

| owner | 可推导的创建者 / 来源 |
|---|---|
| `user` | 用户导入 |
| `main` | Main Agent 产出 |
| `node` | 对应 Node Agent 产出 |

编辑描述、重命名、替换文件或删除资料均不改变 owner。用户管理 Agent 资料属于管理授权，不代表资料转移给用户。因此不持久化独立的 `createdBy` 或 `sourceKind`。

### 3.3 管理权不等于所有权

- User 可以管理当前 Project 内所有 Resource；Node / Main 保持现有 Agent 权限，不因 User 引入而扩大。
- 用户导入的资料默认设置为 `access: { kind: "public" }`，其中 public 仅指同一 Project 内可见，不是跨项目公开。
- 用户管理入口由独立的 `UserResourceService` / 可信 Host handler 提供。它可调用明确的用户管理路径，但不能将任意 RPC 的 `actor.kind = "user"` 直接视为授权。
- 现有 Agent 更新、替换、删除仍按原 owner 与 revision 规则执行。用户对任意 Resource 的管理授权通过专用内部路径校验，不修改 owner，也不通过放宽通用 Agent 权限检查实现。
- F13.1c 建立并验证可信用户服务入口；资料浏览、文件夹管理及相应桌面管理 RPC 由 F13.2a / F13.2b 承接。首版不提供权限编辑 UI。

### 3.4 用户导入的可见性必须原子建立

当前 Resource 创建事件投影默认 `private`。不能在创建 Resource 后再单独调用 `setAccess(public)`，否则两次提交之间发生崩溃会留下错误的私有资料。

设计要求：给 `resource-created` 事件增加可选的初始 access；新用户导入在创建事件中一并写入 `public`，历史事件未携带该字段时仍按 `private` 投影。此变更只扩展 Resource 事件解析 / 投影，不新增 SQL 表或 User 数据库迁移；既有历史事件必须继续正常恢复。

## 4. 导入架构

```text
[用户通过可信桌面 Main 选择文件 / 目录]
                    |
                    v
        [resource.user-import.v1]
                    |
                    v
           [UserResourceService]
           校验身份、Project、来源
           逐文件遍历与路径规范化
                    |
                    v
       [ResourceService 用户导入入口]
       owner=user，初始 access=public
                    |
                    v
       [ResourceLifecycle / F13.1a]
       暂存、代次、操作记录、原子提交
                    |
                    v
          [resource/committed]
                    |
                    v
        [F13.1b ContentProcessor]
        异步提取并持久化正文状态
```

Agent 产出继续走现有专用 Resource 发布工具，其来源只能解析到当前 Project Workspace。用户导入 RPC 不注册为 Agent Tool；模型不能提交任意本地路径来获得文件系统读取能力。

### 4.1 来源与路径

- 本地文件选择由可信桌面 Main 发起；Host 只在专用用户导入 RPC 中接受这些来源。Renderer 或 Agent 不得绕过该入口直接调用任意本地路径读取。
- 单文件导入的逻辑路径默认使用文件名；目录导入保留相对于所选根目录的路径。Resource.name 使用文件名，libraryPath 使用规范化后的相对路径。
- 复用 `normalizeLibraryPath` / `numberedLibraryPath`。同目录重名在扩展名前编号；不同目录允许同名。目录遍历不跟随符号链接，拒绝不安全路径段，并校验普通文件、文件大小与 Project 状态。
- 每个文件仍受现有 100 MiB 原始资产上限约束；目录枚举、批次文件数与总处理量必须有界，避免一次请求无界读取或分配内存。
- 绝对源路径仅用于当前导入调用中的文件读取，不写入 Resource 事件、操作记录、诊断日志或返回给模型。持久化的 `sourceRef` 使用稳定、非绝对的相对路径 / 不透明引用；实际源路径由本次受信任的 intake 闭包持有。
- 系统按既有格式映射推导 Resource.type；不自动生成描述，未填写描述保存为空字符串。校验需允许空 description，同时继续拒绝 NUL 等非法内容。

## 5. 批量、取消与失败语义

- 批次内按确定顺序串行处理，每个文件独立调用现有生命周期和操作 ID 幂等机制；不新增持久化批次表或通用队列。
- 某个文件失败不回滚已经成功保存的其他文件。每项结果区分 `saved`、`failed` 与因取消而未开始的 `cancelled`，并返回稳定错误码及安全摘要；不返回绝对路径、堆栈或内部存储细节。
- 取消后不再启动下一个文件。当前文件若尚未提交，取消并清理未提交暂存；若 Resource 已提交，则保留该资料，不能因为取消导入而删除已保存内容。
- 请求重放复用相同请求 / 操作 ID，依赖 F13.1a 既有幂等语义；用户主动重新选择失败文件则发起新的导入操作。首版不提供独立重试失败项 API。
- 文件保存失败与正文处理失败必须分开。保存成功即保留 Resource，随后由 F13.1b 异步处理；正文失败不能回滚原始资产，也不能通过重新导入同一文件来假装完成正文重处理。
- F13.1c 不公开 `ContentProcessor.retry`。未来若要为正文失败提供用户操作，应由资料管理阶段明确接入已有显式重处理能力。

## 6. 公共 RPC 与服务职责

### 6.1 RPC

新增版本化方法 `resource.user-import.v1`，沿用现有 RPC 的严格输入 / 输出运行时校验与错误封装。建议请求包含：

- `projectId`：目标 Project。
- `requestId`：本次导入的稳定请求标识，用于构造每个文件的幂等操作 ID。
- `sources`：用户在可信桌面 Main 中选择的文件或目录来源；目录由后端受限遍历。

逐文件结果包含：文件名、相对路径、保存结果、成功时的 Resource ID / libraryPath，以及可用时的当前正文处理状态；失败项返回稳定错误码和安全消息。响应不包含绝对源路径。

RPC 复用现有取消机制。取消时保留已提交文件及已返回的逐文件结果，停止后续文件；不额外设计批次恢复服务。该方法只注册到桌面控制面，不注册进 Agent Tool 列表。

### 6.2 职责划分

- `UserResourceService`：验证可信用户调用、Project 状态和导入来源；遍历目录、逐文件编排、计算逻辑路径与逐项结果。
- `ResourceService` / `ResourceLifecycle`：提供内部受信任的 User 创建入口，复用资产暂存、操作记录、代次、路径唯一性和原子提交。不得让 User 导入绕过生命周期直接写文件或事件。
- Resource 创建提交后必须发出既有 `resource/committed` 通知，由 F13.1b 自动建立 / 调度正文处理状态。
- `rpc/resource.ts` 与 `src/host/resource.ts`（具体命名按现有组织调整）：定义版本化契约、严格解析、错误映射和 Host 注册；`src/host/main.ts` 只负责装配注册。
- F13.1c 不开发 Renderer 页面；F13.2 负责目录浏览、整理、管理交互及相应的桌面消费。

## 7. 验收标准

1. 新增固定 User principal，无 UserID / 用户表；既有 Main / Node 事件历史仍可恢复。
2. Agent Tool 和普通 RPC 无法通过传入 `kind: "user"` 冒充用户；可信用户导入入口才可构造 User 主体。
3. 用户导入 Resource 的 owner 为 `user`，同一创建事件中 access 为 project-scoped public；所有 Node 可见，其他 Project 不受影响。
4. 用户导入与 Agent 发布使用不同入口；Agent 发布仍限制在 Workspace，用户导入绝对路径不落入数据库、事件、日志或模型输出。
5. 单文件、多文件、嵌套目录导入成功；相对路径保留、重名自动编号、不安全路径与符号链接不会越界。
6. 单项失败不回滚成功项；取消保留已提交文件，未提交暂存得到清理；同一操作 ID 重放不重复创建。
7. 保存成功后触发 F13.1b；正文状态与原始保存结果分离，正文失败不删除资料。
8. description 允许为空；文件大小、目录枚举与批次处理均有界。
9. RPC 输入输出、错误码、取消和逐文件结果均有运行时校验；不提供独立导入失败重试 RPC，不提供 Renderer UI。
10. `pnpm typecheck`、相关 Resource / Storage / RPC / Host 测试及 `pnpm test --maxWorkers=4` 全部通过；检查既有事件恢复与 F13.1b 正文处理回归。

## 8. 实施顺序与边界

1. 扩展 User principal 与 Resource 历史解析 / 投影，保持既有 Main / Node 权限行为。
2. 增加原子初始 access，建立仅供可信用户服务调用的 Resource 创建与管理授权边界。
3. 实现逐文件 User intake、相对路径与安全来源适配，复用 F13.1a 生命周期。
4. 增加 `resource.user-import.v1` 及 Host 注册，连接取消、逐项结果和错误映射。
5. 补齐身份伪造、历史恢复、路径、部分失败、取消、幂等、public 可见性与 F13.1b 联动测试。

本设计不授权自动开始实现。开始 F13.1c 实施时，先核对最新 master 与 F13.1b 当前实现，再按上述顺序开发和验收。
