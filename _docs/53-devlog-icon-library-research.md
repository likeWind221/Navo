# 图标库选型调研（reicon / lucide）

## 做了什么

- 按用户建议调研 `reicon`，确认其许可、包结构、图标数量与可用性。
- 横向对比 `lucide-react`、`@radix-ui/react-icons`、`@phosphor-icons/react`、`@tabler/icons-react`、`hugeicons-react`、`react-icons` 的许可与周下载量。
- 拉取真实图标源，把「手绘 / reicon Outline / reicon Filled / lucide」按同一概念、同一尺寸渲染成一张对比图（`frontend/qa-output/icon-library-compare.png`，对比页由一次性临时脚本生成，脚本未入库）。

## 关键发现

**reicon 可以用，但不满足本项目的视觉规范。**

基本盘是合格的：`reicon-react` 1.2.5 为 MIT，仓库 `dqev/reicon`（1514 star，2026-05-05 建库，2026-09-07 仍在提交），2678 枚图标 × Outline/Filled 两权重，无运行时依赖，peer 仅 `react>=16.8`，`sideEffects=false`，每个图标一个模块、支持深引入，TypeScript 类型齐全，npm 与 npmmirror 镜像都有包。

阻碍它的是实测出的四点：

1. **同一权重内部绘图方式不统一。** 抽样 13 枚图标的 Outline，10 枚是 `fill="currentColor"` 的实心轮廓路径，`Lightbulb`、`Loader` 是 `stroke-width="1.5"` 的描边路径，`Sparkle` 两者混用。结果就是同为 Outline，粗细却不同，而且描边宽度写死在图标里，无法统一控制。
2. **部分图标坐标贴到 viewBox 边缘。** `Lightbulb` 的 x 到 23.9999、y 到 23.3333，叠加 1.5 描边会被裁切。
3. **缺少本阶段需要的语义名。** 没有 `Brain`、`Wrench`、`Close`：思考只能退到 `Lightbulb`，工具只能退到 `Sledgehammer` 或 `Gear`，语义发生偏移。
4. **无法表达现有视觉规范。** 规范要求 24×24 viewBox、1.75px 描边、圆头圆角、`currentColor`、20px 显示；reicon 只提供 `size`、`color`、`weight`，没有 `strokeWidth`，也无法统一那批写死描边的图标。

**lucide 与现有规范和参考实现都对得上。** `lucide-react` 1.44.0 为 ISC，无运行时依赖，peer 覆盖 React 16.5–19，`sideEffects=false`，2020 年发布至今持续维护，周下载 55,843,685。它的 `size` / `strokeWidth` / `color` 正好映射现有规范，且本项目参考的 `vercel/ai-elements` 与 `assistant-ui` 用的就是它；`brain`、`wrench`、`loader-circle`、`check`、`x`、`chevron-right` 等语义名全部存在（逐一验证返回 200）。

## 坑与发现

- 本机 npm 已配置 `registry=http://registry.npmmirror.com`，两个包在镜像上分别有 `lucide-react@1.44.0`、`reicon-react@1.2.5`，不需要代理即可安装。
- reicon 图标文件里 `O` 与 `F` 的顺序不固定（`Lightbulb` 是 `F` 在前），按固定顺序解析会直接失败。
- 对比页最初用 HTML 表格承载 `<figure>`，被浏览器的 foster parenting 把单元格移出表格，布局塌成一行；改成 flex 行后正常。

## 结论

**本阶段继续使用自绘图标，不引入图标库。** 用户权衡后决定先保留 F4.1 已交付的九枚自绘图标，理由是不为一次性的观感问题引入长期依赖；`14-visual-design.md` 中「暂不引入图标库」的表述与 F1.2.1 的同类说明因此保持有效，无需修改。

本次调研的结论保留备查：如果后续确实需要更丰富的图标或填充权重，`lucide-react`（ISC、周下载 5584 万、支持 `strokeWidth`）是首选，`reicon-react`（MIT、2678 枚、双权重、周下载 1 万）次之，但需要先解决其 Outline 权重内部描边与实心路径混用的问题。

## 下一步

F4.1 维持已交付状态；若 F4.2 在真实过程行里发现某枚图标观感仍不理想，按需单独重绘，不整体更换方案。
