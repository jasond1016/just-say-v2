# JustSay V2 从零重建蓝图

## 1. 这份文档是干什么的

这不是宣传稿，也不是泛泛的 PRD。

这是留给未来自己的“单一真相来源”：

1. 它定义 V2 到底要做什么，不做什么。
2. 它解释 V1 哪些设计必须彻底推翻。
3. 它给出可以直接开工的产品边界、架构切分、数据模型、状态机和实施顺序。

如果未来要从零开始重做，只允许先读这份文档，再动手。

---

## 2. 产品定义

### 2.1 一句话定义

JustSay V2 是一个桌面语音工作台，专注做好两件事：

1. 快速语音输入
2. 实时会议转录

### 2.2 目标用户

1. 高频语音输入的知识工作者
2. 经常参加线上会议、需要保留可检索记录的人
3. 处理中英双语内容的人

### 2.3 产品承诺

用户不关心你用了哪个模型、HTTP 还是 WS、预连接还是冷启动。

用户只关心四件事：

1. 按键就能说
2. 文本来得快
3. 结果稳定可信
4. 历史能找得到

V2 必须围绕这四件事设计。

---

## 3. 从 V1 学到的硬教训

### 3.1 最大问题不是功能不够，而是边界不清

V1 同时想做：

1. PTT
2. Meeting
3. 多后端
4. 本地服务管理
5. 翻译
6. AI 摘要
7. Action items
8. 模型管理
9. 各种高级参数调优

这些能力没有被分层，直接堆到了一个应用里，结果是：

1. 设置项爆炸
2. UI 信息架构变形
3. 主进程承担过多编排责任
4. 识别后端差异泄漏到产品层
5. 状态同步复杂，调试困难

### 3.2 当前最不合理的设计

以下设计在 V2 必须直接废弃：

1. 把“后端类型”“传输模式”“本地/远程”“翻译配置”“模型参数”同时暴露给普通用户
2. 把设置做成一个承载几乎全部复杂度的侧滑大面板
3. 让 `App.tsx` 这种顶层 UI 组件承担跨页面的业务编排
4. 用大量 provider-specific 分支贯穿 session 生命周期
5. 用“当前段 + 已提交段 + preview + sentencePairs + translatedText + wordTimings”这种混合模型在多个层级来回拼接
6. 把“会议实时转录”和“PTT 一次性转录”当成两套几乎独立系统来维护

### 3.3 V1 真正保留下来的经验

这些是 V2 要保留并做好的：

1. PTT 和 Meeting 都是有效需求，不需要再证明
2. 本地识别和云识别都需要，但必须被能力化抽象
3. 历史记录必须内建，而不是导出后自理
4. 实时翻译是增益功能，但必须成为可插拔能力，不得污染转录主流程
5. 桌面应用仍然是正确形态，因为热键、托盘、系统音频采集、文本注入都需要桌面能力

---

## 4. V2 的产品原则

### 4.1 先做稳定的“内核”，再做花活

优先级永远是：

1. 采集稳定
2. 会话状态清晰
3. 文本提交逻辑可靠
4. 历史可持久化
5. UI 易理解
6. 翻译、摘要、导出等增值能力

### 4.2 对用户隐藏组合复杂度

V2 不再暴露“引擎 x 模式 x 端口 x 协议 x profile”的组合矩阵。

改成“能力配置 + 预设方案”：

1. `本地快速`
2. `本地准确`
3. `云端低延迟`
4. `云端低成本`

高级设置存在，但默认折叠，且必须有明确适用场景。

### 4.3 一个统一的转录内核

PTT 和 Meeting 都共用同一条主流水线：

`Capture -> Segment -> Recognize -> Normalize -> Translate(optional) -> Persist -> Deliver`

差别只体现在：

1. 会话模式
2. 输入源
3. 输出方式
4. UI 呈现

### 4.4 数据结构必须为“草稿态”和“提交态”分离服务

不要让 UI 和引擎同时去猜测什么算 preview、什么算 final。

V2 必须明确区分：

1. `Draft`：仍可能变化
2. `Committed`：一旦提交就不回滚
3. `Derived`：翻译、摘要、分句、时间线等由 committed 结果派生

### 4.5 产品界面必须收敛

V2 只保留 4 个一级区域：

1. `Quick Dictation`
2. `Live Session`
3. `History`
4. `Settings`

不再让首页承载过多仪表盘式信息。

---

## 5. V2 明确不做什么

以下内容不进入 V2 首发范围：

1. 复杂 AI 助手编排
2. 多种摘要模板
3. Action items 自动提取工作流
4. 细粒度模型下载器 UI
5. 面向普通用户的“弱边界延迟”“流式策略”等调参项
6. 太多后端的一等支持

V2 首发只保留两类识别方案：

1. 一个本地方案
2. 一个云端方案

第三、第四个后端只有在它们满足统一能力契约且确有价值时再加。

---

## 6. 成功标准

### 6.1 体验指标

1. PTT 从松键到首个文本出现，主流路径 < 1.2s
2. Meeting 从点击开始到进入可见转录状态，主流路径 < 2.5s
3. 30 分钟会议不中断、不丢 session、不出现内存持续失控增长
4. 历史检索在 1 万条记录内仍保持流畅

### 6.2 产品指标

1. 新用户首次完成 PTT 的路径不超过 3 步
2. 设置页首次可理解，不需要先懂 ASR 术语
3. 95% 以上用户无需进入高级设置

### 6.3 代码指标

1. 识别后端切换不影响 UI 层代码
2. 渲染层不持有 provider-specific 逻辑
3. 领域状态机有纯逻辑测试覆盖
4. 任何 transcript 合并逻辑都必须可单测

---

## 7. 重新定义产品结构

### 7.1 Quick Dictation

它是一个极速工具，不是仪表盘。

用户打开应用后应立刻看懂：

1. 当前是否已就绪
2. 热键是什么
3. 输出会发到哪里
4. 最近一次结果是什么

界面只保留：

1. 当前引擎状态
2. 热键提示
3. 最近一次转录结果
4. 一个“开始实时会议”入口

### 7.2 Live Session

它是整个产品的主战场。

这里必须优先保证：

1. 状态明确
2. 文本可读
3. 当前正在说的内容和已确认内容有清晰边界
4. 长时间运行稳定

界面只需要：

1. 顶部会话状态栏
2. 中央滚动转录流
3. 右侧或底部上下文面板
4. 停止、标记、复制、导出

### 7.3 History

History 是资产库，不是附属页。

必须支持：

1. 时间筛选
2. 来源筛选
3. 关键词搜索
4. 详情查看
5. 导出原文/双语文本

### 7.4 Settings

Settings 必须从“参数总仓库”改成“产品配置入口”。

一级信息架构固定为：

1. `General`
2. `Speech Engine`
3. `Input & Output`
4. `Language & Translation`
5. `Advanced`

普通用户前四页足够，高级页默认隐藏。

---

## 8. V2 的信息架构

```text
App
├─ Quick Dictation
├─ Live Session
├─ History
│  ├─ List
│  └─ Detail
└─ Settings
   ├─ General
   ├─ Speech Engine
   ├─ Input & Output
   ├─ Language & Translation
   └─ Advanced
```

核心改动：

1. 不再用“首页大拼盘”
2. 不再让 Settings 承载全部产品理解成本
3. 不再让 Detail 承担过多 AI 功能入口

---

## 9. 核心交互流程

### 9.1 PTT

```text
Idle
-> User holds hotkey
-> Capturing
-> User releases hotkey
-> Recognizing
-> Optional translation
-> Deliver text
-> Save record
-> Idle
```

要求：

1. 浮动指示器极简，只表达状态
2. 输出失败时可重试或复制，不可静默失败
3. 最近一次结果在主界面可见

### 9.2 Meeting

```text
Idle
-> Preparing
-> Streaming
-> Finishing
-> Persisting
-> Completed
```

要求：

1. `Preparing` 必须可见，不允许“点了没反应”
2. `Streaming` 时要明确显示当前输入源和引擎状态
3. `Finishing` 时禁止用户误以为已结束但数据还未落库

### 9.3 History Detail

```text
Open transcript
-> Read
-> Search within transcript
-> Copy / Export
-> Optional enrichments
```

AI 增强能力必须是附加动作，不得成为详情页主结构。

---

## 10. 统一领域模型

V2 的核心不是页面，而是会话。

### 10.1 核心对象

#### `EngineProfile`

```ts
type EngineProfile = {
  id: string
  kind: 'local' | 'cloud'
  label: string
  capabilities: EngineCapabilities
  configRef: string
}
```

#### `EngineCapabilities`

```ts
type EngineCapabilities = {
  streaming: boolean
  translation: boolean
  wordTiming: boolean
  speakerSeparation: boolean
  requiresNetwork: boolean
  requiresLocalService: boolean
}
```

#### `RecognitionSession`

```ts
type RecognitionSession = {
  id: string
  mode: 'ptt' | 'meeting'
  state: SessionState
  startedAt: number | null
  endedAt: number | null
  engineProfileId: string
  sources: CaptureSource[]
}
```

#### `TranscriptDraft`

```ts
type TranscriptDraft = {
  committedBlocks: TranscriptBlock[]
  activeBlock: TranscriptBlockDraft | null
}
```

#### `TranscriptBlock`

```ts
type TranscriptBlock = {
  id: string
  source: 'system' | 'microphone' | 'mixed'
  speakerLabel?: string
  text: string
  translatedText?: string
  startedAt: number
  endedAt: number
  words?: WordTiming[]
}
```

#### `SavedTranscript`

```ts
type SavedTranscript = {
  id: string
  mode: 'ptt' | 'meeting'
  title: string
  startedAt: number
  endedAt: number
  language?: string
  targetLanguage?: string
  blocks: TranscriptBlock[]
  plainText: string
  translatedPlainText?: string
  metadata: TranscriptMetadata
}
```

### 10.2 一条铁律

任何时刻，系统里只能有一份权威 transcript 状态。

1. 引擎输出的是事件
2. Session reducer 负责合并事件
3. UI 只消费 reducer 结果

不允许 UI 再自己发明一套合并逻辑。

---

## 11. 状态机设计

### 11.1 PTT 状态机

```text
idle
-> arming
-> capturing
-> recognizing
-> post_processing
-> delivering
-> completed
-> idle

error -> idle
cancelled -> idle
```

### 11.2 Meeting 状态机

```text
idle
-> preparing
-> streaming
-> finishing
-> persisting
-> completed
-> idle

error
recovering
stopped_unexpectedly
```

### 11.3 为什么一定要状态机

因为 V1 的复杂度很大一部分来自“状态存在，但没有被正式建模”。

V2 所有副作用都必须挂在状态迁移上：

1. 开始采集
2. 连接引擎
3. 发送音频
4. 提交最终片段
5. 停止并落库
6. UI 状态提示

---

## 12. 架构方案

### 12.1 总体原则

继续使用 Electron，但重切边界。

原因很简单：

1. 全局热键
2. 托盘
3. 系统音频采集
4. 文本注入
5. 本地存储

这些能力桌面端天然更合适。

### 12.2 分层结构

```text
src/
├─ main/
│  ├─ bootstrap/
│  ├─ platform/
│  ├─ ipc/
│  └─ app-services/
├─ preload/
├─ renderer/
│  ├─ app/
│  ├─ features/
│  ├─ pages/
│  └─ shared-ui/
└─ core/
   ├─ session/
   ├─ transcript/
   ├─ engine/
   ├─ capture/
   ├─ settings/
   ├─ storage/
   └─ diagnostics/
```

### 12.3 各层职责

#### `core/`

纯业务层，不碰 Electron API。

负责：

1. 状态机
2. transcript reducer
3. 能力模型
4. 数据模型
5. 配置规范化

#### `main/`

负责平台编排，不负责产品逻辑发明。

负责：

1. 热键注册
2. 窗口管理
3. 系统服务生命周期
4. 本地 Python 服务拉起
5. IPC 接口实现

#### `renderer/`

只负责呈现和用户操作。

负责：

1. 页面结构
2. 视觉状态
3. 用户命令触发
4. 列表与详情浏览

### 12.4 本地识别服务

本地 ASR 服务必须被当成“可替换的外部子系统”，而不是主应用内部随处可见的特殊分支。

要求：

1. 通过稳定协议通信
2. 独立 health check
3. 独立 capabilities
4. 独立日志

可以继续保留 Python，但接口必须收敛。

---

## 13. 识别后端契约

V2 不再让后端实现直接暴露给 UI。

所有后端必须实现同一接口：

```ts
interface RecognitionEngine {
  getCapabilities(): Promise<EngineCapabilities>
  warmup(): Promise<void>
  startSession(input: StartSessionInput): Promise<void>
  pushAudio(chunk: AudioChunk): void
  stopSession(): Promise<void>
  abortSession(): Promise<void>
  onEvent(listener: (event: RecognitionEvent) => void): Unsubscribe
}
```

### 13.1 统一事件模型

```ts
type RecognitionEvent =
  | { type: 'session-ready' }
  | { type: 'draft-updated'; payload: DraftUpdate }
  | { type: 'block-committed'; payload: TranscriptBlock }
  | { type: 'warning'; payload: EngineWarning }
  | { type: 'error'; payload: EngineError }
  | { type: 'session-ended' }
```

关键要求：

1. UI 不关心 WS/HTTP
2. UI 不关心 provider 返回的原始字段
3. reducer 只消费统一事件

---

## 14. 设置系统重做方案

### 14.1 原则

设置不是调参后台，而是“选择工作方式”。

### 14.2 普通设置

#### `General`

1. 语言
2. 主题
3. 开机启动
4. 托盘行为

#### `Speech Engine`

1. 选择预设方案
2. 查看当前能力
3. 测试连接/测试本地服务

#### `Input & Output`

1. PTT 热键
2. 输出目标
3. 是否包含麦克风
4. 默认输入设备

#### `Language & Translation`

1. 识别语言
2. 是否启用翻译
3. 目标语言
4. 翻译提供方

### 14.3 高级设置

只保留确实必要的少量项目：

1. 本地服务地址
2. 诊断日志开关
3. 实验特性开关

只有在普通路径无法覆盖时，才允许把高级参数引入 UI。

---

## 15. 存储方案

继续使用 SQLite，但表结构要围绕会话而不是围绕页面临时需求设计。

### 15.1 最小表结构

#### `transcripts`

1. `id`
2. `mode`
3. `title`
4. `started_at`
5. `ended_at`
6. `language`
7. `target_language`
8. `plain_text`
9. `translated_plain_text`
10. `metadata_json`

#### `transcript_blocks`

1. `id`
2. `transcript_id`
3. `seq`
4. `source`
5. `speaker_label`
6. `text`
7. `translated_text`
8. `started_at`
9. `ended_at`
10. `words_json`

#### `app_settings`

1. `key`
2. `value_json`

### 15.2 存储原则

1. 草稿态不直接写最终表
2. 只有 committed 数据才进 transcript blocks
3. 大型派生结果单独存，不污染主记录

---

## 16. UI 设计原则

### 16.1 视觉原则

V2 不做“功能很多的后台”，要做“安静但专业的语音工具”。

要求：

1. 主界面低干扰
2. 实时状态高辨识
3. 长文本阅读舒适
4. 关键操作显眼但不吵

### 16.2 页面原则

1. Quick Dictation 极简
2. Live Session 高信息密度但有秩序
3. History 优先可扫描性
4. Settings 优先可理解性

### 16.3 组件原则

1. 状态颜色有明确语义
2. 当前草稿和已提交文本视觉分离
3. 翻译文本永远是附属层，不可喧宾夺主
4. 词级时间轴只在它真正有帮助时出现

---

## 17. 技术决策

### 17.1 保留

1. Electron
2. React
3. TypeScript
4. SQLite

### 17.2 重构

1. 将业务内核抽到 `core`
2. 用正式 reducer/state machine 替代散落状态
3. 用能力契约替代 provider 分支
4. 用专门 Settings 页面替代超级面板

### 17.3 暂不引入

1. 不急着拆成 monorepo
2. 不急着引入过重状态库
3. 不急着做插件系统

先把单体应用做对，再考虑扩张。

---

## 18. 测试策略

### 18.1 必测纯逻辑

1. session state machine
2. transcript reducer
3. block commit 规则
4. settings normalization
5. engine capability mapping

### 18.2 必测集成

1. PTT 从采集到输出的 happy path
2. Meeting 从启动到落库的 happy path
3. 本地服务不可用时的错误路径
4. 历史记录读写

### 18.3 可选端到端

1. 热键触发
2. 托盘启动
3. 会议开始/结束

---

## 19. 诊断与可观测性

V2 必须把“出了问题怎么查”当成一等需求。

至少要有：

1. 每个 session 的结构化日志
2. 引擎 warmup/ready/stop 时序
3. transcript commit 次数与间隔
4. 本地服务心跳与错误摘要
5. 一键导出诊断包

没有诊断能力，就不要再继续加后端。

---

## 20. 实施顺序

### 阶段 0：冻结 V2 范围

产出：

1. 最终产品边界
2. 最终页面 IA
3. 后端首发名单

完成标准：

1. 不再新增 V2 首发功能

### 阶段 1：先写核心域模型

产出：

1. session state machine
2. transcript reducer
3. engine contract
4. settings schema

完成标准：

1. 核心逻辑可脱离 Electron 单测

### 阶段 2：打通 PTT 垂直切片

产出：

1. 热键
2. 录音
3. 识别
4. 输出
5. 入库

完成标准：

1. PTT 可以独立稳定可用

### 阶段 3：打通 Meeting 垂直切片

产出：

1. 启动准备
2. 实时流
3. 草稿/提交展示
4. 停止与落库

完成标准：

1. 30 分钟 session 稳定

### 阶段 4：补 History 与导出

产出：

1. 列表
2. 搜索
3. 详情
4. 复制/导出

完成标准：

1. 历史可作为主资产浏览

### 阶段 5：补翻译与诊断

产出：

1. 翻译管线
2. 错误提示
3. 诊断导出

完成标准：

1. 翻译失败不影响主转录链路

### 阶段 6：最后才考虑 AI 增强

产出：

1. 摘要
2. 关键词
3. 待办抽取

完成标准：

1. 可完全关闭，不影响主体验

---

## 21. 首发版本定义

V2 首发必须非常克制。

### 必须有

1. PTT
2. Meeting
3. 本地或云端二选一也能完整跑通
4. 历史记录
5. 复制与导出
6. 基础翻译

### 可以晚一点

1. 词级时间轴
2. 说话人颜色高级定制
3. AI 摘要
4. Action items
5. 模型管理 UI

---

## 22. 对未来自己的约束

如果未来又开始出现这些迹象，就说明你在重蹈覆辙：

1. 设置页开始持续膨胀
2. Renderer 里出现大量 provider 分支
3. 顶层页面组件开始自己维护复杂业务状态
4. 会话状态只能靠日志猜
5. 一个功能要改 5 个地方的 transcript 合并逻辑

一旦出现，先停下来重构，不要继续叠功能。

---

## 23. 最终结论

V2 不是“把 V1 再做一遍”。

V2 要做的是：

1. 收缩边界
2. 统一内核
3. 隐藏复杂度
4. 强化状态机
5. 让产品回到用户真正关心的价值上

如果只能记住一句话，那就是：

先把“语音到文本”这条主链路做成稳定、清晰、可维护的系统，再谈一切增强功能。
