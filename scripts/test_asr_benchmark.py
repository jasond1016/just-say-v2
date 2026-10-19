import asyncio
import base64
import hashlib
import json
import tempfile
import time
import unittest
import wave
from pathlib import Path

from websockets.asyncio.server import serve

from asr_benchmark import ensure_runtime_ready, read_pcm, score_transcripts, transcribe_pcm


class JapaneseScoringTests(unittest.TestCase):
    def test_normalizes_both_texts_and_weights_by_reference_characters(self):
        result = score_transcripts([
            {'reference': '日本語。', 'text': '日本'},
            {'reference': 'Ａ！', 'text': 'b'},
        ])
        self.assertEqual(result['edit_distance'], 2)
        self.assertEqual(result['reference_characters'], 4)
        self.assertEqual(result['cer'], 0.5)

    def test_cjk_numeral_fold_equates_decimal_and_kanji_forms(self):
        from asr_benchmark import normalize_numeral_text, score_numeral_transcripts

        self.assertEqual(normalize_numeral_text('1966年と一つ'), normalize_numeral_text('一九六六年と一つ'))
        self.assertEqual(normalize_numeral_text('400只和3万只'), normalize_numeral_text('四百只和三万只'))
        self.assertEqual(normalize_numeral_text('第2セット'), normalize_numeral_text('第二セット'))
        self.assertEqual(normalize_numeral_text('十九人'), normalize_numeral_text('19人'))
        self.assertNotEqual(normalize_numeral_text('66'), normalize_numeral_text('6対6'))
        self.assertNotEqual(normalize_numeral_text('大西洋'), normalize_numeral_text('太平洋'))
        result = score_numeral_transcripts([
            {'reference': '観光地の1つ', 'text': '観光地の一つ'},
            {'reference': '大西洋', 'text': '太平洋'},
        ])
        self.assertEqual(result['edit_distance'], 2)
        self.assertEqual(result['reference_characters'], 9)

    def test_english_wer_keeps_number_words_until_requested(self):
        from asr_benchmark import score_word_errors

        plain = score_word_errors([{'reference': 'killing seventeen', 'text': 'Killing 17.'}])
        folded = score_word_errors(
            [{'reference': 'in his 20s killing seventeen', 'text': 'In his twenties, killing 17.'}],
            fold_numbers=True,
        )
        self.assertEqual(plain['word_errors'], 1)
        self.assertEqual(plain['reference_words'], 2)
        self.assertEqual(folded['word_errors'], 0)
        self.assertEqual(folded['reference_words'], 5)
        unchanged = score_word_errors([
            {'reference': '10 to 60 minutes', 'text': '1060 minutes'},
        ], fold_numbers=True)
        self.assertGreater(unchanged['word_errors'], 0)

    def test_pcm_is_verified_against_frozen_hash_and_sample_count(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'audio.wav'
            pcm = b'\x01\x00\xfe\xff\x03\x00'
            with wave.open(str(path), 'wb') as wav:
                wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                wav.writeframes(pcm)
            record = {'id': 'test', 'audio': path.name, 'num_samples': 3,
                      'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            self.assertEqual(read_pcm(root, record), pcm)
            with self.assertRaisesRegex(ValueError, 'hash changed'):
                read_pcm(root, {**record, 'sha256': '0' * 64})
            with self.assertRaisesRegex(ValueError, 'format changed'):
                read_pcm(root, {**record, 'num_samples': 4})


class SidecarReplayTests(unittest.IsolatedAsyncioTestCase):
    async def test_wrong_model_is_rejected_before_prewarm(self):
        requests = []

        async def handler(socket):
            requests.append(json.loads(await socket.recv()))
            await socket.send(json.dumps({
                'type': 'health-status', 'ok': True, 'readiness': 'ready',
                'runtimeFamilyId': 'qwen3-asr', 'modelIdentifier': 'wrong-model',
            }))
            async for raw in socket:
                requests.append(json.loads(raw))

        async with serve(handler, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, 'identity'):
                await ensure_runtime_ready(f'ws://127.0.0.1:{port}', 'qwen3-asr', 'expected-model')
        self.assertEqual(requests, [{'type': 'health-check'}])

    async def test_replays_remainder_in_real_time_and_collects_final_not_preview(self):
        received = []

        async def handler(socket):
            start = json.loads(await socket.recv())
            session = start['sessionId']
            received.append(start)
            await socket.send(json.dumps({'type': 'session-ready', 'sessionId': session}))
            while True:
                message = json.loads(await socket.recv())
                received.append(message)
                if message['type'] == 'stop-session':
                    for index, text in enumerate(['日本', '語']):
                        await socket.send(json.dumps({
                            'type': 'block-committed', 'sessionId': session,
                            'payload': {'block': {'id': str(index), 'text': text}},
                        }))
                    await socket.send(json.dumps({'type': 'session-ended', 'sessionId': session}))
                    return
                await socket.send(json.dumps({
                    'type': 'draft-updated', 'sessionId': session,
                    'payload': {'stableText': '', 'previewText': '間違った草稿'},
                }))

        async with serve(handler, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            before = time.perf_counter()
            result = await transcribe_pcm(f'ws://127.0.0.1:{port}', bytes(4800), timeout=2)
            elapsed = time.perf_counter() - before
        audio = [message['chunk'] for message in received if message['type'] == 'audio-chunk']
        self.assertEqual([len(base64.b64decode(chunk['dataBase64'])) for chunk in audio], [3200, 1600])
        self.assertEqual(audio[1]['timestamp'] - audio[0]['timestamp'], 100)
        self.assertGreaterEqual(elapsed, 0.145)
        self.assertLess(elapsed, 1.5)
        self.assertEqual(result['text'], '日本\n語')
        self.assertEqual(result['status'], 'ok')
        self.assertIsNone(result['first_stable_ms'])
        self.assertIsNotNone(result['first_draft_ms'])
        self.assertEqual(received[0]['language'], 'ja')
        self.assertFalse(received[0]['translationEnabled'])

    async def test_preserves_partial_final_and_error_without_claiming_success(self):
        async def handler(socket):
            session = json.loads(await socket.recv())['sessionId']
            await socket.send(json.dumps({'type': 'session-ready', 'sessionId': session}))
            async for raw in socket:
                if json.loads(raw)['type'] == 'stop-session':
                    await socket.send(json.dumps({
                        'type': 'block-committed', 'sessionId': session,
                        'payload': {'block': {'id': 'first', 'text': '日本'}},
                    }))
                    await socket.send(json.dumps({
                        'type': 'error', 'sessionId': session,
                        'payload': {'code': 'E_ENGINE_UNAVAILABLE', 'message': 'inference failed'},
                    }))
                    return

        async with serve(handler, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            result = await transcribe_pcm(f'ws://127.0.0.1:{port}', bytes(320), timeout=2)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['text'], '日本')
        self.assertIn('inference failed', result['error'])
        self.assertEqual(result['events'][-1]['message']['type'], 'error')
        self.assertIsNone(result['stop_to_end_ms'])

    async def test_counts_stable_retractions_per_block_and_requires_session_end(self):
        async def handler(socket):
            session = json.loads(await socket.recv())['sessionId']
            await socket.send(json.dumps({'type': 'session-ready', 'sessionId': session}))
            async for raw in socket:
                if json.loads(raw)['type'] == 'stop-session':
                    for block, stable in [('a', '日本'), ('a', '日本語'), ('b', '東京'), ('a', '日木')]:
                        await socket.send(json.dumps({
                            'type': 'draft-updated', 'sessionId': session,
                            'payload': {'blockId': block, 'stableText': stable, 'previewText': ''},
                        }))
                    return

        async with serve(handler, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            result = await transcribe_pcm(f'ws://127.0.0.1:{port}', bytes(320), timeout=2)
        self.assertEqual(result['stable_retractions'], 1)
        self.assertIsNotNone(result['first_stable_ms'])
        self.assertEqual(result['text'], '')
        self.assertEqual(result['status'], 'error')
        self.assertIn('without session-ended', result['error'])


if __name__ == '__main__':
    unittest.main()
