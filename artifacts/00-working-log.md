# 00 — Working Log

Chronological record of every atomic change: commit SHA, what changed, what was
tested, pass/fail, what remains.

## Environment / baseline facts (verified 2026-09-21)

| Fact                     | Value                                     | How verified                        |
| ------------------------ | ----------------------------------------- | ----------------------------------- |
| Working dir              | `/home/user/gravity`                      | `pwd`                               |
| Remote                   | `https://github.com/logiagenesis/gravity` | `git remote -v`                     |
| Remote branches at start | `refs/heads/main` only @ `85ecc61`        | `git ls-remote --heads origin`      |
| Repo contents at start   | `README.md` (9 bytes, `# gravity`) only   | `ls -la`, `cat README.md`           |
| Designated work branch   | `claude/amazing-wright-3iwr5k`            | session harness requirement         |
| Push access              | **Confirmed** — branch created on remote  | `git push -u origin HEAD` succeeded |
| Node                     | v22.22.2                                  | `node --version`                    |
| npm                      | 10.9.7                                    | `npm --version`                     |
| Python                   | 3.11.15                                   | `python3 --version`                 |
| CPU                      | 4 × Intel Xeon @ 2.10 GHz                 | `nproc`, `/proc/cpuinfo`            |
| RAM                      | 15 GiB                                    | `free -h`                           |
| Chromium                 | present at `/opt/pw-browsers/chromium`    | `ls /opt/pw-browsers`               |

### Branch-name deviation (recorded, not assumed)

The task text asks for branch `rebuild/gravity-simulator-next`. The session
harness mandates `claude/amazing-wright-3iwr5k` and forbids pushing elsewhere
without explicit permission. The harness constraint wins; all work is on
`claude/amazing-wright-3iwr5k`. Renaming is a one-line change if the user
prefers the other name.

### Material baseline finding

`logiagenesis/gravity` is **empty**. It is not a fork of
`TheHappyKoala/Harmony-of-the-Spheres` and contains no third-party code. This
makes clean-room implementation the default and the cheapest option — there is
no GPL-derived history to disentangle. See `04-licensing-and-clean-room.md`.

## Log

| #   | SHA           | Change                                            | Checks run                       | Result | Remains                  |
| --- | ------------- | ------------------------------------------------- | -------------------------------- | ------ | ------------------------ |
| 1   | (this commit) | Add `artifacts/00-working-log.md`, baseline facts | `git status`, `git diff --check` | pass   | research artifacts 01–05 |
