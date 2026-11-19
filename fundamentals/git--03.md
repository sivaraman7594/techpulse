## 1. Reflog and recovery

### The reflog as a safety net
<!-- level: intermediate; ref: https://git-scm.com/docs/git-reflog -->
The reflog is a local journal of where `HEAD` and each branch pointed over time. Every commit, checkout, reset, rebase and merge appends an entry, so even after a hard reset or branch deletion the previous tip is usually still listed. Entries expire (90 days for reachable, 30 days for unreachable by default, via `gc.reflogExpire` settings) and are never pushed; they exist only in your clone.

```bash
git reflog
git reflog show feature
git reset --hard HEAD@{2}
git switch -c rescue HEAD@{yesterday}
```

Syntax `HEAD@{n}` means "where HEAD was n moves ago", while `branch@{1.hour.ago}` uses time.

Pitfalls: a fresh clone has no reflog for work done elsewhere, and `git gc --prune=now` combined with `git reflog expire --expire=now --all` removes the safety net permanently.

Interview tip: "I lost commits after a reset" is answered with reflog first; nearly nothing committed is truly lost in the first weeks.

### Recovering deleted branches and dropped commits
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Internals-Maintenance-and-Data-Recovery -->
If you delete a branch or reset past commits, find the tip in the reflog (or the abbreviated hash Git printed when deleting) and create a branch pointing at it. If the reflog has no record, `git fsck --lost-found` (or `--unreachable`) lists dangling commits and blobs that are still in the object store until garbage collection prunes them.

```bash
git branch -D old-work          # prints: (was 4c1e7d2)
git branch old-work 4c1e7d2     # restore it
git fsck --lost-found
git show <dangling-sha>
```

Staged-but-never-committed files are also recoverable: `git add` writes blobs immediately, so `git fsck --lost-found` can find them as dangling blobs. Content never staged or committed is gone.

Pitfalls: uncommitted working-tree changes destroyed by `reset --hard` or `restore` are not in the reflog.

Interview tip: advise committing early (even to a throwaway branch) because committed work is far easier to recover.

### Undoing a bad force-push or rebase
<!-- level: advanced; ref: https://git-scm.com/docs/git-reflog -->
After a rebase gone wrong locally, use `git reflog` to find the entry before "rebase (start)" and reset to it, or use `ORIG_HEAD` immediately after. For a bad force-push to a shared remote, the previous tip is usually still known to somebody: a teammate's remote-tracking branch, a CI log, the hosting platform's push events or "restore branch" feature, or your own reflog if you pushed from this clone.

```bash
git reflog
git reset --hard HEAD@{5}
git push --force-with-lease origin feature
# on a teammate's clone:
git rev-parse origin/main@{1}
```

Servers that keep reflogs for bare repositories (set `core.logAllRefUpdates=true`) can also help.

Pitfalls: repeated force-pushes after recovery may clobber commits that colleagues added in the meantime; announce and coordinate.

Interview tip: the prevention story matters: protect branches against force-push, and use `--force-with-lease` everywhere else.

## 2. Stash

### Stashing work in progress
<!-- level: basic; ref: https://git-scm.com/docs/git-stash -->
`git stash` saves your modified tracked files and staged changes onto a stack, then restores the working tree to HEAD, so you can switch context quickly. `git stash pop` reapplies the newest stash and drops it; `git stash apply` reapplies but keeps it. A stash is internally a commit (actually a small merge of commits for index and worktree) referenced by `refs/stash`.

```bash
git stash push -m "wip: search filters"
git stash list
git stash show -p stash@{1}
git stash pop
git stash drop stash@{0}
```

Untracked files are ignored unless you pass `-u` (and ignored ones with `-a`). `git stash push -- path/to/file` stashes only specific paths.

Pitfalls: pop can conflict, and when it does the stash is kept, not dropped. Stashes pile up and become forgotten; they have no branch context. `git stash --keep-index` stashes only unstaged changes, handy to test what you're about to commit.

Interview tip: for anything longer than a few hours prefer a WIP commit on a branch.

### Stash to branch and recovering dropped stashes
<!-- level: intermediate; ref: https://git-scm.com/docs/git-stash#_discussion -->
`git stash branch <name> [stash]` creates a branch from the commit where the stash was made, applies the stash and drops it if successful, avoiding conflicts caused by drifted base. If you dropped a stash by mistake, its commit is still in the object database until pruned; list unreachable commits and look for ones with the "WIP on" message.

```bash
git stash branch feature/search stash@{0}
git fsck --no-reflogs --unreachable | grep commit
git log --merges --grep='WIP on' --all --oneline --no-walk $(git fsck --no-reflogs --unreachable | awk '/commit/{print $3}')
git stash apply <sha>
```

Pitfalls: `git stash clear` removes all references at once; recovery depends on the dangling objects not yet pruned. Stash is not shared across clones.

Interview tip: a one-line explanation, "stash is a commit stored outside your branches", shows understanding of why recovery is possible.

## 3. Cherry-pick, bisect and history search

### cherry-pick
<!-- level: intermediate; ref: https://git-scm.com/docs/git-cherry-pick -->
`git cherry-pick <commit>` applies the change introduced by a commit onto your current branch as a new commit with a different ID. It is the standard tool for backporting a fix to a release branch or rescuing one commit from an abandoned branch. Ranges work (`A..B` excludes A), `-x` appends "(cherry picked from commit …)" to the message for traceability, and `-n` stages without committing. For merge commits pass `-m 1`.

```bash
git switch release/1.4
git cherry-pick -x 9fceb02
git cherry-pick A..B
git cherry-pick --continue    # after resolving conflicts
```

Pitfalls: duplicated commits across branches can cause confusing conflicts at later merges (though Git usually copes if the patch is identical). Cherry-picking a commit that depends on earlier ones produces a broken partial change.

Interview tip: mention that rebase is basically automated cherry-picking, and `git cherry` / `git log --cherry-pick` identifies patch-equivalent commits.

### git bisect
<!-- level: intermediate; ref: https://git-scm.com/docs/git-bisect -->
`git bisect` performs a binary search through history to find the commit that introduced a bug. You mark a known good commit and a bad commit; Git checks out the midpoint, you test, and each answer halves the range, so a thousand commits need about ten tests. It works best with small atomic commits and a reliable test.

```bash
git bisect start
git bisect bad                 # current commit is broken
git bisect good v2.3.0
# test, then: git bisect good|bad
git bisect run ./scripts/check.sh   # automate
git bisect reset
```

For `bisect run`, the script must exit 0 for good, 1-127 (except 125) for bad, and 125 to skip an untestable commit.

Pitfalls: flaky tests produce wrong culprits; commits that don't build need `skip`. Merge-heavy history can lead you to a merge commit, then bisect within the merged branch.

Interview tip: say how you'd automate it with a failing test written first, and note it needs the test to be independent of the code under bisect.

### Finding who changed what: blame and pickaxe
<!-- level: intermediate; ref: https://git-scm.com/docs/git-blame -->
`git blame file` shows the last commit that touched each line. Use `-L 10,30` for ranges, `-w` to ignore whitespace, and `-C`/`-M` to detect moved or copied lines across files. To ignore mass-reformat commits, list them in a file and configure `blame.ignoreRevsFile` (or `--ignore-revs-file`). The pickaxe, `git log -S"text"`, finds commits that changed the number of occurrences of a string, and `-G"regex"` finds commits whose diff matches a pattern. `git log -L :funcName:file` traces a function's history.

```bash
git blame -w -C -L 40,60 src/pay.py
git log -S"retryLimit" --oneline -- src/
git log -L :calculateTax:src/tax.js
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Pitfalls: blame points to the last toucher, not the originator of the idea; a formatting commit hides the real author unless ignored.

Interview tip: use `-S` to answer "when was this config key removed?"

## 4. Hooks, tags and submodules

### Git hooks
<!-- level: intermediate; ref: https://git-scm.com/docs/githooks -->
Hooks are executable scripts Git runs at defined events. Client-side examples: `pre-commit` (lint, format, secret scan), `commit-msg` (validate message), `pre-push` (run tests). Server-side: `pre-receive`, `update`, `post-receive` (enforce policy, trigger deployment). A non-zero exit from a "pre" hook aborts the operation. Hooks live in `.git/hooks` and are not versioned, so teams share them with `core.hooksPath` pointing to a tracked directory, or tools such as pre-commit, Husky or Lefthook.

```bash
git config core.hooksPath .githooks
cat > .githooks/pre-commit <<'EOF'
#!/bin/sh
npx lint-staged || exit 1
EOF
chmod +x .githooks/pre-commit
```

Pitfalls: `--no-verify` skips client hooks, so enforce critical rules on the server or in CI. Slow hooks drive people to bypass them.

Interview tip: client hooks are convenience, server hooks and CI are enforcement.

### Tags: lightweight and annotated
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Git-Basics-Tagging -->
A tag names a specific commit permanently, normally to mark releases. A lightweight tag is just a ref. An annotated tag is a full object storing tagger, date, message and optional signature; use these for releases. Tags are not pushed by default.

```bash
git tag -a v1.5.0 -m "Release 1.5.0"
git tag -s v1.5.0 -m "Signed release"
git push origin v1.5.0          # or --tags
git describe --tags             # e.g. v1.5.0-12-gabc1234
git tag -d v1.5.0 && git push origin :refs/tags/v1.5.0
```

`git describe` yields human-friendly version strings based on the nearest tag.

Pitfalls: moving or deleting a published tag breaks reproducibility for anyone who fetched it; fetch won't update existing tags without `--force`. `--tags` pushes all local tags, including stray ones.

Interview tip: say tags are immutable by convention, so a bad release gets a new tag, not a moved one.

### Submodules and subtrees
<!-- level: advanced; ref: https://git-scm.com/book/en/v2/Git-Tools-Submodules -->
A submodule embeds another repository at a path. The superproject records only a pointer to a specific commit (a "gitlink") plus the URL in `.gitmodules`. Clones don't fetch submodules unless asked. Updating a submodule is a two-step act: commit inside the submodule, then commit the new pointer in the superproject.

```bash
git submodule add https://example.com/org/lib.git vendor/lib
git clone --recurse-submodules <url>
git submodule update --init --recursive
git submodule update --remote vendor/lib
git config submodule.recurse true
```

Pitfalls: forgetting to push the submodule commit before the superproject leaves others with an unfetchable pointer; detached HEAD inside submodules confuses newcomers; CI must init submodules and have access credentials.

Alternatives: `git subtree` merges the other repo's history into a subdirectory with no special clone steps; package managers are often better for libraries.

Interview tip: summarise submodules as "pinned dependency by commit" and name their operational costs.

### Worktrees
<!-- level: intermediate; ref: https://git-scm.com/docs/git-worktree -->
`git worktree add` creates an additional working directory attached to the same repository, each with its own checked-out branch, sharing one object database. It replaces stashing and cloning twice when you need to review a PR, hotfix, or run long tests while continuing other work.

```bash
git worktree add ../hotfix hotfix/1.4.1
git worktree add -b review-123 ../review origin/pr/123
git worktree list
git worktree remove ../hotfix
git worktree prune
```

A branch can be checked out in only one worktree at a time.

Pitfalls: deleting the directory manually leaves metadata (`git worktree prune` cleans it); build artefacts and dependency folders aren't shared, so each tree needs its own installs.

Interview tip: worktrees are a cheaper alternative to a second clone, and they share the reflog-less object store but have separate HEAD and index.

## 5. Scale and maintenance

### Large repositories and performance
<!-- level: advanced; ref: https://git-scm.com/docs/git-sparse-checkout -->
Big repositories slow down `status`, `checkout` and clones. Mitigations: partial clone (`--filter=blob:none`) so blobs download on demand, sparse checkout to materialise only needed directories, shallow clones for CI, the filesystem monitor (`core.fsmonitor`) and untracked cache (`core.untrackedCache`) to speed `status`, commit-graph files (`git commit-graph write`) for faster history walks, and `git maintenance start` to schedule background prefetch, gc and commit-graph updates.

```bash
git clone --filter=blob:none --sparse <url>
git sparse-checkout set services/billing
git maintenance start
git config core.fsmonitor true
git config feature.manyFiles true
```

Pitfalls: partial clones need network for historical blobs; sparse checkout can hide files tools expect. Repository splitting versus monorepo tooling is an architectural decision, not a Git tweak.

Interview tip: structure answers by symptom: slow clone, slow status, slow history queries.

### Large files: Git LFS and history cleanup
<!-- level: intermediate; ref: https://git-lfs.com -->
Binary assets that change often bloat history because every version is stored. Git LFS replaces big files with small pointer files in the repository and stores the content on a separate server, downloading versions on checkout. Configure patterns with `git lfs track`, which writes `.gitattributes`.

```bash
git lfs install
git lfs track "*.psd"
git add .gitattributes assets/hero.psd
git lfs ls-files
git lfs migrate import --include="*.psd" --everything
```

`git lfs migrate import` rewrites history to move existing files to LFS, which changes all commit IDs and demands coordination.

Pitfalls: LFS requires server support and bandwidth quotas; clones without the LFS client get only pointers; adding a file normally and then to LFS later leaves the original blob in history.

Interview tip: mention alternatives, like storing artefacts in object storage, and that LFS is for versioned binaries rather than build output.

### Removing secrets and rewriting history
<!-- level: advanced; ref: https://git-scm.com/docs/git-filter-branch#_warning -->
If a secret or huge file was committed, deleting it in a new commit does not remove it from history. First rotate the credential, since it must be considered compromised. To purge, rewrite history with `git filter-repo` (a separate, recommended tool; `git filter-branch` is slow and discouraged by its own docs) and force-push, then have all collaborators re-clone, and ask the hosting provider to purge cached views and pull request refs.

```bash
git filter-repo --path config/secrets.yml --invert-paths
git filter-repo --replace-text expressions.txt
git push --force --all
git push --force --tags
```

Run on a fresh mirror clone (`git clone --mirror`) to avoid damaging your working repository.

Pitfalls: forks and clones keep the data; rewriting changes every descendant commit ID, breaking signatures, open PRs and references in issues.

Interview tip: the first answer is always "rotate the secret"; rewriting is secondary hygiene. Mention secret scanning and push protection as prevention.

### Maintenance, integrity and diagnosing problems
<!-- level: intermediate; ref: https://git-scm.com/docs/git-maintenance -->
Routine care keeps a repository healthy. `git maintenance` runs scheduled tasks (prefetch, commit-graph, loose-objects, incremental-repack, gc). `git fsck` checks object integrity and connectivity; `git gc` packs and prunes; `git count-objects -vH` shows size. For debugging, `GIT_TRACE=1`, `GIT_TRACE_PERFORMANCE=1` and `GIT_CURL_VERBOSE=1` reveal what Git is doing, and `git config --show-origin --list` shows where each setting came from.

```bash
git maintenance start
git fsck --full
GIT_TRACE=1 GIT_TRACE_PERFORMANCE=1 git status
git config --show-origin --get user.email
git rev-parse --git-dir --show-toplevel
```

Common corruption causes: interrupted writes, flaky disks, or cloud-sync tools (Dropbox, OneDrive) syncing `.git`. Recovery: fetch missing objects from a remote, or clone fresh and copy over unpushed work.

Pitfalls: do not keep repositories inside synced folders; do not hand-edit `.git` files without a backup.

Interview tip: demonstrate a diagnostic habit, trace first and hypothesise second.
