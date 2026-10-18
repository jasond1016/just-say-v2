# R2T2 日语对照实验：本地 Docker baseline 与模型比较

日期：2026-10-01。实验分支：`experiment/r2t2-ja-baseline`。2026-10-19 结论：不转正。自动语言字错误率 32.275%，强制日语 8.684%，仍差于当时的 Qwen 7.45% 和 SenseVoice 6.80%。实验 sidecar 不进入产品。

## 当前状态

- 已创建实验分支，应用代码和现有模型参数未改动。
- 已匿名下载、校验并准备全部 650 条 FLEURS 日语 test 音频与参考文本。
- 用户已确认开始，使用本地 Docker 和现有缓存模型；32 条 pilot 的 Qwen / SenseVoice baseline 均已完成，原始结果已按 hash 冻结。
- 用户已明确确认接受 R2T2 中文模型许可；已匿名下载固定版本权重、校验 SHA256，完成独立实验 Docker sidecar 的 auto / 强制 Japanese 两条件对照。四次运行各 32/32 完成、无协议失败，所有输入一致，128 条编辑距离均经独立库复核。
- 评测工具通过协议回放测试：固定音频经 JustSay WebSocket 协议，观察最终文字、提交/结束、延迟；评分使用日语 CER。**未执行 650 条全集，未增加生产 Engine Profile 或替换默认模型**。

**结论：本配置的日语 auto 模式不可作为默认替换；强制 Japanese 后外语输出消失，但 CER 仍略差于现有两种模型，优势是稳定前缀不回退以及较早的稳定输出。保留实验分支，日语精度优先仍用现有模型，不把本 pilot 结论外推到中英混说或长会议。**

## 语料与许可

采用 [Google FLEURS](https://huggingface.co/datasets/google/fleurs)，`ja_jp`，`test` split，固定 revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`。2026-10-01 官方 API 返回 `gated=false`、`private=false`；实际匿名下载成功，不需要 Hugging Face 登录、token 或访问申请。

许可：[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)。来源及引用：Alexis Conneau 等，[FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech](https://arxiv.org/abs/2205.12446)，2022。保留来源、许可和转换说明。语料是朗读语音，不足以证明真实日语会议、重叠发言或日中英混说的表现。

原始文件：

- `data/ja_jp/audio/test.tar.gz`：448,762,391 bytes，SHA256 `5de465fa7aaafc4e2c13aba44771550b8cd2dd29bb9b265daeb6d92ca8e0c136`，与 HF LFS 对象一致。
- `data/ja_jp/test.tsv`：SHA256 `5dd9643511437414681ad3f23508596c621cdf78978724a09f1f06fefe9d300b`。

本地保存于 `.amp/in/asr/fleurs-ja-test/`，已在仓库本地 exclude 中排除；不将音频权重或大型原始语料提交 Git。

## 固定输入

- 全集：650 条，8,511.12 秒（约 2 小时 22 分钟），`manifest.jsonl`。
- Pilot：32 条，428.94 秒（约 7 分 9 秒），`pilot-32.jsonl`。
- PCM：`pcm16/*.wav`。原始浮点 WAV 经 soundfile 0.13.1 转为 16 kHz、mono、PCM16；未重采样、剪切、VAD 或补静音。逐条检查采样率、声道及与 TSV 声明一致的样本数。
- 清单逐条保存唯一录音 ID、原句 ID、参考文本、原始参考文本、性别、样本数、时长、转换后的 WAV SHA256。原句可能有重复录音，不能只用句子 ID 去重。
- `provenance.json` 保存 revision、源文件 hash、转换方法、选择算法和清单 hash。
- 全集清单 SHA256：`a0d549552b0ea96ae591bdbfd29ba3637bd2a4cfeaa1f9e4421d027ade115242`。
- Pilot 清单 SHA256：`89b34b71e169ebebd445f66fdd5065cda1a5130708e37328a89a3e6265418467`。

Pilot 选择：全集按 `(num_samples, id)` 排序，用 `min(3, rank * 4 // 650)` 分四个时长区间，再按性别分组；每组按 `SHA256("justsay-ja-baseline-v1:" + id)` 排序取 4 条，最后按唯一录音 ID 排序。共 8 组，各 4 条。全集男性 571 条、女性 79 条，pilot 各 16 条；**pilot 是均衡诊断集，不可当成全集随机估计或官方 FLEURS 分数**。

## baseline 方法

1. 不修改模型或语言实现，优先测现有 Qwen3-ASR-1.7B，再测 SenseVoiceSmall 作现有低资源对照；0.6B 如需完整 profile 对照再补测。
2. 第一步使用 32 条 pilot 和 PTT 会话：100ms PCM 包按真实时间发送，单音源、无翻译，每条录音独立 start/stop。先完成准确率与停键尾段行为的可复现比较，再决定全集运行。
3. 原样保留日语配置差异：SenseVoice 会把 `ja` 传给推理；Qwen 接收并存储 session language，但 `init_streaming_state()` 未传 language，实际为自动识别。baseline 必须如实记录，不在测量前顺便修正它。未来 R2T2 自动语言为同条件主对照，强制 Japanese 是单独试验。
4. 主指标为 corpus-level CER（总字符编辑距离 ÷ 总参考字符数），另保留原始文字及逐条差错。统一参考/预测的 Unicode NFKC、大小写、标点/空白归一化规则并记录版本；不做未经声明的数字转写、假名化或同音纠错。不用空格 WER 作为日语主指标。
5. 保存原始协议事件、每条最终文字、错误/超时、首草稿/首稳定文字到达时间、stop 后最终提交时间与 session-ended 时间。SenseVoice 现有 PTT 路径只在 stop 时推理，草稿及稳定文字指标均不适用，不能把没有回退解释成更稳定的流式模型。端到端延迟与模型推理耗时、离线 RTF 分开，不混称。
6. 结果写入 `.amp/in/artifacts/asr/`，报告保存 dataset/manifest hash、Git 基线、服务代码 hash、模型 snapshot、依赖版本、硬件、参数与模式。未完成条目不能静默丢弃后只报告成功条目的漂亮分数。
7. baseline 输出冻结之后才接入 R2T2，在相同清单、模式、音频格式和评分规则下比较。长会议/VAD、精准时间戳、混说是后续独立实验，不能由本轮朗读 PTT 结果外推。

全集按真实时间运行，单模型仅音频播放就需要约 2 小时 22 分钟，多个模型需串行且加上预热/提交开销。可先用 pilot 找出不可用/明显退化的模型，再进行全集比较；不能把加速灌入音频的分数当真实流式延迟。

## 运行环境核查

- GPU：NVIDIA GeForce RTX 4060 Ti，16,380 MiB，驱动 591.86。
- Ubuntu-22.04 WSL2、Docker Desktop 已在运行。
- 现有 Docker image `justsay-qwen-local-vllm:dev` 可用；检查到 qwen-asr 0.0.4、vLLM 0.14.0、torch 2.9.1、websockets 16.0、silero-vad 6.2.1。
- 现有缓存包含 SenseVoiceSmall 与 Qwen3-ASR-1.7B；Qwen HF snapshot 为 `7278e1e70fe206f11671096ffdd38061171dd6e5`。没有为 baseline 拉取新模型权重。
- 本机 8765 是另一个项目的 HTTP 文件服务器，不是 JustSay sidecar；没有停止或修改它。实验需另选专用端口（例如 18765/18766），且逐一验证真实 runtime identity。

R2T2 的下载身份认证与许可接受是两件事。用户在本线程于 2026-10-01 明确确认接受 [中文模型许可](https://github.com/netease-youdao/Confucius4-R2T2/blob/26d55a54ce5670cff9947a167d8ed95d569fd4d9/MODEL_LICENSE_zh)，之后才下载/运行。实际匿名下载成功，不需要 HF 登录/token。此确认仅覆盖当前实验，不表示已批准商业分发、上线或捆绑权重；原研究报告的商业许可门槛仍需审查。

## 已测 Qwen baseline（pilot v1）

32/32 完成，0 失败。1,543 个归一化参考字符，115 次编辑，CER **7.453%**。Qwen 自动识别语言；这是现有产品服务路径，不是离线模型榜单。

| 指标 | p50 | p95 | 样本数 |
|---|---:|---:|---:|
| 首草稿 | 2,142.6ms | 6,125.5ms | 32 |
| 首非空稳定前缀 | 3,325.3ms | 7,203.5ms | 32 |
| stop → 最后最终提交 | 136.8ms | 217.5ms | 32 |
| stop → session-ended | 136.9ms | 217.6ms | 32 |
| 每条最大音频发送滞后 | 18.8ms | 28.6ms | 32 |

延迟从收到 session-ready 后、开始收集第一包音频前计时；不包含冷加载或第一次整条音频预热。`session-ready` 原始事件的 elapsed_ms 单独按连接开始计时，其余事件按以上基准计时；不能直接以该事件的数值重算首字延迟。分位数为 nearest-rank，单次运行，无重复测量置信区间。

同 block 的 `stableText` 发生 **9 次前缀回退，涉及 7 条录音**；判定是新稳定文字不以旧稳定文字开头，包括变空，**不是已提交 block 被改写**。例：`fleurs-ja-test-13837002945189911385` 的「…多くの点で恐竜に」回退到「…多くの点で恐」。这为 R2T2 的稳定性对比提供了实际观察项，但尚未证明对 UI/翻译造成什么影响。

差错示例（原文保留，不进行假名或数字等价纠正）：

- `fleurs-ja-test-17136622972097304011`：参考「シェンゲン圏」识别为「支援権限」，逐条 CER 23.08%。
- `fleurs-ja-test-11179370060482213220`：参考「骨董品」识别为「コットン品」，逐条 CER 16.33%。
- 数字「第2」「6-6」与预测「第二」「6対6」不被本轮归一化视作等价；因此 CER 同时含正字法差异，不能全部解释成听错。

Qwen 运行固定参数：vLLM GPU utilization 0.55，max model len 8192，max new tokens 32；push 500ms，chunk 1s，unfixed chunks 4 / tokens 5。旧缓存镜像内默认 0.9/32768 与当前代码默认不同，实测前已显式覆盖并从日志确认 8192；服务源代码以只读 bind mount 使用当前版本，未更改模型推理实现。

原始结果：`.amp/in/artifacts/asr/qwen-ja-pilot-v1/`（metadata、warmup、predictions、summary）。关键 SHA256：

- 服务源码：`2a37047e8fda60cbeae854953c254a84a8cc4c3e81aa0fe78446fb85850d68de`。
- `predictions.jsonl`：`1695403a20d4abde45744311ab49a3449f1114d783215e731b57e45e859d831e`。
- `summary.json`：`28f62aab077f2290de7372ace508b42db4565dc911e0dae42d20cf939dfdd4b5`。

## 已测 SenseVoice baseline 与对照（pilot v1）

32/32 完成，0 失败。1,543 个归一化参考字符，105 次编辑，CER **6.805%**。模型使用 `ja`、ITN 开启；整段在 stop 后推理，不能据此说明其流式能力更好。

| 指标 | Qwen3-ASR-1.7B | SenseVoiceSmall |
|---|---:|---:|
| CER（越低越好） | 7.453% | 6.805% |
| stop → 最后最终提交 p50 / p95 | 136.8 / 217.5ms | 346.2 / 481.1ms |
| stop → session-ended p50 / p95 | 136.9 / 217.6ms | 346.3 / 481.2ms |
| 首草稿 p50 / p95 | 2,142.6 / 6,125.5ms | 不适用，PTT 无草稿 |
| 首稳定前缀 p50 / p95 | 3,325.3 / 7,203.5ms | 不适用，PTT 无草稿 |
| 稳定前缀回退 | 9 次 / 7 条录音 | 不适用，PTT 无草稿 |
| 每条最大音频发送滞后 p50 / p95 | 18.8 / 28.6ms | 17.8 / 19.3ms |
| 完成 / 失败 | 32 / 0 | 32 / 0 |

逐条编辑距离 SenseVoice 更少 / 相同 / 更多：**15 / 11 / 6**。本 pilot 仅差 10 次字符编辑（0.648 个百分点），且语言控制、流式/整段路径不同，**不作统计显著性结论，也不据此切换默认模型**。停键后 Qwen 较快，但它已在录音过程中做过推理；这不是两种模型的纯推理速度/RTF 排名。

两次运行的 ID、参考文本、WAV hash、顺序完全相同；评测源码 SHA256 均为 `62152cb77b929b354e99f48ef4f95ce2d1a3c1bb7c1d8e181661d50b2aa03b15`。用现有 Python `editdistance` 库独立复核了全部 64 条编辑距离，与评测工具逐条及汇总一致。

SenseVoice image 在现有 CUDA Qwen image 上安装 funasr 1.3.1 / modelscope 1.36.3，torch 2.9.1、websockets 16.0、soundfile 0.13.1；权重来自本机已有 ModelScope 缓存，只读挂载为 `/models/SenseVoiceSmall`，该路径也是 health 的 modelIdentifier，规范模型名仍为 `iic/SenseVoiceSmall`。未独立确认缓存 snapshot revision，以实际推理文件 SHA256 固定版本。

原始结果：`.amp/in/artifacts/asr/sensevoice-ja-pilot-v1/`；模型文件 hash 清单：`.amp/in/asr/sensevoice-model-hashes.json`。关键 SHA256：

- 服务源码：`40eceaa7e234e1b4b19613d2067513480199ce0315eef0d1b4c49b1be642f54c`。
- `model.pt`：`833ca2dcfdf8ec91bd4f31cfac36d6124e0c459074d5e909aec9cabe6204a3ea`。
- `predictions.jsonl`：`ae3bc05fe7b58c84449639c43dd328c7d66058a84936769ffcbff4b14891f04c`。
- `summary.json`：`e17c8a5e2a2e39ef561da6ea6f8a4d26daf2c2c874fc83c3c296dd63dafbbbe0`。

两模型串行执行，前一实验容器停止后才启动下一模型；跑完已停止本次创建的两只容器以释放 GPU，保留镜像、缓存和日志，不影响用户原有服务。未独占桌面 GPU，延迟不可当成受控实验室硬件极限。

## R2T2 接入与实验条件

使用非量化 BF16 原版模型；本轮不含 GGUF。固定 HF snapshot `185ce639118ad1362d049ca0d8ed04b6ec5cd6c9`，官方 Python SDK [源码版本](https://github.com/netease-youdao/Confucius4-R2T2/commit/26d55a54ce5670cff9947a167d8ed95d569fd4d9)。权重 `model.safetensors`：4,076,191,640 bytes，SHA256 `cc4d5324d386c80f98a8a7b09fbcdcc813ad08a6503fe3a586ebb144ec4610dc`，与 HF 缓存对象名一致。所有配置/分词器 hash 保存于 `.amp/in/artifacts/asr/r2t2-model-hashes.json`。

独立卷 `justsay-r2t2-huggingface-cache`；推理只读挂载并设置 HF_HUB_OFFLINE=1，没有覆盖 Qwen 缓存。SDK 使用 `--no-deps` 安装，复用 baseline 的 qwen-asr 0.0.4 / vLLM 0.14.0 / torch 2.9.1 / websockets 16.0，不引入 Sanic/FireRedVAD 服务或另一套 CUDA 依赖。SDK wheel 含官方分发的 llama native 文件，但本轮不导入、不执行 GGUF 后端。

实验服务 `resources/local-service-r2t2/service.py` 仅支持单麦克风 PTT、无翻译。它不是生产 Runtime Family 接入，也不能仅改应用 endpoint 就宣称完成 UI 集成。health 如实报告实验 identity `r2t2` / `netease-youdao/Confucius4-R2T2`，并标明只支持 PTT；meeting 请求明确拒绝。

解码条件（预先记录，不在看到逐条结果后为特定音频调参）：

- 外部仍为相同 100ms PCM16 实时包；内部首块 320ms（160ms + lookahead 160ms），其后每块 160ms。任意剩余样本在 stop 时送入 SDK state.buffer，不补静音，不丢掉不足一块的尾段。
- 使用 `streaming_transcribe_no_reset` / `finish_streaming_transcribe_no_reset`，unfixed chunks 0 / tokens 1，rollback punctuation=false。官方的 >16s 丢弃最早 8s 的窗口逻辑不改；模型非完全增量编码。
- 流式每步固定最多 4 tokens，参考官方 README 的简化示例；最终 flush 最多 32 tokens，与现有 Qwen 的 token 上限一致。**不等于官方 WebSocket 的自适应 1–4-token 策略，也不是穷尽调参后的模型最优成绩。**
- vLLM GPU utilization 0.55、max model len 8192，与本轮 Qwen 一致；chunk/unfixed/token 策略有意采用 R2T2 模式，不能当成仅替换权重的纯消融试验。
- 主对照自动语言 `None`，与 Qwen 的实际条件一致。因初步观察出现法语/英语输出，另做强制 `Japanese` 的独立条件；不覆盖自动语言结果，不将强制 Japanese 与 Qwen auto 混称同条件比较。
- 只把 SDK 返回的累计 `last_fixed_text` 作为 stableText，previewText 留空。不把累计稳定文字重复拼接，不把窗口内最新假设误标成稳定全文；因此 R2T2 的首草稿与首稳定事件相同。

已验证协议样本分配：550ms 非零音频按 320 + 160 + 70ms 完整送达 SDK；125ms 短录音直接 flush；abort 后新会话不混入旧样本；显式 Japanese 传给 SDK。该测试证明适配层没有丢样本，**不证明模型准确识别了最后一个词**。

官方 no-reset 的 finish 在 `state.buffer` 为空时直接返回当前已固定文字，不再解码未固定尾 token。本轮保留该行为；恰好落在解码边界的录音不能由「正常结束」推断出尾词已完整识别。尾词质量需查看转录或另做边界 POC，不能为改善分数静默补静音。

## 已测 R2T2 自动语言（主对照）

32/32 完成，0 协议错误或超时；1,543 个参考字符、498 次编辑，CER **32.275%**。运行成功不等于输出可用，不能把严重识别错误筛掉再报告平均值。独立 `editdistance` 库逐条复核一致，输入 ID/参考/WAV hash/顺序与 baseline 完全一致。

| 指标 | p50 | p95 | 样本数 |
|---|---:|---:|---:|
| 首稳定文字（同时是首草稿） | 2,885.4ms | 11,317.6ms | 31 |
| stop → 最后最终提交 | 97.0ms | 307.4ms | 32 |
| stop → session-ended | 97.6ms | 307.5ms | 32 |
| 每条最大音频发送滞后 | 21.5ms | 29.1ms | 32 |

稳定前缀回退 0 次；`fleurs-ja-test-3499908623335261784` 没有 stop 前 stable draft，只有最终提交，首稳定分位数分母为 31 而不是 32。与 Qwen 逐条编辑距离比较，R2T2 更少 / 相同 / 更多：**9 / 10 / 13**。稳定 append-only 是输出性质，不保证文字正确或首字更快。

出现 6 条明显外语/混合输出，内容不是日语逐字转录（不自动修复或删样本）：

- `12990017395008628751`：「消防隊は最終的に午後11時35分までに火を消しました」→ `sous-boîte est, finalement, à 11h35, pour éteindre le feu`。
- `13903496305700695803`：「植物は光合成によって…」→ `plantes a coopération selon le soleil…`。
- `16539857400725720083`：「手についた水分が…」→ `Handed water on the outside of the layer…`。
- `18334548031286251988`：「衛星はロケットで…」→ `este es el planeta de la est`。
- `2330237947966115273`：「ローマの各所には…」→ `Roma's scripture is for people…`。
- `3563562150682074308`：「衛星はロケットで…」→「A星是火箭在宇宙中送来的，…」。

这是自动模式下已观察到的异常，不把未记录的 SDK language 值直接断言为具体「语言检测根因」。补测只改变显式 Japanese 提示，以检查异常是否仍出现；不能由模型配置列出 Japanese 就保证自动模式适合日语。

本 pilot 有 5 条恰好落在 160ms 解码边界（14.40、12.00、15.36、22.08、18.24 秒），其中 3 条为以上外语输出。边界与外语问题可能同时出现，但**不据此推断边界导致语言变化**；没有剩余样本时 native finish 不发新推理是源码确定的行为，不是本轮所有误差的已证实原因。

原始结果：`.amp/in/artifacts/asr/r2t2-ja-pilot-v1/`。服务源码 SHA256 `085bdedbbe58faa1c159ac02572fac5aaf4d9d00b244e07feb5d184d60b3fd66`；`predictions.jsonl` 为 `1262a3b57f6a7613f264f8040a3f56c7ebd6d8d8d83c1ff5a3bf72355afd97b7`；`summary.json` 为 `1efe4984705a0da6578d3c8d81006627bab2380388451636f4172ab01305610b`。

## 已测 R2T2 强制 Japanese（独立诊断条件）

32/32 完成，0 失败；134 / 1,543，CER **8.684%**。与 auto 条件相比，只增加 `JUSTSAY_R2T2_LANGUAGE=Japanese`，源码、权重、chunk/token 参数、输入和评分均不改。此前 6 条外语/混合输出均恢复为日语；人工检查本条件 32 条预测未发现该类外语句输出，但仍有日语词汇、专名、正字法及尾部错误。

这证明**显式语言条件在此样本集显著影响输出**，而不是已经定位训练/分词器/自动检测的内部根因。它是看过 auto 结果后的诊断试验，不宣称预注册或盲测。也不能从纯日语输入推断 forced Japanese 适合日中英混说。

| 模型 / 实际语言条件 | CER ↓ | 首稳定 p50 / p95 | stop → 最终提交 p50 / p95 | 稳定前缀回退 |
|---|---:|---:|---:|---:|
| Qwen3-ASR-1.7B / auto | 7.453% | 3,325.3 / 7,203.5ms | 136.8 / 217.5ms | 9 次 |
| SenseVoiceSmall / ja | 6.805% | 不适用 | 346.2 / 481.1ms | 不适用 |
| R2T2 / auto | 32.275% | 2,885.4 / 11,317.6ms（n=31） | 97.0 / 307.4ms | 0 次 |
| R2T2 / Japanese | 8.684% | 2,495.0 / 6,702.6ms | 82.4 / 166.1ms | 0 次 |

其余首稳定分位数样本数为 32；最终提交均为 32。R2T2 Japanese 的 stop → session-ended p50 / p95 为 82.5 / 166.3ms；每条最大音频发送滞后为 25.0 / 28.8ms。所有模式均按真实时间发送，未用加速灌音频制造更低的首字延迟。

相对 Qwen：多 19 次编辑（CER 高 **1.231 个百分点**），稳定首字中位数早约 **830ms**，停键后最终提交中位数早约 **54ms**。逐条编辑距离更少 / 相同 / 更多：**8 / 15 / 9**，不能单凭均衡小 pilot 宣称统计显著性或模型全面退化/升级。Qwen 的协议 stableText 来自相邻假设公共前缀，R2T2 来自 native fixed output；两者的「稳定」保证不相同，这正是需要同时报告回退次数和准确率的原因。

建议：

1. 本期日语默认模型不切换；若精度优先，保留现有配置。
2. 若继续 R2T2 的日语低延迟 POC，明确固定 Japanese，再用独立输入检验尾音、专名与 16s 窗口切换；不能把本轮输入用于反复挑参后继续叫客观 benchmark。
3. 自动语言的多语言/混说能力仍是上线阻塞项；不因强制 Japanese 修复了本 pilot 就跳过混说评测。
4. 本轮先不跑耗时数小时的 650 条 × 多条件全集，也未测试 GGUF/Windows 原生/两小时会议。

原始结果：`.amp/in/artifacts/asr/r2t2-ja-forced-pilot-v1/`。`predictions.jsonl` SHA256 `a78cda0adb65e0356e0abe535f7886e8437c38e767bbbbc9b9aafee58750bad0`；`summary.json` SHA256 `dddeaba4d0b2a503d40ae003e25eb52b6ddd4ba62827b3793b7d0c7a597d3555`。四条件逐条并列表保存在 `.amp/in/artifacts/asr/ja-pilot-comparison.json`，不是仅保留汇总分数。

全部实验容器已停止以释放 GPU；镜像、固定权重、输入、结果、服务日志和源码副本保留。尚未提交/推送实验代码；正式两轴代码评审的固定基点已询问用户，待确认后执行并提交。

## 评测工具与仓库检查

- 评测工具 6 个测试通过：归一化/加权 CER、WAV hash/样本数校验、错模型身份拒绝、100ms 实时发送与剩余包、最终文字而非草稿评分、错误保留和连接提前结束、按 block 检查稳定前缀回退。
- R2T2 协议适配层 4 个测试通过：累计稳定文字与尾音完整传递、短录音/abort 隔离、meeting 拒绝、显式 Japanese 条件。
- `pnpm typecheck`、`pnpm check:no-explicit-any` 通过。
- 本地缺少 type-coverage 可执行文件，直接 `pnpm type-coverage` 未能运行；用隔离的 `pnpm --package=typescript@5.9.3 --package=type-coverage@2.29.7 dlx type-coverage --project tsconfig.json --at-least 99.5 --detail --strict` 检查通过：45,530 / 45,735，**99.55%**。未修改 package.json/lockfile，也未重装共享 node_modules。
- `pnpm test`：328 通过、1 失败。失败为未改动的 `src/main/engines/create-recognition-engine.test.ts`：测试用 `profileCatalog[2]` 当 cloud，但当前该项是新增的 local-accurate-lite，故 warmup 成功而非预期抛错。本轮没有改应用或旧测试，不顺便修复。

## 复跑入口

Python 3.12，使用已有 `resources/local-service/.venv` 的 websockets 16.0。评测脚本不依赖模型库。先按 metadata 中的模型 identity、服务源码和运行参数启动对应 sidecar，再用新输出目录（拒绝覆盖旧结果）：

```powershell
resources\local-service\.venv\Scripts\python.exe -B -m unittest discover -s scripts -p test_asr_benchmark.py -v
resources\local-service\.venv\Scripts\python.exe -B scripts\asr_benchmark.py --manifest .amp/in/asr/fleurs-ja-test/pilot-32.jsonl --uri ws://127.0.0.1:18765 --runtime-family qwen3-asr --model Qwen/Qwen3-ASR-1.7B --service-provenance .amp/in/asr/qwen-service.json --output .amp/in/artifacts/asr/qwen-ja-pilot-v2
resources\local-service\.venv\Scripts\python.exe -B scripts\asr_benchmark.py --manifest .amp/in/asr/fleurs-ja-test/pilot-32.jsonl --uri ws://127.0.0.1:18766 --runtime-family sensevoice --model /models/SenseVoiceSmall --service-provenance .amp/in/asr/sensevoice-service.json --output .amp/in/artifacts/asr/sensevoice-ja-pilot-v2
```

本机已保留上述两只停止的实验容器，可用 `docker start justsay-ja-baseline-qwen` / `docker start justsay-ja-baseline-sensevoice` 分别启动；**不要同时启动两只做 GPU 延迟评测**。只读服务目录绑定当前工作树，若后来修改了源码，应从基线版本恢复到独立目录并重新绑定，而不是误以为旧容器保存了基线源码。

R2T2 镜像构建与独立缓存准备（已接受模型许可的当前实验；新操作者需先自行接受许可；FROM 镜像需与上述 baseline image ID 对齐）：

```powershell
docker build -f resources/local-service-r2t2/Dockerfile -t justsay-r2t2-experiment:dev .
docker run --rm --mount type=volume,source=justsay-r2t2-huggingface-cache,target=/root/.cache/huggingface --entrypoint python justsay-qwen-local-vllm:dev -c "from huggingface_hub import snapshot_download; print(snapshot_download('netease-youdao/Confucius4-R2T2', revision='185ce639118ad1362d049ca0d8ed04b6ec5cd6c9', allow_patterns=['*.json','*.safetensors','*.txt','*.model','README.md','MODEL_LICENSE*']))"
```

本机已创建 `justsay-ja-r2t2`（auto，18767）与 `justsay-ja-r2t2-forced`（Japanese，18768）容器；复跑时依次启动，并等待 health 真实 ready，再运行相应命令，输出目录必须新建：

```powershell
resources\local-service\.venv\Scripts\python.exe -B -m unittest discover -s scripts -p test_r2t2_service.py -v
resources\local-service\.venv\Scripts\python.exe -B scripts\asr_benchmark.py --manifest .amp/in/asr/fleurs-ja-test/pilot-32.jsonl --uri ws://127.0.0.1:18767 --runtime-family r2t2 --model netease-youdao/Confucius4-R2T2 --service-provenance .amp/in/asr/r2t2-service.json --output .amp/in/artifacts/asr/r2t2-ja-pilot-v2
resources\local-service\.venv\Scripts\python.exe -B scripts\asr_benchmark.py --manifest .amp/in/asr/fleurs-ja-test/pilot-32.jsonl --uri ws://127.0.0.1:18768 --runtime-family r2t2 --model netease-youdao/Confucius4-R2T2 --service-provenance .amp/in/asr/r2t2-forced-service.json --output .amp/in/artifacts/asr/r2t2-ja-forced-pilot-v2
```

服务和评测源码原样副本已保存在 `.amp/in/artifacts/asr/baseline-source/`；官方 SDK、示例、WS 源码及许可证的固定版本副本保存在 `.amp/in/artifacts/asr/r2t2-upstream-source/`。不保留临时 git clone；模型缓存、输入、原始结果与这些验证证据保留。

本轮数据和原始结果仅在本地 runner；文档入 Git 不等于上传音频/权重/结果。应用层 Electron 采集、UI 展示、翻译、系统文字注入未纳入此测试，不能将其称为整个桌面应用端到端验证。
