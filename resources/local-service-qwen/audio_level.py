"""Level gate for Qwen drafts.

Near-silent audio still makes the streaming model emit text. The Japanese
FLEURS files at about 0.0008 RMS did that. Real speech in that set sits near
0.09 RMS, so 0.01 is between the two.
"""

import numpy as np

DEFAULT_MIN_UTTERANCE_RMS = 0.01


def rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))


def is_audible(samples: np.ndarray, threshold: float = DEFAULT_MIN_UTTERANCE_RMS) -> bool:
    return rms(samples) >= threshold
