---
name: game-ui-qa
description: Use when designing, implementing, reconstructing, or reviewing HUD, menu, dialogue, inventory, settings, or other in-game UI.
---
# Game UI QA

Treat game UI as interaction state, not a single screenshot.

## Workflow

1. Inventory screens, overlays, HUD regions, navigation hierarchy, input methods, focus rules, safe areas, viewports, locales, and accessibility needs.
2. Define state coverage for loading, empty, disabled, focused, selected, pressed, error, pause, modal, reconnect or retry, and gameplay transitions that apply.
3. Separate visual tokens and layout from interaction logic and game-state binding. Preserve editable structure alongside rendered evidence.
4. Verify keyboard, mouse, controller, and remapped input paths that the target supports, including focus recovery and back or cancel behavior.
5. Check text expansion, localization, contrast, readable scale, motion sensitivity, color-independent signals, overflow, occlusion, and HUD readability during play.
6. Capture the exact viewport and state, then verify the interaction result in an actual runtime when gameplay behavior is claimed.

## Stop conditions

- Do not infer interaction correctness from a static mockup or Editor preview.
- Do not silently replace project style, input conventions, or accessibility policy with generic defaults.
- Do not approve a visual match when focus, navigation, state binding, text, or runtime behavior remains unverified.

## Evidence

Report the tested viewport, locale, input mode, UI and gameplay state, editable artifact, rendered capture, interaction result, accessibility findings, and unresolved runtime gaps.
