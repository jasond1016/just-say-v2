# 2026-10-19 SenseVoice 同时跑两套翻译

实验分支：`experiment/index-translate-2b`。机器：RTX 4060 Ti，16380 MiB。识别换成现有 SenseVoiceSmall sidecar（镜像 `justsay-sensevoice-baseline:dev`，CUDA，按键模式，语言按 `ja` / `en` / `zh` 传入，开启 ITN，并去掉事件表情）。翻译仍是 llama.cpp `b11721` 的 `llama-server`，上下文 4096，`--reasoning off`，Flash Attention 开。两套权重都是 Q4_K_M：Index-Translate-2B（1,312,164,352 字节）和 Hy-MT2-1.8B（1,133,080,448 字节，与官方 GGUF 清单一致）。句子和 chrF 算法与 [上一轮 Qwen 识别对照](2026-10-19-index-translate-probe.md) 相同。产品代码没有改。

这是 8 句对齐样本，不是基准。分数不能和模型卡上的 COMET 比较。

## 结论

**SenseVoice 旁边放哪一套 Q4 翻译，这张卡都还很空。** 桌面大约 3.6 GiB 时，识别加翻译的峰值大约 6.3 GiB，还剩大约 10 GiB。识别实际大约 1.1 GiB，两套翻译各大约 1.5 GiB。上一轮 Qwen3-ASR-1.7B 加 Index 的峰值是 12849 MiB。

译文请求都在 0.5 秒以内，96 次里没有空结果，也没有思考标签。Index 的参考译文和上一轮逐项相同：官方提示 chrF 0.415，当前客户端提示 0.403。Hy-MT2 的官方中文提示接近 Index（0.406）。当前客户端提示在 Hy-MT2 上掉到 0.287，掉分集中在译入日语：`Target language: ja` 被译成了冰岛语一带的文字。把同一句的目标改成英文全名 `Japanese` 后，冒烟结果回到日语。

SenseVoice 把上一轮被 0.01 响度门丢掉的轻声片段也提交了。12 段都有文本，识别 chrF 均值 0.820。轻声专名仍会听错，错字会进译文。

## 资源

采样是 Windows `nvidia-smi` 的整卡 `memory.used`。进程级显存仍是 `[N/A]`，拆分来自整卡差值。

| 时刻 | 已用 MiB |
|---|---:|
| 两个模型都没加载 | 3583 |
| 只有 SenseVoice | 4664 |
| SenseVoice 加 Index-Translate-2B | 6181 |
| Index 重叠回放的 175 次采样 | 6186–6290 |
| 停掉 Index，SenseVoice 还在 | 4737 |
| SenseVoice 加 Hy-MT2-1.8B | 6251 |
| Hy-MT2 重叠回放的 174 次采样 | 6178–6219 |
| 两套都停掉 | 3533 |

由此估出：SenseVoice 约 1081 MiB（4664 − 3583），Index 约 1517 MiB（6181 − 4664），Hy-MT2 约 1514 MiB（6251 − 4737）。两轮重叠时 GPU 利用率都到过 100%，显存只比空闲多几十 MiB。没有 OOM。

Hy-MT2 加载时有一条分词警告：`special_eos_id is not in special_eog_ids`。这轮请求都以 `finish_reason: stop` 结束。两套模型的 GGUF 上下文都写成 262144，服务都限制在 4096。按满上下文分配 KV，1.5 GiB 这个占用不再成立。

## 参考译文

8 个 `sentence_id`（1731、1821、1931、1758、1818、1965、1694、1695）与上一轮相同。Index 的官方提示仍是一条中文用户消息，temperature 0，`max_tokens` 256，`enable_thinking: false`。Hy-MT2 的官方提示是模型卡上的默认句式「将以下文本翻译为{目标语言}，注意只需要输出翻译后的结果，不要额外解释」，采样用模型卡推荐的 temperature 0.7、top_p 0.6、top_k 20、repeat_penalty 1.05，`max_tokens` 256。当前客户端提示两边相同：英文 system，用户消息是 `Source language` / `Target language` / `Text`，temperature 0，不带其他采样字段。

| 模型 | 提示 | 条数 | 空结果 | 超过 10 秒 | chrF | 延迟均值 / 最大 |
|---|---|---:|---:|---:|---:|---:|
| Index | 官方 | 48 | 0 | 0 | 0.415 | 231 / 353 ms |
| Index | 当前客户端 | 48 | 0 | 0 | 0.403 | 238 / 378 ms |
| Hy-MT2 | 官方 | 48 | 0 | 0 | 0.406 | 222 / 484 ms |
| Hy-MT2 | 当前客户端 | 48 | 0 | 0 | 0.287 | 213 / 449 ms |

Index 的六个方向和上一轮相同：日→英 0.584，中→英 0.593，英→日 0.474，英→中 0.338，中→日 0.279，日→中 0.223。

Hy-MT2 官方提示按方向：

| 方向 | chrF | 延迟均值 |
|---|---:|---:|
| 日→英 | 0.602 | 229 ms |
| 中→英 | 0.587 | 192 ms |
| 英→日 | 0.410 | 276 ms |
| 中→日 | 0.354 | 296 ms |
| 英→中 | 0.284 | 174 ms |
| 日→中 | 0.202 | 165 ms |

译入英语两边接近。日译中仍然是同义改写把 chrF 压低，Hy-MT2 还会换词：同一句「群島や湖では、必ずしもヨットは必要ありません。」官方输出是「在岛屿和湖泊上，并不一定需要帆船。」对照是「在群岛和湖泊之中，游艇并不是必需的。」游艇被写成了帆船。

当前客户端提示在 Hy-MT2 上按方向：日→英 0.575，中→英 0.600，英→中 0.310，日→中 0.224，英→日 0.006，中→日 0.006。16 条译入日语全部离开了日语，落到冰岛语或邻近北欧语，例如英译日得到 “Í eyjafjöllum og vötnum þar þarftu ekki endast jók.” 同一句把 `ja` 改成 `Japanese` 后，冒烟输出是「群島や湖では、必ずしもヨットが必要ではありません。」Index 用同一个 `ja` 代码仍输出日语。

## 识别之后再翻译

4 句 × 3 种语言。12 段全部提交了文本，包括整段 RMS 低于 0.01 的 7 段。上一轮 Qwen sidecar 把这 7 段当成静音丢掉了。SenseVoice 的提交后延迟均值 463 ms，最慢 1454 ms；这段时间主要花在松开按键后对整段音频做一次识别。

识别 chrF：日语 0.754，英语 0.886，中文 0.820，12 段均值 0.820。轻声片段能出字，专名仍不稳。日语「群島」被听成「軍島」，Index 就译成 “military islands”。英语 “archipelagos” 被听成 “archip Paagoos”，“King George Island” 被听成 “wasine George Island”。

有识别文本之后再翻译，chrF 均值 Index 0.529，Hy-MT2 官方提示 0.476。听对的句子仍然干净：日语「脳病理と行動の相関関係は、科学者たちの研究を裏付けるものです。」被逐字识别，Index 译成 “The correlation between brain pathology and behavior supports the research of scientists.” 提交后的翻译延迟大约 140–320 ms。

## 接入

这轮之后，设置里的默认翻译服务是 Index-Translate-2B。部署可以选本机托管，或填另一台机器的地址和端口。本机托管会启动 `llama-server`（上下文 4096，`--reasoning off`）。请求仍走现有的英文提示。已经保存的 OpenAI 兼容地址和模型不会被改写。

## 样本限制

- 8 句不能代表会议、混说或专名。chrF 对照的是另一种语言的 FLEURS 平行句。
- Hy-MT2 接上当前客户端时，目标语言代码 `ja` 会偏题。官方全名提示没有这个问题。这次只额外冒烟了一句 `Japanese`，没有把 48 条客户端提示改成全名再跑一遍。
- 上下文必须继续限制。两套 GGUF 都标着 262144。
- Index 这轮能接上当前英文提示，仍然是因为 `llama-server` 用 `--reasoning off` 启动。
