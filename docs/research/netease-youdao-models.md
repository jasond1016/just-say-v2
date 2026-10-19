# 网易有道全部公开模型：JustSay 候选研究

研究日期：2026-10-01（Asia/Shanghai）。范围：实时查询 Hugging Face `netease-youdao` 组织的全部公开模型仓库，核对官方模型卡、官方 GitHub 源码、公开论文及上游运行时文档。**仅研究：未下载模型权重、未运行模型推理、未写 JustSay 应用代码。**

后续实测另见 [R2T2 日语 Docker 对照报告](./r2t2-ja-baseline.md)。本报告的「未实测」描述是研究完成时的状态，不能替代后续实验结果；尤其不能把「首选实验候选」理解成已验证适合日语或应替换默认模型。

JustSay 是 Windows Electron 桌面语音工作站，中英频繁切换、按键听写、长会议实时转录、逐块翻译；已有 SenseVoiceSmall、Qwen3-ASR 1.7B/0.6B；输入为 16 kHz mono PCM16，每 100 ms 一块；WebSocket sidecar 提供 `stableText` / `previewText` 和 final block；翻译已有 OpenAI-compatible chat-completions。项目侧信息已结合本地源码核查。

本地核查：现有 Qwen 流式默认 **1 s/u4/t5**；翻译对每个 final block 用通用 system/user prompt 独立请求，没有 T3PO 历史/当前输入状态；`OpenAiCompatibleChatClient` 将空响应判为异常。Windows 的 Managed Local Service 当前仅允许 SenseVoice，Qwen 走 Remote Service。源码依据：[`profile-catalog.ts`](../../src/core/settings/profile-catalog.ts)、[`service.py`](../../resources/local-service-qwen/service.py)、[`translation-pipeline.ts`](../../src/main/services/translation-pipeline.ts)、[`openai-compatible-chat.ts`](../../src/main/services/openai-compatible-chat.ts)、[`create-runtime.ts`](../../src/main/bootstrap/create-runtime.ts)、[`音频与草稿协议`](../../src/shared/local-service-types.ts)。

## 1. 结论与候选排序

**不要整体替换现有链路。首选研究 R2T2 的稳定流式 ASR；T3PO 只做中英同传的可选高资源翻译后端；TTS 留给未来朗读/配音，不进入当前转录关键路径。**

| 排名 | 候选 | JustSay 价值 | 建议与进入条件 |
|---|---|---|---|
| 1 | Confucius4-R2T2，含 GGUF | 与现有 Qwen3-ASR 同源；已提交文本不回改，更适合向下游翻译连续供给稳定文本 | **实验候选，不是立即默认替换。** 先以 Linux/WSL2/远端 CUDA 服务核对能力；Windows 原生 GGUF 路线需要移植与实测。必须验证中英混说、长窗口切换、按键释放尾音、资源峰值及自定义许可 |
| 2 | Confucius4-T3PO-GGUF，原版为质量参照 | 真正对增量源文本作 WAIT/TRANS 决策，中英双向，能复用已有 chat-completions 传输 | 本地 Windows 实验优先 Q6_K，资源紧张才比较 Q5_K_M；**不默认捆绑 14B 模型**。需要协议状态、结束强制翻译、明确方向，不能仅换模型名；量化后策略/质量未被官方精确量化验证 |
| 3 | Confucius4-TTS | 14 语言、无需参考音频转写的跨语言声音克隆 | 仅在增加朗读/配音功能时评估；当前公开 API 整段返回音频，不是低延迟流式 TTS，依赖链较重 |
| 条件候选 | embed / Rerank | 未来会议记录双语搜索、术语/资料检索 | 不改善 ASR 或同传本身。先明确检索需求；当前卡片几乎无说明，不能把 BCEmbedding 的成绩直接归给这两份 ONNX |
| 不引入 | 其余数学推理模型、QAnything 整套系统、Qwen-7B-QAnything | 与当前语音链路目标不匹配 | 不为翻译或会议总结增加这些专用数学模型；也不为尚不存在的会议知识库需求引入整个 RAG 系统 |

如果要求“Windows 原生、普通笔记本、无需 WSL、立即可分发”，本次证据**不足以批准任何新的默认 ASR**。如果优先级是“中英稳定会议字幕并愿意使用远端/WSL CUDA”，R2T2 最值得先实验。对低资源用户，保留现有 0.6B / SenseVoice 路线，而不是假设新 GGUF 必然更快。

## 2. 当前全部模型清单（15 个公开仓库）

清单由实时 [HF API](https://huggingface.co/api/models?author=netease-youdao&limit=1000&full=true) 核对，返回 15 项且没有超过本次 1000 项上限；所有项均为 `private=false`、`gated=false`。不含其他组织的相关模型、Spaces、数据集或未公开仓库。GGUF 是另一个分发仓库，不代表另一种能力。

| 仓库（一手模型卡） | 类型与来源 | 发布许可信息 | 本次判断 |
|---|---|---|---|
| [Confucius4-R2T2](https://huggingface.co/netease-youdao/Confucius4-R2T2) | Qwen3-ASR-1.7B 派生的稳定前缀 ASR | 权重：网易有道自定义；代码 Apache-2.0 | 优先研究 |
| [Confucius4-R2T2-GGUF](https://huggingface.co/netease-youdao/Confucius4-R2T2-GGUF) | 上述模型 F16 / Q8_0 / Q4_K_M + 音频 projector | 同一自定义许可 | Windows 潜力，非开箱即用 |
| [Confucius4-T3PO](https://huggingface.co/netease-youdao/Confucius4-T3PO) | Qwen2.5-14B 派生，中英双向文本同传 | Apache-2.0；模型卡提醒仍需遵守基础模型等许可 | 可选重型翻译后端 |
| [Confucius4-T3PO-GGUF](https://huggingface.co/netease-youdao/Confucius4-T3PO-GGUF) | F16 / Q6_K / Q5_K_M | Apache-2.0 | 原生 Windows 运行路径最直接的新增候选 |
| [Confucius4-TTS](https://huggingface.co/netease-youdao/Confucius4-TTS) | T2S + S2A，14 语言语音合成 | Apache-2.0；另有外部模型与代码依赖 | 可选未来朗读 |
| [QAnything](https://huggingface.co/netease-youdao/QAnything) | 本地知识库问答系统配套 `models.zip`，非单个通用 LLM | 卡片 Apache-2.0；明确提示 LLM 商用遵守 Qwen 许可 | 不纳入当前转录/翻译 |
| [Qwen-7B-QAnything](https://huggingface.co/netease-youdao/Qwen-7B-QAnything) | 老 Qwen-7B 的中英 RAG 指令微调，含自定义代码 | metadata 写 Apache-2.0，但正文又写 Tongyi Qianwen Research License，**冲突待澄清** | 不选 |
| [Rerank](https://huggingface.co/netease-youdao/Rerank) | XLM-R 序列分类 ONNX | 卡片仅 Apache-2.0 metadata | 检索需求出现后再核对 |
| [embed](https://huggingface.co/netease-youdao/embed) | XLM-R 特征提取 ONNX | 同上 | 同上 |
| [Confucius-o1-14B](https://huggingface.co/netease-youdao/Confucius-o1-14B) | Qwen2.5-14B-Instruct 派生教育数学 CoT | Apache-2.0 | 非会议/翻译模型 |
| [Confucius-o1-14B-GGUF](https://huggingface.co/netease-youdao/Confucius-o1-14B-GGUF) | BF16、Q2_K、Q3_K_M、Q4_0、Q4_K_M、Q5_0，多个分片 | Apache-2.0 | 只评估过 BF16 品质，仍不选 |
| [Confucius3-Math](https://huggingface.co/netease-youdao/Confucius3-Math) | DeepSeek-R1-Distill-Qwen-14B 派生，中文 K-12 数学强化学习 | MIT（另需基础模型合规） | 非语音链路模型 |
| [Confucius3-Math-GGUF](https://huggingface.co/netease-youdao/Confucius3-Math-GGUF) | 同类 BF16、Q2_K、Q3_K_M、Q4_0、Q4_K_M、Q5_0 分片 | MIT | 只评估过 BF16，仍不选 |
| [Confucius4](https://huggingface.co/netease-youdao/Confucius4) | Qwen3.5-27B 派生多模态数学推理，不是 R2T2/T3PO/TTS 的通用合并模型 | 正文 Apache-2.0，HF metadata 未标许可 | 不选 |
| [Confucius4_GGUF](https://huggingface.co/netease-youdao/Confucius4_GGUF) | 上述 27B，BF16 目录（卡片注明 F16 GGUF）、Q6_K、Q5_K_M；视觉 projector | Apache-2.0 | 不选 |

## 3. R2T2：真流式成立的层面与不成立的推断

### 3.1 输出契约：稳定前缀确有训练与代码路径，不是只有宣传标签

[官方模型卡](https://huggingface.co/netease-youdao/Confucius4-R2T2/blob/185ce639118ad1362d049ca0d8ed04b6ec5cd6c9/README.md) 自报使用 stable-prefix、forced time-alignment、token-level audio segmentation 数据与 Longest Stable Prefix 学习，解码分块范围 **80 ms–2 s**；已提交文本 append-only，不回改。**forced time-alignment 是训练数据工艺，不能推导出推理 API 提供时间戳。**

源码进一步区分了最新文本与 finalized text：`streaming_transcribe()` 返回 **`(full hypothesis, cumulative fixed prefix)`**，对应 `(state.text, fixed_text)`，不是返回上游 state 对象，也不是两个增量片段；尾部 token 可回退，累计稳定前缀才对外提交。`streaming_transcribe_no_reset()` 返回窗口中的最新文本和累计 `last_fixed_text`。[源码 S1]

因此更精确的说法是：**稳定提交输出为真流式；内部仍有未固定尾巴/预览修订。** JustSay 的 `stableText` 应接当前 block 的累计 finalized prefix；WebSocket 的增量 `msg.text` 要先累计，不能直接把整个 `state.text` 当稳定文本。仅使用官方 WebSocket 时，API 只提供稳定增量文本，无法恢复同等质量的独立 `previewText`；可将预览留空，或在自有 sidecar 中使用 Python API 映射未确认的尾部。JustSay 的预览是尾部，不能重复填入稳定全文。窗口模式的最新文本与跨窗口累计稳定文本也不能未经对齐直接取字符串差集。

### 3.2 计算并非完全增量

`streaming_transcribe()` 的 docstring 与实现明确说明，每次新 chunk 到来，把截至目前的 `audio_accum` **整体重新交给模型**。不是只编码最新 160 ms 的固定状态声学流。[S1，L302–L490]

官方 WebSocket v1 用 `streaming_transcribe_no_reset()`：音频超过 **16 s** 时丢弃最早 **8 s**，同时去掉对应分块的文本。截断逻辑写死普通 chunk **2560 samples = 160 ms**、首 chunk **5120 samples = 320 ms**；首次丢弃 **49 chunks**、后续 **50 chunks**。[S1，L655–L671]

GGUF 原生扩展在每次 `generate_once` 的路径调用 `llama_memory_clear(...)`，重新处理音频和 prompt；外部 embedding/hybrid prefill 路径也清 KV。[S3，L451、L731]

结论：它不是“仅把离线 ASR 结果不断覆盖展示”的输出伪流式，但也**不是已证明具有完全增量 encoder / 跨更新持久 decoder KV / 固定每块计算量**的实现。不能将 80 ms chunk 能力等同于 CPU 每 80 ms 都能完成推理。长会议可以使用有界音频窗口，却仍需实测窗口增长/截断时的算力、延迟和漏字。

### 3.3 与现有 100 ms PCM 链路的接口关系

官方 WebSocket 接收 **16 kHz mono int16 二进制帧**，Python 输入则为 float32 waveform；WS 源码把 PCM16 除以 **32768**。JustSay 100 ms = **1600 samples = 3200 bytes**，官方 160 ms 解码 = **2560 samples = 5120 bytes**，首块 160 ms + 160 ms lookahead = **5120 samples = 10240 bytes**。[S2；R2T2 README Message format]

**保留现有 100 ms 传输，不把传输块误当模型解码块**：sidecar 或 WS 服务累计后按 160 ms 解码。这样首轮 320 ms 音频在 100 ms 包节拍下，要等第 4 包才够；之后更新节拍受缓冲量影响，并非恒定 100 ms。Python 接口可接任意样本长度，但官方 v1 长窗口文本裁剪按 160/320 ms 写死，所以不应未经检查把长会议解码直接改成 100 ms。

官方 `/asr_stream_api_v1` 的成功响应是 `status/requestId/msg`，其中 `msg.text` 为**自上次响应以来的新稳定片段**，`reset` 表示段边界；还带 `asr_cost_ms` / `total_cost_ms`。它没有 JustSay 的 final block 对象，需转换到现有 block 生命周期。音频结束使用文本消息 `YOUDAO_ONETIME_ASR_STREAM_EOS`，服务 flush 后关闭；不能只关 socket。[S2；README WebSocket endpoint / Message format]

`reset=true` 包里的 `text` 仍是新片段，不能再拼入一遍旧全文。只把稳定源文本交给翻译，以免翻译 append-only 地锁定后来会回改的预览。

### 3.4 中英切换：有一手支持路径，缺定量混说结果

官方 GitHub README 的演示入口明确包含 code-switch / 中英混说；WS `language` 默认 `zhen`，源码将其转换为 Python `None`（**不是传给模型的独立“zhen”语言 token**）。`language=None` 时可自动判断语言；文本清理保留 mixed-language 英文空格。[S2，L926–L929；S1，L704–L709；官方示例入口 https://r2t2.youdao.com/examples/]

[config.json](https://huggingface.co/netease-youdao/Confucius4-R2T2/blob/185ce639118ad1362d049ca0d8ed04b6ec5cd6c9/config.json) 列出 **30 个 support_languages**（含 Chinese、English、Cantonese 等）。这是配置声明，不是 30 语言逐项实测证明。官方称主要优化中文/英文；本次未找到可复现的中英 code-switch CER/WER 表、混说切换延迟、专有名词 benchmark，也未播放演示来假装做了测试。

对 JustSay 优先试 `None` / WS `zhen`，再分别对比显式 Chinese、English；官方 no-reset 路径会把此前识别语言拼进后续 prefix，因此**不能仅凭自动识别选项保证连续频繁换语言没有滞后或偏置**。

### 3.5 时间戳和会议功能

**官方流式 API 明确不支持 timestamps，forced aligner 不参与；单条流式调用不支持 batch。** [S1，L226–L240、L330–L332]

非流式 `transcribe()` 继承 Qwen3-ASR，签名接受 `return_time_stamps` 并向父类转发。是否配 Qwen forced aligner 可得到符合 JustSay 所需质量的词级时间戳，**本次未验证**；官方示例 `forced_aligner=None`、`return_time_stamps=False`。不应把父类的可选参数当成流式已有能力。

`asr_cost_ms` 是计算耗时，不是词的声学时间；chunk 到达时间也不等于词级对齐。当前证据没有说话人 diarization/分离重叠发言的正式输出契约。可保存应用自己掌握的 block 起止采样位置，但只能称块级时间范围，不可标称精准词级时间戳。

### 3.6 作者自报指标：低延迟不是免费的精度升级

下列数字均为**作者评测，不是本次实测，也不是 JustSay 的基线评测**。官方比较把 Qwen3-ASR 2 s/u2/t5 列为可回改的 pseudo-streaming，并另列 160 ms base；不能仅选较差的 160 ms base 宣称 R2T2 比现有 Qwen 一概准确。[R2T2 模型卡 Evaluation]

| 数据集、指标（%） | Qwen3-ASR 2 s/u2/t5 | Qwen3-ASR base 160 ms | R2T2 160 ms |
|---|---:|---:|---:|
| AMI，英文 WER | 9.25 | 24.79 | 11.37 |
| LibriSpeech clean，英文 WER | 1.67 | 22.30 | 2.13 |
| LibriSpeech other，英文 WER | 3.54 | 25.74 | 4.88 |
| EN-RealSI，英文 WER | 6.54 | 13.75 | 8.40 |
| Wenet-meeting，中文 CER | 5.97 | 20.38 | 7.27 |
| Wenet-net，中文 CER | 4.94 | 19.79 | 5.87 |

这些会议/英文集合上，R2T2 160 ms 比 160 ms base 明显好，但比 2 s/u2/t5 仍有精度损失。核心价值是**稳定提交、低延迟的权衡**，不是没有代价地提高精度。作者“no loss in offline accuracy”指训练后离线能力保持，并不等于流式结果与离线完全相同。

尤其 **Wenet-meeting 7.27 vs 5.97、AMI 11.37 vs 9.25** 是“不全面更准”的直接反例。主线程核实 JustSay 默认 **1 s/u4/t5**，与作者 **2 s/u2/t5** 基线不同，所以表中差距也不能直接当成 JustSay 引入后的效果预测。**本次没有实机测试。**

官方 SVG 包含可精确读取的标签；指标名为 **retrospective chunk-wise latency**，Pareto 图注称 mean fuzzy latency，不能视作指定 Windows 硬件的端到端延迟 SLA：

| 官方 160 ms 配置 | 英文 WER | First / Average / Last（s） | 中文 CER | First / Average / Last（s） |
|---|---:|---|---:|---|
| quality priority | 6.13 | 0.58 / 0.55 / 0.52 | 6.42 | 0.69 / 0.60 / 0.24 |
| latency priority | 7.13 | 0.27 / 0.21 / 0.09 | 7.10 | 0.39 / 0.32 / 0.18 |

出处：[英文 SVG](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/resources/asr_en_wer_latency.svg)、[中文 SVG](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/resources/asr_cn_wer_latency.svg)。图的汇总口径与各 dataset 表不是同一行数值，不自行重算为 JustSay 预期 WER；未找到这些延迟值所对应的明确消费级 GPU/CPU 配置。

### 3.7 GGUF 体积、硬件与 Windows 路径

不要把名称 `Qwen3-ASR-1.7B` 当成完整参数统计：HF safetensors API 对 R2T2 返回 **2,038,052,480 个 BF16 参数**（含整体 checkpoint），原始两字节权重计算为 **4,076,104,960 bytes ≈ 3.796 GiB**，不含运行时缓存。[HF R2T2 API]

官方 GGUF 模型卡用 GiB 约数；下面为 API 的精确文件字节，无需下载权重：

| 文件 | bytes | GiB（换算、约） |
|---|---:|---:|
| R2T2-f16.gguf | 3,447,345,088 | 3.211 |
| R2T2-Q8_0.gguf | 1,834,422,208 | 1.708 |
| R2T2-Q4_K_M.gguf | 1,107,404,736 | 1.031 |
| mmproj-f16.gguf | 641,773,984 | 0.598 |
| mmproj-Q8_0.gguf | 348,336,544 | 0.324 |

出处：[HF GGUF API](https://huggingface.co/api/models/netease-youdao/Confucius4-R2T2-GGUF?blobs=true)。Q4_K_M + Q8 projector 共 **1,455,741,280 bytes ≈ 1.356 GiB**，不是“整个 ASR 只有 1 GB”；F16 + F16 projector 共 **4,089,119,072 bytes ≈ 3.808 GiB**。音频 projector 是必要部分，而不是可省略的图像附件。

运行内存还包括 KV、音频编码、激活、batch 和运行时。按 config 的 28 layers、8 KV heads、128 head dimension，**假设 K/V 均 FP16/BF16、单序列、普通未压缩缓存**，估算 K+V 为每 token **114,688 bytes**；4096 tokens 约 **0.4375 GiB**，32768 tokens 约 **3.5 GiB**。这是结构推算，不是实测显存，也不包括运行时额外分配；GGUF native 默认 `n_ctx=32768`、`n_batch=8192`、`n_threads=32`，不可仅由权重文件大小推最低内存。[S4；config]

官方 GGUF 后端三条路线：[S5]

| 路线 | 真实运行组件 | Windows 判断 |
|---|---|---|
| `stream_llama_hybrid`（官方推荐） | PyTorch/vLLM-native 音频 encoder + llama.cpp decoder；需要 HF processor/模型路径与 GGUF | 不是纯轻量 GGUF。保留 CUDA/PyTorch 依赖；较适合 Linux/WSL2 先验证 |
| `stream_llama` | llama.cpp mel + encoder + decoder；流式算法/processor 仍由 Python 侧复用 | 最接近原生 Windows 桌面方向，但官方预编译与依赖尚不支持直接使用 |
| `onetime_llama` | llama.cpp 单次识别，GGUF 目录即可 | **不是流式**，不能拿单次成功证明长会议流式可用 |

关键事实：

- [官方预编译说明 S5] 仅 **Linux x86_64、CUDA、CPython 3.12**；llama.cpp **0.4.0 / b10950**，固定上游提交 [ad6c668](https://github.com/ggml-org/llama.cpp/commit/ad6c66839af3c5646fba8c6c2e2087a1e4e38948)，ggml **0.23.0**、GNU **14.4.0**。没有官方 `.dll/.pyd` Windows 分发证据。
- 官方 `pyproject.toml` OS classifier 为 POSIX Linux，并默认依赖 `qwen-asr[vllm]`；`ws_server.py` 使用 `Sanic.start_method="fork"`、GPU FireRedVAD，ASR 仍实例化 vLLM，并没有 GGUF WS 开关。[S2；S6]
- 即便 `LlamaNative` 声学编码不使用 PyTorch，复用的 streaming 方法在传 `max_new_tokens` 时仍执行 `from vllm import SamplingParams`；官方 demo 正是这样调用。[S1，L350–L351；S4] **仅重编译 native extension 不能证明整条 Python 流式路径已脱离 vLLM。**
- [vLLM 官方安装文档](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/)明确 OS Linux，不支持原生 Windows，推荐 WSL；这约束 R2T2 现成路径，而非仅编译器问题。
- [llama.cpp 官方构建文档](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)支持 Windows MSVC/clang + CMake，CUDA/Vulkan 等后端。但**上游 Windows 支持不等于 Youdao wrapper、音频 projector、流式模型、Vulkan 都已经过验证**。
- 官方解释推荐 hybrid 的原因：两种 encoder 对**安静音频起始段**的鲁棒性不同，hybrid 保留 PyTorch encoder 以取得较好识别品质。[S5] 原生 GGUF 路线需特别测试低音量起音，不能视为无损替代。

建议路径：先保留 Electron Windows 前端，通过现有 WS sidecar 连接 Linux/WSL2/远端官方服务建立对照；要原生本地分发，再评估固定上游版本、Windows native 重建、解除流式调用对 vLLM 的实际依赖、HF tokenizer/processor 打包及稳定/预览/结束协议转换。本次不实现这些改动。未找到官方“最低 4/6/8 GB 显存”或指定笔记本 CPU real-time factor，不编造门槛。

### 3.8 长会议与按键听写：后续 POC 项，而非本次 bug 审计

选型上，官方已有流式与 rolling-window 实现，但没有足够证据证明 JustSay 的数小时会议与按键释放边界已可靠。以下仅列验收项目，不把静态观察冒充漏字/崩溃复现：

1. 采用有界 rolling-window 路线验证至少 2 小时，而非由单文件累计音频 demo 推断长期资源稳定。[S1]
2. 保持 100 ms transport，验证尾帧不足 160 ms、恰好整块、半词、VAD reset 与 EOS flush 均完整提交，且累计前缀与 WS delta 不重复拼接。[S1；S2]
3. 验证 16 s 窗口裁掉 8 s 的边界重复/遗漏、混说语言前缀偏置、quiet onset；改变解码 chunk 大小时重新核对窗口文本同步。[S1；S5]

### 3.9 许可：非 Apache 权重，并有中英文收入门槛冲突

[英文 MODEL_LICENSE](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/MODEL_LICENSE)、[中文 MODEL_LICENSE_zh](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/MODEL_LICENSE_zh)必须一起读，不能只看 Python package 的 Apache metadata：

- 权重与 GGUF 为自定义“网易有道模型使用许可协议”；官方 README 区分代码 Apache-2.0 与权重许可。不是可无条件视为 Apache/MIT 的权重。
- 第 2.2 条：你或关联方前一自然月 MAU **超过 1 亿**，或上一自然年收入达到相应门槛时，必须另获许可。**中文版为年收入超过 1 亿元人民币；英文版为 RMB 1 billion = 10 亿元。** 英文第 9 条规定中英文冲突时以中文为准，故分发决策至少按更严的 **1 亿元** 做审查，并建议向作者书面澄清，不沿用英文 10 亿元门槛。
- 第 3.4：下游接受者同样受约束，需合适合同条款；副本保留版权与协议。禁止用本模型/衍生品改进其他 AI 模型，例外为 R2T2 自身、其衍生品、非商业 AI 模型。
- “Derivative Work” 定义包含输出及基于输出的作品，范围较宽；普通 ASR 输出作为翻译输入不等于训练改进模型，但录音/转录用于商业其他模型微调、蒸馏或数据回流需要额外合规判断，不能自行宣称免责。
- 衍生模型发布需声明原作者不背书；有合规、高风险用途、侵权责任、违约撤销条款。第 1.4 的“模型”定义还提到最终代码，虽 README 声称代码 Apache，应在重分发前核清适用范围。

**法律审阅是上线门槛，不是本报告作出法律授权。** 未触达门槛不等于可以忽略下游、用途与训练限制；量化不会移除许可。

## 4. T3PO：最接近已有翻译传输接口，但策略与资源不同

### 4.1 翻译范围与协议

[官方原版模型卡](https://huggingface.co/netease-youdao/Confucius4-T3PO/blob/83332d83952dff7f0eaa6ed4f82b53eadf1f1c7c/README.md)称 **14B**、基于 **Qwen2.5-14B**；它是 **text-to-text 同传**，不直接接音频，语音翻译必须外接 ASR。正式范围是 **中文→英文 / 英文→中文**，未训练的日→中只称观察到泛化，作者明确其他方向未经严格评估。不要当作已验证多语言翻译引擎。

每次请求的 user message 包含任务指令与：

```text
<STREAMING_HISTORY>
source_1¦target_1§source_2¦target_2§...

<CURRENT_INPUT>
尚未提交的源文本 buffer
```

- 空响应或仅 EOS 为 **WAIT**：保留当前 buffer，更多源文本到来后再请求。
- 非空为 **TRANS**：输出下一目标片段，把该 buffer 与片段作为一对历史，**恰好提交一次**，然后清 buffer。
- 已提交译文 append-only，不随后文重写。推荐 greedy / `temperature=0`。
- 流结束需要 force flush 剩余 buffer。HF 示例通过 `min_new_tokens=1`；官方 HTTP generator 使用 **`min_tokens`**，不是标准所有 OpenAI-compatible 服务都支持的字段。[T1]

这不同于 `stream:true` 的 SSE token 输出：**这里的“流式”首先是源文本随时间增量到达与 READ/WRITE 决策**。原始 HTTP 实现每次读取完整 completion 后再产出片段，而不是音频端到端模型。已有 chat-completions 可复用 URL/鉴权/响应读取，但现有“每个 final block 一次普通翻译”的行为不会自动拥有上述同传策略。

根据本地核查，JustSay 的通用 prompt 不包含 `STREAMING_HISTORY` / `CURRENT_INPUT`，而 `OpenAiCompatibleChatClient` 对空响应抛错，**直接与合法 WAIT 冲突**。因此不能仅换 endpoint/模型名获得同传；需要单独的 T3PO 状态协议与空响应语义，同时保留现有普通翻译的异常判定。ASR 与翻译保持独立边界；现有设置还要求翻译 Credentials，本地无鉴权服务的配置策略也需明确。

JustSay 可先把它用于明确方向的稳定 ASR 增量；不能将 `previewText` 输入它，也不应在每个 100 ms 音频包无文字变化时发请求。100 ms 包是音频 transport，不是 14B 模型调用频率。若只是逐个完整 final block 翻译，T3PO 的独特收益较小，可能还需 force 防止 WAIT，应先与现有普通翻译比质量/延迟而非盲目替换。

双向训练不等于一次混合句自动决定统一目标语。官方 `direction` 为 zh2en/en2zh，prompt 为指定目标语同传；需明确用户目标语言、会话方向，混说源句整体译到目标语的表现仍要测。不自动逐词切换方向，否则会丢失句法上下文。

### 4.2 上下文、策略参数与缓存

[config.json](https://huggingface.co/netease-youdao/Confucius4-T3PO/blob/83332d83952dff7f0eaa6ed4f82b53eadf1f1c7c/config.json) `max_position_embeddings=32768`，48 layers、40 attention heads、8 KV heads、hidden size 5120。**32768 是模型配置的 token 窗口，不是 32768 字，也不是可无限会议记忆。** 任务指令、源/目标历史、当前输入及生成都占空间；实际 llama-server `-c` / vLLM 的服务上限仍要配置。

官方 engine 默认：[T1；T2]

| 参数 | 源码值 | 意义 |
|---|---:|---|
| `history_window` | 30 | 最近 **30 对 source-target**，不是 30 tokens 或整场会议 |
| `force_break_threshold` | 20 | 引擎强制切段阈值，按方向的 source units，不是等待 20 ms |
| `max_buffer_units` | 200 | 未提交文本 buffer 上限 |
| 一般 `max_new_tokens` | 128 | 单决策输出限制，不是上下文窗口 |
| 服务 `translation_force_max_new_tokens` | 256 | 配置默认的 force 输出上限；独立 generator 若未传覆盖则用一般上限 |

source units 按方向分词：中文主要按字符，英文按词等 token-like units，**不是模型 BPE token**。保留最近 30 对有助有界成本，但不能保证术语跨数小时一致；可利用会话级 glossary（官方已提供 prompt 术语对）而非无限增长 history。[T1；官方 `glossary.py`]

作者宣称 interleaved history 的稳定前缀可支持 KV 复用；但不能自动推导所有后端已持久复用缓存。HF `TransformersGenerator` 每次新 `tokenizer(...)` / `model.generate(...)`，没有显式保留跨调用 `past_key_values`；HTTP 路径发送完整历史，是否复用由服务端 prefix cache 决定。历史滑动会改变开头，影响命中。**需要单独验证 llama.cpp slot/prompt cache 与 vLLM prefix caching，不把格式设计当成实际吞吐证明。** [T1，L390–L421、L477–L506]

官方低/原生/高档不是三份模型，而是 first-token WAIT 边界偏置：[T3]

| 档位 | tau（源码精确值） | 偏好 |
|---|---:|---|
| low | 0.9375009536743164 | 压低 stop logits，更早提交 |
| native | 0.0 | 不加 bias，原生策略 |
| high | -0.39 | 增加 stop logits，多等上下文 |

stop IDs **151643 / 151645**；bias 为 `-tau × scale`，scale 分别 **1.0 / 1.05**，校准 repetition penalty **1.05**。量化、llama.cpp 采样处理顺序、不同 penalty 设置可改变 WAIT 决策。官方 Python HF backend 对非 native mode 会拒绝；HTTP backend 需要 `logit_bias` 等能力。结束 flush 不应保留 WAIT bias。[T3；T1；`text_inference.py`]

### 4.3 精确体积与真实成本

[HF API](https://huggingface.co/api/models/netease-youdao/Confucius4-T3PO?blobs=true) safetensors 参数统计为 **14,770,033,664 个 BF16 参数**；“14B”是族名称，不是精确 14,000,000,000。仅两字节权重结构计算 **29,540,067,328 bytes ≈ 27.511 GiB**。

[官方 GGUF CONVERSION_INFO](https://huggingface.co/netease-youdao/Confucius4-T3PO-GGUF/blob/86d1098305f8acf2f025d6c4359640fb657ec491/CONVERSION_INFO.md)与 HF API 一致：

| 版本 | bytes | 十进制 GB（约） | GiB（约） |
|---|---:|---:|---:|
| F16 | 29,547,714,080 | 29.548 | 27.518 |
| Q6_K | 12,124,681,760 | 12.125 | 11.292 |
| Q5_K_M | 10,508,871,200 | 10.509 | 9.787 |

无分片；转换器 llama.cpp 提交为 [5202104](https://github.com/ggml-org/llama.cpp/commit/5202104b59ada9005db079eea43882a2b7bf5802)，GGUF v3、qwen2 architecture、**579 tensors**。低位版本由 F16 量化，不是独立小参数模型。

按 config 推算、假设普通 FP16/BF16 K/V 单序列，head dimension = 5120/40 = **128**；K+V 每 token **196,608 bytes**，4096 tokens **0.75 GiB**、8192 tokens **1.5 GiB**、32768 tokens **6 GiB**。计算为 2（K/V）×48×8×128×2 bytes。不是实测，也不含激活、batch、运行时及 ASR。

决策解释：

- **8 GB VRAM 无法单凭完整 GPU 常驻容纳 Q5_K_M 文件对应全部权重**；CPU/部分 offload 有可行性，但不代表同传速度合格。
- **12 GB** 卡对 Q5 + 较短上下文可做实验；Q6 仅文件约 11.292 GiB，缓存/激活后空间紧张。**16 GB** 是更合理的量化翻译实验档位，**24 GB** 更适合与量化 ASR 共存；这些是容量规划建议，**不是官方最低显存/本次跑通结果**。
- F16 仅权重已超 **24 GiB**，不可把“14B 可单卡”理解为 24 GB 卡无量化全 GPU 同驻；CPU offload 会改变延迟。
- ASR 与翻译抢同一 GPU 会产生队列延迟；官方 R2T2 WS 使用 `gpu_memory_utilization=0.95`，直接同卡再起 T3PO 没有预算保证。[S2，L281–L288] 必须重规划缓存/限额，不可照抄各自示例后声称同驻。
- 每个 chunk 即便返回 WAIT 也消耗 prefill/首 token 计算；频繁重发长历史、无缓存、等待重试都会增加成本。**没有官方特定消费卡 tokens/s、CPU RTF、峰值显存/功耗或 API 单价**，不开出每小时会议成本估计。

### 4.4 Windows 可运行路径与 OpenAI 兼容的边界

官方 GGUF 卡给出 `llama-server -m ... --port 8010` 与 `/v1/chat/completions`；不需要 R2T2 那种专用音频 projector。结合 llama.cpp 官方 Windows CMake/MSVC CUDA/Vulkan 支持，**T3PO-GGUF 是较直接的原生 Windows 运行路线**，但本次没有 Windows 环境/权重执行，仍不是已测可发布成品。

建议验证 `llama-server` 的 chat template、模型名称、context size、GPU offload、EOS-only 响应、`logit_bias`、force flush。尤其官方 generator 使用的 `min_tokens` / `repetition_penalty` 是服务特定扩展：GGUF 卡只演示普通请求，**没有证明其与 vLLM 一样支持强制尾段/全部档位**。服务若忽略最小 token 参数，应根据运行时一手 API 确定 EOS 禁止/采样设置，而非只改 prompt 指示“别等待”。

### 4.5 作者评测与许可证

正式范围的公开评测图包含 **5 个子图**：en→zh RealSI、newstest2021、ACL 60/60；zh→en RealSI、newstest2021；比较 InfiniSST、EAST、Commercial A/B 与本模型档位。[官方图](https://github.com/netease-youdao/Confucius4-T3PO/blob/63a6d605934f31098e14770e1a86e84a2fd337a5/assets/figures/external_comparison_comet_word_cw.png)

横轴为 **word-CW（lower is better）**，纵轴 COMET，不是 ms；**没有逐点精确数值标签或可直接核查的表格**。本次已检视原始图，不把散点估读当精确 COMET，也不换算为音频毫秒。作者称更优质量-延迟前沿，尚未找到完整可复现实验设置/数据结果或公开 T3PO 技术报告。模型卡与仓库仍写 technical report forthcoming。

官方 Q6_K“close match to F16”、Q5“trade a little more quality”是定性建议，本次未找到量化后 COMET、WAIT率、丢段率的精确对照。推荐先 Q6，再测 Q5 的理由是降低策略扰动，而非证实 Q6 无损。

T3PO 原版与 GGUF **Apache-2.0**，没有 R2T2 那个 MAU/收入限制，但仍需保留许可/通知、遵守基础模型与外部 ASR 的许可。若 T3PO 前接 R2T2，**整体产品不会因为翻译模块 Apache 而免除 ASR 权重的自定义条款**。

## 5. TTS：优秀跨语言声音克隆候选，不是已完成流式同传播放方案

[官方模型卡](https://huggingface.co/netease-youdao/Confucius4-TTS/blob/c82f9a7b3706ee3172eb95273daa650a504dccab/README.md)和[论文 arXiv:2608.11650v1，2026-08-12](https://arxiv.org/html/2608.11650v1)提供较完整一手研究资料：

- 支持 **14 语言**：中、英、日、韩、德、法、西班牙、印尼、意大利、泰、葡萄牙、俄、马来、越南。跨语言克隆无需 reference transcript；continuation 模式可以额外使用参考转写提高相似度。跨语言声音迁移**不是把参考音频直接翻译**，目标文本仍由翻译模型产生。
- 论文训练约 **500k 小时**，**32×NVIDIA A40** 是训练硬件，不是推理最低需求。T2S **24 layers / hidden 1280**，S2A flow matching，**25 Euler steps / CFG 0.7**，最终 BigVGAN vocoder。
- CV3-Eval 每方向 **200 条**、6 方向 **1200 条**，作者 en→zh CER **6.16%**、zh→en WER **3.19%**；Seed-TTS-eval English **1088 条**、Chinese **2020 条**，默认 reference cloning English WER **1.49% / SIM 0.700**、Chinese CER **0.94% / SIM 0.765**。这些是**合成后 ASR 可懂度/声音相似度指标，不是翻译分数、实时速度或人工 MOS**。论文摘要的平均“WER 3.73%”实际混合了表中中文 CER 与英文 WER，引用时不要隐藏口径。
- 模型卡 Seed-TTS-eval 的 Qwen3-TTS 对照为 English WER **1.24% / SIM 0.714**、Chinese CER **0.77% / SIM 0.770**；不能称所有中英指标都优于现有主流 TTS。均为作者表格，不是本次独立对照。

部署与流式边界：

- 卡片要求 **Python 3.10 / CUDA 12.6**；源码 requirements 固定 torch/torchaudio **2.7.0**、transformers **4.52.4**。[TTS requirements]
- [HF API](https://huggingface.co/api/models/netease-youdao/Confucius4-TTS?blobs=true)：`t2s_model.safetensors` **2,643,608,800 bytes**、`s2a_model.pt` **417,121,682 bytes**，合计 **3,060,730,482 bytes ≈ 2.851 GiB**；只是两模块文件体积，不能当完整安装或显存需求。
- [配置 U1]还需 **facebook/w2v-bert-2.0、CAMPPlus、nvidia/bigvgan_v2_22khz_80band_256x** 与语义 codec/外部代码。CPU 路径有条件选择，但没有官方 CPU RTF 与 Windows 跑通证据；Apache 的本体许可不能覆盖参考声音使用权和全部外部依赖授权。
- 输出采样率 **22050 Hz**、参考音频输入处理 **16000 Hz**；不能把 JustSay 的 ASR PCM16 16 kHz 协议直接当 TTS 输出格式。[U1]
- [公开 `generate()` U2]按最长 **80 text tokens/segment** 分割，逐段合成，收集所有 `chunks` 后做拼接并**最后返回一个 waveform tensor**，默认 cross-fade 参数 **0.3 s**；没有音频 chunk generator、首音频时延或实时 WebSocket 输出契约。分段合成不等于实时流式输出。
- 论文结论把“improving streaming and low-latency inference / reducing runtime cost”列为 future work。故 **不建议把它挂在当前稳定会议转录/翻译关键路径**。如将来添加独立朗读/声音克隆，可先完成版权授权、Windows/WSL 部署与首音频延迟测试。

## 6. 剩余模型为何不值得当前引入

### 6.1 数学推理系列

- **Confucius-o1-14B / GGUF**：Qwen2.5-14B-Instruct 派生，卡片称训练指令 **6000 条**，专注教育数学；输出 `<thinking>` / `<summary>`。作者明确非数学任务未验证、可循环推理、没有安全对齐评测。长推理对低延迟翻译不利；没有证明适合会议总结。GGUF 只称评估 BF16，没有各低位量化的精确品质结果。
- **Confucius3-Math / GGUF**：中文 K-12，MIT，[论文 arXiv:2506.18330v1](https://arxiv.org/html/2506.18330v1)。模型卡“可消费单卡”不能挪作 T3PO 的硬件依据：论文 §8 的 RTX **4090D 24 GB** 用 **FP8**，vLLM **0.9.0 / CUDA 12.8**，不是 BF16；与 R1 比较的数字还将单卡结果乘 **8**。数学性能与吞吐不是同传能力。
- **Confucius4 / Confucius4_GGUF**：**Qwen3.5-27B** 多模态数学模型，卡片数学推理优化与 CoT 缩短；Q5_K_M 在内部 Math-Figure **664 条**上原版 **0.907**、量化 **0.895**。这是作者唯一明确量化测评，不是 ASR/翻译收益，不能把“Confucius4”族名误解成通用语音统一模型。无需为 JustSay 当前需求引入 27B 视觉数学模型。

### 6.2 QAnything 与检索模型

- **QAnything** 是完整知识库 QA 系统，支持 PDF/Word/PPT/Markdown/TXT 等；HF 卡片自己提醒文档不及时，以官方 GitHub 为准。旧卡片环境写 NVIDIA 显存 **≥16 GB**、驱动 **≥525.105.17**、CUDA **≥12.0**。这是旧版本整套系统的要求，既不是 ONNX embed 单体最低需求，也不是当前最新版保证。离线双语会议资料检索有潜在价值，但未出现该产品需求前不加入。
- **Qwen-7B-QAnything** 中英 RAG 专用，基于老 Qwen-7B，官方 runtime 为 FastChat + Transformers/vLLM，默认 Transformers 8-bit load + BF16 inference。卡片 Apache metadata 与正文 Tongyi research license 不一致；商业分发不能只信标签。本次不建议选它作翻译或总结。
- **embed / Rerank**：两张卡片仅 28 bytes 左右（基本只有 Apache metadata），无 benchmark/输入输出说明。官方 [embed config](https://huggingface.co/netease-youdao/embed/blob/2beecc0e56f555b44772f48cc6fdcc6769e0b0a3/config.json)为 XLMRobertaModel，[Rerank config](https://huggingface.co/netease-youdao/Rerank/blob/fbdee35dc840e2fe179a4c1fcfa552681aad9510/config.json)为 XLMRobertaForSequenceClassification；二者 **12 layers、hidden 768、12 attention heads、max_position_embeddings 514**。**514 不是用户可输入 514 tokens 的承诺**（位置与特殊 token 开销要核对）。ONNX 文件存在不等于已经确定池化/归一化/输出 head 的契约。
- QAnything 卡片引用官方 **BCEmbedding** 的 bce-embedding-base_v1 / bce-reranker-base_v1；[BCEmbedding README](https://github.com/netease-youdao/BCEmbedding)说明 CLS pool、512-token 常规输入与双语/跨语检索。但本次**没有验证这两个 `netease-youdao/embed` / `Rerank` ONNX 是相同 checkpoint/导出版本**，不能把 BCE MTEB 59.43、rerank 60.06 等成绩直接归属给它们，也不能因 wrapper 支持长文切片而宣称 ONNX 原生 32k context。

## 7. 建议下一阶段验收（本次未执行）

目标是决定能否引入，而不是下载完能出一句文字就判定通过：

1. **先法律门槛**：R2T2 中/英文协议、收入/关联方、下游许可证和基于输出训练限制；确认是否允许所计划的桌面 bundled weights/按需下载及商业使用。
2. **独立 ASR 对照**：SenseVoiceSmall、Qwen3-ASR 0.6B/1.7B、R2T2 原版/Q8/Q4；相同录音、采样率、VAD/热词设置。不要改变多个维度后把改善归因于模型。
3. **任务集**：短按键听写（100–900 ms 与秒级）、句末半词/英文专有名词、200/500/1000 ms 静音、中文句里英文缩写/数字/代码、连续中→英→中切换、安静起音、长语音无静音、重叠说话/远场噪声。仅中英分开测不覆盖 code-switch。
4. **长会议至少 2 小时**：围绕 16 s/8 s 窗口切换记录重复/遗漏，监控 RAM/VRAM、队列积压、重连/睡眠恢复、静音幻觉。分别测官方 v1 与自有 sidecar 的 tail flush，保留 100 ms transport。
5. **性能口径**：首稳定字、稳定词 acoustic lag、final block 延迟、P50/P95/P99、RTF、stable-prefix 回改次数、CER/WER（混说定义单独记录），测模型/端点单独资源以及 ASR+T3PO 同驻。别拿 retrospective latency 当设备上的端到端 SLA。
6. **T3PO 独立文本对照**：先喂人工正确 stable chunks，再喂真实 ASR，区分翻译错误与 ASR 级联错误；native 起步，再测 low/high。测试单个否定、后置修饰、数字单位、术语、混说目标语、空 WAIT、准确一次提交、`¦/§` 转义、history=30 滑动、断线后恢复与 end flush；量化需重新测 WAIT率、遗漏/重复和 COMET/人工正确性。
7. **Windows 路径**：T3PO llama-server 原生先验证标准与扩展字段；R2T2 先 WSL/远端建立参照，原生移植再测 CUDA/CPU（以及若需要的 Vulkan），不能用 Linux 预编译 `.so` 或单次 CLI 结果签收 Windows 实时流式支持。
8. **资源退路**：低资源设备保持现有小 ASR 与既有翻译 endpoint；模型按需启用，T3PO 不常驻抢 ASR 所需显存。只在确有朗读需求后另行评估 TTS。

## 8. 证据等级、未验证项与复查定位

- **本次已核实**：15 仓库完整公开清单；模型卡许可/能力声明；GGUF 与 TTS 文件 metadata 精确大小；配置结构；源码接口、缓冲/前缀/裁剪/结束行为；T3PO 图坐标与无精确点标签；论文内容；R2T2 许可证中英差异。采用直接读取一手文档和静态源码，不是二手评测。
- **作者自报**：ASR WER/CER/retrospective latency、TTS WER/CER/SIM/训练规模、T3PO 质量-延迟优势、其他数学模型 benchmark。没有在 JustSay 上独立复现。
- **结构推算/建议**：GiB 换算、普通 FP16/BF16 KV 预算、消费卡档位建议、100 ms transport 与 160/320 ms 解码的聚合节拍。明确不是性能测量。
- **未验证**：任何 Windows 构建/实际推理、CPU/GPU latency/RTF/功耗、GGUF 量化后的混说和 WAIT策略质量、2 小时会议稳定性、词级时间戳/说话人、原生 Vulkan 音频编码、T3PO 服务 force 参数的可移植性、TTS 首音频时延、外部依赖许可证逐项法务核查。没有下载权重或登录在线 demo 做输入测试。
- **论文缺口**：R2T2 与 T3PO 的官方当前模型卡/README仍写技术报告待发布；针对标题查找也未发现官方提供的有效 arXiv 标识，不能把不存在的论文引用补成“已验证”。TTS 与 Confucius3-Math 有上述真实论文可查；报告发布日期不能替代模型实际评测日期。

### 固定版本与一手来源索引

HF 页面可能继续更新；本报告主要重点模型快照为：

- R2T2 HF：[`185ce639` 模型卡](https://huggingface.co/netease-youdao/Confucius4-R2T2/blob/185ce639118ad1362d049ca0d8ed04b6ec5cd6c9/README.md)，API lastModified 2026-09-17；GGUF：[`86ff0251` 模型卡](https://huggingface.co/netease-youdao/Confucius4-R2T2-GGUF/blob/86ff0251cb9f456b63aeef5f80137f104e22869a/README.md)，2026-09-20。
- T3PO HF：[`83332d83` 模型卡](https://huggingface.co/netease-youdao/Confucius4-T3PO/blob/83332d83952dff7f0eaa6ed4f82b53eadf1f1c7c/README.md)，2026-09-29；GGUF：[`86d10983` 模型卡](https://huggingface.co/netease-youdao/Confucius4-T3PO-GGUF/blob/86d1098305f8acf2f025d6c4359640fb657ec491/README.md)，2026-09-20。
- TTS HF：[`c82f9a7b` 模型卡](https://huggingface.co/netease-youdao/Confucius4-TTS/blob/c82f9a7b3706ee3172eb95273daa650a504dccab/README.md)，2026-09-21。

源码定位（读取的是该固定版本，不是凭 README 标签猜测）：

- **S1** [R2T2 streaming state / 实现，r2t2_asr.py](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/r2t2/r2t2_asr.py)：L226–L240 不支持 timestamps；L302–L490 累计重送与 fixed text；L580–L763 rolling；L765–L876 finish。
- **S2** [R2T2 ws_server.py](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/ws_server.py)：L185 fork；L203–L208 chunk/lookahead；L254–L288 GPU/VAD/ASR加载；L316–L320 PCM转换；L926–L929 zhen；L1005–L1024 EOS；L1086–L1146 stable与reset；L1169 外部buffer裁剪。
- **S3** [R2T2 native_ext.cpp](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/r2t2_llama/native_ext.cpp)：L451 / L731 清 KV，mtmd 音频编码。
- **S4** [R2T2 GGUF model.py](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/r2t2_llama/model.py)：L187 起类复用 vLLM-shaped streaming；L258 起 LlamaNative 参数与 HF processor。
- **S5** [R2T2 llama backend README](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/r2t2_llama/README.md)：三路线、quiet onset、Linux/CUDA/CPython ABI、固定上游版本、native rebuild。
- **S6** [R2T2 pyproject.toml](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/pyproject.toml)：Linux classifier 与 qwen-asr[vllm]；[CMakeLists](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/r2t2_llama/CMakeLists.txt)：shared libs / $ORIGIN 路径。
- **T1** [T3PO translation.py](https://github.com/netease-youdao/Confucius4-T3PO/blob/63a6d605934f31098e14770e1a86e84a2fd337a5/inference/translation.py)：source units、EngineConfig、历史滑动、Transformers与HTTP generator。
- **T2** [T3PO config.py](https://github.com/netease-youdao/Confucius4-T3PO/blob/63a6d605934f31098e14770e1a86e84a2fd337a5/inference/config.py)：buffer/history/generation服务默认。
- **T3** [T3PO latency.py](https://github.com/netease-youdao/Confucius4-T3PO/blob/63a6d605934f31098e14770e1a86e84a2fd337a5/inference/latency.py)：精确 tau、stop IDs、bias 与校准说明；[prompts.py](https://github.com/netease-youdao/Confucius4-T3PO/blob/63a6d605934f31098e14770e1a86e84a2fd337a5/inference/prompts.py)：历史分隔符处理。
- **U1** [TTS inference_config.yaml](https://github.com/netease-youdao/Confucius4-TTS/blob/4fb32c481302d8858c3aec6a1c2a8b4cea8894c0/config/inference_config.yaml)：模型组件与采样率；[requirements.txt](https://github.com/netease-youdao/Confucius4-TTS/blob/4fb32c481302d8858c3aec6a1c2a8b4cea8894c0/requirements.txt)。
- **U2** [TTS inference.py](https://github.com/netease-youdao/Confucius4-TTS/blob/4fb32c481302d8858c3aec6a1c2a8b4cea8894c0/confuciustts/cli/inference.py)：L260–L354 分段合成与整段 waveform 返回。

**最终建议：把 R2T2 作为“稳定提交 ASR”实验，而非保证更准确/更轻的升级；把 T3PO-GGUF 作为“中英同传可选后端”，而非通用多语普通翻译；本期不引入 TTS/数学/RAG 整套。Windows 原生与长会议尾段正确性、R2T2 许可，是批准上线前最关键的三个缺口。**
