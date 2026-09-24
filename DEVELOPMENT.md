# Development notes (jev-cli)

Written for whoever edits this repository — including AI agents working on the maxde server.
Two things here have caused real data loss before; read them before touching git.

## 1. Which copy is writable

| Path | Role |
|---|---|
| `~/GitHub/jev-cli` | **Development copy — the only writable one.** Remotes: `gitea` (internal mirror), `origin` (GitHub). |
| `~/.pi/agent/git/github.com/gmaxxxie/jev-cli` | Pi's package install cache, **read-only**. Installed via `git:github.com/gmaxxxie/jev-cli`. |

`pi update --extensions` runs `git reset --hard` + `git clean` on the cache. **Committing or
editing there means the next update silently rolls your work back.**

### Incident 2026-09-20

A retirement commit was pushed to gitea only; GitHub never received it. Pi's update reset the
cache to the old `main`, which reinstalled the already-deleted `jev_route` / `jev_triage`.

### Guards on the cache

The cache has no development remote, its `pushurl` points at a sentinel path, and
`pre-commit` / `pre-push` hooks reject commits and pushes. If Pi deletes and re-clones the
directory the guards disappear — re-run:

```bash
~/scripts/pi-git-package-guard.sh
```

## 2. Push to gitea only

Gitea is configured with a **push mirror** (`sync_on_commit`): pushing to gitea propagates to
GitHub automatically (measured ~4 s).

- **Never `git push origin`.** The mirror is a *forced* overwrite: the next sync silently rolls
  back any commit that exists only on GitHub. Push to `gitea`, then let the mirror carry it.
- **Branch and tag deletions do not propagate.** To delete a remote branch or tag, delete it on
  both gitea and GitHub.
- `~/scripts/gitea-commit.sh` pushes to gitea only by default — that behaviour is intentional,
  leave it alone.

```bash
git push gitea main            # correct
git push gitea --delete <ref>  # then also: git push origin --delete <ref>
```

## 3. Local install / verification

```bash
~/GitHub/jev-cli/install.sh             # installs the CLI (and API-key guidance)
~/.local/bin/jev --status --check       # gateway + live key check
```

`~/.local/bin/jev` is a symlink into `bin/jev` of this repository (single source of truth), so
CLI edits take effect immediately — no reinstall needed.
