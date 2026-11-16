# Sentinel Earth: first-screen intro and console polish

Written with the MotionSites Web Builder spec template (design-taste rules and rubric only; none of its media or example copy is used).

## 0. Brief
A first-screen intro over the live globe, then a polish pass on the existing console.
Mood: nocturnal, precise, calm. Signature: the real, sun-lit globe is the hero media; one glass panel says what this is in one breath.
Fidelity: build exactly this. No nav, cards, badges, video, scroll sections or decorations not listed here.

## 1. Stack and fonts
Existing stack (Next.js 16, Tailwind 4, shadcn/ui), CSS only, no new dependency. Archivo (variable, width axis) is already loaded; nothing else.

## 2. Tokens (existing)
`--background #0a1128`, `--foreground #e8ecf7`, `--muted-foreground #9aa6c8`, accent `#FFB238`. The accent appears on the primary button only. Text steps on glass: 100 headline, 85 sub, 75 fact, 70 footnote (each at least 4.5:1 even over bright cloud). No violet.

## 3. Material (one, reused)
Glass: the console's `rgb(16 27 58 / 78%)` (66% failed 4.5:1 over bright cloud), `backdrop-filter: blur(18px) saturate(1.3)`, 1px border `rgb(255 255 255 / 14%)`, top inset highlight `inset 0 1px 0 rgb(255 255 255 / 8%)`, shadow `0 8px 32px rgb(0 0 0 / 28%)`. The console's `.hud` panels take the same shadow.

## 4. Assets
None. The globe behind it is the live NASA imagery. No NASA logo.

## 5. Layers
Intro is `absolute inset-0` above the globe. The console chrome is hidden while it shows, so the globe is the only thing behind the panel, and the globe stays draggable. Panel: bottom-left on desktop, `left clamp(24px, 4vw, 64px)`, `bottom clamp(24px, 6vh, 72px)`, `width min(520px, 42vw)`, radius 28px, padding 32px. Phone: inset 16px, bottom `max(16px, safe-area)`, padding 20px.

## 6. Content (reading order)
| Element | Copy | Style |
|---|---|---|
| H1 | Sentinel Earth | clamp(2.5rem, 6vw, 5rem), weight 500, leading 0.98, tracking -0.03em, balanced wrap |
| Sub | Live NASA data on wildfires, storms, space weather and passing asteroids, on one globe. Built for disaster analysts and anyone briefing them. | 17px/1.55, weight 400, tracking -0.01em, 85%, max-width 28rem |
| Fact | **34** natural events are open right now, and **27** asteroids pass within 20 lunar distances in the next 30 days. | 15px/1.5, 75%, numerals 100% weight 600 tabular. Two skeleton bars while loading. Hidden if a feed fails. "Saved data" appended if a feed is stale. |
| Primary | Open the console | pill, solid `#FFB238` on `#0a1128` text, 15px/500, min-height 48px, padding 14px 28px |
| Footnote | Not an official NASA product. | 12px, 70% |

## 7. Motion
Easing `cubic-bezier(0.22, 1, 0.36, 1)`. Panel fades in 0.6s. Then H1, sub, fact, button rise (opacity 0 to 1, translateY 20px to 0, blur 8px to 0), 0.8s each, delays 0.2s, 0.32s, 0.44s, 0.56s. Done by 1.4s. Button hover scale 1.03 over 200ms, active 0.97. Nothing loops. Reduced motion: final state at once, no animation. Dismissal is instant.

## 8. Behaviour
Shown once per browser (`localStorage` key `sentinel-intro`, in try/catch; no storage means it shows each visit). Skipped when the URL has `layer`, `date`, `event` or `view`. Button, Enter or Esc dismisses. Focus starts on the button and moves to the console title afterwards. The existing "Drag to rotate" hint appears only after dismissal.

## 9. Responsive
No horizontal scroll at 375px. Tap targets at least 44px. Panel never exceeds 60svh so the globe stays visible above it on phones.

## 10. Console polish (numbers only; no behaviour, data or layout change)
Body tracking -0.011em, line-height 1.5. Headings tracking -0.025em, leading 1.05. Dashboard key numbers weight 500, tracking -0.03em. Console and ground titles weight 600, tracking -0.02em. Panel shadow `0 8px 32px rgb(0 0 0 / 28%)`. Text selection amber at 30%. State changes 150 to 300ms on `cubic-bezier(0.4, 0, 0.2, 1)`.

## 11. Constraints and acceptance
Do not: add dependencies, video, MotionSites media, scroll sections, or change feeds, the analyst or ground-view logic.
Acceptance (first viewport, 1440x900): the lit globe fills the screen; bottom-left, one glass panel with the title, one sentence, one live fact and one amber button. Nothing else is visible.
