# 57：F5.1 工作区布局与导航

## 做了什么

用户授权完成侧栏项目/会话双视图、顶部项目/会话标签、侧栏滑动过渡。本次仅修改 frontend、前端计划和索引，未修改后端。

Shell.tsx 拥有 opened、active、section、expanded 四个状态。open 按 ID 去重并激活，窄屏选中后收起侧栏；close 移除标签，关闭当前标签后选右邻或左邻，全部关闭显示空态。列表视图切换不改变活动标签。正式入口使用当前 Chat，预览入口 App 的 preview=workspace 延迟加载 Mock Workspace。

## 关键决策

所有内容面板保持挂载，用 visibility 和 inert 控制可见性及键盘访问，切换或关闭标签不销毁草稿与展开状态，也不取消正在执行的当前会话。当前不支持无限数量会话，后续真实会话接入需要另行确定装载生命周期。

navigation/style.module.css 将侧栏宽度和内层位移同时过渡 300ms。宽屏内容区跟随宽度变化，600px 以下采用覆盖式侧栏、首次加载默认关闭；系统减少动画时停用过渡。长标签截断，标签栏内部横向滚动。

项目和会话图形直接由 Shell 的 EntryIcon 绘制，归属导航展示。导航状态与布局在一个所有者中，无额外转发层。预览仅演示导航和草稿保留，正式 Chat 沿用 F4。没有新增协议；项目、真实多会话和持久恢复未在本步实现。

## 坑与发现

Messages.tsx 是独立演示入口，不是可导入组件；工作区预览采用独立轻量 Mock 面板，避免重复挂载演示根节点。隐藏面板不使用卸载或 display:none，保持 DOM 布局与局部状态。

## 验证与下一步

typecheck、桌面 build 通过；scripts/qa/workspace.cjs 在 Electron 验证标签去重、切换、关闭相邻激活、草稿保留、侧栏动画中间宽度与 420px 窄屏无页面横向溢出。已检查宽屏截图，产物为 qa-output/workspace.png 和 workspace-narrow.png。本次没有重新执行真实模型回合验收。

当前 F5.1 实现及自动验收完成，等待用户视觉验收；代码导读随本次交付提供。不推进 F5.2，不提交后端改动。


## 侧栏交互微调

用户追加要求：底部固定设置，Logo 合并折叠按钮并变化图标，项目/会话切换动画，对应新增入口，关闭按钮圆形红色悬停，以及去掉输入框焦点长线。

Shell 将 Logo 与侧栏图形合成一个按钮；箭头根据 expanded 翻转。视图切换使用位移滑块，列表与新增文字淡入。底部设置不参与列表滚动。新增和设置当前为明确禁用的布局入口，真实功能未接入，不创建假项目或会话。

导航样式为关闭按钮提供圆形命中区域和红色 hover；workspace 样式移除 textarea 的 inset box-shadow，键盘焦点通过外层 composer 边框表达。未更改输入提交、取消或后端行为。

typecheck 和 Electron 工作区 QA 通过；追加检查设置与新增文案及真实 Composer 聚焦后的 boxShadow 为 none。用户视觉验收仍待确认。


标签微调：悬停底色移到整个 tab 容器，覆盖标题及关闭区域；关闭按钮复用已有 Icon close SVG 并用 Grid 居中，避免字体 × 的基线偏差。新增入口取消边框。复查 reicon 官方仓库 https://github.com/dqev/reicon 及 46 号选型记录，本次无需增加依赖。


## reicon 全量替换可行性核对

2026-09-15 只读下载 npm 官方 reicon-react 1.2.5 tarball 并检查图标模块清单及 createIcon，未安装依赖或修改生产代码。当前统一入口有 12 个图标，导航另有侧栏、文件夹、会话、加号、设置，停止按钮是 CSS 方块。ArrowRight、BookOpen、Compass、Loader、Check、ChevronRight、Globe、TerminalSquare、Pen、Folder、Chat、Plus、Gear、SidebarLeft/Right、Stop 可作为对应候选；Brain/Wrench 无同名模块，不能宣称所有语义都一比一覆盖。图标高亮需适配库的填充/描边与 SVG 根节点，不能直接替换当前 Shape。官方来源：https://github.com/dqev/reicon 和 https://registry.npmjs.org/reicon-react/1.2.5 。
补充纠正旧记录：本次包中有 X（可对应关闭），createIcon 实际支持 strokeWidth，并分别调整描边路径与填充轮廓；46 号记录关于不支持 strokeWidth 及关闭图标缺失的判断不能继续用于当前选型。尚未进行替换后的渲染验收。


## reicon 接入

用户授权常规图标统一使用 reicon-react 1.2.5，保留 Brain/Tool。Icon 统一映射库组件，以 24 坐标 SVG 容器承载库的嵌套 SVG；高亮遮罩同时继承白色 color 与 stroke，兼容填充与描边图形。导航项目、会话、新增、设置、侧栏及停止均复用入口，原十枚自绘常规图标删除。侧栏镜像动画保留。依赖只写前端清单与锁文件。

类型检查、单 HTML 构建和完整消息高亮 QA 通过。导航 QA 的固定等待在加载图库时过早，改为有界等待预览输入框挂载。
最终按图标深路径导入，避免开发时加载整个图库；重启开发服务更新依赖预构建后，导航 QA 通过（等待挂载与首帧布局稳定再测动画），桌面 build 通过。消息演示已重建。


发送图标修复：reicon 接入后 SVG 有外层尺寸容器和内层图形。原发送按钮的后代 svg 选择器把两层都旋转，内层围绕 SVG 坐标原点转动后被裁切。改为仅旋转按钮直接子 SVG；同时将过程展开与活动图标尺寸规则限定到外层，避免同类嵌套影响。


2026-09-15 用户明确确认本 Step 完成验收，F5.1 正式完成。下一步 F5.2 已授权，接口核对与交接见 62 号记录。
