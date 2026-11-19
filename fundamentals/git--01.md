## 1. The object model

### Content-addressed storage
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Git-Internals-Git-Objects -->
Git is at heart a key-value store: every piece of content is stored under a key computed from a hash of that content. Identical content always gets the same ID, so Git deduplicates automatically, and any change to content changes its ID, which makes corruption detectable. Historically the hash is SHA-1; SHA-256 repositories exist as an opt-in format but interoperability with hosting providers is still limited.

You can see this directly with plumbing commands.

```bash
echo 'hello' | git hash-object --stdin
echo 'hello' | git hash-object -w --stdin   # also writes the object
git cat-file -p <id>
```

Objects live in `.git/objects`, loose at first (a zlib-compressed file per object) and later bundled into packfiles with delta compression by `git gc`.

Pitfalls:
- Treating the hash as a secret or a random ID; it is derived from content.
- Assuming file names are part of a blob; they are not, trees hold names.

Interview tip: explain that "Git stores snapshots, not diffs" and that deltas are only a storage optimisation in packfiles.

### Blobs, trees, commits and tags
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Git-Internals-Git-Objects -->
Git has four object types. A blob holds raw file contents. A tree lists names, modes and IDs of blobs and sub-trees, so it represents a directory. A commit points to one top-level tree (the snapshot), zero or more parent commits, author and committer identities, timestamps and a message. An annotated tag points to another object with a name, tagger and message.

```bash
git cat-file -p HEAD            # the commit
git cat-file -p HEAD^{tree}     # its root tree
git ls-tree -r HEAD             # all blobs recursively
```

Because a commit's ID covers its tree and its parents' IDs, history forms a Merkle DAG: changing an old commit changes every descendant ID. That is why rebasing "rewrites" history; it actually creates new commits.

Pitfalls: believing a commit stores a diff; renames are detected on demand by comparing snapshots, not recorded.

Interview tip: walk through what `git commit` creates: blobs for changed files, new trees up the path to the root, then a commit object, and finally moves the branch ref.

### Refs, HEAD and branches as pointers
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Git-Internals-Git-References -->
A ref is a human-readable name that points to an object ID, stored as a small file under `.git/refs/` (or in the packed-refs file). A branch is just a ref in `refs/heads/` pointing to a commit; a tag lives in `refs/tags/`; remote-tracking branches live in `refs/remotes/`. `HEAD` normally holds a symbolic reference to the current branch, for example `ref: refs/heads/main`.

```bash
cat .git/HEAD
git rev-parse HEAD
git symbolic-ref HEAD
git show-ref --heads
```

Committing moves the branch that HEAD points to forward by one commit. Creating a branch is therefore nearly free: it writes one 41-byte file.

Pitfalls: in detached HEAD state, HEAD points straight to a commit, so new commits are not on any branch and may be lost after switching unless you create a branch.

Interview tip: if asked why branches are cheap in Git but costly in older systems, answer that a branch is a movable pointer, not a copy of the tree.

### Commit ancestry and revision syntax
<!-- level: intermediate; ref: https://git-scm.com/docs/gitrevisions -->
Git has a compact language for naming commits. `HEAD~1` (or `HEAD~`) is the first parent of HEAD, `HEAD~3` goes back three first-parent steps, and `HEAD^2` means the second parent of a merge commit. `main..feature` selects commits reachable from `feature` but not from `main`; `main...feature` is the symmetric difference. `@` is shorthand for HEAD, and `:/text` finds the most recent commit whose message matches.

```bash
git log main..feature --oneline    # what feature adds
git diff main...feature            # changes since the merge base
git show HEAD~2:path/to/file
git rev-parse feature^{commit}
```

Understanding the difference between `~` and `^` matters on merge commits: `~` always follows first parents, `^N` selects among parents.

Pitfalls: confusing two-dot and three-dot in `git diff` versus `git log`; they mean different things in each command. In `git diff`, `A..B` is the same as `A B`, but `A...B` compares B to the merge base.

Interview tip: be ready to explain how to list commits on a branch that are not yet on the remote: `git log origin/main..HEAD`.

### Packfiles, garbage collection and integrity
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Internals-Packfiles -->
Loose objects are fine at first, but thousands of them waste space and slow transfers. `git gc` (also run automatically via `git gc --auto`) packs loose objects into packfiles, storing similar objects as deltas against each other, and removes unreachable objects older than the prune expiry (two weeks by default). Pack indexes (`.idx`) allow fast lookup.

```bash
git count-objects -vH
git gc --aggressive --prune=now   # rarely needed
git fsck --full                   # verify connectivity and hashes
git verify-pack -v .git/objects/pack/*.idx | head
```

Pitfalls:
- `--prune=now` can delete objects another concurrent process is about to reference.
- `--aggressive` is rarely worth the CPU and may make repositories no smaller.
- Dangling commits are not deleted immediately; reflog entries and the prune grace period protect them.

Interview tip: say that clone and fetch send thin packs negotiated from "have" and "want" lines, which is why incremental fetches are small.

## 2. The staging area

### The three trees: working tree, index, HEAD
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Git-Tools-Reset-Demystified -->
Git tracks three states of your project. HEAD is the last commit's snapshot. The index (staging area) is the proposed next commit, stored in `.git/index`. The working tree is the actual files on disk. `git status` compares them pairwise: HEAD to index gives "changes to be committed", and index to working tree gives "changes not staged".

```bash
git add file.txt         # working tree -> index
git commit               # index -> new commit, HEAD moves
git diff                 # working tree vs index
git diff --staged        # index vs HEAD
```

The index exists so you can craft commits deliberately and also so that Git can quickly detect changes via cached stat data.

Pitfalls: `git commit file.txt` (without `-a`) behaves differently from what many expect: it commits that file's working content and bypasses other staged changes in some modes (`--only` default). Prefer explicit staging.

Interview tip: the "three trees" model is the key to explaining reset, checkout, restore and stash.

### Staging parts of a file
<!-- level: basic; ref: https://git-scm.com/docs/git-add#_interactive_mode -->
`git add -p` (patch mode) lets you stage individual hunks, so one working file can contribute to several focused commits. Press `y` to stage, `n` to skip, `s` to split a hunk, and `e` to edit it manually. `git add -i` offers an interactive menu, and `git restore -p` and `git reset -p` unstage or discard selectively.

```bash
git add -p
git diff --staged
git commit -m "Validate email before saving"
git add -p
git commit -m "Refactor mailer"
```

Small, single-purpose commits are easier to review, revert and bisect.

Pitfalls:
- Untracked files are not offered by `add -p` unless you use `git add -N` (intent to add) first.
- After staging a partial hunk, tests ran on the working tree may not match what you commit; use `git stash --keep-index` to test the staged version.

Interview tip: mention atomic commits as the reason you use patch mode, tying it to cleaner `git bisect` results.

### .gitignore, exclude and tracked files
<!-- level: basic; ref: https://git-scm.com/docs/gitignore -->
`.gitignore` tells Git which untracked files to ignore. Patterns support `*`, `**`, a trailing `/` for directories, and `!` for negation. Rules are read from `.gitignore` files in the tree, from `.git/info/exclude` (private to your clone) and from the global file named by `core.excludesFile`. Ignore rules only affect untracked files: if a file is already tracked, adding it to `.gitignore` changes nothing.

```bash
echo 'node_modules/' >> .gitignore
git rm --cached secrets.env       # stop tracking, keep on disk
git check-ignore -v build/out.js  # why is this ignored?
git status --ignored
```

Pitfalls:
- A negation cannot re-include a file if a parent directory is excluded.
- Removing a committed secret with `rm --cached` leaves it in history, so rotate the secret.
- Platform files (`.DS_Store`) belong in your global ignore, not in every project.

Interview tip: `git check-ignore -v` is the quickest debugging tool for confusing ignore behaviour.

### Line endings and file modes
<!-- level: intermediate; ref: https://git-scm.com/docs/gitattributes -->
Mixed CRLF and LF line endings create noisy diffs. Git can normalise through `.gitattributes`, the portable and recommended mechanism, or via `core.autocrlf` (per-user). A typical `.gitattributes` has `* text=auto` plus explicit `eol` settings for scripts and `binary` markers for binary files. Git also records the executable bit, but not other permissions.

```gitattributes
* text=auto
*.sh text eol=lf
*.bat text eol=crlf
*.png binary
```

```bash
git add --renormalize .
git ls-files --eol
git update-index --chmod=+x script.sh
```

Pitfalls: relying on each developer's `core.autocrlf` leads to inconsistent results; a shell script committed with CRLF fails on Linux with `bad interpreter`. File mode changes from a Windows filesystem can show up as spurious diffs; `core.fileMode=false` is a workaround, not a cure.

Interview tip: commit `.gitattributes` so the repository, not individuals, defines line-ending policy.

## 3. Branching

### Creating, switching and deleting branches
<!-- level: basic; ref: https://git-scm.com/docs/git-switch -->
`git switch` (Git 2.23+) is the dedicated command for changing branches, and `git restore` handles files; both split up the overloaded `git checkout`. `git switch -c feature` creates and moves to a new branch from the current commit; `git branch -d name` deletes a merged branch while `-D` forces deletion.

```bash
git switch -c feature/login
git switch main
git branch -vv                  # show upstreams and ahead/behind
git branch -d feature/login     # refuses if unmerged
git branch --merged main        # candidates for cleanup
```

Switching branches updates the index and working tree to the target snapshot, and it refuses if local changes would be overwritten.

Pitfalls: deleting a branch with unmerged commits makes them reachable only via reflog; note the abbreviated ID printed by `-D` so you can recover it.

Interview tip: be able to say that `checkout` still works and is equivalent, but `switch`/`restore` have clearer semantics and are marked experimental in older docs.

### Upstream tracking branches
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Branching-Remote-Branches -->
A local branch can have an upstream: the remote-tracking branch it normally syncs with. It lets `git status` report "ahead 2, behind 1" and makes bare `git pull` and `git push` know where to go. `git push -u origin feature` sets the upstream on the first push. Remote-tracking branches such as `origin/main` are read-only local bookmarks updated by `git fetch`.

```bash
git push -u origin feature
git branch --set-upstream-to=origin/main main
git branch -vv
git config push.autoSetupRemote true   # Git 2.37+
```

Pitfalls: `origin/main` is your last-known snapshot of the remote, not live state; it can be stale until you fetch. `push.default` (default `simple`) refuses to push to a differently named upstream.

Interview tip: explain that `git pull` is `git fetch` followed by merge (or rebase when `pull.rebase` is set), so fetching first and inspecting is a safer habit.

### Fast-forward and three-way merges
<!-- level: basic; ref: https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging -->
If the target branch has no new commits since your branch started, `git merge` simply moves the pointer forward (fast-forward); no new commit is created. Otherwise Git performs a three-way merge using the merge base (common ancestor) plus the two branch tips and records a merge commit with two parents.

```bash
git switch main
git merge feature            # ff if possible
git merge --no-ff feature    # always create a merge commit
git merge --ff-only feature  # fail unless fast-forward
git merge-base main feature
```

`--no-ff` preserves the fact that a group of commits was a feature branch, useful for revert-as-a-unit. `--ff-only` guards a protected branch from unplanned merge commits.

Pitfalls: the default merge strategy is `ort` (Git 2.34+, replacing `recursive`), which handles renames well but cannot resolve semantic conflicts; always run tests after merging.

Interview tip: identify the merge base and say the algorithm compares each side with the base, accepting changes made by only one side.

### Detached HEAD
<!-- level: basic; ref: https://git-scm.com/docs/git-checkout#_detached_head -->
Checking out a commit, tag or remote-tracking branch directly puts you in detached HEAD: HEAD contains a commit ID instead of a branch name. This is useful for inspecting old code, building a release tag, or running bisect. Commits made here move only HEAD, so once you switch away they become unreachable except through the reflog.

```bash
git switch --detach v2.1.0
# experiment, then either:
git switch -c hotfix-2.1   # keep the work
git switch main            # abandon it
git reflog                 # find an abandoned commit
```

Pitfalls: users panic at the warning; it is not an error. The real danger is making commits and then switching away without a branch name.

Interview tip: the recovery recipe is `git reflog`, find the commit, `git branch rescue <id>`.

### Branch naming and long-lived versus short-lived branches
<!-- level: intermediate; ref: https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows -->
Branch names are free-form but conventions help: `feature/…`, `fix/…`, `release/…`, with ticket IDs for traceability. Slashes create ref directories, so you cannot have both `feature` and `feature/x`. Long-lived branches (`main`, `develop`, release branches) represent stable lines; short-lived topic branches isolate work and should be merged and deleted quickly.

```bash
git switch -c fix/1234-null-cart
git push -u origin fix/1234-null-cart
git push origin --delete fix/1234-null-cart
git remote prune origin       # drop stale remote-tracking refs
```

Pitfalls: long-lived feature branches drift from main, producing painful merges; integrate often or use feature flags. Case-insensitive file systems can clash on names that differ by case.

Interview tip: link branch lifetime to integration risk; short branches reduce conflict size and support continuous delivery.

### Comparing branches
<!-- level: intermediate; ref: https://git-scm.com/docs/git-log -->
Use `git log` with range syntax to see commit differences and `git diff` for content differences. `git log --left-right --cherry-pick main...feature` marks which commits exist on only one side, ignoring commits that are patch-equivalent (common after cherry-picks or rebases). `git range-diff` compares two versions of a series of commits, which is invaluable when reviewing a force-pushed branch.

```bash
git log --oneline --graph --decorate --all
git log --left-right --cherry-pick --oneline main...feature
git diff --stat main...feature
git range-diff main old-feature new-feature
```

Pitfalls: a plain `git diff main feature` includes changes made on main since the fork, confusing reviewers; use three dots for "what the branch introduces".

Interview tip: `git cherry -v main` lists commits not yet applied upstream by patch ID.
