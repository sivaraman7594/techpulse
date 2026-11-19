## 1. Merge versus rebase

### How rebase works
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Branching-Rebasing -->
`git rebase main` takes the commits on your current branch that are not on `main`, temporarily sets them aside, resets your branch to `main`, and replays each commit one by one as a new commit. The new commits have the same changes (roughly) but different parents and therefore different IDs. The result is a linear history with no merge commit.

```bash
git switch feature
git fetch origin
git rebase origin/main
# resolve conflicts, then:
git add .
git rebase --continue      # or --abort / --skip
```

Replaying means conflicts can occur at each step, and you may resolve the same conflict repeatedly; `git config rerere.enabled true` records and reuses resolutions.

Pitfalls: the old commits still exist in the reflog, but anyone who based work on them now has diverged history. `ORIG_HEAD` points to the pre-rebase tip so you can undo with `git reset --hard ORIG_HEAD`.

Interview tip: "rebase rewrites history by creating copies" is the one-line explanation interviewers want.

### The golden rule of rebasing
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Branching-Rebasing#_rebase_peril -->
Do not rebase commits that others may already have based work on, typically anything pushed to a shared branch. Rebasing replaces those commits; collaborators who pulled the old ones will see their history diverge, and a careless pull can duplicate commits.

It is safe, and encouraged, to rebase private topic branches. If you must update a pushed branch of your own after rebasing, use `--force-with-lease`, which refuses the push if the remote moved since you last fetched.

```bash
git push --force-with-lease origin feature
git push --force-with-lease=feature:abc1234 origin feature
```

Pitfalls:
- Plain `--force` can overwrite a teammate's push silently.
- `--force-with-lease` is weakened if a background process fetches automatically (some IDEs), because your remote-tracking ref then looks up to date.

Interview tip: explain "rewrite local, merge shared" as a team policy and mention protected branches that block force-pushes.

### Merge versus rebase: trade-offs
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Branching-Rebasing#_rebase_vs_merge -->
Merging preserves exact history including when branches diverged and joined; it is non-destructive and safe for shared branches, at the cost of merge commits that make graphs busier. Rebasing yields a linear, easier-to-read history and simpler bisecting, but rewrites commits and loses the context of the original branch point.

Common team policies: rebase topic branches onto main before review, then merge with `--no-ff` or squash-merge to main; or enforce linear history with fast-forward-only merges. Syncing a long-running branch with `main` by repeatedly merging main into it creates noisy "Merge branch main" commits, so many teams rebase instead.

```bash
git pull --rebase            # fetch + rebase local commits
git config --global pull.rebase true
git merge --no-ff feature
```

Pitfalls: conflicts after a rebase are resolved per commit, which can be harder than one merge resolution for long branches.

Interview tip: answer with context ("it depends on whether history is shared, and what the team values: traceability or readability") and name your default.

### Squash merging and interactive rebase
<!-- level: intermediate; ref: https://git-scm.com/docs/git-rebase#_interactive_mode -->
`git rebase -i HEAD~N` opens a todo list of the last N commits where you can `pick`, `reword`, `edit`, `squash`, `fixup`, `drop` or reorder lines. `fixup` is common with `git commit --fixup <id>` followed by `git rebase -i --autosquash`, which arranges fix commits automatically. `git merge --squash` combines a branch's changes into the index without a commit, letting you create a single commit on the target.

```bash
git commit --fixup 3f2a1c9
git rebase -i --autosquash origin/main
git merge --squash feature && git commit
```

Squash merges produce clean main history but discard individual commits, and later merges of the same branch may re-conflict because Git has no record that they were integrated.

Pitfalls: never use interactive rebase on commits already shared; also remember that `drop` removes work, recoverable via reflog.

Interview tip: mention `rebase --onto` for moving a branch from one base to another: `git rebase --onto main old-base feature`.

## 2. Conflicts

### Why conflicts happen and how to read markers
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging#_basic_merge_conflicts -->
A conflict occurs when both sides changed the same region of a file relative to the merge base, or one side edited what the other deleted or renamed. Git marks the file as unmerged and inserts markers.

```text
<<<<<<< HEAD
timeout = 30
=======
timeout = 60
>>>>>>> feature
```

Above the `=======` is your current side, below is the incoming side. Edit the file to the intended final content, remove all marker lines, then `git add` and commit (or `--continue`). During a rebase, "ours" and "theirs" swap meaning: ours is the branch being rebuilt onto, theirs is your own commit being replayed.

```bash
git status                   # lists unmerged paths
git diff --name-only --diff-filter=U
git merge --abort            # back out
```

Pitfalls: committing marker lines accidentally; add a pre-commit check. A clean textual merge can still be semantically broken, so run tests.

Interview tip: always mention the ours/theirs swap during rebase.

### diff3 and zdiff3 conflict style
<!-- level: intermediate; ref: https://git-scm.com/docs/git-config#Documentation/git-config.txt-mergeconflictStyle -->
With `merge.conflictStyle` set to `diff3` (or `zdiff3`, Git 2.35+) markers also show the common ancestor between `|||||||` and `=======`. Seeing the base lets you tell which side changed what, so you can combine them correctly rather than guessing. `zdiff3` additionally trims lines common to both sides from the conflict region, making it smaller.

```bash
git config --global merge.conflictStyle zdiff3
git checkout --conflict=diff3 file.txt   # re-create markers
```

Example output includes a middle block:

```text
<<<<<<< HEAD
retries = 5
||||||| base
retries = 3
=======
retries = 3
backoff = true
>>>>>>> feature
```

Here ours changed 3 to 5 and theirs added a line, so the correct result keeps both changes.

Pitfalls: tools that parse markers may not support the extra section.

Interview tip: say you enable diff3 because a two-way view hides intent.

### Resolution tools, rerere and strategy options
<!-- level: intermediate; ref: https://git-scm.com/docs/git-rerere -->
`git mergetool` launches a configured visual tool. `git checkout --ours file` or `--theirs file` takes one side for a whole file; `git merge -X ours` (a strategy option) prefers our side only in conflicting hunks, which is different from `-s ours` that discards the other branch's changes entirely while recording the merge. `rerere` ("reuse recorded resolution") remembers how you resolved a conflict and applies it automatically next time, handy when repeatedly rebasing or merging long-lived branches.

```bash
git config --global rerere.enabled true
git checkout --theirs path/file && git add path/file
git merge -X patience feature
git log --merge -p path/file    # commits involved in the conflict
```

Pitfalls: `-s ours` is dangerous because it silently drops the other branch's content; `-X ours` is not a free pass either because non-conflicting changes from theirs still merge.

Interview tip: be able to state the difference between `-s ours` and `-X ours`.

### Aborting and recovering from a bad merge
<!-- level: basic; ref: https://git-scm.com/docs/git-merge#_how_to_resolve_conflicts -->
If a merge or rebase goes wrong mid-way, `git merge --abort` or `git rebase --abort` restores the pre-operation state. After a completed but wrong merge that is not pushed, `git reset --hard ORIG_HEAD` (or to the reflog entry before the merge) undoes it. If it has been pushed, use `git revert -m 1 <merge-commit>` to create an inverse commit, where `-m 1` chooses the mainline parent to keep.

```bash
git merge --abort
git reset --hard ORIG_HEAD
git revert -m 1 <merge-sha>
```

Pitfalls: reverting a merge records that those changes were removed, so merging the same branch later will not bring them back; you must "revert the revert" first.

Interview tip: this "revert a revert" nuance is a common senior-level question.

## 3. Remotes and collaboration

### Remotes, fetch, pull and push
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Git-Basics-Working-with-Remotes -->
A remote is a named URL (usually `origin`). `git fetch` downloads new objects and updates remote-tracking branches without touching your working branch. `git pull` is fetch plus integrate (merge by default or rebase). `git push` uploads your commits and moves the remote branch if the update is a fast-forward.

```bash
git remote -v
git remote add upstream https://example.com/org/repo.git
git fetch --all --prune
git pull --ff-only
git push origin main
```

A rejected push ("non-fast-forward") means the remote has commits you lack: fetch and integrate, then push again.

Pitfalls: `git pull` can create unexpected merge commits; set `pull.ff only` or `pull.rebase` to make the behaviour explicit. `--prune` removes remote-tracking refs for branches deleted on the server.

Interview tip: describe fetch as safe and pull as "fetch plus a possibly surprising merge".

### Forks, upstream and pull requests
<!-- level: basic; ref: https://git-scm.com/book/en/v2/GitHub-Contributing-to-a-Project -->
In the fork workflow, you copy a project into your account, clone your fork (`origin`), and add the original as `upstream`. You create a topic branch, push it to your fork, and open a pull request (or merge request) back to the upstream repository. To stay current, fetch `upstream` and rebase or merge its main into your branch.

```bash
git remote add upstream https://example.com/org/repo.git
git fetch upstream
git switch main && git merge --ff-only upstream/main
git push origin main
```

Pull requests are a hosting-platform feature, not part of Git itself; Git's native equivalent is `git request-pull` and patch emailing (`git format-patch` and `git am`).

Pitfalls: working directly on your fork's `main` makes syncing messy; always branch.

Interview tip: be clear on what is Git (branches, remotes) versus what is a platform feature (PRs, reviews, checks).

### Push safety: protected branches and force-with-lease
<!-- level: intermediate; ref: https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegt -->
Servers can reject certain pushes through hooks or platform settings: branch protection can require pull requests, passing checks, signed commits, linear history, and block force-pushes and deletions. Locally, `git push --force-with-lease` is the safer force: it only overwrites if the remote ref still equals what your remote-tracking branch says. `--force-if-includes` (Git 2.30+) adds a check that your local branch has integrated that remote tip.

```bash
git push --force-with-lease --force-if-includes origin feature
git config receive.denyNonFastForwards true   # server-side
```

Pitfalls: scripts and aliases using `--force` bypass the safety net. Force-pushing to a shared branch forces everyone else to recover.

Interview tip: when asked "how do you fix a bad commit on main?", the right answer is revert, not force-push, unless it exposed a secret.

### Cloning options: shallow, partial and sparse
<!-- level: intermediate; ref: https://git-scm.com/docs/git-clone -->
Full clones copy all history. A shallow clone (`--depth 1`) fetches only recent commits, useful for CI. A partial clone (`--filter=blob:none` or `--filter=tree:0`) omits objects until needed, fetching them lazily from the server. Sparse checkout limits the working tree to chosen directories.

```bash
git clone --depth 1 --branch v1.4.0 https://example.com/org/repo.git
git clone --filter=blob:none https://example.com/org/big.git
git sparse-checkout set services/api docs
git fetch --unshallow
```

Pitfalls: shallow clones break commands that need history (`git describe`, blame, merge-base, version stamping), and shallow repos cannot always be pushed from. Partial clones require server support and network access when you touch old content.

Interview tip: for large monorepos mention partial clone plus sparse checkout, and for CI mention shallow clones with an explicit fetch-depth when the build needs tags.

## 4. Team workflows

### Trunk-based development
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Distributed-Git-Distributed-Workflows -->
In trunk-based development everyone integrates into a single main branch at least daily, using very short-lived branches (hours to a couple of days) or committing directly with strong tests. Unfinished functionality is hidden behind feature flags, so deployment is decoupled from release. It minimises merge pain and encourages continuous integration and delivery.

Requirements: fast automated tests, code review that doesn't block for days, and a flag system with cleanup discipline. Releases are cut as tags or short-lived release branches from main, with fixes cherry-picked as needed.

```bash
git switch -c small-change
git commit -am "Add flag-guarded export button"
git pull --rebase origin main
git push origin small-change   # PR merged within hours
```

Pitfalls: without flags and tests, trunk-based degrades into a broken main; stale flags accumulate as technical debt.

Interview tip: contrast it with GitFlow by integration frequency rather than by branch names.

### GitFlow and release branches
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows -->
GitFlow uses `main` for released code, `develop` as the integration branch, `feature/*` from develop, `release/*` for stabilisation, and `hotfix/*` from main. It suits versioned products with scheduled releases and multiple supported versions, but is heavy for web services deployed continuously: long-lived branches delay integration and create merge-back work.

Hotfix flow: branch from the production tag, fix, merge into main and tag, then merge into develop (or the active release branch) so the fix isn't lost.

```bash
git switch -c hotfix/1.4.1 v1.4.0
# fix, commit
git switch main && git merge --no-ff hotfix/1.4.1 && git tag -a v1.4.1 -m "Hotfix"
git switch develop && git merge --no-ff hotfix/1.4.1
```

Pitfalls: forgetting the merge-back; diverging develop and main.

Interview tip: describe when you would choose it (several maintained versions) and when you would not (SaaS with continuous delivery).

### Commit messages and history hygiene
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project -->
A good commit has one logical change and a message with an imperative subject of about 50 characters, a blank line, and a body explaining why, not just what. The diff already shows what changed; the message supplies intent, trade-offs, and links to issues. Conventions such as Conventional Commits (`feat:`, `fix:`) enable automated changelogs and versioning.

```text
Reject expired tokens before loading the user

Loading the user first leaked timing information about account
existence. Check expiry on the token alone, then fetch.

Refs: #482
```

Use `git commit --amend` for the latest commit and interactive rebase for earlier ones, before pushing. Use `git blame` and `git log -S` / `-G` for archaeology, which only works well with meaningful history.

Pitfalls: "fix stuff", giant mixed commits, and committing generated files.

Interview tip: say commits are for reviewers and future debuggers, and mention `git commit -v` to see the diff while writing.

### Code review and signing commits
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Tools-Signing-Your-Work -->
Git author fields are just text, so anyone can claim to be someone else. Signed commits and tags provide cryptographic provenance. Git supports GPG, SSH keys (`gpg.format ssh`, Git 2.34+) and X.509 signatures. Platforms display "verified" badges and branch protection can require signatures.

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git log --show-signature -1
git verify-commit HEAD
```

For verifying SSH signatures locally configure `gpg.ssh.allowedSignersFile`.

Pitfalls: rebasing re-signs commits only if signing is enabled, otherwise signatures are lost; a signature proves key possession, not the code's safety.

Interview tip: tie signing to supply-chain security, and note the cost: key management and developer friction.

## 5. Undoing changes

### reset: soft, mixed and hard
<!-- level: intermediate; ref: https://git-scm.com/docs/git-reset -->
`git reset <commit>` moves the current branch to `<commit>`. What happens to the index and working tree depends on the mode. `--soft` moves only the branch pointer, leaving changes staged. `--mixed` (default) also resets the index, leaving changes in the working tree unstaged. `--hard` resets index and working tree, discarding uncommitted changes.

```bash
git reset --soft HEAD~1     # undo commit, keep staged
git reset HEAD~1            # undo commit, keep unstaged
git reset --hard origin/main
git reset HEAD file.txt     # unstage a file (path form)
```

With paths, `git reset <path>` only copies from HEAD into the index (it never moves the branch).

Pitfalls: `--hard` destroys uncommitted work irrecoverably (committed work is recoverable via reflog). Resetting a pushed branch then forces a risky force-push.

Interview tip: map the modes onto the three trees: soft changes HEAD; mixed adds the index; hard adds the working tree.

### revert: undoing with a new commit
<!-- level: basic; ref: https://git-scm.com/docs/git-revert -->
`git revert <commit>` creates a new commit that applies the inverse of an earlier commit. History stays intact, so it is the right way to undo something already shared. You can revert a range, and use `-n` to apply the inverse to the working tree without committing, letting you combine several reverts.

```bash
git revert abc1234
git revert -n HEAD~3..HEAD
git revert -m 1 <merge-commit>   # merge commit: choose parent
```

Conflicts can occur if later changes touched the same lines; resolve as with a merge and `git revert --continue`.

Pitfalls: reverting a merge makes later re-merging of that branch skip the reverted changes, so revert the revert first. Reverting does not remove secrets from history.

Interview tip: say "reset rewrites, revert records". Choose revert on shared branches.

### restore and checkout for files
<!-- level: basic; ref: https://git-scm.com/docs/git-restore -->
`git restore` (Git 2.23+) copies file content from a source into the working tree and/or index. By default it restores the working tree from the index, discarding unstaged edits. `--staged` restores the index from HEAD (unstage). `--source=<commit>` picks another commit. `-p` does it by hunk.

```bash
git restore file.txt                  # discard unstaged changes
git restore --staged file.txt         # unstage
git restore --source=HEAD~2 file.txt  # bring back an older version
git restore --staged --worktree file.txt
```

The older `git checkout -- file` and `git reset HEAD file` do the same, but are overloaded.

Pitfalls: restoring the working tree is destructive and not recoverable if the changes were never staged or committed. `git clean -fd` removes untracked files similarly; use `-n` first for a dry run.

Interview tip: demonstrate the pair, `restore` for files and `switch` for branches, as the modern, less error-prone replacements.

### amend and fixing the last commit
<!-- level: basic; ref: https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---amend -->
`git commit --amend` replaces the tip commit with a new one containing the current index and optionally a new message. It is perfect for typos or forgotten files, as long as the commit isn't shared. `--no-edit` keeps the message, `--author` resets authorship, and `--reset-author` updates it to you.

```bash
git add forgotten.txt
git commit --amend --no-edit
git commit --amend -m "Correct message"
```

An amended commit has a new ID; the old one lingers in the reflog.

Pitfalls: amending after pushing requires a force-push and disrupts anyone who pulled. During a rebase, amending the wrong commit is common; use `edit` in interactive rebase rather than amending HEAD.

Interview tip: when asked how to fix a commit made on the wrong branch, answer: create or switch to the right branch (cherry-pick), then `git reset --hard HEAD~1` on the wrong one.

### clean: removing untracked files
<!-- level: basic; ref: https://git-scm.com/docs/git-clean -->
`git clean` deletes untracked files, which `reset --hard` and `restore` leave alone. Because deletions bypass history, they are not recoverable. Always run `-n` (dry run) first. `-f` is required, `-d` includes directories, `-x` also removes ignored files (build output), and `-i` is interactive.

```bash
git clean -nd         # preview
git clean -fd         # delete untracked files and dirs
git clean -fdx        # also ignored files: full reset of the tree
git clean -fdX        # only ignored files
```

Combine with `git reset --hard` to return a working directory to the exact state of a commit, common in CI.

Pitfalls: `-x` will delete local config, `.env` files and IDE settings listed in `.gitignore`. Nested repositories are skipped unless you pass `-ff`.

Interview tip: distinguish tracked versus untracked when explaining which command undoes what.
