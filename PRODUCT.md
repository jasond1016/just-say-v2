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

Sharp. Fast. Minimal.

The interface communicates through absence: no decoration that doesn't earn its place, no UI chrome that doesn't serve a function. The tool feels like an extension of the keyboard, not an application you "open and use." Confidence comes from speed and reliability, not visual flourish.

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
3. **Keyboard-native.** The UI assumes the user's hands are on the keyboard. Mouse is supported but not primary. Hotkey hints are first-class.
4. **Text is the product.** Typography and text layout are the core design challenge. Transcript readability at long durations matters more than any other visual concern.
5. **Quiet confidence.** The tool should feel like professional equipment, not consumer software. No onboarding wizards, no "getting started" heroes, no empty-state illustrations.

## Accessibility & Inclusion

- WCAG AA minimum for all text contrast
- Reduced motion support for all transitions
- Keyboard-navigable throughout
- Screen reader landmarks and live regions for transcript updates
- Support for both light and dark themes (user's system preference respected)
