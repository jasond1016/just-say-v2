"""Rescore frozen predictions without running a model."""

import argparse
import json
from pathlib import Path

from asr_benchmark import score_numeral_transcripts, score_transcripts, score_word_errors


def rescore(path: Path, *, words: bool) -> dict:
    records = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]
    completed = [record for record in records if record.get('status') == 'ok' and record.get('text') is not None]
    if len(completed) != len(records):
        raise ValueError(f'{path} has {len(records) - len(completed)} incomplete predictions')
    summary = {
        'count': len(completed),
        'character': score_transcripts(completed),
        'cjk_numeral_character': score_numeral_transcripts(completed),
        'numeral_fold_changed': [
            record['id'] for record in completed
            if score_transcripts([record])['edit_distance'] != score_numeral_transcripts([record])['edit_distance']
        ],
    }
    if words:
        summary['word'] = score_word_errors(completed)
        summary['word_numeral'] = score_word_errors(completed, fold_numbers=True)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('predictions', type=Path, nargs='+')
    parser.add_argument('--words', action='store_true')
    args = parser.parse_args()
    for path in args.predictions:
        summary = rescore(path, words=args.words)
        output = path.with_name('rescore.json')
        output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(path.parent.name, json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
