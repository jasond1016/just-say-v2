# Codex 落地提示词

```md
你现在是在 `D:\my_projects\JustSay-v2` 仓库内工作的 Codex。

目标不是继续做 mockup，而是**按照已经确认的高保真 HTML 设计，直接把当前应用完整落地到现有代码中**。

最重要的执行要求：

1. **不要中途停下来等我确认。**
2. **不要先只给方案或计划，直接开始改代码。**
3. **除非遇到真正无法自行判断的阻塞问题，否则不要提问。**
4. **你需要一次性完成端到端落地：阅读代码、实现、补状态、调整样式、验证、最后汇报。**
5. **如果某些交互在 mockup 中没有 100% 细节，你要根据现有产品方向自主补完，但必须保持和 mockup 语言一致。**
6. **不要把任务拆成“这轮只做一部分”。默认就是一次性完成整个 redesign 落地。**

## 设计来源

你必须以这些 mockups 为唯一设计基准：

- `mockups/sidebar/focused-rail.html`
- `mockups/live-session/focused-flow.html`
- `mockups/quick-dictation/ptt-hud.html`
- `mockups/history/focused-archive.html`
- `mockups/settings/focused-controls.html`

以及产品约束：

- `PRODUCT.md`

## 总体产品方向

你必须严格保持这些核心方向：

- 产品气质：`Sharp. Fast. Minimal.`
- 文本优先，界面服务文本，不和文本抢注意力
- 减少 dashboard 感，避免后台管理界面感
- 高密度但不嘈杂
- 状态应该由界面结构自然表达，而不是堆提示条
- 高频功能要克制，低频功能要低调

## 需要落地的范围

### 1. 全局应用壳

先统一全局 app shell，重点参考：

- `mockups/sidebar/focused-rail.html`

需要把真实应用中的左侧全局 sidebar 改成这套语言，包括但不限于：

- brand block 的写法
- active item 语法：更精确的 active 状态，不只是整块底色
- utility zone：service health + refresh
- healthy / degraded / failed 的状态语义

优先检查和修改：

- `src/renderer/app/App.tsx`
- `src/renderer/styles/app-shell.css`
- 其他与 app shell / responsive nav 相关的样式文件

要求：

- 保持现有 section 结构：`Quick Dictation / Live Session / History / Settings`
- 不要把 PTT HUD 误做成普通 app page
- 全局 sidebar 要和各页面最终视觉语言统一

### 2. Live Session 页面

参考：

- `mockups/live-session/focused-flow.html`

需要落地到真实页面：

- `src/renderer/pages/live-session-page.tsx`
- 相关样式与子组件

必须实现的方向：

- 单栏 transcript-first
- 去掉常驻右侧边栏
- streaming 和 completed 在同一张画布内切换
- 停止后保留 transcript，不回空态
- streaming 只保留最必要操作
- completed 后才出现 post-session actions
- 标题逻辑、时间逻辑、完成态标题可改名 affordance，按 mockup 精神落地

如果现有数据结构不完全支持，也要在现有架构里尽量落地到最接近设计的程度，不要因为不是 100% 一样就停下。

### 3. Quick Dictation

参考：

- `mockups/quick-dictation/ptt-hud.html`

需要明确区分：

- 主窗口里的 `Quick Dictation` 页面
- 真正的 PTT HUD / overlay

设计结论是：

- `Quick Dictation` 不是 page-first 功能
- 核心体验在 HUD，不在主窗口页面
- 成功态极简
- 失败态用 recovery strip

你要检查当前实现里：

- `src/renderer/pages/quick-dictation-page.tsx`
- 与 PTT runtime / overlay / capture 相关的代码

落地方向：

- 主窗口页面要降级为辅助面，而不是主要使用面
- 如果当前代码已有独立 HUD / overlay 能力，就把视觉和状态模型调整到 mockup 方向
- 如果缺少完整 HUD 实现，就在现有能力允许范围内尽可能还原其状态语法
- 录音中不显示假实时转录文本
- 状态模型应是：`Recording -> Processing -> Sent -> Recovery`

### 4. History

参考：

- `mockups/history/focused-archive.html`

需要落地到：

- `src/renderer/pages/history-page.tsx`
- 相关样式与交互逻辑

必须遵循的产品决策：

- History 是 archive，不是 dashboard
- 不做 split view 常驻双栏
- 流程是两级：
  - Overview：搜索 / 筛选 / 列表
  - Detail：打开一条 transcript
- Detail 里：
  - transcript 是 source
  - notes 是 LLM 派生视图
  - notes 内合并 summary / decisions / action items
- 不再单独保留 `Action Items` tab
- notes 需要体现这些状态：
  - not generated yet
  - generating
  - generation failed
- `Generate notes` 只在该出现的位置出现
- 已生成后保留 `Regenerate notes`
- 音频条是 detail 页的一部分，不是独立大播放器

如果当前 history 的真实路由还是单页组件，也可以在同一组件内通过 state 切换 overview/detail，但最终用户体验要符合 mockup。

### 5. Settings

参考：

- `mockups/settings/focused-controls.html`

需要落地到：

- `src/renderer/pages/settings-page.tsx`
- 相关样式与状态逻辑

必须遵循的设计结论：

- Settings 是 support surface，不是后台
- 左侧是 app sidebar
- 中间是 settings directory
- 右侧只显示当前 section，不要一页全摊开
- Advanced 保持可见，但明显更低调
- 要补关键真实状态：
  - saved
  - checking
  - invalid input
  - degraded service

要求至少把这些 section 的真实切换体验做清楚：

- Workspace
- Recognition
- Advanced

并且根据 mockup 语言把其它 section 一并整理到同一体系内。

## 自主决策规则

如果 mockup 和现有实现之间有缝隙，按以下优先级决策：

1. 先保证产品方向正确
2. 再保证主要信息架构正确
3. 再保证核心状态和交互正确
4. 最后再补视觉细节

允许你自主决定：

- 具体组件拆分
- 局部命名
- 样式组织方式
- 哪些地方用现有组件复用，哪些地方新建轻量组件
- 哪些 mockup 说明文字不应进入真实 UI

不允许你做的事：

- 不要把 mockup 说明文案直接当成产品 UI 文案大面积塞进页面
- 不要引入新的设计方向
- 不要重新发明一套和 mockup 不一致的 layout
- 不要把 low-frequency actions 重新放回高优先级位置
- 不要中途停下来问“要不要我先做 A 再做 B”

## 工程要求

- 优先复用现有结构，但必要时可以重构
- 不要只改样式，要让状态和交互也跟上设计
- 必要时补充组件、状态、文案和布局
- 如果有现有测试或构建命令，完成后要运行
- 如果有 lint / typecheck / build，尽量跑完并修掉你引入的问题
- 如果某些检查无法跑通，要在最终汇报里明确说明原因

## 最终交付要求

你完成时不要只说“我改了哪些文件”，而要给出：

1. 实际完成了哪些用户可感知的 redesign 落地
2. 哪些页面和状态已经对齐 mockup
3. 做了哪些合理的自主补完
4. 运行了哪些验证
5. 还有哪些残余风险或未完全覆盖点

记住：**默认你要自己一路做完，不要在中间停下来等待确认。**
```

