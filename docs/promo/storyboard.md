# Teaser storyboard (37 s, 1280x720, 24 fps)

> **Draft status.** Started from a Codex CLI draft, then adjusted to what the renderer actually produces. Every clip is real renderer output from `scripts/media/frames.ts`, sped up (time-lapse) to fit its slot. The rough cut is [`office-space-teaser.mp4`](https://github.com/rbrtcnkln1/office-space/releases/download/v0.8.1/office-space-teaser.mp4) (a v0.8.1 release asset; silent, captions and a "VO:" subtitle burned in so a reviewer can follow the intended voiceover).

| Timecode | Shot | Source and treatment | Caption | Transition |
| --- | --- | --- | --- | --- |
| 0:00 to 0:04 | Title card | First frame of Hire day (empty office), dimmed. Big title, "for Claude Code", the install line in a code box. | OFFICE SPACE for Claude Code | Fade up from black, then cut |
| 0:04 to 0:12 | Hire day | Full scene (22 s of office time) in 8 s: empty office, three arrivals through the door, the line at the Boss, the briefing, walking to desks, typing. | Orientation includes a commute. | Cut |
| 0:12 to 0:19 | Hand-in | Full scene (19 s) in 7 s: workers finish and queue at the Boss, packets fly, one failed job in red, they leave, the Employee of the Day sign updates. | Promotions last until the next hand-in. | Cut |
| 0:19 to 0:25 | Remote crew | Full scene (11 s) in 6 s: four desks with teal badges, a red **!** with "1 needs you" in the summary, a white **?** with a note, one worker fading as stale. | Even remote work has office drama. | Cut |
| 0:25 to 0:33 | Break room | Full scene (25 s) in 8 s: coffee, push-ups, the Boss kicks back and whistles, everyone drifts back. | The Boss practices executive stillness. | Cut |
| 0:33 to 0:37 | End card | Last frame of Hire day (everyone typing), dimmed. Title, install line. | OFFICE SPACE for Claude Code | Fade to black |

Layout: the office is drawn at 3 px per logical pixel (an integer multiple) on a dark navy frame, with the caption in bold and the voiceover subtitle in italic underneath.

## Ideas for a fuller cut

- A deadpan "performance review" gag: freeze on the idle Boss with a fake memo caption.
- Zoom (integer scale) on the red **!** bubble when a worker is blocked.
- Sound: office hum, a typing loop, a door chime for each arrival, a single sad trombone for the red hand-in.

## Concept art (reference only)

Generated with Codex CLI as mood references. They are not the shipped sprites and are not used in the video: [The Boss](concept/boss.jpg), [worker archetypes](concept/workers.jpg), [title card](concept/title.jpg).
