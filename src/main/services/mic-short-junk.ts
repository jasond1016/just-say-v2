/** Meeting Mic-in: drop very short junk ASR commits/drafts (noise / hallucination). */

/** Prefer killing screenshot junk (哦/对/原名) over preserving 2-char short answers like はい. */
export const MIC_MIN_GRAPHEMES = 3

/** Secondary gate for block commits with tiny ASR windows. */
export const MIC_MIN_DURATION_MS = 300

export function countGraphemes(text: string): number {
  return [...text.normalize('NFKC').trim()].length
}

export function isMicrophoneShortJunkText(text: string): boolean {
  return countGraphemes(text) < MIC_MIN_GRAPHEMES
}

export function isMicrophoneShortJunkCommit(input: {
  text: string
  startedAt: number
  endedAt: number
}): boolean {
  if (isMicrophoneShortJunkText(input.text)) {
    return true
  }

  const durationMs = Math.max(0, input.endedAt - input.startedAt)
  return durationMs < MIC_MIN_DURATION_MS
}
