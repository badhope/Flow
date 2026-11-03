# Flow 设计系统

> 依据：项目定位是「AI 原生跨境出口电商平台」，不是通用商城模板。
> 因此界面分成两种模态，而不是全站一种皮肤。

## 一、双模态原则

| 模态 | 范围 | 底色 | 目的 |
|---|---|---|---|
| **Storefront（买家）** | `/`、`/products`、`/products/:id`、`/cart`、`/checkout`、`/orders` | 浅色 `slate-50` | 商品图与价格优先，长时间浏览不疲劳，信任感优先 |
| **Workbench（卖家）** | `/seller/*` | 深色 `.flow-dark` | 高频操作、信息密度高、AI 常驻；长时间盯屏 |

买家端唯一允许的深色区域是 **首页首屏 Hero**：它承担「AI 意图入口」的定位表达，进入商品区立刻回到浅色。

## 二、Token

定义位置：`client/src/flow-design.css`。

| 分组 | Token | 值 |
|---|---|---|
| 背景 | `--flow-bg` | `#07080b`（near-black，带冷调） |
| 表面 | `--flow-surface-1/2/3` | `#0b0d12` / `#10131a` / `#161a22` |
| 描边 | `--flow-line-1/2/3` | 白 6% / 10% / 16% |
| 文字 | `--flow-text-1/2/3` | `#f2f4f8` / `#9ca3b0` / `#5f6675` |
| 强调 | `--flow-accent` | `#c6ff4a`（电光酸橙，占用面积 ≤10%） |
| 语义 | ok / warn / danger / cyan | `#3ddc97` / `#ffb020` / `#ff5a5f` / `#22d3c5` |
| 圆角 | `--flow-r-1..5` | 4 / 8 / 12 / 16 / 24 |
| 阴影 | `--flow-e1/e2/e3` | 仅浮层使用；暗色下高度靠更亮表面 + 描边 |
| 动效 | `--flow-t-fast/state/enter/page` | 120 / 180 / 320 / 420ms |

**为什么不用紫色渐变**：紫色已是「AI 产品」的默认符号，缺少辨识度；电光酸橙在黑底上对比度更高，且与交易类语义（成功、增长）不冲突。青色降级为数据色二。

## 三、组件原语

位置：`client/src/components/seller/SellerUI.tsx`。

| 原语 | 用途 | 约束 |
|---|---|---|
| `SellerPageHeader` | 页面标题区 | 必含 title；description ≤ 2 行 |
| `FlowPanel` | 内容面板 | 替代 ad-hoc `<Card className="shadow-sm">` |
| `FlowStat` | 指标块 | 数值用 tabular-nums |
| `FlowEmpty` | 空态 | 必须说明「下一步做什么」 |
| `FlowStatus` | 状态徽标 | 五档语义，禁止页面自定义颜色 |

## 四、AI 交互原语

| 组件 | 对应模式 | 行为 |
|---|---|---|
| `SellerCommandPalette` | Wayfinders / Prompt actions | ⌘K 唤起；导航与自然语言共用一个输入框；AI 兜底始终排第一 |
| `AgentTrace` | Action plan / Footprints | 步骤状态点（待执行/运行/完成/失败）+ 工具名 + 耗时；可折叠 |
| `ApprovalCard` | Verification / Governors | 写操作唯一执行入口；仅 pending 显示批准/拒绝；高风险标红 |

## 五、暗色兼容层

`client/src/flow-dark-compat.css` 把历史页面硬编码的 `slate/blue/amber/emerald` 工具类映射到 token。

**为什么需要**：v1.21.1 有 26 个页面、上千处硬编码颜色；直接逐页替换会产生巨大 diff 与视觉回归风险。兼容层让未迁移页面立即获得正确对比度，迁移后的页面用 token 自然覆盖。

**边界**：只映射颜色/边框/阴影，不改布局与交互。

## 六、可访问性

- 正文对比度：`--flow-text-1` on `--flow-surface-1` ≈ 15:1
- 次要文字 `--flow-text-2` ≈ 6.5:1（满足 WCAG AA）
- 弱化文字 `--flow-text-3` 仅用于 ≤11px 的辅助信息，不承载唯一信息
- `prefers-reduced-motion` 下所有进入动画降级为 120ms 淡入
- 命令面板全程可键盘操作（↑↓ / Enter / Esc）

## 七、禁止事项

1. 不在买家端使用 `.flow-dark`（除首页 Hero）。
2. 不在页面里写 `bg-[#...]` 硬编码色值；新增语义先加 token。
3. 不用颜色单独表达状态（必须配文字或图标）。
4. 不为单个页面新建 Card 变体；用 `FlowPanel`。
5. 不在模型循环内执行写操作——UI 只能通过 `ApprovalCard` 触发。
