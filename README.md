# Journey to the Center of Hawkthorne

A single-file 8-bit platform adventure tribute to *Community* S3E20, "Digital Estate Planning".
Open `index.html` in a browser — no build step, no dependencies. Art, music, levels and story all live in that one file.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | ← → (or A / D) | D-pad / stick |
| Jump (hold for height, press again mid-air with boots) | Space, ↑, W | A |
| Drop through a wooden platform | ↓ + Space | ↓ + A |
| Climb ladders | ↑ / ↓ | D-pad |
| Sword / talk / open | Z (or J) | X / B |
| Down-stab (pogo off enemies and spikes) | hold ↓ + Z in mid-air | ↓ + X |
| Drink potion | Q | Y |
| Read one of Abed's scrolls | E | LB |
| Journal & items | I | Select |
| Pause | Esc / P | Start |
| Mute | M | |

Progress autosaves at every checkpoint lantern; pick **Continue** on the title screen.

## The game

1. **Village of Hawkthorne** — hub and tutorial. Meet Hilda and Abed, shop at the smithy, find the secret under the old well, and decide what to do when Annie and Shirley rob the blacksmith.
2. **The Black Caverns** — a dark descent lit by your lantern. Find the Spring-Heeled Boots (double jump), decide whether to help a trapped Gilbert, grab the White Crystal, then outrun the level deleting itself beneath you.
3. **Hawthorne Wipes Country** — mountain roads, moving lifts and a towelette factory full of conveyor belts, crumbling bridges and goblin workers.
4. **Castle Hawkthorne** — a vertical climb past shield knights and fire bars, grime seals that only moist towelettes can wipe away, Troy's last stand, and a duel with Gilbert on the battlements.
5. **The Throne of Hawkthorne** — a three-phase fight with Cornelius's floating head (with some help from an Abed who has had forty in-game years to level up).

There are three endings. Your choices (the smithy, Gilbert in the caverns) and the four hidden pages of Cornelius's journal decide which ones you can reach.

## Editing levels

Levels are ASCII maps near the top of the script (`MAP_VILLAGE`, `MAP_CAVERNS`, …); the legend is documented next to `TILEDEF` and `LEVELS`.
After changing a map, run the reachability checker, which simulates the game's own physics to prove each level can still be finished (and that locked doors can't be skipped):

```sh
node tools/check-levels.mjs          # all levels
node tools/check-levels.mjs 1 --map  # one level, with a map of every reachable standing spot
```

Add `?debug` to the URL for level warps (keys 1–5), god mode (G) and item cheats (B boots, L lantern, C crystal, U towelettes, $ gold).
