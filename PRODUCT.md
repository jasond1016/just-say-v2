# Product

## Register

product

## Users

Knowledge workers who rely on voice input throughout their day: writers, developers, analysts, and anyone in frequent online meetings. They work at desks with external monitors, often in quiet or semi-quiet environments. They switch between Chinese and English constantly. They need speech-to-text that just works without fiddling.

Primary contexts:
- Quick dictation mid-task (composing emails, filling forms, writing docs) where hands stay on the keyboard and voice is faster than typing
- Long-running meetings where a searchable transcript matters more than real-time reading
- Reviewing and exporting past transcripts for follow-up work

## Product Purpose

JustSay is a desktop voice workstation that does two things exceptionally well: fast push-to-talk dictation and stable live meeting transcription. It exists because browser-based transcription tools lack system audio capture, global hotkeys, and direct text injection. Success means the user forgets the tool is there: press a key, speak, text appears.

## Brand Personality

Calm. Ready. Precise.

The interface stays out of the way until the moment you need it, then delivers exactly what you expect. Warmth over sharpness: easy on the eyes for hours-long sessions. Reliability over spectacle: always available, never crashing mid-meeting. Accuracy over reduction: every element earns its place by communicating the right information at the right time.

## Anti-references

- Generic SaaS dashboards with teal/blue accent gradients, pill buttons, and card grids
- Electron apps that feel like web pages rather than native desktop tools (slack-like bloat, rounded-everything)
- Overly decorative UIs with nested cards, hero metrics, and information-sparse layouts
- Parameter-heavy settings panels that expose internal complexity to users
- Any interface where someone could guess "AI made this" from the aesthetic alone
- The current V1/V2 design with its uppercase label + big number + rounded card pattern

## Design Principles

1. **Density over decoration.** Every pixel should carry information or afford an action. Whitespace is used for rhythm, not padding.
2. **State is the interface.** The user should always know what the tool is doing without reading labels. Status is communicated through layout shifts, color changes, and typography weight, not badge-and-banner noise.
3. **Text is the product.** Typography and text layout are the core design challenge. Transcript readability at long durations matters more than any other visual concern.
4. **Quiet confidence.** The tool should feel like professional equipment, not consumer software. No onboarding wizards, no "getting started" heroes, no empty-state illustrations.

## Accessibility & Inclusion

- WCAG AA minimum for all text contrast
- Reduced motion support for all transitions
- Screen reader landmarks and live regions for transcript updates
