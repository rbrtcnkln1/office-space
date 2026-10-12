---
title: Office Commands - Plan
type: feat
date: 2026-10-11
topic: office-commands
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Office Commands - Plan

## Goal Capsule

- **Objective:** Add eight slash commands in two waves. Wave 1 tells people what is happening in the office; wave 2 lets them make the office their own.
- **Product authority:** The repo owner. Decisions below came from a 2026-10-11 brainstorm.
- **Open blockers:** None for wave 1. Wave 2 depends on a pixel-art catalog that does not exist yet (see Dependencies).

---

## Product Contract

### Summary

Wave 1 adds four information commands: `/office-space-roster`, `/office-space-recap`, `/office-space-usage` and `/office-space-workers`. Wave 2 adds four customization commands: `/office-space-boss`, `/office-space-team`, `/office-space-office` and `/office-space-theme`. Customization is described in plain words and refined through step-by-step multiple choice with an "Other" option.

### Problem Frame

Today the office can be opened, banded, updated and reported on, but people cannot ask it anything or change anything about it. Who is working on what is only visible as tiny labels under desks; what happened earlier in the day is lost; outside-worker files that fail to parse are silently skipped; and every office looks the same. Roadmap issues #3 to #7, #13 and #16 already describe these wants separately.

### Key Decisions

- **Two waves.** Information commands ship first because they need no new art. Customization ships once a catalog of hair, outfits, furniture and colors exists to draw from.
- **Plain words through a small side AI call.** Customization and the roster understand natural language by sending a short request to a small, fast Claude model outside the conversation. Each use costs a little of the user's plan usage and none of their chat context. The mod's zero-context-cost rule still holds.
- **Stepped multiple choice when a decision is needed.** When a request is vague or a command is run with no words, it walks the user through one choice at a time (2 to 4 options plus "Other" for free text), the way these brainstorm questions work.
- **Roster summaries are AI-written.** Each worker's line describes what it is actually doing, not just the task it was given.
- **The usage board (#16) moves into wave 1.** It was on hold; this plan un-parks it as `/office-space-usage`.

### Requirements

**Wave 1: information**

- R1. `/office-space-roster` lists everyone in the office right now (subagents and outside workers): name or role, status, how long they have been at it, and a one-line AI-written summary of what they are doing.
- R2. If the roster's AI summary can't be produced (offline, no usage left, no activity visible), the line falls back to the worker's own task text and says so.
- R3. `/office-space-recap` summarizes the current day: hand-ins, failures, outside workers that needed a person, and Employee of the Day.
- R4. `/office-space-usage` shows context fill, plan limit windows with reset times, and cost when the host provides them, as a text summary.
- R5. The office can also show usage as office objects (in-tray, wall clock, calendar per #16), with a setting to hide them.
- R6. `/office-space-workers` shows the watched folder, each parsed outside worker, and each skipped file with a plain reason (malformed JSON, unknown status, too big, too old, symlink).
- R7. Every wave-1 command answers in plain text that reads well in both the terminal and the desktop app, and never throws.

**Wave 2: customization**

- R8. `/office-space-boss <words>` changes the Boss's look (hair style and color, outfit, accessories) from a plain-words description; `/office-space-boss reset` restores the default.
- R9. `/office-space-team <words>` renames workers, gives roles custom titles and looks, and sets how many desks the office starts with.
- R10. `/office-space-office <words>` decorates the room from a furniture and color catalog (starting with a vending machine), and workers can use some new pieces on breaks.
- R11. `/office-space-theme` saves the current look as a small shareable file, loads one, and offers a few built-in presets.
- R12. Anything the catalog can't draw gets a friendly "not in the catalog yet" reply naming the closest available options.
- R13. Customizations persist across sessions and each command has a reset.

**Choosing and confirming**

- R14. A customization command run with no words, or with a request that maps to several catalog choices, walks the user through stepped multiple choice: one decision per step, 2 to 4 options, plus "Other" for free text.
- R15. "Other" free text goes through the same AI interpretation as a plain-words command.
- R16. Before applying a customization, the user sees what will change and can confirm or back out.

**Cost and safety**

- R17. Nothing any command does adds text to the model's conversation context.
- R18. Every AI call's output is validated against the catalog before anything is drawn or saved; invalid output is rejected with a friendly message.
- R19. Imported themes are data only: they are validated strictly and nothing in them is executed or shown unescaped.
- R20. Commands that make an AI call say so in their help text, so users know they use a little plan usage.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given two subagents and one outside worker, when the user runs `/office-space-roster` while offline, then three lines appear with the task text and a note that summaries are unavailable.
- AE2. **Covers R8, R14, R16.** Given the default Boss, when the user runs `/office-space-boss` with no words, then they choose hair style, then hair color (or "Other: pink"), then outfit, see a summary of the change, confirm, and the Boss redraws.
- AE3. **Covers R12.** When the user asks for "a jetpack", then the reply says jetpacks aren't in the catalog yet and lists available accessories.
- AE4. **Covers R6.** Given a workers folder with one valid file and one with a typo in its status, when the user runs `/office-space-workers`, then it lists one worker and one skipped file with the reason "unknown status".

### Scope Boundaries

- "Play with it" commands (demo, office events, making the Boss do things) are deferred to a later round.
- Sound effects are out.
- No online theme gallery; themes are shared as files.
- No new AI calls that run on their own; AI is used only when the user runs a command.

### Dependencies / Assumptions

- Wave 2 needs a pixel-art catalog: Boss hair styles, outfits and accessories; furniture including a vending machine; wall and floor colors.
- Assumes the host lets a plugin make a small side model call that returns text (`$.model`).
- Assumes the host can show a choice prompt mid-command. If not, the stepped choices appear as buttons in the office panel.
- Assumes a plugin can see recent activity for each agent. If not, the roster AI can only rephrase the task text.

### Outstanding Questions

- **Deferred to planning:** Which host API shows a stepped choice prompt to the user, and how the panel fallback behaves when the panel is closed.
- **Deferred to planning:** What recent-activity data a plugin can read per agent, and which small model to use for the side calls.
- **Deferred to planning:** Where the day's history for the recap is kept and when it resets.

---

## Wave 1 Implementation Notes (2026-10-11)

- **Host APIs found.** AI call: `$.model.complete({ model: 'haiku', system, prompt, maxTokens, effort: 'low', timeoutMs })`, a tool-less side call with no history, so nothing enters the conversation; its result is `isAnswered` with text, or a `reason`. Per-agent activity: `$.session.messages({ agentId })` returns that agent's transcript rows (text and tool uses), or `{ deny }`. Usage: `$.session.usage()` and the `session.measure` event (context, rate limits, cost). Stepped choices (wave 2) still need a host prompt API; not part of wave 1.
- **Roster.** One batched call per run for all workers with activity; strict check (JSON object, numbered keys in range, at most 20 words, no links or markup); fallback to task text with a visible note. Outside workers have no transcript, so their note and status stand in as activity.
- **Time at it.** The host gives no start time, so a light watcher notes when each agent was first seen at work.
- **Recap.** `DayTracker` watches the agent list and outside workers every 5 seconds (local reads only, with the office open or closed) and stores the tally in `$.store` as `day:<date>`; a new date starts empty.
- **Usage objects.** Drawn by `usageart.ts` from `usage.ts` figures; `office.usage` is set from `session.measure` and `$.session.usage()`; `showUsage` clears it.
- **Workers.** `external.ts` gained `classifyWorker` (skip reasons); `info.ts` builds the report.

## Wave 2, slice 1: catalog foundation and `/office-space-boss` (resolved)

Covers R8, R12, R13 (Boss), R14-R18, R20.

- **Stepped choices use the Office Space panel, not a host dialog.** The host has `$.ui.ask` (an AskUserQuestion dialog), but it cannot be shown to work from inside a slash command on every build, and a command the host does not recognize falls through to the chat as a message. So the command only ever answers with one short line and opens the panel; the steps are `Button`s (plus an `Input` for "Other" on terminal and desktop) drawn by the panel's own `ui.render` hook, which the tests mount on both surfaces. No path leads to the model or the conversation (R17).
- **Side call:** `$.model.complete({ model: 'haiku', effort: 'low', maxTokens: 300, timeoutMs: 20000 })`, one call per request, no history, no tools. The reply must be one JSON object of catalog ids (plus `unknown` and `vague` lists) and is validated strictly before anything is shown or saved.
- **Catalog:** `plugin/hooks/catalog.ts` (ids, labels, colors, validation, closest-options text) is pure and shared by the later team/office/theme commands; the art is drawn by `character()` in `sprites.ts`.
- **Persistence:** `$.store` key `bossLook`, read on `session.start`, cleared by `/office-space-boss reset`.
- **Confirmation:** every change, from words or steps, shows its summary with Apply, Start over and Cancel; only Apply saves.

## Wave 2, slice 2: `/office-space-team` and `/office-space-theme` (resolved)

Covers R9, R11, R13 (team, theme), R14-R20.

- **Team data** (`plugin/hooks/team.ts`, pure): `{ titles, looks, desks }` keyed by role id. A look is a partial of the Boss's four catalog ids, so a part left out keeps the role's built-in look; `character()` and `paletteFor()` now accept a partial look for any role. Titles go through `sanitize()` and are capped at 14 characters; the renderer escapes them. Persisted in `$.store` key `team`, cleared by `reset`.
- **Desks:** 5 to 15, rounded up to full rows of five by the existing layout rules (`Office.startDesks`); an occupied desk is never removed. Mapping words in agent tasks to roles was skipped: the role rules are regexes in `sprites.ts` and a per-user mapping needs its own design.
- **Panel:** the Boss's panel code became a generic `choiceView` used by Boss, team and theme. Team steps: what -> role -> part -> choice(s) -> summary -> Apply; "Other" takes an exact role, title or number with no AI call, and anything else goes through the same validated haiku call as plain words.
- **Themes** (`plugin/hooks/theme.ts`): `{ format, version, name, boss?, team?, office? }`, strict whitelist validation, 8 KB cap, saved under `~/.claude/office-space/themes/<slug>.json`, loaded by name or path, confirmed with the same Apply summary. Three presets use only catalog ids.
- **Office section is a stand-in.** `validateOffice()` in `theme.ts` accepts only a flat object of short ids and small numbers and is stored under `officeLook`; swap it for the office command's validator and store key when `/office-space-office` lands.
