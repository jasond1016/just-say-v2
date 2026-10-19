"""Probe a local translation model beside a resident ASR sidecar.

This is an experiment harness. It does not change the product client.
It scores a small FLEURS-aligned sample, so the numbers are not a benchmark.
"""

import argparse
import asyncio
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from asr_benchmark import ensure_runtime_ready, read_pcm, transcribe_pcm


ROOT = Path(__file__).resolve().parents[1]
LANGS = ("ja", "en", "zh")
MANIFESTS = {
    "ja": ROOT / ".amp/in/asr/fleurs-ja-test/manifest.jsonl",
    "en": ROOT / ".amp/in/asr/fleurs-en-test/manifest.jsonl",
    "zh": ROOT / ".amp/in/asr/fleurs-cmn-test/manifest.jsonl",
}
NAMES = {"ja": "日语", "en": "英语", "zh": "中文"}
DIRECTIONS = [("ja", "en"), ("en", "zh"), ("zh", "en"), ("ja", "zh"), ("en", "ja"), ("zh", "ja")]


def load_manifest(path: Path) -> dict[int, dict]:
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            rows[int(row["sentence_id"])] = row
    return rows


def choose_ids(tables: dict[str, dict[int, dict]], count: int) -> list[int]:
    shared = set(tables["ja"]) & set(tables["en"]) & set(tables["zh"])
    ranked = []
    for sentence_id in shared:
        durations = [tables[lang][sentence_id]["duration_s"] for lang in LANGS]
        if min(durations) < 6 or max(durations) > 16:
            continue
        ranked.append((sum(durations) / 3, sentence_id))
    ranked.sort()
    if len(ranked) < count:
        raise ValueError(f"Only {len(ranked)} aligned sentences in the 6-16s band")
    step = max(1, len(ranked) // count)
    return [sentence_id for _, sentence_id in ranked[::step][:count]]


def chrf(hypothesis: str, reference: str) -> float:
    """Character chrF with beta=2, orders 1..6. Not sacrebleu chrF++."""
    hypothesis = hypothesis.strip()
    reference = reference.strip()
    if not hypothesis or not reference:
        return 0.0
    precisions = []
    recalls = []
    for order in range(1, 7):
        hyp = [hypothesis[i:i + order] for i in range(max(0, len(hypothesis) - order + 1))]
        ref = [reference[i:i + order] for i in range(max(0, len(reference) - order + 1))]
        if not hyp or not ref:
            precisions.append(0.0)
            recalls.append(0.0)
            continue
        from collections import Counter
        hyp_counts = Counter(hyp)
        ref_counts = Counter(ref)
        overlap = sum(min(count, ref_counts[gram]) for gram, count in hyp_counts.items())
        precisions.append(overlap / len(hyp))
        recalls.append(overlap / len(ref))
    precision = sum(precisions) / len(precisions)
    recall = sum(recalls) / len(recalls)
    if precision + recall == 0:
        return 0.0
    beta = 2
    return (1 + beta ** 2) * precision * recall / (beta ** 2 * precision + recall)


def gpu_snapshot() -> dict:
    query = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu",
         "--format=csv,noheader,nounits"],
        text=True,
    ).strip().splitlines()[0].split(",")
    apps = subprocess.check_output(
        ["nvidia-smi", "--query-compute-apps=pid,process_name,used_gpu_memory",
         "--format=csv,noheader"],
        text=True,
    ).strip()
    return {
        "memory_used_mib": int(query[0].strip()),
        "memory_total_mib": int(query[1].strip()),
        "utilization_gpu_pct": int(query[2].strip()),
        "compute_apps": [line for line in apps.splitlines() if line.strip()],
    }


def post_json(url: str, payload: dict, timeout: float) -> tuple[int, dict, float]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json", "Authorization": "Bearer local"},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
            return response.status, body, (time.perf_counter() - started) * 1000
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return exc.code, {"error": detail}, (time.perf_counter() - started) * 1000


def completion_text(payload: dict) -> str:
    content = payload.get("choices", [{}])[0].get("message", {}).get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict)).strip()
    return ""


def index_messages(source: str, target: str, text: str) -> list[dict]:
    return [{
        "role": "user",
        "content": (
            f"请将以下{NAMES[source]}文本翻译为{NAMES[target]}，直接输出翻译结果，不要进行任何解释。\n\n{text}"
        ),
    }]


def hymt_messages(_source: str, target: str, text: str) -> list[dict]:
    return [{
        "role": "user",
        "content": (
            f"将以下文本翻译为{NAMES[target]}，注意只需要输出翻译后的结果，不要额外解释：\n\n{text}"
        ),
    }]


def app_messages(source: str, target: str, text: str) -> list[dict]:
    return [
        {
            "role": "system",
            "content": (
                "You are a translation engine. Translate the user text faithfully. "
                "Return only the translated text without explanations or quotes."
            ),
        },
        {
            "role": "user",
            "content": f"Source language: {source}\nTarget language: {target}\nText:\n{text}",
        },
    ]


def translate(base_url: str, model: str, messages: list[dict], *, sampling: str, timeout: float) -> dict:
    payload = {"model": model, "messages": messages}
    if sampling == "app":
        payload["temperature"] = 0
    elif sampling == "index":
        payload["temperature"] = 0
        payload["max_tokens"] = 256
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    elif sampling == "hymt":
        payload["temperature"] = 0.7
        payload["top_p"] = 0.6
        payload["top_k"] = 20
        payload["repeat_penalty"] = 1.05
        payload["max_tokens"] = 256
    else:
        raise ValueError(f"Unknown sampling mode: {sampling}")
    status, body, elapsed = post_json(f"{base_url}/chat/completions", payload, timeout)
    text = completion_text(body) if status == 200 else ""
    return {
        "http_status": status,
        "latency_ms": round(elapsed, 1),
        "within_10s": elapsed < 10_000 and status == 200 and bool(text),
        "empty": status != 200 or not text,
        "has_think_tag": "</think>" in text or text.startswith("<think>"),
        "text": text,
        "error": body.get("error") if status != 200 else None,
    }


def mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def summarize(rows: list[dict], key: str) -> dict:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row[key], []).append(row)
    summary = {}
    for name, items in grouped.items():
        scored = [item for item in items if not item["empty"]]
        summary[name] = {
            "n": len(items),
            "empty": sum(item["empty"] for item in items),
            "think_tags": sum(item["has_think_tag"] for item in items),
            "over_10s": sum(not item["within_10s"] for item in items),
            "chrf": mean([item["chrf"] for item in scored]),
            "latency_ms_mean": mean([item["latency_ms"] for item in items]),
            "latency_ms_max": max((item["latency_ms"] for item in items), default=None),
        }
    return summary


async def run(args) -> None:
    tables = {lang: load_manifest(path) for lang, path in MANIFESTS.items()}
    sentence_ids = choose_ids(tables, args.sentences)
    output = args.output
    output.mkdir(parents=True, exist_ok=False)
    snapshots = {"before_probe": gpu_snapshot()}

    health = await ensure_runtime_ready(args.asr_uri, args.asr_family, args.asr_model)
    snapshots["asr_ready"] = gpu_snapshot()
    with urllib.request.urlopen(f"{args.base_url}/models", timeout=10) as response:
        models = json.loads(response.read().decode("utf-8"))
    model = models["data"][0]["id"]
    snapshots["both_resident"] = gpu_snapshot()

    reference_rows = []
    for sentence_id in sentence_ids:
        for source, target in DIRECTIONS:
            text = tables[source][sentence_id]["raw_reference"]
            reference = tables[target][sentence_id]["raw_reference"]
            official = index_messages if args.official_sampling == "index" else hymt_messages
            for prompt_name, messages, sampling in (
                ("official", official(source, target, text), args.official_sampling),
                ("app", app_messages(source, target, text), "app"),
            ):
                result = translate(args.base_url, model, messages, sampling=sampling, timeout=args.timeout)
                reference_rows.append({
                    "sentence_id": sentence_id,
                    "source": source,
                    "target": target,
                    "prompt": prompt_name,
                    "input": text,
                    "reference": reference,
                    "chrf": round(chrf(result["text"], reference), 4),
                    **result,
                })
    (output / "reference-translations.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in reference_rows) + "\n",
        encoding="utf-8",
    )

    asr_ids = sentence_ids[:args.asr_sentences]
    asr_rows = []
    overlap = {"samples": [], "translations": []}

    async def sample_gpu():
        while True:
            overlap["samples"].append({"t": time.time(), **gpu_snapshot()})
            await asyncio.sleep(0.5)

    sampler = asyncio.create_task(sample_gpu())
    try:
        for sentence_id in asr_ids:
            for lang in LANGS:
                record = tables[lang][sentence_id]
                pcm = read_pcm(MANIFESTS[lang].parent, record)
                asr = await transcribe_pcm(args.asr_uri, pcm, language=lang)
                asr.pop("events", None)
                hypothesis = asr.get("text", "")
                target = "en" if lang != "en" else "zh"
                official = index_messages if args.official_sampling == "index" else hymt_messages
                translated = translate(
                    args.base_url, model, official(lang, target, hypothesis),
                    sampling=args.official_sampling, timeout=args.timeout,
                ) if hypothesis else {"empty": True, "text": "", "latency_ms": 0, "within_10s": False,
                                       "has_think_tag": False, "http_status": None, "error": "empty asr"}
                overlap["translations"].append({
                    "sentence_id": sentence_id, "source": lang, "target": target, **translated,
                })
                asr_rows.append({
                    "sentence_id": sentence_id,
                    "source": lang,
                    "target": target,
                    "asr_status": asr.get("status"),
                    "asr_text": hypothesis,
                    "asr_reference": record["raw_reference"],
                    "asr_chrf": round(chrf(hypothesis, record["raw_reference"]), 4),
                    "asr_rms": round(pcm_rms(pcm), 6),
                    "asr_error": asr.get("error"),
                    "stop_to_final_ms": asr.get("stop_to_final_ms"),
                    "translation": translated["text"],
                    "translation_reference": tables[target][sentence_id]["raw_reference"],
                    "translation_chrf": round(chrf(translated["text"], tables[target][sentence_id]["raw_reference"]), 4),
                    "translation_latency_ms": translated["latency_ms"],
                    "translation_empty": translated["empty"],
                    "translation_think_tag": translated.get("has_think_tag", False),
                })
    finally:
        sampler.cancel()
        await asyncio.gather(sampler, return_exceptions=True)
    snapshots["after_overlap"] = gpu_snapshot()

    if overlap["samples"]:
        used = [sample["memory_used_mib"] for sample in overlap["samples"]]
        util = [sample["utilization_gpu_pct"] for sample in overlap["samples"]]
        overlap_summary = {
            "samples": len(overlap["samples"]),
            "memory_used_mib_min": min(used),
            "memory_used_mib_max": max(used),
            "utilization_gpu_pct_max": max(util),
        }
    else:
        overlap_summary = {}

    summary = {
        "model": model,
        "official_sampling": args.official_sampling,
        "asr_family": args.asr_family,
        "asr_model": args.asr_model,
        "sentence_ids": sentence_ids,
        "asr_sentence_ids": asr_ids,
        "health": {key: health.get(key) for key in ("ok", "readiness", "modelIdentifier", "runtimeFamilyId")},
        "gpu": snapshots,
        "overlap": overlap_summary,
        "reference_by_prompt": summarize(reference_rows, "prompt"),
        "asr_chrf": mean([row["asr_chrf"] for row in asr_rows if row["asr_text"]]),
        "asr_translation_chrf": mean([row["translation_chrf"] for row in asr_rows if row["asr_text"]]),
        "asr_failures": sum(row["asr_status"] != "ok" or not row["asr_text"] for row in asr_rows),
    }
    # Direction key needs both languages.
    by_direction: dict[str, list[dict]] = {}
    for row in reference_rows:
        if row["prompt"] == "official":
            by_direction.setdefault(f"{row['source']}->{row['target']}", []).append(row)
    summary["reference_official_by_direction"] = {
        name: {
            "n": len(items),
            "empty": sum(item["empty"] for item in items),
            "chrf": mean([item["chrf"] for item in items if not item["empty"]]),
            "latency_ms_mean": mean([item["latency_ms"] for item in items]),
        }
        for name, items in by_direction.items()
    }
    (output / "asr-then-translate.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in asr_rows) + "\n",
        encoding="utf-8",
    )
    (output / "gpu-overlap.json").write_text(
        json.dumps(overlap, ensure_ascii=False), encoding="utf-8",
    )
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def pcm_rms(pcm: bytes) -> float:
    if len(pcm) < 2:
        return 0.0
    total = 0
    count = len(pcm) // 2
    for offset in range(0, count * 2, 2):
        sample = int.from_bytes(pcm[offset:offset + 2], "little", signed=True)
        total += sample * sample
    return (total / count) ** 0.5 / 32768


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8088/v1")
    parser.add_argument("--asr-uri", default="ws://127.0.0.1:18766")
    parser.add_argument("--asr-family", default="sensevoice")
    parser.add_argument("--asr-model", default="/models/SenseVoiceSmall")
    parser.add_argument("--official-sampling", choices=("index", "hymt"), default="index")
    parser.add_argument("--sentences", type=int, default=8)
    parser.add_argument("--asr-sentences", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--output", type=Path, required=True)
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
