# Git interview questions

### What is the difference between git fetch and git pull?
<!-- level: basic; kind: concept; ref: https://git-scm.com/docs/git-pull -->
`git fetch` downloads new commits, tags and branch tips from a remote and updates your remote-tracking branches (such as `origin/main`), but leaves your local branches and working tree untouched. `git pull` is `git fetch` followed by integrating the fetched upstream into your current branch: a merge by default, or a rebase if `pull.rebase` or `--rebase` is set.

```bash
git fetch origin
git log HEAD..origin/main --oneline   # inspect first
git merge --ff-only origin/main       # then integrate deliberately
```

Fetch is always safe; pull can create merge commits or conflicts at an inconvenient moment. Setting `pull.ff only` makes pull fail instead of making surprise merges. A good answer also says that a "pull" never contacts the server twice; remote-tracking refs are just a local cache of the last fetch.

### Explain Git's object model.
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/book/en/v2/Git-Internals-Git-Objects -->
Git stores four object types in a content-addressed database keyed by a hash of the content. Blobs hold file data, trees map names to blobs and subtrees (directories), commits reference one root tree plus parent commits and metadata, and annotated tags reference another object with a name and message. Because each object's ID covers its content and the IDs it references, history is a Merkle DAG: change anything and every descendant ID changes.

Branches and tags are just refs, small files holding a commit ID; `HEAD` points to the current branch. Git stores snapshots, not diffs; packfiles apply delta compression only as a storage optimisation.

```bash
git cat-file -p HEAD
git cat-file -p HEAD^{tree}
```

Good answers explain consequences: branches are cheap, rebase creates new commits, and identical files are stored once.

### What is the difference between merge and rebase, and when do you use each?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/book/en/v2/Git-Branching-Rebasing -->
Merge joins two histories with a merge commit (or fast-forwards), preserving the real branching structure. Rebase replays your commits on top of another base, creating new commits and a linear history.

Use rebase to tidy and update private topic branches before review (`git rebase origin/main`, interactive rebase to squash fixups). Use merge to integrate shared work or when the branch structure is meaningful, and to avoid rewriting commits others rely on. Never rebase published shared history; if you rebased your own pushed branch, use `git push --force-with-lease`.

Trade-offs: rebase gives readable, bisect-friendly history but loses the original context and resolves conflicts commit by commit; merge is non-destructive but creates a noisier graph. Many teams combine them: rebase locally, then squash-merge or `--no-ff` merge into main. State your policy and why.

### What do git reset --soft, --mixed and --hard do?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/docs/git-reset -->
All three move the current branch to the target commit. They differ in how far the reset reaches across the three trees: HEAD, index (staging area) and working tree.

- `--soft`: moves only the branch; changes stay staged. Good for squashing the last N commits into one.
- `--mixed` (default): also resets the index; changes remain in the working tree, unstaged.
- `--hard`: resets index and working tree, discarding uncommitted changes.

```bash
git reset --soft HEAD~3 && git commit -m "Combined change"
git reset --hard origin/main
```

Committed work discarded by `--hard` can be recovered through `git reflog`, but uncommitted changes cannot. Reset rewrites branch history, so on shared branches prefer `git revert`, which adds an inverse commit.

### How does git revert differ from git reset?
<!-- level: basic; kind: concept; ref: https://git-scm.com/docs/git-revert -->
`git revert <commit>` makes a new commit applying the inverse of a previous commit; history is preserved and nothing is rewritten, so it's safe on shared branches. `git reset` moves the branch pointer backwards, effectively deleting commits from the branch's history, which requires force-pushing if the commits were already published.

For a merge commit, specify the mainline parent: `git revert -m 1 <merge>`. Be aware that after reverting a merge, merging the same branch again will not bring back the reverted changes, because Git thinks they were already merged; you must revert the revert first.

Choose revert for undoing public mistakes, reset for local cleanup before pushing. Neither removes a leaked secret from history; that needs a history rewrite plus credential rotation.

### What is the staging area and why does Git have one?
<!-- level: basic; kind: concept; ref: https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository -->
The staging area (index) is a snapshot of what the next commit will contain, stored in `.git/index`. You move changes into it with `git add` and turn it into a commit with `git commit`. It lets you compose commits deliberately: stage only some files, or only some hunks with `git add -p`, even if your working tree contains unrelated edits.

It also underpins efficiency: the index caches file metadata so `git status` can detect changes quickly, and it holds the merge state during conflicts.

```bash
git add -p
git diff --staged
git restore --staged file
```

Mentioning `git diff` (working tree vs index) versus `git diff --staged` (index vs HEAD) shows practical understanding. The staging area is the reason for atomic, reviewable commits.

### What is a detached HEAD and how do you recover from it?
<!-- level: basic; kind: concept; ref: https://git-scm.com/docs/git-checkout#_detached_head -->
Normally HEAD points to a branch name, and commits advance that branch. In detached HEAD state HEAD points directly at a commit, for example after `git switch --detach v1.0` or checking out `origin/main`. Commits you create are not on any branch, so switching away leaves them reachable only through the reflog until garbage collection.

To keep work, create a branch while still there: `git switch -c my-fix`. If you already left, find the commit with `git reflog` and run `git branch rescue <sha>`.

Detached HEAD is useful for inspecting old versions, building tagged releases and bisecting; the warning is informational. Key point: the risk is only in committing without a name and walking away.

### How do you resolve a merge conflict?
<!-- level: basic; kind: concept; ref: https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging -->
Conflicts arise when both sides changed the same lines (or one deleted what the other edited). Git stops, lists unmerged paths in `git status`, and writes markers into files.

1. Open each conflicted file and decide the final content using both sides and, ideally, the base (`merge.conflictStyle zdiff3` shows it).
2. Remove marker lines.
3. `git add <file>` to mark resolved.
4. Finish with `git commit` (merge) or `git rebase --continue`.

```bash
git status
git diff --name-only --diff-filter=U
git merge --abort    # to give up
```

Mention that during a rebase "ours" and "theirs" are swapped, that `rerere` can reuse resolutions, and that tests must run after resolving because a textually clean merge can still be semantically broken.

### What is the difference between git stash and a WIP commit?
<!-- level: basic; kind: concept; ref: https://git-scm.com/docs/git-stash -->
`git stash` stores uncommitted tracked changes (and, with `-u`, untracked files) on a stack outside any branch, resetting your working tree to HEAD. A WIP commit saves them as a regular commit on a branch.

Stash is quick for short interruptions, such as switching to review something. A WIP commit is better for anything lasting: it is visible in branch history, can be pushed as a backup, shows in `git log`, and can later be reworked with `git commit --amend` or `reset --soft HEAD~1`.

Pitfalls of stash: easily forgotten, no branch context, `pop` conflicts keep the stash, and `git stash clear` deletes the lot (although dangling commits may be recoverable with `git fsck`). Use `git stash push -m "message"` and `git stash branch` when changes drift.

### When would you use git cherry-pick, and what are its risks?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/docs/git-cherry-pick -->
`git cherry-pick <sha>` re-applies a single commit's change as a new commit on the current branch. Typical uses: backporting a bugfix to a release branch, rescuing a commit from a discarded branch, or moving a commit made on the wrong branch.

Use `-x` to record the source SHA in the message so people can trace it. Ranges are `A..B` (exclusive of A).

Risks: the copy has a different ID, so history shows duplicates; later merges may produce conflicts if the same change was altered in each branch; picking a commit that depends on earlier ones gives an incomplete change; and heavy cherry-picking suggests a branching strategy problem. Prefer merging the branch when you want everything. `git log --cherry-pick main...feature` helps find patch-equivalent commits.

### How does git bisect work?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/docs/git-bisect -->
Bisect is a binary search over commit history to find which commit introduced a regression. You tell Git one good commit and one bad commit; it checks out the midpoint; you test and mark it good or bad; this repeats, needing roughly log2(N) steps. At the end it prints the first bad commit.

```bash
git bisect start
git bisect bad
git bisect good v3.0
git bisect run pytest tests/test_checkout.py
git bisect reset
```

`bisect run` automates the search using an exit code: 0 good, 125 skip, other non-zero below 128 bad. It needs a deterministic test and commits that build; use `skip` for broken ones. Small atomic commits make the result actionable; flaky tests give false culprits. A good answer includes writing the failing test first.

### What are Git hooks and what are their limits?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/docs/githooks -->
Hooks are scripts triggered by Git events. Client-side: `pre-commit`, `commit-msg`, `pre-push`, `post-merge`. Server-side: `pre-receive`, `update`, `post-receive`. They live in `.git/hooks`, which is not versioned, so share them via `core.hooksPath` or frameworks like pre-commit, Husky or Lefthook.

Use client hooks for fast feedback: formatting, linting staged files, commit message format, secret detection. Use server hooks or branch-protection rules and CI for enforcement.

Limits: users can bypass client hooks with `--no-verify` or by not installing them; slow hooks hurt productivity; hooks run in the local environment, so results can differ from CI. Interview-quality answer: "client hooks help, server-side checks enforce".

### What is the difference between a lightweight and an annotated tag?
<!-- level: basic; kind: concept; ref: https://git-scm.com/book/en/v2/Git-Basics-Tagging -->
Both name a commit. A lightweight tag is merely a ref in `refs/tags/` pointing to a commit. An annotated tag is a full object containing the tagger, date, message and optionally a GPG or SSH signature, pointing to a commit. Releases should use annotated (or signed) tags because they carry provenance and are used by `git describe` by default.

```bash
git tag -a v2.0.0 -m "Release 2.0.0"
git push origin v2.0.0
git describe --tags
```

Tags aren't pushed automatically; push individually or with `--tags`. Treat published tags as immutable: moving them breaks reproducibility, since fetch will not overwrite an existing local tag without force. Issue a new tag instead.

### How do git submodules work and what problems do they cause?
<!-- level: advanced; kind: concept; ref: https://git-scm.com/book/en/v2/Git-Tools-Submodules -->
A submodule is a nested repository whose exact commit is recorded in the parent as a gitlink, with its URL in `.gitmodules`. The parent pins a version, not a branch. Cloning needs `--recurse-submodules` (or `git submodule update --init --recursive`).

Workflow for changes: commit and push inside the submodule first, then commit the updated pointer in the parent. Problems: people forget to push the submodule commit, leaving unresolvable pointers; submodules sit in detached HEAD, confusing newcomers; CI needs credentials and an init step; and merges of pointer changes can conflict.

Alternatives: `git subtree`, package managers (npm, Composer, Go modules), or a monorepo. Submodules are suitable when you truly need a pinned, separately-versioned source dependency.

### What does git reflog do and how does it help you recover work?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/docs/git-reflog -->
The reflog is a local log of where HEAD and branch tips pointed, recorded on every move (commit, checkout, reset, rebase, merge, pull). Even when commits become unreachable from any branch, the reflog keeps references for 30 to 90 days by default, so you can find them and restore.

```bash
git reflog
git branch rescue HEAD@{3}
git reset --hard HEAD@{1}
```

It is local only: not pushed and not shared. It cannot recover uncommitted changes that were never staged. `git fsck --lost-found` can find dangling objects when the reflog doesn't help. State clearly that "committed work is almost never lost" and describe a concrete recovery after a bad `reset --hard` or deleted branch.

### What is the difference between git pull --rebase and git pull (merge)?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/docs/git-pull#Documentation/git-pull.txt---rebasefalsetruemergesinteractive -->
Both fetch the upstream. Plain pull merges the upstream into your branch, producing a merge commit when histories diverged. `pull --rebase` replays your local unpushed commits on top of the updated upstream, giving linear history without a merge commit.

Rebasing local-only commits is safe because nobody else has them. It avoids the clutter of "Merge branch 'main' of origin" commits. The downside is that conflicts are resolved per replayed commit and the commit IDs change.

Configure it with `git config --global pull.rebase true` (and optionally `rebase.autoStash true`). `pull.rebase=merges` preserves local merge commits. A good answer notes that if you have already pushed those commits, you should not rebase them.

### How do you undo a pushed commit on a shared branch?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/docs/git-revert -->
Use `git revert <sha>` and push the new inverse commit. It's a normal fast-forward push, requires no coordination and leaves an audit trail. For a merge commit use `git revert -m 1 <merge-sha>`.

Rewriting with reset and force-push should be reserved for exceptional cases (leaked secret, huge file), and done with `--force-with-lease`, after warning the team and with branch protection temporarily adjusted. Collaborators must then reset or rebase their local copies.

```bash
git revert abc1234
git push origin main
```

If the bad commit contains a credential, rotate it first; reverting leaves it in history. After reverting a merge, remember you must revert the revert before re-merging that branch.

### What are shallow and partial clones, and when are they appropriate?
<!-- level: intermediate; kind: concept; ref: https://git-scm.com/docs/git-clone -->
A shallow clone (`--depth N`) truncates history to the last N commits, reducing transfer size, ideal for CI jobs that only build the latest commit. A partial clone (`--filter=blob:none` or `tree:0`) keeps full commit history but downloads file contents (or trees) on demand from the server, good for large repositories where you need history queries but not all blobs.

```bash
git clone --depth 1 <url>
git clone --filter=blob:none <url>
git fetch --unshallow
```

Combine partial clone with sparse checkout to also limit the working tree. Trade-offs: shallow clones break `git describe`, blame and merge-base computation; partial clones need network access when historical content is requested and server support. A good answer names the use case for each.

### How do you keep a feature branch up to date with main?
<!-- level: basic; kind: concept; ref: https://git-scm.com/book/en/v2/Git-Branching-Rebasing -->
Two options. Rebase: `git fetch origin && git rebase origin/main` replays your commits on the new main tip, keeping history linear; push with `--force-with-lease` if the branch was already pushed and only you use it. Merge: `git merge origin/main` brings main into your branch with a merge commit, safe if others share the branch.

Do it regularly, so conflicts stay small, and always before opening or merging a pull request. Run tests afterwards. Enabling `rerere` saves repeated conflict resolutions in long branches.

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

Say which you use and why: rebase for private topic branches, merge for shared branches, and avoid merging main into a branch repeatedly if the team wants linear history.

### How does Git detect renames, and what does that mean for history?
<!-- level: advanced; kind: concept; ref: https://git-scm.com/docs/git-diff#Documentation/git-diff.txt--Mltngt -->
Git does not record renames. Each commit is a full snapshot, and tools infer renames by comparing the trees of two commits: a deleted path and a new path with identical or sufficiently similar content (default 50% similarity) are reported as a rename. Merge uses the same detection to apply changes to the renamed file.

```bash
git log --follow -p -- new/path.txt
git diff -M --stat HEAD~1
git blame -C file
```

Consequences: `git log` stops at a rename unless you pass `--follow` (single file); heavily editing a file while moving it in one commit can defeat detection and cause delete/add conflicts. Best practice: move files in a pure rename commit, then change contents in the next. Mentioning `merge.renamelimit` and the `ort` strategy's improved rename handling is a bonus.

### How would you explain Git's three-way merge algorithm?
<!-- level: advanced; kind: concept; ref: https://git-scm.com/docs/git-merge#_how_conflicts_are_presented -->
Git finds the merge base: the best common ancestor of the two tips (`git merge-base A B`). It then compares base to each tip. For each region: if only one side changed it, take that change; if both changed it identically, take it once; if both changed it differently, it's a conflict. Renames, deletions and mode changes follow similar rules.

When there are several equally good ancestors (criss-cross merges), the older `recursive` strategy merged them into a virtual base; the default `ort` strategy (Git 2.34+) does the same, with better performance and rename handling.

```bash
git merge-base main feature
git merge -s ort -X patience feature
```

The key insight is that the base tells Git which side's change was intentional: without it, a two-way diff can't know whether a line was added or removed.
