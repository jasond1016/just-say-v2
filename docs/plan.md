# JustSay V2 handoff plan: `local-fast` / `local-accurate`

## Problem

Turn the current profile labels into real, comparable ASR runtime selections without increasing frontend complexity:

- `local-fast` -> `SenseVoiceSmall`
- `local-accurate` -> `Qwen3-ASR-1.7B`

The target outcome is that JustSay can switch between the two profiles for real A/B comparison while keeping the existing product model intact: one fast profile, one accurate profile, one shared Electron workflow, and deployment mode that stays separate from profile choice.

## Confirmed decisions

1. `local-fast` stays on the current SenseVoice path.
2. `local-accurate` uses `Qwen3-ASR-1.7B`.
3. Qwen must use **vLLM + official streaming-style stateful decoding**.
4. Meeting mode uses **Silero VAD** for utterance boundaries.
5. PTT does **not** use VAD; key-down/key-up remains the utterance boundary.
6. First batch does **not** include timestamps.
7. If Windows-native Qwen/vLLM is unstable, the only fallback is **remote-service**.
8. Qwen model/runtime download must be **explicit prewarm / preload**, not an implicit first-use download.
9. Electron should continue talking to a **custom JustSay sidecar protocol**, not directly to `vllm serve` OpenAI APIs.
10. A `remote-service` endpoint represents exactly one runtime family; sidecar health must report runtime identity.
11. `local-fast` / `local-accurate` remain product profile choices even when deployment mode is `remote-service`.
12. Selecting `local-accurate` is allowed before Qwen is ready; readiness is enforced at `Check profile` and session start.
13. Successful Qwen prewarm must leave the sidecar alive with the model already loaded.
14. Qwen draft updates should use `stableText` for the confirmed prefix and `previewText` for the unstable tail.
15. Max utterance rollover force-commits the current block and immediately starts a new utterance state.
16. Saved transcripts must persist profile, runtime family, model identifier, and deployment mode.
17. `Check profile` may trigger prewarm, but only when that side effect is disclosed clearly in the UI.

## Architecture direction

### Runtime split

Keep the two user-facing profiles as separate runtime implementations:

- `resources\local-service\` -> SenseVoice runtime
- `resources\local-service-qwen\` -> new Qwen runtime

Both runtimes should speak the same JustSay WebSocket contract so the Electron/session pipeline can stay largely unchanged.

### Service topology

Preferred data flow:

`Electron -> LocalEngineAdapter -> custom JustSay sidecar -> qwen-asr/vLLM streaming backend`

For remote deployment, keep the same custom protocol and move the Qwen sidecar to another machine.

Additional topology rules:

- A single `remote-service` endpoint maps to exactly one runtime family.
- Sidecar health is the authoritative source of runtime identity (`runtimeFamilyId`, `modelIdentifier`) before a session starts.
- Profile choice stays the same across deployment modes; only hosting location changes.

### Streaming/VAD behavior

#### Qwen meeting mode

- Capture window still emits `100ms` PCM chunks.
- Qwen sidecar aggregates to `500ms` pushes into streaming decode.
- One streaming state is maintained per active source (`system`, optionally `microphone`).
- Silero VAD is only used to determine utterance start/end, not to create ASR micro-batches.
- Draft updates should populate `stableText` with the confirmed prefix and `previewText` with the unstable tail.
- When VAD detects speech end, call streaming finalize and emit `block-committed`.
- If the utterance exceeds the configured max length before VAD closes it, force-commit the current block and immediately start a new streaming state.

Recommended initial parameters:

- push size: `500ms`
- `chunk_size_sec = 1.0`
- `unfixed_chunk_num = 4`
- `unfixed_token_num = 5`
- end-of-speech silence: ~`800ms`
- max utterance length: `15s`

#### Qwen PTT mode

- Start streaming state on key-down.
- Continuously push buffered PCM while pressed.
- Finalize on key-up.
- No VAD involvement.

## Scope

### In scope

1. Real profile-to-runtime mapping.
2. Qwen sidecar with vLLM streaming + Silero VAD.
3. Runtime-aware local service boot/probe/test flow.
4. Explicit preload/prewarm flow for Qwen.
5. Metadata and diagnostics good enough to compare SenseVoice vs Qwen outputs.
6. Test coverage for resolver/controller/session integration changes.

### Out of scope for first batch

1. Word-level timestamps in live transcription.
2. Speaker diarization / speaker separation.
3. Direct `vllm serve` OpenAI API integration.
4. Automatic background model downloads on first capture.
5. WSL-specific fallback UX.

## Implementation phases

### Phase 1 - Make profiles real

Goal: turn `local-fast` and `local-accurate` into actual runtime selections instead of UI-only labels/capability claims.

Primary areas:

- `src\core\settings\profile-catalog.ts`
- `src\shared\api-types.ts`
- `src\core\settings\settings-resolver.ts`
- renderer copy that describes profiles/status

Expected outcomes:

1. `local-fast` explicitly maps to SenseVoice runtime metadata.
2. `local-accurate` explicitly maps to Qwen runtime metadata.
3. Renderer copy makes it clear that profile choice and deployment mode are separate concerns.
4. Capabilities reflect current truth; do not claim unsupported features.

### Phase 2 - Make local service selection runtime-aware

Goal: stop treating “local service” as one generic Python process.

Primary areas:

- `src\main\services\configurable-local-service-controller.ts`
- `src\main\services\python-local-service-controller.ts`
- `src\main\services\local-service-supervisor.ts`
- `src\main\services\speech-service.ts`
- bootstrap wiring in `src\main\index.ts`

Expected outcomes:

1. Managed-local can start the correct sidecar for the selected profile.
2. Remote-service can target the correct runtime without changing frontend concepts.
3. A single remote endpoint is treated as one runtime family, not a multi-runtime broker.
4. Sidecar health returns runtime identity (`runtimeFamilyId`, `modelIdentifier`) so mismatches are detectable before transcription starts.
5. `Check profile` / probe / prewarm must test the target profile, not whichever runtime happens to be active.

### Phase 3 - Add the Qwen sidecar

Goal: create a dedicated Qwen runtime that implements the existing JustSay protocol.

Primary areas:

- `resources\local-service-qwen\pyproject.toml`
- `resources\local-service-qwen\service.py`
- `resources\local-service-qwen\README.md`
- startup/config handling in Electron main process

Expected outcomes:

1. Qwen sidecar can boot independently.
2. It exposes health, session start, audio push, stop, and abort on the JustSay protocol.
3. It adds an explicit prewarm operation rather than hiding model loading inside protocol health checks.
4. Health responses expose runtime identity and actionable readiness details if the runtime or model is unavailable.

### Phase 4 - Implement Qwen streaming + Silero VAD

Goal: use Qwen in its intended streaming form instead of imitating the existing offline chunk/re-run loop.

Primary areas:

- `resources\local-service-qwen\service.py`
- shared local service message types if any protocol additions are required

Expected outcomes:

1. Meeting mode maintains one streaming state per active source.
2. Silero VAD drives utterance boundaries only.
3. Drafts are emitted incrementally from streaming state updates.
4. Draft payloads use `stableText` for the confirmed prefix and `previewText` for the unstable tail.
5. Final committed blocks are emitted only after VAD end-of-speech, utterance rollover, or explicit stop/finalize.
6. PTT path stays push-to-talk bounded and bypasses VAD.

### Phase 5 - Explicit preload / diagnostics / operator UX

Goal: make Qwen startup predictable instead of surprising the user with implicit downloads or silent failures.

Primary areas:

- `src\main\services\speech-service.ts`
- settings/diagnostics UI surfaces
- sidecar READMEs and health detail payloads

Expected outcomes:

1. Prewarm can be used to trigger Qwen model/runtime availability intentionally and leaves the sidecar model-loaded on success.
2. Selecting `local-accurate` remains allowed even when Qwen is not ready; readiness is enforced at `Check profile` and session start.
3. If `Check profile` will trigger prewarm, the UI says so explicitly instead of presenting it as a pure status check.
4. Diagnostics clearly show missing model, unsupported local runtime, runtime mismatch, or remote-service requirements.
5. Remote-service becomes the documented fallback for Windows environments that cannot host Qwen/vLLM reliably, with a clear recommendation instead of repeated hidden retries.

### Phase 6 - Comparison metadata and persistence

Goal: preserve enough runtime identity to compare outputs later.

Primary areas:

- transcript persistence types/repository
- history/detail/export surfaces

Expected outcomes:

1. Saved transcripts retain the engine profile, runtime family, model identifier, and deployment mode used for recognition.
2. History/export makes it clear whether a transcript came from SenseVoice or Qwen.
3. Future A/B evaluation can be done from stored transcripts without guessing the backend.

### Phase 7 - Test and validation pass

Goal: lock down the new runtime split before feature tuning.

Primary validation areas:

- settings resolver tests
- service controller tests
- speech/profile test flow
- session coordinator / meeting / PTT integration
- local sidecar health/protocol tests

Validation matrix:

1. `local-fast` managed-local still works end to end.
2. `local-accurate` managed-local works when Qwen runtime is available.
3. `local-accurate` degrades cleanly to actionable failure when local Qwen is unavailable.
4. `remote-service` works for both profile families when pointed at a matching remote sidecar.
5. Remote runtime mismatch is rejected before session start based on health-reported runtime identity.
6. Meeting and PTT both preserve draft/commit semantics, including stable/preview draft behavior.

## Key risks and watchouts

### 1. Windows + vLLM viability

This is the main platform risk. The product fallback is **remote-service only**, so the implementation should avoid half-supported local hacks and surface a clean remote-service recommendation when needed.

### 2. Capability drift

Current profile capability flags already overstate some features. Do not repeat that with Qwen. The UI and stored metadata should reflect only what is actually wired.

### 3. Protocol creep

Keep the Electron contract stable if possible. Any protocol additions should be justified by real product needs, not backend convenience.

### 4. False “streaming”

Do not implement Qwen as repeated offline full-audio reruns under a streaming label. That would erase the main value of adopting Qwen.

## Suggested task order

1. Phase 1 + Phase 2 first, so profile/runtime wiring becomes truthful.
2. Phase 3 to stand up the new Qwen sidecar skeleton and health path.
3. Phase 4 to make Qwen genuinely stream with Silero VAD.
4. Phase 5 to make preload and fallback behavior usable.
5. Phase 6 + Phase 7 to preserve comparison data and stabilize the rollout.

## Definition of done

This effort is complete when:

1. switching between `local-fast` and `local-accurate` changes the actual ASR runtime;
2. Qwen meeting mode uses vLLM streaming with Silero-driven utterance boundaries;
3. PTT uses the same Qwen runtime without VAD dependence;
4. preload/prewarm behavior is explicit and user-visible;
5. Windows failures point to remote-service as the supported fallback;
6. remote runtime mismatches are detected before transcription starts; and
7. saved transcripts can be attributed to the profile/runtime/model/deployment mode that produced them.
