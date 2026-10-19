"""Replay frozen PCM16 manifests against the JustSay sidecar and score Japanese CER."""

import argparse
import asyncio
import base64
import hashlib
import json
import math
import subprocess
import time
import unicodedata
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

from websockets.asyncio.client import connect


NORMALIZATION = 'ja-nfkc-casefold-no-punctuation-or-whitespace-v1'


def normalize_text(text: str) -> str:
    return ''.join(
        char for char in unicodedata.normalize('NFKC', text).casefold()
        if not char.isspace() and not unicodedata.category(char).startswith('P')
    )


def edit_distance(reference: str, hypothesis: str) -> int:
    previous = list(range(len(hypothesis) + 1))
    for index, left in enumerate(reference, 1):
        current = [index]
        for column, right in enumerate(hypothesis, 1):
            current.append(min(
                current[-1] + 1,
                previous[column] + 1,
                previous[column - 1] + (left != right),
            ))
        previous = current
    return previous[-1]


def score_transcripts(records: list[dict]) -> dict:
    errors = characters = 0
    for record in records:
        reference = normalize_text(record['reference'])
        hypothesis = normalize_text(record['text'])
        errors += edit_distance(reference, hypothesis)
        characters += len(reference)
    if characters == 0:
        raise ValueError('No reference characters to score')
    return {'edit_distance': errors, 'reference_characters': characters,
            'cer': errors / characters, 'normalization': NORMALIZATION}


CJK_DIGITS = {
    '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
}
CJK_SMALL_UNITS = {'十': 10, '百': 100, '千': 1000}
CJK_LARGE_UNITS = {'万': 10_000, '億': 100_000_000, '亿': 100_000_000}
CJK_NUMBER_CHARS = set(CJK_DIGITS) | set(CJK_SMALL_UNITS) | set(CJK_LARGE_UNITS)
NUMERAL_CER_NORMALIZATION = 'cjk-numeral-nfkc-cer-v1'
WER_NORMALIZATION = 'en-wer-nfkc-casefold-hyphen-split-v1'
NUMERAL_WER_NORMALIZATION = 'en-wer-numeral-v1'
ENGLISH_NUMBER_WORDS = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11,
    'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16,
    'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30,
    'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
}
ENGLISH_SCALES = {'hundred': 100, 'thousand': 1000, 'million': 1_000_000, 'billion': 1_000_000_000}
ENGLISH_DECADES = {
    'twenties': '20s', 'thirties': '30s', 'forties': '40s', 'fifties': '50s',
    'sixties': '60s', 'seventies': '70s', 'eighties': '80s', 'nineties': '90s',
}


def _parse_cjk_small(text: str) -> int | None:
    total = 0
    current = 0
    seen = False
    index = 0
    while index < len(text):
        character = text[index]
        if character.isdigit():
            end = index + 1
            while end < len(text) and text[end].isdigit():
                end += 1
            current = int(text[index:end])
            seen = True
            index = end
            continue
        if character in CJK_DIGITS:
            current = CJK_DIGITS[character]
            seen = True
            index += 1
            continue
        if character in CJK_SMALL_UNITS:
            total += (current or 1) * CJK_SMALL_UNITS[character]
            current = 0
            seen = True
            index += 1
            continue
        return None
    return total + current if seen else None


def _parse_cjk_number(text: str) -> int | None:
    if text.isdigit():
        return int(text)
    if all(character in CJK_DIGITS for character in text):
        return int(''.join(str(CJK_DIGITS[character]) for character in text))
    total = 0
    rest = text
    for character, scale in CJK_LARGE_UNITS.items():
        if character not in rest:
            continue
        left, rest = rest.split(character, 1)
        part = _parse_cjk_small(left) if left else 1
        if part is None:
            return None
        total += part * scale
    if rest:
        part = _parse_cjk_small(rest)
        if part is None:
            return None
        total += part
    return total


def fold_cjk_numerals(text: str) -> str:
    """Rewrite kanji and mixed numerals to decimal digits. Lexical text stays put."""
    characters = list(unicodedata.normalize('NFKC', text))
    folded = []
    index = 0
    while index < len(characters):
        if characters[index].isdigit() or characters[index] in CJK_NUMBER_CHARS:
            end = index
            has_kanji = False
            while end < len(characters) and (
                characters[end].isdigit() or characters[end] in CJK_NUMBER_CHARS
            ):
                has_kanji = has_kanji or characters[end] in CJK_NUMBER_CHARS
                end += 1
            span = ''.join(characters[index:end])
            value = _parse_cjk_number(span) if has_kanji else None
            folded.append(str(value) if value is not None else span)
            index = end
            continue
        folded.append(characters[index])
        index += 1
    return ''.join(folded)


def normalize_numeral_text(text: str) -> str:
    return normalize_text(fold_cjk_numerals(text))


def score_numeral_transcripts(records: list[dict]) -> dict:
    errors = characters = 0
    for record in records:
        reference = normalize_numeral_text(record['reference'])
        hypothesis = normalize_numeral_text(record['text'])
        errors += edit_distance(reference, hypothesis)
        characters += len(reference)
    if characters == 0:
        raise ValueError('No reference characters to score')
    return {'edit_distance': errors, 'reference_characters': characters,
            'cer': errors / characters, 'normalization': NUMERAL_CER_NORMALIZATION}


def english_words(text: str) -> list[str]:
    characters = []
    for character in unicodedata.normalize('NFKC', text).casefold():
        if character.isspace() or character in {'-', '‐', '‑', '‒', '–', '—'}:
            characters.append(' ')
        elif unicodedata.category(character).startswith(('P', 'S')):
            continue
        else:
            characters.append(character)
    return [word for word in ''.join(characters).split(' ') if word]


def _take_english_number(tokens: list[str], index: int) -> tuple[int | None, int]:
    total = 0
    current: int | None = None
    consumed = 0
    while index + consumed < len(tokens):
        token = tokens[index + consumed]
        if token in ENGLISH_NUMBER_WORDS:
            value = ENGLISH_NUMBER_WORDS[token]
            if current is None:
                current = value
            elif value < 10 and current >= 20 and current % 10 == 0:
                current += value
            else:
                break
            consumed += 1
            continue
        if token in ENGLISH_SCALES:
            total += (1 if current is None else current) * ENGLISH_SCALES[token]
            current = None
            consumed += 1
            continue
        break
    if consumed == 0:
        return None, 0
    return total + (current or 0), consumed


def fold_english_number_words(tokens: list[str]) -> list[str]:
    folded = []
    index = 0
    while index < len(tokens):
        decade = ENGLISH_DECADES.get(tokens[index])
        if decade is not None:
            folded.append(decade)
            index += 1
            continue
        value, consumed = _take_english_number(tokens, index)
        if consumed:
            folded.append(str(value))
            index += consumed
            continue
        folded.append(tokens[index])
        index += 1
    return folded


def score_word_errors(records: list[dict], *, fold_numbers: bool = False) -> dict:
    errors = words = 0
    for record in records:
        reference = english_words(record['reference'])
        hypothesis = english_words(record['text'])
        if fold_numbers:
            reference = fold_english_number_words(reference)
            hypothesis = fold_english_number_words(hypothesis)
        errors += edit_distance(reference, hypothesis)
        words += len(reference)
    if words == 0:
        raise ValueError('No reference words to score')
    return {
        'word_errors': errors,
        'reference_words': words,
        'wer': errors / words,
        'normalization': NUMERAL_WER_NORMALIZATION if fold_numbers else WER_NORMALIZATION,
    }


async def transcribe_pcm(uri: str, pcm: bytes, *, language: str = 'ja', timeout: float = 120) -> dict:
    if not pcm or len(pcm) % 2:
        raise ValueError('Expected nonempty mono PCM16')
    session = 'benchmark-' + uuid.uuid4().hex
    result = {'status': 'error', 'text': '', 'events': [], 'first_draft_ms': None,
              'first_stable_ms': None, 'stop_to_final_ms': None,
              'stop_to_end_ms': None, 'stable_retractions': 0, 'max_send_lag_ms': 0.0}
    blocks = {}
    stable_by_block = {}
    receiver = None
    started = time.perf_counter()
    stop_at = final_at = None

    def record(message):
        elapsed = (time.perf_counter() - started) * 1000
        result['events'].append({'elapsed_ms': elapsed, 'message': message})
        if message['type'] == 'error':
            raise RuntimeError(json.dumps(message['payload'], ensure_ascii=False))
        return elapsed

    try:
        async with connect(uri, open_timeout=timeout, max_size=4 * 1024 * 1024) as socket:
            await socket.send(json.dumps({'type': 'start-session', 'sessionId': session,
                                         'mode': 'ptt', 'language': language, 'translationEnabled': False}))
            ready = json.loads(await asyncio.wait_for(socket.recv(), timeout))
            record(ready)
            if ready['type'] != 'session-ready' or ready.get('sessionId') != session:
                raise RuntimeError('Sidecar did not acknowledge this session')
            started = time.perf_counter()

            async def receive():
                nonlocal final_at
                async for raw in socket:
                    message = json.loads(raw)
                    elapsed = record(message)
                    if message.get('sessionId') != session:
                        continue
                    if message['type'] == 'draft-updated':
                        payload = message['payload']
                        stable = payload['stableText']
                        if stable or payload['previewText']:
                            if result['first_draft_ms'] is None:
                                result['first_draft_ms'] = elapsed
                        if stable and result['first_stable_ms'] is None:
                            result['first_stable_ms'] = elapsed
                        block = payload.get('blockId', '')
                        previous = stable_by_block.get(block, '')
                        if previous and not stable.startswith(previous):
                            result['stable_retractions'] += 1
                        stable_by_block[block] = stable
                    elif message['type'] == 'block-committed':
                        block = message['payload']['block']
                        blocks[block['id']] = block['text']
                        final_at = time.perf_counter()
                    elif message['type'] == 'session-ended':
                        return
                raise RuntimeError('Connection closed without session-ended')

            receiver = asyncio.create_task(receive())
            wall_start = int(time.time() * 1000)
            for offset in range(0, len(pcm), 3200):
                chunk = pcm[offset:offset + 3200]
                deadline = started + (offset + len(chunk)) / 32000
                await asyncio.sleep(max(0, deadline - time.perf_counter()))
                if receiver.done():
                    await receiver
                    raise RuntimeError('Session ended before all audio was sent')
                await socket.send(json.dumps({'type': 'audio-chunk', 'sessionId': session, 'chunk': {
                    'source': 'microphone', 'sampleRate': 16000, 'channels': 1,
                    'timestamp': wall_start + offset // 32,
                    'dataBase64': base64.b64encode(chunk).decode('ascii'),
                }}))
                result['max_send_lag_ms'] = max(result['max_send_lag_ms'],
                                                (time.perf_counter() - deadline) * 1000)
            stop_at = time.perf_counter()
            await socket.send(json.dumps({'type': 'stop-session', 'sessionId': session}))
            await asyncio.wait_for(receiver, timeout)
            result['stop_to_end_ms'] = (time.perf_counter() - stop_at) * 1000
            if final_at is not None:
                result['stop_to_final_ms'] = (final_at - stop_at) * 1000
            result['status'] = 'ok'
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
    finally:
        if receiver is not None:
            receiver.cancel()
            await asyncio.gather(receiver, return_exceptions=True)
    result['text'] = '\n'.join(blocks.values())
    result['replay_wall_s'] = time.perf_counter() - started
    return result


async def ensure_runtime_ready(uri: str, runtime_family: str, model: str, *, language: str = 'ja') -> dict:
    async with connect(uri, open_timeout=10) as socket:
        async def health():
            await socket.send(json.dumps({'type': 'health-check'}))
            response = json.loads(await asyncio.wait_for(socket.recv(), 15))
            if (response.get('type'), response.get('runtimeFamilyId'), response.get('modelIdentifier')) != (
                'health-status', runtime_family, model,
            ):
                raise RuntimeError(f'Unexpected runtime identity: {response}')
            return response

        response = await health()
        if response.get('readiness') != 'ready':
            await socket.send(json.dumps({'type': 'prewarm', 'mode': 'ptt', 'language': language}))
            await asyncio.wait_for(socket.recv(), 900)
            response = await health()
        if not response.get('ok') or response.get('readiness') != 'ready':
            raise RuntimeError(f'Runtime not ready: {response}')
        return response


def read_pcm(root: Path, record: dict) -> bytes:
    path = root / record['audio']
    with path.open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != record['sha256']:
            raise ValueError(f'Audio hash changed: {record["id"]}')
    with wave.open(str(path), 'rb') as wav:
        if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth(), wav.getnframes()) != (
            16000, 1, 2, record['num_samples'],
        ):
            raise ValueError(f'Audio format changed: {record["id"]}')
        return wav.readframes(wav.getnframes())


async def run_benchmark(args) -> int:
    manifest = args.manifest.resolve()
    records = [json.loads(line) for line in manifest.read_text(encoding='utf-8').splitlines()]
    if not records or len({record['id'] for record in records}) != len(records):
        raise ValueError('Manifest must contain unique nonempty recordings')
    health = await ensure_runtime_ready(args.uri, args.runtime_family, args.model, language=args.language)
    args.output.mkdir(parents=True, exist_ok=False)
    metadata = {
        'created_at': datetime.now(timezone.utc).isoformat(),
        'git_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'benchmark_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'manifest_sha256': hashlib.sha256(manifest.read_bytes()).hexdigest(),
        'dataset': json.loads((manifest.parent / 'provenance.json').read_text(encoding='utf-8')),
        'service': json.loads(args.service_provenance.read_text(encoding='utf-8')),
        'health': health, 'uri': args.uri, 'mode': 'ptt', 'language_requested': args.language,
        'sample_rate': 16000, 'chunk_ms': 100, 'realtime_pacing': True,
        'warmup_id': records[0]['id'], 'normalization': NORMALIZATION,
        'latency_origin': 'session-ready, before collecting first 100ms audio packet',
        'percentiles': 'nearest rank; only completed recordings with an observed event',
    }
    (args.output / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    warmup = await transcribe_pcm(args.uri, read_pcm(manifest.parent, records[0]), language=args.language)
    (args.output / 'warmup.json').write_text(json.dumps(warmup, ensure_ascii=False), encoding='utf-8')
    if warmup['status'] != 'ok':
        raise RuntimeError(f'Unscored warmup failed: {warmup.get("error")}')
    results = []
    with (args.output / 'predictions.jsonl').open('x', encoding='utf-8', newline='\n') as output:
        for index, record in enumerate(records, 1):
            result = {**record, **await transcribe_pcm(args.uri, read_pcm(manifest.parent, record), language=args.language)}
            result['score'] = score_transcripts([result])
            results.append(result)
            output.write(json.dumps(result, ensure_ascii=False) + '\n')
            output.flush()
            print(f'{index}/{len(records)} {record["id"]} {result["status"]} CER={result["score"]["cer"]:.3%}', flush=True)
    summary = score_transcripts(results)
    failed = sum(result['status'] != 'ok' for result in results)
    summary.update({'count': len(results), 'failed': failed,
                    'audio_duration_s': sum(record['num_samples'] / 16000 for record in records),
                    'stable_retractions': sum(result['stable_retractions'] for result in results)})
    if failed:
        summary['observed_cer_including_failed_attempts'] = summary['cer']
        summary['cer'] = None
    for metric in ['first_draft_ms', 'first_stable_ms', 'stop_to_final_ms', 'stop_to_end_ms', 'max_send_lag_ms']:
        values = sorted(result[metric] for result in results if result['status'] == 'ok' and result[metric] is not None)
        summary[metric] = {'count': len(values), 'p50': values[math.ceil(len(values) * 0.5) - 1] if values else None,
                           'p95': values[math.ceil(len(values) * 0.95) - 1] if values else None}
    (args.output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--uri', required=True)
    parser.add_argument('--runtime-family', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--service-provenance', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--language', default='ja')
    return asyncio.run(run_benchmark(parser.parse_args()))


if __name__ == '__main__':
    raise SystemExit(main())
