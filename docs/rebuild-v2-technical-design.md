# JustSay V2 技术设计文档

## 1. 文档目的

本文件是 [`docs/rebuild-v2-blueprint.md`](D:\my_projects\JustSay\docs\rebuild-v2-blueprint.md) 的工程化延伸。

蓝图回答“做什么”和“为什么这样做”，本文件回答：

1. 代码库怎么组织
2. 运行时职责怎么分配
3. 模块之间通过什么契约通信
4. 状态机和事件表怎么定义
5. 哪些垂直切片可以直接开工

目标是让一个新的实现团队可以据此直接创建 V2 仓库并开始编码。

---

## 2. 设计目标

V2 的技术设计必须满足以下目标：

1. `PTT` 与 `Meeting` 共享同一套转录内核
2. `Renderer` 不再承担转录状态合并责任
3. Provider 差异被限制在引擎适配层
4. 媒体采集、识别、翻译、存储、输出各自有明确边界
5. 主流程在无翻译、无 AI 增强时仍可完整运行
6. 绝大多数逻辑可脱离 Electron 单测

---

## 3. 运行时总览

### 3.1 运行时拓扑

```text
┌────────────────────────────────────────────────────────────┐
│ Electron Main Process                                     │
│                                                            │
│  AppBootstrap                                              │
│  TrayService                                               │
│  HotkeyService                                             │
│  SessionCoordinator                                        │
│  EngineRegistry                                            │
│  LocalServiceSupervisor                                    │
│  OutputDispatcher                                          │
│  TranscriptRepository                                      │
│  SettingsService                                           │
│  DiagnosticsService                                        │
└───────────────┬───────────────────────────────┬────────────┘
                │ IPC commands                  │ IPC events
                │                               │
┌───────────────▼───────────────────────────────▼────────────┐
│ Hidden Capture Window                                      │
│                                                            │
│  CaptureRuntime                                            │
│  - microphone capture                                      │
│  - system audio capture                                    │
│  - PCM conversion / resampling                             │
│  - chunk emission                                          │
└───────────────┬────────────────────────────────────────────┘
                │ PCM chunks / capture status
                │
┌───────────────▼────────────────────────────────────────────┐
│ Recognition Engines                                        │
│                                                            │
│  LocalEngineAdapter -> Python Local Service                │
│  CloudEngineAdapter -> Remote API / WS                     │
└───────────────┬────────────────────────────────────────────┘
                │ Recognition events
                │
┌───────────────▼────────────────────────────────────────────┐
│ Renderer Main Window                                       │
│                                                            │
│  App shell                                                 │
│  Quick Dictation                                           │
│  Live Session                                              │
│  History                                                   │
│  Settings                                                  │
│                                                            │
│  UI only consumes runtime snapshots and history data       │
└────────────────────────────────────────────────────────────┘
```

### 3.2 核心判断

V2 继续使用 Electron，但要把职责改成：

1. `Main` 负责平台编排与系统服务生命周期
2. `Capture Window` 负责浏览器侧音频能力
3. `Core` 负责纯业务逻辑
4. `Renderer` 只消费快照和发命令

这是 V2 最重要的架构重分配。

---

## 4. 目录结构

```text
src/
├─ core/
│  ├─ contracts/
│  │  ├─ engine.ts
│  │  ├─ ipc.ts
│  │  ├─ settings.ts
│  │  └─ storage.ts
│  ├─ session/
│  │  ├─ session-types.ts
│  │  ├─ session-events.ts
│  │  ├─ session-machine.ts
│  │  ├─ session-reducer.ts
│  │  ├─ session-selectors.ts
│  │  └─ session-machine.test.ts
│  ├─ transcript/
│  │  ├─ transcript-types.ts
│  │  ├─ transcript-reducer.ts
│  │  ├─ transcript-selectors.ts
│  │  ├─ transcript-normalizer.ts
│  │  └─ transcript-reducer.test.ts
│  ├─ settings/
│  │  ├─ settings-schema.ts
│  │  ├─ settings-defaults.ts
│  │  ├─ profile-catalog.ts
│  │  ├─ settings-resolver.ts
│  │  └─ settings-resolver.test.ts
│  ├─ errors/
│  │  ├─ error-codes.ts
│  │  └─ app-error.ts
│  └─ diagnostics/
│     ├─ diagnostic-events.ts
│     └─ runtime-metrics.ts
├─ main/
│  ├─ bootstrap/
│  │  ├─ create-app.ts
│  │  ├─ create-windows.ts
│  │  └─ lifecycle.ts
│  ├─ platform/
│  │  ├─ tray-service.ts
│  │  ├─ hotkey-service.ts
│  │  ├─ capture-window-service.ts
│  │  ├─ output-window-service.ts
│  │  └─ clipboard-service.ts
│  ├─ services/
│  │  ├─ session-coordinator.ts
│  │  ├─ ptt-coordinator.ts
│  │  ├─ meeting-coordinator.ts
│  │  ├─ engine-registry.ts
│  │  ├─ local-service-supervisor.ts
│  │  ├─ translation-pipeline.ts
│  │  ├─ output-dispatcher.ts
│  │  ├─ settings-service.ts
│  │  ├─ transcript-service.ts
│  │  └─ diagnostics-service.ts
│  ├─ engines/
│  │  ├─ local-engine-adapter.ts
│  │  ├─ cloud-engine-adapter.ts
│  │  ├─ engine-factory.ts
│  │  └─ adapters/
│  ├─ persistence/
│  │  ├─ sqlite.ts
│  │  ├─ transcript-repository.ts
│  │  ├─ settings-repository.ts
│  │  └─ migrations/
│  ├─ ipc/
│  │  ├─ channels.ts
│  │  ├─ register-ipc.ts
│  │  ├─ settings-handlers.ts
│  │  ├─ session-handlers.ts
│  │  ├─ history-handlers.ts
│  │  └─ diagnostics-handlers.ts
│  └─ shared/
│     └─ runtime-snapshot-store.ts
├─ preload/
│  ├─ index.ts
│  ├─ api.ts
│  └─ typed-events.ts
├─ renderer/
│  ├─ app/
│  │  ├─ App.tsx
│  │  ├─ router.tsx
│  │  └─ providers.tsx
│  ├─ features/
│  │  ├─ runtime/
│  │  │  ├─ runtime-store.ts
│  │  │  ├─ runtime-selectors.ts
│  │  │  └─ use-runtime.ts
│  │  ├─ settings/
│  │  ├─ history/
│  │  ├─ ptt/
│  │  └─ live-session/
│  ├─ pages/
│  ├─ shared-ui/
│  └─ lib/
└─ shared/
   ├─ api-types.ts
   ├─ ipc-events.ts
   └─ primitive-types.ts
```

### 4.1 目录规则

1. `core` 只放纯逻辑，不依赖 Electron
2. `main` 不得引入 `renderer`
3. `renderer` 不得直接依赖 `main`，只能走 `preload`
4. `shared` 只放两端都会用到的稳定类型
5. provider-specific 类型不得进入 `renderer`

---

## 5. 依赖规则

### 5.1 允许依赖

1. `renderer -> preload API types -> shared -> core`
2. `main -> core`
3. `main -> shared`
4. `preload -> shared`

### 5.2 禁止依赖

1. `core -> main`
2. `core -> renderer`
3. `renderer -> electron` 直接能力
4. `renderer -> engine adapter`
5. `renderer -> sqlite schema`

### 5.3 边界解释

一旦 `renderer` 需要知道 “WS 断了”“HTTP fallback 了”“当前是 Groq 还是 SenseVoice” 这类细节，就说明边界已经坏了。

---

## 6. 领域模型

### 6.1 基础类型

```ts
export type SessionMode = 'ptt' | 'meeting'
export type CaptureSource = 'microphone' | 'system'
export type EngineKind = 'local' | 'cloud'
```

### 6.2 引擎能力

```ts
export type EngineCapabilities = {
  streaming: boolean
  translation: boolean
  wordTiming: boolean
  speakerSeparation: boolean
  requiresNetwork: boolean
  requiresLocalService: boolean
}
```

### 6.3 引擎配置

```ts
export type EngineProfile = {
  id: string
  label: string
  kind: EngineKind
  capabilities: EngineCapabilities
  preset: 'local-fast' | 'local-accurate' | 'cloud-low-latency' | 'cloud-low-cost'
}
```

### 6.4 会话实体

```ts
export type RecognitionSession = {
  id: string
  mode: SessionMode
  status: SessionStatus
  engineProfileId: string
  startedAt: number | null
  endedAt: number | null
  sources: CaptureSource[]
  error: AppErrorPayload | null
}
```

### 6.5 Transcript 模型

蓝图中的 `activeBlock` 在 V2 技术实现里细化为“按来源保存活跃草稿”，因为 Meeting 可以同时存在多个输入来源。

```ts
export type TranscriptBlock = {
  id: string
  source: CaptureSource
  speakerLabel?: string
  text: string
  translatedText?: string
  startedAt: number
  endedAt: number
  words?: WordTiming[]
}

export type TranscriptBlockDraft = {
  id: string
  source: CaptureSource
  speakerLabel?: string
  stableText: string
  previewText: string
  translatedPreviewText?: string
  startedAt: number
  updatedAt: number
  words?: WordTiming[]
}

export type TranscriptState = {
  committedBlocks: TranscriptBlock[]
  activeDrafts: Partial<Record<CaptureSource, TranscriptBlockDraft>>
  revision: number
}
```

### 6.6 持久化实体

```ts
export type SavedTranscript = {
  id: string
  mode: SessionMode
  title: string
  startedAt: number
  endedAt: number
  language?: string
  targetLanguage?: string
  plainText: string
  translatedPlainText?: string
  blocks: TranscriptBlock[]
  metadata: {
    engineProfileId: string
    includeMicrophone: boolean
    translationEnabled: boolean
  }
}
```

---

## 7. 核心模块设计

### 7.1 `SessionCoordinator`

这是 V2 主流程的总编排器。

职责：

1. 接收 UI 命令和热键命令
2. 选择 `PTTCoordinator` 或 `MeetingCoordinator`
3. 管理当前运行时快照
4. 向 UI 广播稳定快照
5. 把错误转换成产品级状态

不负责：

1. 拼 transcript 文本
2. 直接处理原始 provider 事件
3. 操作数据库细节

### 7.2 `PTTCoordinator`

职责：

1. 热键触发的一次性会话生命周期
2. 请求 capture window 开始麦克风采集
3. 驱动单次识别
4. 在最终文本出来后触发输出分发与持久化

### 7.3 `MeetingCoordinator`

职责：

1. 长会话生命周期
2. 请求 system/microphone capture
3. 驱动流式识别
4. 管理草稿与提交块
5. 停止时完成持久化和诊断结算

### 7.4 `TranscriptReducer`

这是整个 V2 的核心纯逻辑模块。

输入：

1. 统一识别事件
2. 翻译事件
3. 会话终结事件

输出：

1. 新的 `TranscriptState`
2. 派生选择器可消费的稳定视图

原则：

1. 草稿更新只替换草稿
2. committed block 一旦进入数组，不得被回滚
3. 翻译结果只能 patch 已知 block 或已知 draft
4. UI 不允许自己再做 merge

### 7.5 `EngineRegistry`

职责：

1. 按 `EngineProfile` 返回对应适配器
2. 暴露 profile catalog
3. 隐藏 provider 实现差异

### 7.6 `LocalServiceSupervisor`

职责：

1. 启动/停止本地 Python 服务
2. health check
3. capabilities 探测
4. 结构化记录启动失败原因

状态：

1. `stopped`
2. `starting`
3. `healthy`
4. `degraded`
5. `failed`

### 7.7 `OutputDispatcher`

职责：

1. 将 PTT 最终文本发往键盘注入、剪贴板或弹窗
2. 标准化失败行为
3. 返回可诊断结果

---

## 8. 识别引擎契约

### 8.1 引擎接口

```ts
export interface RecognitionEngine {
  getCapabilities(): Promise<EngineCapabilities>
  warmup(input: WarmupInput): Promise<void>
  startSession(input: StartSessionInput): Promise<void>
  pushAudio(chunk: AudioChunk): void
  stopSession(): Promise<void>
  abortSession(): Promise<void>
  onEvent(listener: (event: RecognitionEvent) => void): Unsubscribe
}
```

### 8.2 输入类型

```ts
export type WarmupInput = {
  mode: SessionMode
  language: string
}

export type StartSessionInput = {
  sessionId: string
  mode: SessionMode
  sources: CaptureSource[]
  language: string
  translation: {
    enabled: boolean
    targetLanguage?: string
  }
}

export type AudioChunk = {
  source: CaptureSource
  data: Uint8Array
  sampleRate: number
  channels: 1
  timestamp: number
}
```

### 8.3 统一识别事件

```ts
export type RecognitionEvent =
  | { type: 'session-ready' }
  | { type: 'draft-updated'; payload: DraftUpdatePayload }
  | { type: 'block-committed'; payload: BlockCommittedPayload }
  | { type: 'translation-updated'; payload: TranslationUpdatedPayload }
  | { type: 'warning'; payload: EngineWarningPayload }
  | { type: 'error'; payload: AppErrorPayload }
  | { type: 'session-ended' }
```

### 8.4 Draft 更新载荷

```ts
export type DraftUpdatePayload = {
  blockId: string
  source: CaptureSource
  speakerLabel?: string
  stableText: string
  previewText: string
  translatedPreviewText?: string
  words?: WordTiming[]
  startedAt: number
  updatedAt: number
}
```

### 8.5 Commit 载荷

```ts
export type BlockCommittedPayload = {
  block: TranscriptBlock
}
```

### 8.6 契约要求

所有适配器都必须满足：

1. 不向上游泄漏 provider 原始字段
2. 不把 preview/final 的判定责任交给 UI
3. `blockId` 在同一 session 内稳定
4. commit 后的 block 不再改写

---

## 9. Capture 设计

### 9.1 为什么需要独立 Capture Window

因为系统音频采集和 `getUserMedia` 最适合放在浏览器上下文中执行，而不是主进程。

V2 统一为一个隐藏 `capture window`，不再拆成多套零散录音窗口。

### 9.2 `CaptureRuntime` 职责

1. 接收主进程的 capture command
2. 打开 microphone 或 system audio 流
3. 统一转成 `PCM16 mono 16kHz`
4. 按 chunk 推送给主进程
5. 上报开始、停止、错误、权限问题

### 9.3 Capture Command

```ts
export type CaptureCommand =
  | {
      type: 'start'
      requestId: string
      sources: CaptureSource[]
      microphoneDeviceId?: string
      systemSourceId?: string
      sampleRate: number
      chunkMs: number
    }
  | { type: 'stop'; requestId: string }
  | { type: 'abort'; requestId: string }
```

### 9.4 Capture Event

```ts
export type CaptureEvent =
  | { type: 'capture-started'; requestId: string; sources: CaptureSource[] }
  | { type: 'capture-stopped'; requestId: string }
  | { type: 'capture-error'; requestId: string; error: AppErrorPayload }
  | { type: 'audio-chunk'; requestId: string; chunk: AudioChunk }
```

---

## 10. IPC 设计

### 10.1 设计原则

V2 的 IPC 只暴露产品语义，不暴露实现细节。

例如：

1. 可以有 `session.startMeeting`
2. 不可以有 `start-meeting-transcription-ws`
3. 可以有 `settings.update`
4. 不可以有 `set-local-segmentation-hold-ms`

### 10.2 IPC 通道文件

`src/main/ipc/channels.ts` 中定义单一常量表，避免字符串散落。

### 10.3 Renderer -> Main 命令

```ts
type AppCommands = {
  'settings.get': () => Promise<AppSettings>
  'settings.update': (patch: SettingsPatch) => Promise<AppSettings>
  'speech.listProfiles': () => Promise<EngineProfile[]>
  'speech.testProfile': (profileId: string) => Promise<ProfileTestResult>
  'session.getRuntime': () => Promise<AppRuntimeSnapshot>
  'session.prewarm': (mode: SessionMode) => Promise<void>
  'session.startMeeting': (input: StartMeetingCommand) => Promise<void>
  'session.stopMeeting': () => Promise<void>
  'history.list': (query: HistoryListQuery) => Promise<PaginatedHistoryResult>
  'history.search': (query: HistorySearchQuery) => Promise<PaginatedHistoryResult>
  'history.get': (id: string) => Promise<SavedTranscript | null>
  'history.delete': (id: string) => Promise<boolean>
  'history.export': (id: string, format: ExportFormat) => Promise<ExportResult>
  'diagnostics.export': () => Promise<DiagnosticBundleResult>
}
```

### 10.4 Main -> Renderer 事件

```ts
type AppEvents = {
  'runtime.snapshot': AppRuntimeSnapshot
  'runtime.notification': RuntimeNotification
  'settings.changed': AppSettings
}
```

V2 推荐主界面以 `runtime.snapshot` 为主，不再分发大量零散 channel。

### 10.5 Runtime Snapshot

```ts
export type AppRuntimeSnapshot = {
  ptt: {
    status: PttStatus
    lastResult?: {
      text: string
      deliveredAt: number
      deliveryMethod: 'simulate_input' | 'clipboard' | 'popup'
    }
  }
  liveSession: {
    sessionId: string
    status: MeetingStatus
    startedAt: number | null
    durationSec: number
    transcript: TranscriptState
    engineProfileId: string
    translationEnabled: boolean
  } | null
  services: {
    localService: 'stopped' | 'starting' | 'healthy' | 'degraded' | 'failed'
  }
}
```

---

## 11. 设置系统设计

### 11.1 用户设置与运行时配置分离

V2 不再把所有引擎内部参数直接塞进 `AppSettings`。

分成两层：

1. `AppSettings`：用户可理解配置
2. `ResolvedRuntimeConfig`：引擎可执行配置

### 11.2 用户设置模型

```ts
export type AppSettings = {
  general: {
    language: 'zh-CN' | 'en-US'
    theme: 'system' | 'light' | 'dark'
    launchAtLogin: boolean
    minimizeToTray: boolean
  }
  speech: {
    selectedProfileId: string
    language: 'auto' | 'zh' | 'en' | 'ja' | 'ko'
  }
  input: {
    pttHotkey: 'RCtrl' | 'RAlt'
    includeMicrophoneInMeeting: boolean
    microphoneDeviceId: string | 'default'
  }
  output: {
    method: 'simulate_input' | 'clipboard' | 'popup'
  }
  translation: {
    enabledForPtt: boolean
    enabledForMeeting: boolean
    targetLanguage: string
    provider: 'openai-compatible'
  }
  advanced: {
    localServiceHost?: string
    localServicePort?: number
    diagnosticsEnabled: boolean
    experimentalFlags: string[]
  }
}
```

### 11.3 Profile Catalog

`profile-catalog.ts` 定义用户可选预设：

1. `local-fast`
2. `local-accurate`
3. `cloud-low-latency`
4. `cloud-low-cost`

每个 profile 再由 resolver 映射到实际 provider 和参数。

### 11.4 Resolver 作用

`settings-resolver.ts` 负责把：

1. 用户设置
2. profile catalog
3. secure store 中的凭证
4. 当前平台能力

解析成：

```ts
export type ResolvedRuntimeConfig = {
  engineProfile: EngineProfile
  engineConfig: Record<string, unknown>
  translationConfig?: Record<string, unknown>
  captureConfig: {
    sampleRate: 16000
    chunkMs: 100
  }
  outputConfig: {
    method: 'simulate_input' | 'clipboard' | 'popup'
  }
}
```

---

## 12. 会话状态机

### 12.1 PTT 状态

```ts
export type PttStatus =
  | 'idle'
  | 'arming'
  | 'capturing'
  | 'recognizing'
  | 'post_processing'
  | 'delivering'
  | 'completed'
  | 'cancelled'
  | 'error'
```

### 12.2 PTT 事件表

| 当前状态 | 事件 | 下一个状态 | 副作用 |
|---|---|---|---|
| `idle` | `PTT_HOTKEY_DOWN` | `arming` | 准备 capture request |
| `arming` | `CAPTURE_STARTED` | `capturing` | 开始接收音频 |
| `arming` | `FAILED` | `error` | 广播错误 |
| `capturing` | `PTT_HOTKEY_UP` | `recognizing` | 停止 capture，通知 engine flush |
| `capturing` | `CANCELLED` | `cancelled` | 丢弃草稿 |
| `recognizing` | `BLOCK_COMMITTED` | `post_processing` | 生成最终文本 |
| `post_processing` | `TRANSLATION_DONE` or `SKIP_TRANSLATION` | `delivering` | 调用 output dispatcher |
| `delivering` | `DELIVERY_SUCCEEDED` | `completed` | 记录 usage，写入 history |
| `delivering` | `DELIVERY_FAILED` | `error` | 保留文本用于复制 |
| `completed` | `RESET` | `idle` | 清空临时运行时 |
| `error` | `RESET` | `idle` | 清空错误态 |

### 12.3 Meeting 状态

```ts
export type MeetingStatus =
  | 'idle'
  | 'preparing'
  | 'streaming'
  | 'finishing'
  | 'persisting'
  | 'completed'
  | 'recovering'
  | 'stopped_unexpectedly'
  | 'error'
```

### 12.4 Meeting 事件表

| 当前状态 | 事件 | 下一个状态 | 副作用 |
|---|---|---|---|
| `idle` | `START_REQUESTED` | `preparing` | resolve config, warmup engine |
| `preparing` | `SESSION_READY` | `streaming` | 开始计时，广播 snapshot |
| `preparing` | `FAILED` | `error` | 释放资源 |
| `streaming` | `DRAFT_UPDATED` | `streaming` | reducer 更新草稿 |
| `streaming` | `BLOCK_COMMITTED` | `streaming` | reducer 追加 committed block |
| `streaming` | `STOP_REQUESTED` | `finishing` | 停止 capture，通知 engine close |
| `streaming` | `ENGINE_WARNING` | `recovering` or `streaming` | 按策略记录或降级 |
| `streaming` | `FAILED` | `stopped_unexpectedly` | 保存诊断，允许用户重试 |
| `finishing` | `SESSION_ENDED` | `persisting` | 整理 final transcript |
| `persisting` | `PERSIST_SUCCEEDED` | `completed` | 保存历史记录 |
| `persisting` | `PERSIST_FAILED` | `error` | 进入错误态但保留内存内容 |
| `completed` | `RESET` | `idle` | 清空运行时 |
| `recovering` | `RECOVERY_SUCCEEDED` | `streaming` | 继续 session |
| `recovering` | `RECOVERY_FAILED` | `stopped_unexpectedly` | 要求用户干预 |

### 12.5 状态机实现方式

建议用纯 reducer + transition guards 实现，不强制引入状态机库。

只要满足：

1. 转移表显式存在
2. 不允许隐式状态跳转
3. 每个状态变更有可测试副作用描述

---

## 13. Transcript Reducer 规则

### 13.1 Reducer 输入事件

```ts
export type TranscriptEvent =
  | { type: 'draft-updated'; payload: DraftUpdatePayload }
  | { type: 'block-committed'; payload: BlockCommittedPayload }
  | { type: 'translation-updated'; payload: TranslationUpdatedPayload }
  | { type: 'reset' }
```

### 13.2 核心规则

1. 同一 `source` 的 draft 被新 draft 覆盖
2. `block-committed` 会清除对应 `blockId` 的 draft
3. translation 更新只 patch 已存在 block/draft
4. reducer 不做 DB 写入
5. reducer 不做 UI 排版

### 13.3 排序规则

1. committed blocks 按 `startedAt` 排序
2. active drafts 按 `updatedAt` 派生显示顺序
3. UI 展示顺序由 selector 决定，不由页面自己拼

### 13.4 关键 selector

```ts
export const selectVisibleTimeline
export const selectPlainText
export const selectTranslatedPlainText
export const selectLatestCommittedBlock
export const selectHasDraftContent
```

---

## 14. 存储设计

### 14.1 Repository 接口

```ts
export interface TranscriptRepository {
  save(transcript: SavedTranscript): Promise<void>
  list(query: HistoryListQuery): Promise<PaginatedHistoryResult>
  search(query: HistorySearchQuery): Promise<PaginatedHistoryResult>
  getById(id: string): Promise<SavedTranscript | null>
  delete(id: string): Promise<boolean>
}
```

### 14.2 SQLite 表

#### `transcripts`

1. `id TEXT PRIMARY KEY`
2. `mode TEXT NOT NULL`
3. `title TEXT NOT NULL`
4. `started_at INTEGER NOT NULL`
5. `ended_at INTEGER NOT NULL`
6. `language TEXT`
7. `target_language TEXT`
8. `plain_text TEXT NOT NULL`
9. `translated_plain_text TEXT`
10. `metadata_json TEXT NOT NULL`
11. `created_at INTEGER NOT NULL`
12. `updated_at INTEGER NOT NULL`

#### `transcript_blocks`

1. `id TEXT PRIMARY KEY`
2. `transcript_id TEXT NOT NULL`
3. `seq INTEGER NOT NULL`
4. `source TEXT NOT NULL`
5. `speaker_label TEXT`
6. `text TEXT NOT NULL`
7. `translated_text TEXT`
8. `started_at INTEGER NOT NULL`
9. `ended_at INTEGER NOT NULL`
10. `words_json TEXT`

#### `app_settings`

1. `key TEXT PRIMARY KEY`
2. `value_json TEXT NOT NULL`

### 14.3 索引

至少建立：

1. `transcripts(mode, started_at DESC)`
2. `transcripts(created_at DESC)`
3. `transcript_blocks(transcript_id, seq)`
4. 全文搜索索引，覆盖 `plain_text` 与 `translated_plain_text`

---

## 15. Renderer 设计

### 15.1 Renderer 只做三类事

1. 展示 `runtime.snapshot`
2. 发出用户命令
3. 浏览历史记录

### 15.2 Runtime Store

`renderer/features/runtime/runtime-store.ts` 是 UI 的唯一运行时入口。

职责：

1. 订阅 `runtime.snapshot`
2. 维护本地可序列化快照
3. 对页面暴露 selector

不负责：

1. transcript merge
2. provider-specific fallback
3. 业务状态转换

### 15.3 页面数据来源

1. `Quick Dictation` 读 `runtime.ptt`
2. `Live Session` 读 `runtime.liveSession`
3. `History` 通过命令式查询拿分页数据
4. `Settings` 读取和提交 `AppSettings`

---

## 16. 错误模型

### 16.1 错误码

```ts
export type AppErrorCode =
  | 'E_CAPTURE_PERMISSION'
  | 'E_CAPTURE_UNAVAILABLE'
  | 'E_ENGINE_UNAVAILABLE'
  | 'E_ENGINE_TIMEOUT'
  | 'E_ENGINE_PROTOCOL'
  | 'E_TRANSLATION_FAILED'
  | 'E_OUTPUT_DELIVERY'
  | 'E_STORAGE_WRITE'
  | 'E_INVALID_SETTINGS'
  | 'E_LOCAL_SERVICE_START'
```

### 16.2 错误载荷

```ts
export type AppErrorPayload = {
  code: AppErrorCode
  message: string
  retryable: boolean
  detail?: Record<string, unknown>
}
```

### 16.3 错误处理规则

1. 对用户显示的是产品语言
2. 对日志记录的是结构化错误细节
3. 翻译失败不能中断主 transcript 流程
4. 输出失败不能丢文本
5. 落库失败时需保留内存结果并允许导出

---

## 17. 诊断与日志

### 17.1 结构化日志事件

```ts
type DiagnosticEvent =
  | { type: 'session-started'; sessionId: string; mode: SessionMode }
  | { type: 'capture-started'; sessionId: string; sources: CaptureSource[] }
  | { type: 'engine-ready'; sessionId: string; profileId: string }
  | { type: 'draft-received'; sessionId: string; source: CaptureSource; chars: number }
  | { type: 'block-committed'; sessionId: string; blockId: string; chars: number }
  | { type: 'translation-failed'; sessionId: string; reason: string }
  | { type: 'session-persisted'; sessionId: string; blockCount: number }
  | { type: 'session-failed'; sessionId: string; errorCode: AppErrorCode }
```

### 17.2 诊断包内容

1. app version
2. selected profile
3. recent structured logs
4. local service health summary
5. latest failed session snapshot

---

## 18. 测试设计

### 18.1 单元测试

必须覆盖：

1. `session-machine.ts`
2. `transcript-reducer.ts`
3. `settings-resolver.ts`
4. `engine-factory.ts`
5. `output-dispatcher.ts`

### 18.2 集成测试

必须覆盖：

1. PTT happy path
2. Meeting happy path
3. local service unavailable
4. storage write failure
5. translation failure fallback

### 18.3 端到端测试

优先覆盖：

1. hotkey -> capture -> output
2. start meeting -> live transcript -> stop -> history visible

---

## 19. 实施切片

### 切片 1：脚手架与基础契约

产出：

1. `core/contracts`
2. `core/session`
3. `core/transcript`
4. `shared/api-types`
5. `main/ipc/channels.ts`

完成标准：

1. 纯逻辑测试可运行

### 切片 2：统一 settings 与 profile catalog

产出：

1. `AppSettings`
2. `profile-catalog`
3. `settings-resolver`
4. secure store 读取桥接

完成标准：

1. UI 能读取、更新并展示 profile

### 切片 3：capture window

产出：

1. 单隐藏窗口 capture runtime
2. microphone capture
3. system audio capture
4. PCM chunk IPC

完成标准：

1. 主进程能稳定收到 chunk 和错误事件

### 切片 4：PTT 垂直切片

产出：

1. `PTTCoordinator`
2. output dispatcher
3. history save
4. runtime snapshot for ptt

完成标准：

1. PTT 全链路可用

### 切片 5：Meeting 垂直切片

产出：

1. `MeetingCoordinator`
2. transcript reducer integration
3. runtime snapshot for live session
4. stop and persist

完成标准：

1. Live Session 全链路可用

### 切片 6：History

产出：

1. transcript repository
2. list/search/detail/export

完成标准：

1. 历史记录可作为一等页面使用

### 切片 7：翻译、诊断与恢复

产出：

1. translation pipeline
2. diagnostics export
3. recovery states

完成标准：

1. 增强能力不污染主链路

---

## 20. 明确要避免的实现陷阱

1. 不要再让 `preload` 暴露几十个松散函数
2. 不要再让 `App.tsx` 同时管理导航、主题、会议状态、音频生命周期
3. 不要把 provider 原始 transcript 结构直接丢给 UI
4. 不要让 settings 直接保存所有引擎内部调参
5. 不要在多个层重复写 transcript merge 逻辑
6. 不要把错误处理放在 `console.error` 后就结束

---

## 21. 首批文件骨架建议

新仓开工时，先创建以下文件：

1. `src/core/session/session-types.ts`
2. `src/core/session/session-machine.ts`
3. `src/core/transcript/transcript-types.ts`
4. `src/core/transcript/transcript-reducer.ts`
5. `src/core/contracts/engine.ts`
6. `src/core/settings/settings-schema.ts`
7. `src/core/settings/profile-catalog.ts`
8. `src/main/services/session-coordinator.ts`
9. `src/main/services/engine-registry.ts`
10. `src/main/platform/capture-window-service.ts`
11. `src/main/ipc/channels.ts`
12. `src/preload/api.ts`
13. `src/renderer/features/runtime/runtime-store.ts`

先把这些文件建起来，再开始填实现。

---

## 22. 结论

这份技术设计的核心不是“怎么把当前项目拆得更漂亮”，而是建立一套新的运行时秩序：

1. `core` 持有真实业务规则
2. `main` 持有平台和编排责任
3. `capture window` 持有媒体能力
4. `renderer` 只消费稳定快照

只要这四条边界不破，V2 才有机会长期保持简洁、可维护、可扩展。
