# 88：F5 Project 前端闭环规划

原记录日期：2026-10-13。以下原文保留当时的规划状态；当前审查与后续顺序见文末 2026-10-26 补充，当前计划以 [frontend-plan.md](frontend-plan.md) 为准。两轮均只处理规划，不实现前后端代码，不进行模型调用或桌面功能验收。

## 做了什么

- 核对 F5.2 已交付的创建、列表与详情，以及 F9.9/F9.10 已提供的项目回合、节点复核、状态跟随、消息与资源元数据查询。
- 按用户确认，将下一阶段目标确定为当前运行期间的完整 Project 执行闭环，并写入 `frontend-plan.md` 的 F5.3–F5.8、阶段边界和当前下一步。
- 本次修改范围为前端计划、本规划记录和文档索引；保留工作区原有 Agent 规则修改、模型协议调研文档及索引条目。

## 关键决策

### 阶段目标与顺序

```text
复用：创建 Project / 项目侧栏 / 顶部标签 / 对话内容展示
                           ↓
新增：Main 对话与目标确认 → Roadmap → Node 对话与人工控制
              ↑                              ↓
              └──── 协调 / 调整路线 ← 消息 / 资源查看
```

| 步骤 | 用户获得的能力 | 主要验收结果 |
|---|---|---|
| F5.3 | 工作区布局与交互设计 | Main、Roadmap、Node、消息与资源的入口和导航明确，宽屏/窄屏预览经用户确认，运行中离开与关闭的行为明确 |
| F5.4 | Main 对话、目标确认与项目状态跟随 | 项目内多轮流式对话、取消和目标确认可用，不同项目隔离，目标与状态实时展示 |
| F5.5 | Roadmap 展示与实时变化 | 节点、依赖、状态和允许操作以后端快照展示，路线变化可见并可打开节点 |
| F5.6 | Node 对话与人工控制 | 用户显式执行、继续、取消、完成或跳过；节点间会话隔离，版本冲突可辨识，控制节点不创建 Agent 对话 |
| F5.7 | 消息记录与资源元数据查看 | 消息分页与参与者可见，资源来源、版本和访问范围可见，变化后刷新 |
| F5.8 | 当前运行期间的完整 Project 闭环验收 | Electron 中完成规划、节点执行、资源/消息交接、人工确认、Main 协调与继续推进，包含真实 Host 和真实模型人工验收 |

功能目标和完整验收标准统一维护在 [前端计划](frontend-plan.md)，本记录解释阶段划分和边界。

### 当前运行期间先形成可用闭环

后端仍在 F10 开发，不把完整持久化接入作为本阶段完成条件。当前运行期间切换项目或节点后保留草稿和对话，是界面与状态管理要求；历史查询、应用重启后续接原上下文和中断恢复另行规划，依赖后端 F10.2/F10.3及相应公共契约，交由 `backend-plan.md` 实施。

后端已经提供的持久化继续正常使用，前端展示接口实际返回的数据，不关闭持久化、不另建前端持久化事实源。归档/重新打开等需新增操作接口的项目管理、资源正文预览、文件管理、权限编辑、Verification、RAG 和独立多会话管理也不属于 F5.8 收尾条件。

### 复用现有协议与人工操作边界

- Main/Node 执行使用现有 `project.turn.v1`，复用 v2 内容事件和当前思考/工具/Markdown/公式展示；取消沿用对应请求的 cancel 帧，只作用于该回合。
- 项目状态使用 `project.follow.v1` 的完整基线和整份替换帧；前端不解析助手文字推断目标、节点状态或路线变化。
- Node 完成/跳过使用 `project.node.review.v1` 和当前节点版本；操作入口依据公共快照中的允许操作，后端仍是状态权威。
- 消息和资源使用现有查询接口，资源只展示元数据；`public` 表示本 Project 内共享。
- 每次 Agent 回合都必须由用户明确启动。节点解锁、消息或资源到达、回合结束不会自动启动其他 Agent；切换界面也不能隐式触发执行。
- Renderer 只通过 `frontend/shared/` 和桌面桥接访问公共协议，不依赖后端私有 Store 或内部事件。新增共享契约按项目规则另行串行交接。

协议依据为既有交付记录 [F9.9b](72-devlog-f9.9b-human-control.md)、[F9.9c](73-devlog-f9.9c-project-follow.md) 与 [F9.10](74-devlog-f9.10-goal-confirm.md)；本次不设计新的 Agent 协议或取消机制。实施涉及这些机制时仍须按项目规则核对对应 Harness 源码。

## 坑与发现

- 旧前端信息架构保留 Learning 的教材/练习语义，不能直接作为通用 Project 的工作区结构；F5.3 需以当前 Navo PRD 和本轮范围重新设计。
- F5.2 交付时记录的“Host 重启后项目清空”是历史边界，后端 F10.1a 起已有项目持久保存；在 F5.4 接入时校正相关旧文案，不据此宣称会话历史已恢复。
- 后端数据持久保存不等于前端具备历史查询、重启续接或中断处理；后端能力交付也不代表前端桌面已通过验收。
- 本工作区仍在 F10.1c 分支，且存在原有未提交文档改动。另两处工作树已使用文档编号 87–89，本记录采用下一编号 90；仅记录文档，不在此旧步骤分支实现前端功能。

## 验证与边界

本次仅核对规划范围、Step 状态、当前下一步、文档引用与实际 diff；不运行与纯文档改动无关的类型检查、单测、构建或模型实验。后续功能与视觉验收结果分别写入所属 Step 开发记录，不能将本规划记录作为已实现证明。

## 下一步

当前下一步为 F5.3 Project 工作区布局与交互设计，尚未开始。用户本次授权记录已确认的计划，不自动授权开始 F5.3 或连续实现全部步骤；各 Step 按项目启动、审查、分支和验收规则推进。真实模型验收前先说明预计耗时与影响范围并取得授权。

## 2026-10-26：后端能力审查与前端后续规划

### 做了什么

- 根据用户“审查后端能力、识别前端缺口、规划后续步骤”的要求，核对 PRD、两端计划、Bug 表、当前源码与公共契约。
- 以当前 checkout `3368638` 为审查基线；所在分支为 `phase13-f13.6-openrouter-acceptance`，后端验收脚本和记录已有未提交修改。审查期间共享 Bug 表、索引及后端记录继续变化，因此只更新本记录与 `frontend-plan.md`，不改共享索引、不分配新文档编号、不提交或推送其他会话的修改。
- 保持 F5.4 为下一步，补入 submitted / 返工 / Main 复盘的明确验收目标，将 F5.6 拆成 F5.6a 节点执行和 F5.6b 验收复盘；规划前端 F6 历史与上下文、F7 资料库、F8 自动推进，全部保持未开始。
- 校正“后端下一步 F13.1”“F10 尚未交付”“`/compact` 仍无真实能力”等过时描述。F5.1–F5.3 的历史交付不被重新验收，浮空岛视觉继续复用。

### 已证实的能力与缺口

| 审查位置 | 当前代码事实 | 对后续开发的影响 |
|---|---|---|
| `frontend/src/App.tsx`、`workspace/Chat.tsx`、`workspace/chat/conversation/hook.ts` | 普通会话使用真实流式链路，但 Session 固定为 local-session；项目与普通会话分别渲染 | 不能把普通会话发送函数直接作为项目执行入口，项目需要真实 target 与请求归属 |
| `frontend/src/workspace/project/Detail.tsx`、`Workspace.tsx` | 详情读取一次快照，地图可显示该快照；正式 Main / Node 只留草稿、发送禁用，消息 / 资源按钮禁用；demo 的固定回复不属于正式能力 | F5.4 的关键是接通执行和 follow；F5.5 接真实状态，无需重做地图视觉 |
| `rpc/project.ts`、`src/host/project.ts`、`src/host/project/turn.ts` | Main / Node / Review 回合、人工 complete / skip / rework、Mailbox 与 Resource 查询均注册；项目回合转发既有 v2 内容事件 | 核心执行无须重新设计后端，先补桌面桥；复盘也是 Main 回合，不新增第二个 Review Agent |
| `frontend/shared/project.ts`、`electron/ipc/project/handler.ts` | 桌面只提供 list / create / get、目录选择和四项 AutoRun 方法；没有 project turn / follow / node review / mailbox / resources 方法 | “后端已有 RPC”不等于 Renderer 已能调用，F5.4、F5.6、F5.7 分别接入对应桌面能力 |
| `rpc/project.ts`、`src/host/project/view.ts` | Main 有 sessionId，Node 只有 hasSession；Node 包含作业、自查、返工意见、复盘结果和 actions | 会话在本轮 turn 事件中可取得 ID，但重启后不能只靠 Node 快照定位旧会话；需后端公共交接后再做完整恢复 |
| `rpc/session.ts`、`src/host/session/history.ts`、`frontend/shared/session.ts` | context / follow / history 桌面 API 已有；历史是有效 surface 的消息和摘要检查点，游标绑定 surfaceGeneration，没有完整 Turn 终态条目 | 已知 Session 可先做历史阅读；完整原始档案、中断原因与 Node 身份定位不能冒称已有。压缩后必须识别 history-changed |
| `src/command/compact.ts`、`src/app.ts`、前端命令解析与对话 Hook | `/compact` 已注册，前端通用斜杠命令能发送到 Host；当前正式 Hook 绑定普通 local-session | 正式缺口是上下文 UI、项目 Session 路由与验收，不是从零实现压缩命令 |
| `rpc/resource.ts`、`frontend/shared/resource.ts`、`electron/ipc/resource.ts` | 已有目录、资料管理、文件与目录选择、流式导入和状态跟随；公开状态只含正文处理结果 | 可先做基础资料页面；ready 表示正文提取就绪，不能因此显示“语义 / 图谱可检索” |
| 同上，及 `src/resource/graph.ts` | 未发现用户搜索、正文重处理、获得查看副本的公共资料方法；桌面没有拖拽文件解析与默认应用打开能力 | 搜索、重处理和打开需要明确补齐依赖，不能用库内私有路径或 Agent 工具替代 |
| `src/resource/retrieval.ts`、`src/tools/builtins/resource/{list,search,fetch}.ts` | 权限内目录、混合检索与原文读取工具已实现，实际结果可通过现有内容事件显示 | Agent 工具是任务能力，不是用户搜索的公共接口；前端仍需独立搜索与分页交接 |
| `src/host/main.ts`、`src/app.ts`、`src/resource/graph.ts` | 正式 Host 只传 embedding，没有传 graph；graph 未配置时不创建 extractor、不启动新抽取 | 验收脚本的显式图谱配置不能证明正式桌面导入后会建图。交由后端确认正式 Host 的启用与状态交付，不在前端静默增加模型调用 |
| `src/host/project/follow.ts`、`rpc/project.ts` | 项目 follow 含 detail、mailboxSequence、resourceRevision，不含 AutoRun 快照或自动回合内容 | 可消费项目状态变化，不能据此承诺自动运行状态或内容实时可见 |
| `src/project/autorun.ts`、`frontend/shared/project.ts` | AutoRun 控制与查询已有；运行记录在进程内 Map 中，暂停可等待当前回合收敛，没有公共持续观察出口 | 基础控件可先提供显式查询；实时过程需交接。重启后无旧 run 时重新 start，不将项目持久化解释为 AutoRun 可恢复 |
| `frontend/src/workspace/Shell.tsx`、`project/Notice.tsx` | 设置与新增普通会话未开放；空项目仍提示“仅内存、重启清空” | F5.4 校正过时提示；登录 / 模型选择、多会话与归档等独立产品能力后置 |

以上为源码事实与交付边界，不把“尚未提供的规划能力”登记成已确认生产 Bug。现有 Bug 的关闭仍以 Bug 表中的条件为准。

### 关键决策与顺序

```text
[REUSE: Project entry + chat content + island map]
                         |
                         v
[ADD F5.4: Main turn + project follow]
                         |
                         v
[ADD F5.5: live map] -> [ADD F5.6a: Node turn]
                         |
                         v
[ADD F5.6b: submission + Human/Main review]
                         |
                         v
[ADD F5.7: messages + Resource info] -> [ADD F5.8: manual desktop loop]
                         |
                         v
[ADD F6: history + restart + context]
                         |
                         v
[ADD F7: library + search + assisted task]
                         |
                         v
[ADD F8: AutoRun control + observation + takeover]
```

REUSE 表示复用已有能力，ADD 表示待交付；图表示建议顺序，不表示所有步骤存在硬依赖。F7.1–F7.2 的基础资料页面可在 F5.7 后提前；后端公共交接可以先准备，缺少搜索契约不阻止人工执行闭环。

- F5.4 对项目回合、请求取消和项目观察作最小桌面接入，复用消息内容展示；不同项目与 Node 的运行状态按实际归属管理。现有普通会话控制器只有一个 active，不把它原样扩作全局项目并发调度器。
- 视图切换、节点面板关闭、整个项目标签关闭和窗口销毁属于不同生命周期。实施前固定各自保留草稿、观察订阅和活动回合的规则；保留现有 F5.3 交互决定，不让 React 卸载意外决定业务取消。
- F5.5 只接活数据与状态语义，沿用目前岛屿、航线、取景和窄屏布局。Node 只包含工作节点，submitted 与完成明确区分。
- F5.6b 同时呈现人工验收与 Main 复盘；前者基于 reviewedRevision，后者用既有 review target，最终状态仍以后端为准。产物先关联到 F5.7 的元数据入口，默认应用打开等能力由 F7 承接。
- F6.1 先消费已知会话的有效历史；F6.2 所缺 Node 身份与中断事实交由 `backend-plan.md` 实施。F6.3 展示真实测量依据，不把估算写成精确用量或用一个固定窗口虚构百分比。
- F7 分开可直接消费的资料浏览 / 管理、仍有依赖的文件交互 / 搜索、最后的任务验收。公开索引状态、搜索分页、查看副本、重处理及正式 Host 图谱能力交由 `backend-plan.md` 实施，前端计划只记录目标和验收边界。
- F8.1 基础控制先用既有 API；F8.2 的持续状态和自动回合内容需后端公共交付。暂停请求与已暂停分开，恢复同一运行与重启后开启新运行分开；不以无限轮询填补契约缺口。
- 仅规划后端依赖，不给后端分配未经确认的新 Step，也不修改其计划、生产代码、模型配置或验收脚本。独立多会话、模型设置、归档、正文预览、图谱可视化与已取消的专用引用体系均不在本轮。

### 文件职责与验收安排

本轮实际只改 `frontend-plan.md`（功能目标、前置条件、状态和下一步）与本记录（源码依据、模块职责及取舍）。共享索引已有本记录入口，本轮不并发改写，也没有完成新的实施 Step。

审查期间，另一会话提交 `2b3b823`，其中已包含本轮前端计划的大部分修改；本会话没有执行 Git 提交或推送，也没有重写该提交。后端最新失败已推进到来源声明一致性验收，F13.6 仍进行中，以其实时记录为准。本记录及计划中的最终措辞调整仍需提交、推送，后续收口时只处理明确归属本任务的文档。

后续实施职责供单步启动说明核对，不提前创建文件：

- `frontend/shared/project*` 与 `frontend/electron/{ipc,preload}/project*`：桌面项目公共入口、运行时校验、按窗口隔离的请求 / 取消 / 观察；根 `rpc/**` 已有方法优先复用，新增跨端契约须另行串行交接。
- `frontend/src/workspace/project/**`：项目快照、地图和节点视图；由项目 / 会话状态的拥有者管理在途请求与订阅，不让展示组件拥有另一份权威节点状态。
- `frontend/src/workspace/chat/**`：继续负责正文、思考、工具、命令和滚动等展示与交互；项目身份和任务路由不靠解析助手文本推断。
- `frontend/shared/session*`、既有 session IPC / preload 与前端会话视图：有效历史、上下文和压缩事件的消费；未知公共事实必须交接，不能引入后端 Store 依赖。
- `frontend/shared/resource*`、既有 resource IPC / preload 与前端资料视图：复用目录、管理和导入能力，补齐正式页面；搜索等新能力先有公共交付再接入。
- 前端测试与 Electron QA：每步只覆盖本次功能与真实风险；分别验证公共调用链、正式页面交互和用户验收。实施阶段按仓库要求完成本地与 PR head CI 门禁，不能只用 build 或 Bridge 验收证明产品可用。

### 验证结果与实际边界

本轮为静态审查与纯文档规划，未调用真实模型、未运行 GPU 作业、未启动桌面、未改代码，也不重新执行已有测试。只检查本轮文档差异、相对 Markdown 引用、步骤状态与源码依据；后端真实验收在另一会话继续更新，基线见 [156](156-devlog-f13-6-backend-acceptance.md)，后续现场见独立的 [PR #105](https://github.com/likeWind221/Navo/pull/105)，关闭状态以 [Bug 表](bug-plan.md) 为准。本记录不冻结另一会话的运行结果，也不关闭 BUG-010 或 F13.6。

### 下一步与交接

当前 Step：F5.4，未开始。用户授权范围：能力审查和后续规划；已修改文件为本记录与前端计划，无实施代码。未落实的公共能力包括 Node 会话定位 / 中断事实、用户搜索 / 分页 / 索引状态、查看副本 / 重处理、正式 Host 图谱启用与自动过程观察，均交由后端计划实施。没有新代码需要代码导读，本轮交付文档变化、审查结论与依赖边界；后续实施仍须逐 Step 启动，不自动连续推进。

### 规划确认与 PR 收口

2026-10-26 用户确认按上述计划推进，并授权推送、合并本次规划 PR；本次收口不开始 F5.4 实施。以最新 `origin/master` 的 `7e84f59` 创建独立 worktree 与 `codex/frontend-development-plan` 分支，只迁入本记录和前端计划；后端 PR #105 继续独立保留，不携带其脚本或未合入的验收文档。对于该 PR 才有的记录改用远程 PR 链接，保证本次文档在 master 上可独立阅读。

本地验证为两份文档的相对引用、实际变更文件范围与 `git diff --check`；纯文档不运行代码测试或模型验收。提交后执行仓库 CI 的文档分流门禁，确认本 PR head 的检查成功后 squash 合并，并清理本次专用分支和 worktree。
