# Convey brand system

## Brand idea

**Move with intent.** Convey turns a natural-language request into one bounded, reviewable financial move. Product feels calm, exact, human, and quietly advanced.

## Audience

- People sending, splitting, protecting, or coordinating money without wanting crypto complexity.
- Small groups, families, merchants, and treasurers who need understandable control and durable receipts.
- Judges should understand product value in 20 seconds and inspect technical evidence in one additional action.

## Visual thesis

Monochrome editorial finance with cinematic spatial motion. Warm off-white surfaces, near-black stages, large precise typography, thin rules, restrained radii, real product evidence. Avoid generic fintech gradients, glass panels, dashboard-card mosaics, decorative status badges, and crypto neon.

## Core tokens

| Role | Value |
|---|---|
| Ink | `#090909` |
| Paper | `#f7f7f4` |
| Surface | `#ffffff` |
| Muted ink | `rgba(9, 9, 9, 0.52)` |
| Hairline | `rgba(9, 9, 9, 0.10)` |
| Success | `#1f7a4d` |
| Warning | `#9a6210` |
| Danger | `#a73636` |

Black and white carry brand. Semantic colors appear only when status needs them.

## Typography

- Use existing application sans family and `next/font` configuration.
- Headlines: tight tracking, short line lengths, sentence case.
- Product copy: plain language, concrete outcomes, no protocol jargon in primary task surfaces.
- Technical IDs and receipts: monospace only where fixed-width scanning helps.
- One small uppercase eyebrow per major section at most.

## Shape and spacing

- Primary surfaces use 0–16px radius; pills only for compact actions, filters, and statuses.
- Prefer rules, whitespace, and tonal shifts over nested cards.
- Dense evidence uses aligned rows and timelines. Marketing uses large spatial contrast and one dominant idea per section.
- Frequent mobile actions target at least 44px.

## Motion

- Motion represents intent becoming a checked outcome: parse, compare, approve, settle, verify.
- Use `motion` for entrance, state transition, and shared-layout choreography.
- Default transition: 180–320ms with `[0.22, 1, 0.36, 1]`; larger narrative reveals may reach 600ms.
- Animate opacity and transforms. Never delay task completion for decoration.
- Every motion path honors `prefers-reduced-motion` with an immediate equivalent state.

## Product voice

- Outcome first: “Medicine support, protected until pickup.”
- Authority explicit: “Review and approve,” never “AI sent.”
- Failure direct and recoverable: “No matching order. Nothing was submitted.”
- Demo disclosure belongs in receipt/detail context: “Replay uses deterministic sample evidence; no chain transaction occurred.”
- Avoid implementation labels, SDK versions, server topology, hackathon language, and build status in customer navigation.

## Iconography and media

- Use existing Iconsax wrappers from `components/icons.tsx`; do not mix visible icon families.
- Use real product screenshots or purposeful abstract routing media. Never fabricate a product screenshot.
- Product evidence must remain legible without relying on imagery.

## Page modes

### Public landing

Editorial/cinematic. Immediate outcome statement, real product surface, three-step explanation, proof, one clear conversion to `/app`.

### Companion workspace

Touch-first operational UI. Conversation owns primary space; bounded action cards reveal exact recipient, limits, conditions, approval boundary, and receipt. Desktop adds context rail. Mobile uses full-height thread, safe-area composer, and bottom navigation.

### Evidence and receipts

High information density without developer theatre. Show requested action, independent checks, authority, resulting status, timestamps, and verifiable references. Simulation and missing proof remain clearly distinguishable from live verified outcomes.

## Anti-drift checklist

- Does screen feel like Convey before logo appears?
- Can user state next action in one sentence?
- Does motion explain state change?
- Are mock/demo and live evidence distinguishable?
- Is wallet still final authority?
- Does mobile feel native rather than compressed desktop?
- Did any component introduce a second visual system or icon family?
