# The Duel Matrix — choreography bible

35 pairings (6 attackers × 6 victims, minus king-takes-king). Every cell below
is variant **A** and is mandatory as written. Each cell also ships a variant
**B** designed by the duels agent: same pairing, different opening beat AND
different finish — not a speed/mirror/palette change.

## Hard rules (from the critic gates)

- ≤ 4.0 s at 1× including camera in/out. Shape: cut-in ≤ 0.5 s, action ≈ 2.7 s,
  resolve + cut-out ≤ 0.8 s.
- Scripts are pure pose-functions of t ∈ [0,1] (see `DuelScript` in
  `src/core/stage.ts`). Sampling any t is valid; t=1 is the canonical end state
  (victim gone, attacker in `idle` on the captured square).
- Anticipation and follow-through on every action. Nothing snaps.
- Both silhouettes separated at default camera distance; stage combatants
  ~1.6 squares apart along the camera-relative axis.
- Victims are *defeated*, not butchered: no gore, no dismemberment of flesh
  (stone may shatter). Defeat readings per victim, used by every attacker row:
  - **Huscarl** — shield fails him; drops to a knee, falls.
  - **Berserkr** — unhorsed; the horse always survives and bolts offstage.
  - **Völva** — staff broken or grounded; hood collapses as if empty.
  - **Jötunn** — cracks along its seams, collapses into a rubble heap that
    sinks away.
  - **Valkyrie** — brought out of the air; wings fold over her as she kneels.
  - **Jarl** — kneels, plants the greatsword, slumps against it.
- Audio cues via `ctx.cue()` at exact beats; every duel has ≥ 1 vocal accent.
- NO film references. Tone sources: Norse saga matter-of-factness, Bayeux
  Tapestry staging, marginalia wit (RxK may be gently funny; nothing slapstick).

## The 35 (attacker × victim)

### Huscarl attacks (workmanlike, spear + shield)
| Cell | Variant A |
|---|---|
| PxP | Shield-wall duel: spears probe over rims; attacker hooks the rival shield down with his spear butt and thrusts over the top. |
| PxN | He plants the spear butt in the ground against the charge; the horse rears off the point and throws its rider; one finishing thrust. |
| PxB | Advances shield-first under a hail of runes that burst on the boss; closes, shield-bash, thrust beneath the hood. |
| PxR | The giant unfolds and slams its palm; he rolls between the stone fingers and jams the spear into a glowing seam — the giant seizes up and crumbles. |
| PxQ | She dives; he braces and deflects the dive off the shield boss; she skids to earth, he pins a wing with the shield edge and thrusts. |
| PxK | The greatsword falls on his shield and splits it; he ducks the second swing and trips the Jarl with the spear haft; the Jarl kneels. |

### Berserkr attacks (mounted, twin axes)
| Cell | Variant A |
|---|---|
| NxP | Passing charge: the horse veers at the last stride and both axes scissor over the shield rim. |
| NxN | Two riders pass at speed and trade sparks; on the return pass the attacker leans under the swing and takes the rival from the saddle. |
| NxB | Her first rune spooks the horse — it rears, and he leaps *from the rear* over the second rune, both axes falling through the third's glow. |
| NxR | The stone arm sweeps; the horse slides under it and he chops into the elbow seam — the arm cracks off, the giant tips and crumbles. |
| NxQ | She lifts off; he stands on the saddle, leaps, catches her spear-arm mid-air and drags her down; axes finish it grounded. |
| NxK | The Jarl sets his point like a pike; the horse pulls up short and the Berserkr vaults over its head, over the blade, both axes down. |

### Völva attacks (ranged, cast runes — she never closes distance)
| Cell | Variant A |
|---|---|
| BxP | One slow rune circles him; he swipes at it and it splits into three orbiting motes — shield, arm, chest. |
| BxN | **Worked example.** Staff planted; three runes ignite in sequence; the horse rears and throws the rider before the third lands. |
| BxB | Cast against cast — runes annihilate mid-air; her third rune travels *underground* and erupts beneath the rival's staff, breaking it. |
| BxR | A fetter-rune binds the tower before it can unfold; the limbs strain against glowing bands, the bands contract, the tower bursts to rubble. |
| BxQ | The dive meets a dome of light; wingtips clip it and spin her; a rune ignites on her own shield and drives her to earth. |
| BxK | He swings through each rune as it lights — each parried rune brands a mark on him; at the third mark he freezes mid-swing and falls. |

### Jötunn attacks (unfolds first — the petrify/unfold IS the anticipation)
| Cell | Variant A |
|---|---|
| RxP | **Worked example.** The tower shudders, seams crack, limbs unfold, one hand comes down. The shield does not help. |
| RxN | It stands *into* the charge; catches the rearing forehooves in one hand and shoves — horse and rider roll away; the horse bolts. |
| RxB | Runes burst as dust against its chest; it inhales and blows the rune-light out like candles, then flicks her staff from her hands. |
| RxR | Two towers unfold facing; a colossal grapple, forehead grinding on forehead; the attacker tears a merlon from its own shoulder and clubs. |
| RxQ | She strafes once, spear sparking off stone; it claps both hands — a thunderclap — and she tumbles from the air, wings folding. |
| RxK | One great human blow chips its shin; the giant kneels down to his level, regards him, and lays him down with two fingers. Marginalia-dry. |

### Valkyrie attacks (the airborne row — every cell leaves the ground)
| Cell | Variant A |
|---|---|
| QxP | One wingbeat up; the spear comes down through the shield like a bolt; she lands standing on the fallen shield. |
| QxN | She flies a low counter-circle to the charge and drops her shield edge-first across the horse's line; it shies, the rider is thrown onto her waiting point. |
| QxB | Runes chase her; she rolls between two, splits the third on her spearhead, and continues through to pin the staff to the ground. |
| QxR | The stone arm swings; she lands ON it, runs its length, drives the spear into the neck seam, and steps off as it crumbles beneath her. |
| QxQ | Two fliers spiral upward in a double helix and clash once at the apex with a flash; the loser's wings fold and she falls, landing kneeling. |
| QxK | **Worked example.** She takes off; he swings through empty air; she comes down through the gap. The only duel where the camera leaves ground level. |

### Jarl attacks (heavy, reluctant — he wins by economy, never flourish)
| Cell | Variant A |
|---|---|
| KxP | He pushes the spear aside with a gauntlet and gives one economical half-swing; turns away before the huscarl finishes kneeling. |
| KxN | Sidesteps the charge and drags the rider off as the horse passes; finishes grounded, then leans on the pommel, breathing hard. |
| KxB | Walks shoulder-first through all three runes — his mantle chars, he does not stop — and breaks the staff with one downward cut. |
| KxR | The palm slams down; his planted greatsword splits the blow; he steps inside, cuts the ankle seam, and rides the falling tower down. |
| KxQ | She dives; he does not dodge — takes the spear on the mantled shoulder, staggers, seizes the haft and swings her out of the air. |

## Variant B direction

Different entry beat + different finish per cell. Examples of legitimate
variation axes: which side the approach comes from *with different action*
(not a mirror), a failed first attempt by the attacker, weather/dust
interaction, the victim getting one counter-beat in before losing. Forbidden:
palette swaps, time-stretches, mirrored keyframes, reusing another cell's
choreography.

## Camera grammar

- Cut-in: swing from board camera to a low duel framing (~1.1 units height),
  combatants on thirds. Cut-out: ease back as the victor walks to `idle`.
- One camera idea per duel maximum (a push, an orbit segment, OR a rise —
  never several). QxK is the only cell allowed to leave ground level.
- `shake()` only on stone impacts and shield breaks, intensity ≤ 0.35,
  suppressed by reduced-motion.

## 2D mode

Duels are suppressed entirely in 2D (integration handles it); the capture
resolves with a compact emblem-flash vignette (attacker emblem slides over
victim emblem, victim fades) rendered by the same scripts' `t=1` end state —
no separate codepath that could desync.
