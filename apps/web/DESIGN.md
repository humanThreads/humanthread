---
name: HumanThread Public Web
description: A delivery dispatch system where one visible thread connects context, execution, and human confirmation.
colors:
  signal-green: "#1f883d"
  signal-ink: "#f7faf8"
  dispatch-paper: "#f4f7f5"
  raised-paper: "#fbfcfb"
  graphite: "#17201c"
  steel-text: "#5d6963"
  track-line: "#cbd3cf"
  strong-line: "#9ba8a1"
typography:
  display:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "64px"
    fontWeight: 680
    lineHeight: 1.02
    letterSpacing: "0"
  tablet-display:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "58px"
    fontWeight: 680
    lineHeight: 1.02
    letterSpacing: "0"
  close:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "46px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "0"
  headline:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "42px"
    fontWeight: 650
    lineHeight: 1.12
    letterSpacing: "0"
  subheadline:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "34px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "0"
  mobile-title:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 620
    lineHeight: 1.18
    letterSpacing: "0"
  body:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0"
  small-body:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0"
  kicker:
    fontFamily: "Geist Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "0"
  label:
    fontFamily: "Geist Mono, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0"
rounded:
  control: "4px"
  status: "999px"
spacing:
  compact: "8px"
  control: "16px"
  section: "80px"
components:
  button-primary:
    backgroundColor: "{colors.signal-green}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
    height: "46px"
  button-secondary:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
    height: "46px"
---

# Design System: HumanThread Public Web

## Overview

**Creative North Star: "The Delivery Dispatch Graph"**

Public HumanThread surfaces borrow the precision of operational dispatch charts:
time, actors, context, and state form one legible coordinate system. The visual
world is light, exact, and work-focused, but it is not another boxed enterprise
dashboard. A visible signal thread proves how work moves between people, Agents,
documents, and approval states.

This seed governs public brand and product-explanation surfaces. Authenticated
Workbench pages keep their denser Operate-mode components while sharing the
brand, type, and semantic status language. Motion is one orchestrated delivery
sequence, not a layer of perpetual decoration.

**Key Characteristics:**

- Cool dispatch-paper fields with graphite notation.
- One signal-green route that always represents active progress or action.
- Asymmetric compositions built on explicit tracks and stages.
- Sparse depth, clipped panels, and low-radius controls.
- Motion that explains ownership, handoff, waiting, and completion.

## Colors

The palette is restrained: cool neutrals carry the system and signal green is
reserved for the active delivery thread and primary action.

### Primary

- **Signal Green** (`#1f883d`): the active route, primary action, confirmed
  progress, and keyboard focus. It is never ambient decoration.

### Neutral

- **Dispatch Paper** (`#f4f7f5`): the main public-page field.
- **Raised Paper** (`#fbfcfb`): navigation and the few surfaces that need
  separation from the graph.
- **Graphite** (`#17201c`): primary copy, route labels, and decisive controls.
- **Steel Text** (`#5d6963`): explanatory copy and secondary metadata.
- **Track Line** (`#cbd3cf`): structural rules, axes, and inactive routes.

Dark preference uses the same hierarchy with a charcoal field, muted steel
tracks, off-white text, and the recognizable signal green.

**The Signal Has Meaning Rule.** Green identifies a current route, action, focus,
or confirmed state. If an element has none of those meanings, it stays neutral.

## Typography

**Display Font:** Geist Sans (with the existing system sans fallback)

**Body Font:** Geist Sans (with the existing system sans fallback)

**Label/Mono Font:** Geist Mono (with the existing monospace fallback)

**Character:** Geist keeps the product voice direct and contemporary. The mono
face is used only for stage, time, state, and routing notation, so the page reads
as an operational system without becoming a terminal theme.

### Hierarchy

- **Display** (650 weight, responsive `44px` to `72px`, `1.02` line height): one
  concrete product promise in the opening viewport.
- **Headline** (600 weight, responsive `30px` to `48px`, `1.1` line height): major
  narrative transitions.
- **Title** (600 weight, `18px` to `22px`, `1.25` line height): stage and content
  headings.
- **Body** (400 weight, `16px` to `18px`, `1.65` line height): explanations,
  limited to roughly 68 characters per line.
- **Label** (550 weight, `11px` to `13px`, normal letter spacing): operational
  notation; uppercase appears only where the underlying state is conventionally
  uppercase.

**The Notation Is Not Decoration Rule.** Monospace type is used only when content
behaves like an identifier, time, stage, command, or state.

## Layout

Public surfaces use a twelve-column desktop grid with deliberately unequal
content and demonstration regions. The root hero reserves five columns for the
product promise and seven for the framed delivery run, so the demonstration is
the primary proof rather than a thin footer beneath oversized copy. Text keeps a
stable reading column and never sits over moving detail without a solid contrast
field.

Spacing follows a compact operational rhythm inside demonstrations and a larger
narrative rhythm between sections. On screens below `768px`, the graph becomes a
single vertical route, labels return to document order, and every action remains
full-width or safely one-line.

**The Route Owns the Grid Rule.** Tracks and stages organize real content; no
crosshair, rule, or coordinate line exists solely to make a blank area look
technical.

## Elevation & Depth

The system is flat by default. Tonal paper layers, solid borders, and controlled
overlap establish hierarchy. A soft tinted shadow may appear only under a
demonstration surface that must separate from the page; navigation, content
bands, and ordinary containers stay shadowless.

**The Flat Operations Rule.** Elevation communicates a temporary foreground or
interactive layer, never generic importance.

## Shapes

The world uses clipped rectangular geometry. Content surfaces and fields use
corners from `0px` to `4px`; buttons use `4px`. Status pills are allowed only
when a compact semantic state needs a bounded label. Circular nodes represent
actual route events, not decoration.

## Components

### Buttons

- **Shape:** compact rectangular controls with gently clipped corners (`4px`).
- **Primary:** Signal Green with Signal Ink, a stable `46px` height, and icon plus
  one-line action text.
- **Secondary:** Raised Paper with a Strong Line border and Graphite text.
- **Hover / Focus:** darken the primary fill or strengthen the secondary border;
  keyboard focus uses a three-pixel translucent Signal Green outline.
- **Active:** translate downward by one pixel for tactile feedback.

### Navigation

The public header is a solid Raised Paper band with one bottom Track Line. It is
sticky, uses the existing HumanThread mark, and keeps only login and account
creation actions. Mobile removes the redundant login text link but retains the
primary account action.

### Delivery Dispatch Track

The signature track contains five semantic nodes and four connecting segments.
Desktop uses a horizontal time axis; mobile uses a vertical document-order
route. Every stage retains a label and description in static markup. The
Signal Green cursor runs across a 4.2-second staged sequence with a progress
fill and a handoff pulse, while the runbook announces the active stage and
updates its counter. Visitors can restart the authored sequence at any point;
reduced-motion users receive the final complete route on load and can still
explicitly request one controlled replay.

### Product Story Bands

Product layers are unframed full-width bands separated by Track Lines. A sticky
desktop index shows the four real product areas, while mobile removes the index
and keeps each section in semantic order. These bands never become floating
cards.

## Do's and Don'ts

### Do:

- **Do** let one signal route connect otherwise separate product stages.
- **Do** use native document order and a complete static route as the reduced-
  motion experience.
- **Do** keep product demonstrations truthful and label authored sample data.
- **Do** use solid fields and spacing to preserve copy contrast over diagrams.

### Don't:

- **Don't** turn the public page into a wall of equal feature cards.
- **Don't** use gradients, glows, glass, or dark terminal motifs as shorthand for
  AI capability.
- **Don't** add route lines, status lights, or timetable notation without a real
  product meaning.
- **Don't** animate continuously once the delivery sequence has been understood.
