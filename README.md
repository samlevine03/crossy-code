# crossy-code

`/crossy-code` opens a Crossy Road style game in a pane. It is drawn as a voxel world in the terminal.
A small software renderer draws boxes with shadows, lighting and antialiasing, two pixels to a cell.

This repository is its own plugin marketplace:

```bash
claude plugin marketplace add samlevine03/crossy-code
claude plugin install crossy-code@crossy-code
```

Or, inside a session: `/plugin marketplace add samlevine03/crossy-code`, then `/plugin install crossy-code@crossy-code`.

The repository is private, so git on your machine needs access to it, either with an SSH key or through `gh auth login` and `gh auth setup-git`.

## Keys

The pane takes keys while it has focus.

- `w` `a` `s` `d` hop. The arrow keys and `h` `j` `k` `l` work once the status line is clicked.
- `p` pauses. The game also pauses when the pane loses focus.
- `c` opens the character picker. `a` and `d` browse, `w` buys or picks.
- `r` starts over. `f` shows frames per second, render time and supersampling. `q` or `esc` closes the pane.

## Characters

Tokens appear on grass and roads. They buy characters:

| Character | Tokens |
| --- | --- |
| Clawd | free |
| Rubber Duck | 50 |
| Ferris | 100 |
| CI Bot | 100 |
| Cold Brew | 150 |
| Save Icon | 150 |
| Kernel Hacker | 200 |
| Zombie Process | 300 |

Top score, tokens, characters and death counts are saved to the plugin store and carry across sessions.

## Rendering

The renderer redraws the whole world each frame, at about 30 frames per second:

- shadows from a fixed sun
- per-face lighting
- water that ripples and flows with the logs
- up to 3x supersampling, which drops a level when frames run slow

The terminal paints at most 1024 color pairs a frame. Each frame is rounded to 4 bits a channel,
and the rarest pairs merge into their nearest neighbor so the score and banners stay sharp.

The game needs a truecolor terminal. On other surfaces the pane shows a note to open it in the terminal.

## Development

```
claude plugin validate .
claude plugin test .
```
