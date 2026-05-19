# JustSay Speech Runtime Model

This context defines the product language for how JustSay chooses and talks to speech recognition backends. It exists so plans and implementation discussions can distinguish user-facing choices from the backend runtime that actually does the recognition.

## Language

**Engine Profile**:
A user-facing speech option in JustSay that the product presents as a selectable profile.
_Avoid_: Preset label, engine, model

**Runtime Family**:
The backend speech runtime that actually performs recognition for an Engine Profile.
_Avoid_: Profile, preset, endpoint

**Managed Local Service**:
A Runtime Family hosted by a sidecar process launched on the same machine as the JustSay app.
_Avoid_: Local profile, builtin engine

**Remote Service**:
A Runtime Family hosted outside the JustSay app and reached over the JustSay sidecar protocol.
_Avoid_: Broker, gateway, multi-runtime endpoint

**Runtime Readiness**:
The state of whether a Runtime Family is ready to accept recognition work when a session starts or a profile is checked.
_Avoid_: Selected profile, enabled preset, current engine

**Prewarm**:
An explicit operator action that establishes Runtime Readiness before recognition starts.
_Avoid_: Implicit startup, lazy load, background auto-download

**Draft Stability**:
The distinction between the confirmed part of an in-progress transcript and the still-changing tail.
_Avoid_: Temporary text, partial output

**Transcript Provenance**:
The recorded identity of which profile, runtime family, model, and deployment mode produced a saved transcript.
_Avoid_: Selected preset only, backend guess

**Deployment Mode**:
The hosting choice for a Runtime Family, independent of which Engine Profile the user selected.
_Avoid_: Profile type, runtime family

**Profile Check**:
An operator action that verifies whether the selected Engine Profile can be used now, and may trigger Prewarm when that side effect is disclosed.
_Avoid_: Pure health ping, silent preload

**Utterance Rollover**:
The act of force-closing an in-progress utterance at a configured limit and continuing recognition in a new utterance state.
_Avoid_: Endless utterance, silent truncation

**Runtime Identity**:
The authoritative description of which Runtime Family and model a sidecar instance is serving.
_Avoid_: Backend guess, endpoint assumption

**Platform Blocker**:
A known runtime or environment constraint that means a selected Runtime Family is not supportable in the current hosting mode.
_Avoid_: Temporary glitch, generic failure

## Relationships

- An **Engine Profile** resolves to exactly one **Runtime Family**
- A **Runtime Family** may be hosted as a **Managed Local Service** or a **Remote Service** according to **Deployment Mode**
- A **Remote Service** exposes exactly one **Runtime Family**
- An **Engine Profile** may be selected even when its **Runtime Family** lacks **Runtime Readiness**
- A successful **Prewarm** creates **Runtime Readiness** for a **Runtime Family**
- A sidecar reports **Runtime Identity** independently of whether it currently has **Runtime Readiness**
- A transcript draft expresses **Draft Stability** as a stable prefix plus a changing tail
- A saved transcript carries **Transcript Provenance** for the **Engine Profile** and **Runtime Family** that produced it
- An **Engine Profile** does not change when only **Deployment Mode** changes
- A **Profile Check** may establish **Runtime Readiness**, but only when that behavior is explicit to the operator
- **Utterance Rollover** ends one in-progress transcript block and starts the next when an utterance exceeds its configured limit
- A **Platform Blocker** in managed-local hosting leads the operator toward **Remote Service**, not repeated hidden retries

## Example dialogue

> **Dev:** "If the user picks `local-accurate`, is that the same thing as choosing the Qwen backend?"
> **Domain expert:** "Not exactly. `local-accurate` is the **Engine Profile**; Qwen is the **Runtime Family** it resolves to."

## Flagged ambiguities

- "runtime" was being used to mean both the user-facing selection and the backend implementation — resolved: use **Engine Profile** for the user-facing choice and **Runtime Family** for the backend.
- "ready" was being used to mean both "selected in settings" and "able to transcribe now" — resolved: selection is an **Engine Profile** choice; operational availability is **Runtime Readiness**.
