# Demo recording

`crossy-code.gif` (in the top-level README) and `crossy-code.mp4` (on the `demo` release, kept out of git
so plugin installs stay small) are a scripted take of a fresh Claude Code
session: `/crossy-code`, a look through the character picker, then a run played by an autopilot until a bug gets it.

## Recording

```
brew install vhs gifski
demo/record.sh [seed] [autopilot seconds]   # defaults: 40, 24
```

This overwrites `crossy-code.mp4` and `crossy-code.gif`. Check the take, then commit the GIF and upload the video:

```
gh release upload demo demo/crossy-code.mp4 --clobber
```

## How it works

| File | What it does |
| --- | --- |
| `record.sh` | Copies the plugin to a temp dir, adds the autopilot, records with VHS, exports MP4 and GIF |
| `autopilot.ts` | Reads the live `Game` and picks hops that stay safe, with a few rows of lookahead for a way through |
| `register.patch` | Fixes the first world's seed, runs the autopilot for N seconds, then hops forward blindly so the run ends in a death |
| `sim.ts` | Runs the autopilot headless over many seeds: `npx tsx demo/sim.ts 1 60 28` |

- The game is not changed: the autopilot and patch only go into the temp copy. If `hooks/register.tsx`
  changes near the patched lines, regenerate `register.patch` from a working copy with `diff -u`.
- Frame times vary live, so the same seed won't replay the same inputs. The autopilot reacts instead.
  Pick seeds that `sim.ts` reports `alive` across several runs.
- `env -i` keeps the recording session clean. The plugin loads with `--plugin-dir` and starts on a fresh
  save, so the HUD shows 0 tokens.
- The startup screen shows the signed-in account and plan. Look at the first seconds before sharing.
