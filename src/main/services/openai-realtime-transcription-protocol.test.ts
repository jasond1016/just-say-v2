import { describe, expect, it } from 'vitest'
import {
  createOpenAiRealtimeTranscriptionUrl,
  parseRealtimeTranscriptionServerEvent
} from './openai-realtime-transcription-protocol'

describe('OpenAI realtime transcription protocol', () => {
  it('parses JustSay patched partial hypotheses and VAD end timing', () => {
    expect(
      parseRealtimeTranscriptionServerEvent(
        JSON.stringify({
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: 'it_10',
          delta: ' world',
          transcript: 'hello world'
        })
      )
    ).toEqual({
      type: 'conversation.item.input_audio_transcription.delta',
      itemId: 'it_10',
      delta: ' world',
      transcript: 'hello world'
    })
    expect(
      parseRealtimeTranscriptionServerEvent(
        JSON.stringify({
          type: 'input_audio_buffer.speech_stopped',
          audio_end_ms: 1230
        })
      )
    ).toEqual({
      type: 'input_audio_buffer.speech_stopped',
      audioEndMs: 1230
    })
  })

  it('accepts an unpatched speech-stopped event for remote compatibility', () => {
    expect(
      parseRealtimeTranscriptionServerEvent(
        JSON.stringify({ type: 'input_audio_buffer.speech_stopped' })
      )
    ).toEqual({ type: 'input_audio_buffer.speech_stopped' })
  })

  it('builds the native SenseVoice realtime endpoint', () => {
    expect(createOpenAiRealtimeTranscriptionUrl('127.0.0.1', 8040)).toBe(
      'ws://127.0.0.1:8040/v1/realtime?intent=transcription'
    )
  })

  it('rejects unknown event types instead of leaking them into the engine', () => {
    expect(() =>
      parseRealtimeTranscriptionServerEvent(JSON.stringify({ type: 'response.audio.delta' }))
    ).toThrow('Unsupported native SenseVoice realtime event')
  })
})
