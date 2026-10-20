# Contributing

Thanks for wanting to help. Honestly, I have no idea if anyone will. Right now there are zero contributions, and
I'm not mentally prepared for there to be any. If this gets overrun with pull requests, I'll probably pay for
CodeRabbit or something and get some OSS magic going. I've never done this before and have no idea what I'm doing,
so this file will change depending on what happens. Until then, I read everything myself, and these rules keep
that manageable.

## Open an issue first

- **Bugs:** use the bug form. Say what you did, what happened, your terminal, and your `claude --version`.
  For anything visual, add a screenshot.
- **Changes and ideas:** open an idea issue before writing code, and wait until it's agreed.
  Pull requests without an agreed issue may be closed without review. Typo and docs fixes are the exception.

## Pull requests

- Keep each one small and about one thing. Link the issue.
- Run `claude plugin validate .` and `claude plugin test .` and paste the result into the PR.
- Anything that changes the picture needs a screenshot or GIF from a truecolor terminal.
  The tests don't check the look.
- Read "Things to keep" in [AGENTS.md](AGENTS.md): the color pair budget, the 33 ms frame budget,
  and inner loops without helpers. A change that breaks them won't be merged, however nice it looks.

## AI tools

This project was written with Claude Code, so AI help is fine. Unreviewed AI output is not.

- **Say what you used.** The PR template asks which tools you used and for what.
- **Understand it.** You should be able to explain every line you're submitting, and how it fits the rest of
  the game, without asking the tool. If you can't, don't send it yet.
- **A human sends it.** No issues, pull requests or comments opened by an agent on its own.
  A person reads it and submits it.
- **Write your own words.** Cut generated issue and PR text down to what matters. Don't paste a long write-up.
- **No made-up reports.** A bug or security report you haven't reproduced yourself gets closed. A fabricated
  one gets you blocked.
- **No generated art.** The voxel models are hand-placed boxes in `hooks/models.ts`. New characters should be
  too.

Low-effort generated pull requests and issues are closed without comment. Repeat ones get you blocked.

## License

Contributions are under the [MIT license](LICENSE), the same as the rest of the project. Don't submit code you
don't have the right to license that way, including code a tool reproduced from somewhere else.
