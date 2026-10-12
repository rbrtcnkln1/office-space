// The stepped multiple-choice flow every customization command shares
// (/office-space-boss, /office-space-office, /office-space-team, and the
// Apply step of /office-space-theme). Pure types
// (no `$`).
//
// Each command owns its own state machine (what the steps are and what Apply
// does) and turns its current state into a `FlowView`. ./register.tsx draws a
// view the same way for every command: a question with 2 to 4 option buttons,
// an "Other" text field that goes through the command's AI path, and, at the
// end, a summary of the change with Apply, Start over and Cancel. A press
// comes back as an `Action`. Nothing here ever reaches the conversation.

import type { BossLook } from './catalog'
import type { CustomPart } from './parts'
import type { RoleId } from './sprites'

export type Option = { id: string; label: string }

export type Action =
  | { kind: 'choose'; id: string } // one of the offered options
  | { kind: 'other'; text: string } // free text, through the same AI path as plain words
  | { kind: 'apply' }
  | { kind: 'retry' } // draw the part again (./draw.ts)
  | { kind: 'restart' }
  | { kind: 'cancel' }

/** What the panel draws for one state of a flow. */
export type FlowView = {
  /** Which command: also the prefix of every button key (`boss-hair-spiky`). */
  id: string
  /** The bold line while an AI call is running ("Boss look"). */
  title: string
  busy: boolean
  /** What the busy line says (default: asking the AI). */
  busyText?: string
  /** 'preview': a drawn part (./draw.ts) waiting for Apply, Retry or Cancel; `preview` absent means it failed. */
  stage: 'pick' | 'confirm' | 'preview'
  /** The bold line of the current stage: the question, or "apply this change?". */
  heading: string
  /** Names the step in button keys (`boss-<stepKey>-<option>`). */
  stepKey: string
  options: Option[]
  /** Show the free-text "Other" field. */
  other: boolean
  /** The Other field's placeholder (default: describe it in words). */
  otherHint?: string
  /** The change, one line each (confirm stage). */
  summary: string[]
  notes: string[]
  /** Offer Start over on the confirm stage (default true; a loaded theme has no steps to restart). */
  restart?: boolean
  /** Extra buttons on the pick and confirm stages ("Draw it: cowboy hat"); a press is a `choose`. */
  extra?: Option[]
  /** The character before and after a drawn part, for the preview stage. */
  preview?: { role: RoleId; before: Partial<BossLook>; after: Partial<BossLook>; part: CustomPart }
}
