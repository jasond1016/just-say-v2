/** Meeting Mic-in: suppress near-duplicate microphone lines vs recent system text. */

export const CROSS_SOURCE_NEAR_DUP_WINDOW_MS = 8_000
export const CROSS_SOURCE_NEAR_DUP_SIMILARITY = 0.8

const FILLER_PATTERN = /えっと|えーと|えー|ええっと|あの|まあ|その/g

export function normalizeTranscriptTextForCompare(text: string): string {
  return text
    .normalize('NFKC')
    .replace(FILLER_PATTERN, '')
    .replace(/[\s\u3000。、．，,\.!?？！…〜~「」『』（）()【】\[\]・･]/gu, '')
    .trim()
}

export function isCrossSourceNearDuplicate(microphoneText: string, systemText: string): boolean {
  const mic = normalizeTranscriptTextForCompare(microphoneText)
  const system = normalizeTranscriptTextForCompare(systemText)

  if (mic.length < 2 || system.length < 2) {
    return false
  }

  if (mic === system) {
    return true
  }

  const [shorter, longer] = mic.length <= system.length ? [mic, system] : [system, mic]
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.55) {
    return true
  }

  return diceCoefficient(mic, system) >= CROSS_SOURCE_NEAR_DUP_SIMILARITY
}

function diceCoefficient(left: string, right: string): number {
  if (left.length < 2 || right.length < 2) {
    return left === right ? 1 : 0
  }

  const leftBigrams = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index += 1) {
    const bigram = left.slice(index, index + 2)
    leftBigrams.set(bigram, (leftBigrams.get(bigram) ?? 0) + 1)
  }

  let overlap = 0
  for (let index = 0; index < right.length - 1; index += 1) {
    const bigram = right.slice(index, index + 2)
    const count = leftBigrams.get(bigram) ?? 0
    if (count > 0) {
      leftBigrams.set(bigram, count - 1)
      overlap += 1
    }
  }

  return (2 * overlap) / (left.length - 1 + (right.length - 1))
}
