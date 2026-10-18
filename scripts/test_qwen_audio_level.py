import importlib.util
import unittest
from pathlib import Path

import numpy as np


def load_audio_level():
    path = Path(__file__).resolve().parents[1] / 'resources' / 'local-service-qwen' / 'audio_level.py'
    spec = importlib.util.spec_from_file_location('audio_level', path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Cannot load {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


audio_level = load_audio_level()


class QwenAudioLevelTests(unittest.TestCase):
    def test_silence_and_near_silent_recordings_are_not_audible(self):
        self.assertFalse(audio_level.is_audible(np.zeros(16000, dtype=np.float32)))
        self.assertFalse(audio_level.is_audible(np.full(16000, 0.0008, dtype=np.float32)))
        self.assertFalse(audio_level.is_audible(np.zeros(0, dtype=np.float32)))

    def test_speech_level_is_audible(self):
        self.assertTrue(audio_level.is_audible(np.full(16000, 0.02, dtype=np.float32)))
        self.assertAlmostEqual(audio_level.rms(np.full(4, 0.02, dtype=np.float32)), 0.02)


if __name__ == '__main__':
    unittest.main()
