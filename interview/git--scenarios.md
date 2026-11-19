### You ran git reset --hard and lost three commits you hadn't pushed. How would you get them back?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/git-reflog -->
Observe: `git log` no longer shows the commits, but nothing was deleted from the object database yet; `reset --hard` only moved the branch pointer.

Hypothesise: the commits are unreachable from any branch but still referenced by the reflog.

Verify: run `git reflog` and look for the entry just before "reset: moving to ...". Check with `git show HEAD@{1}` or `git log -1 <sha>` that it is the right tip.

Fix: move the branch back, or create a rescue branch first to be safe.

```bash
git reflog
git branch rescue HEAD@{1}
git reset --hard rescue
```

If the reflog doesn't have it (different clone, expired), use `git fsck --lost-found` to find dangling commits. Only changes that were never committed or staged are truly gone.

Prevent: commit early, even to a temporary branch; use `git stash` before experiments; prefer `git restore` and `git switch` over `reset --hard`; consider an alias that runs `git status` first. For shared branches use `revert` instead.

Common wrong answers: "they are gone forever", re-typing the work from memory, or running `git gc --prune=now`, which can delete the dangling commits you are trying to recover.

### A teammate force-pushed to main and your recent commits vanished from the remote. What do you do?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegt -->
Observe: `git fetch` shows `+ abc..def main -> origin/main (forced update)`; history of origin/main no longer contains commits that were there.

Hypothesise: someone rewrote main (rebase, amend, or push of an older state) and overwrote commits.

Verify: the previous tip is in your remote-tracking reflog: `git reflog show origin/main`. Compare with `git log origin/main@{1}..origin/main` and ask the author what they intended. Hosting platforms usually list push events with before and after SHAs.

Fix: stop others from pushing while you coordinate. Identify the last good SHA, then restore main with a deliberate push from someone with permission.

```bash
git reflog show origin/main
git branch backup-main origin/main@{1}
git push --force-with-lease=main:<bad-sha> origin backup-main:main
```

If the rewrite was intentional, rebase your local commits onto the new main: `git rebase --onto origin/main <old-base> mybranch`.

Prevent: branch protection that blocks force-push on main, require pull requests, use `--force-with-lease` for topic branches, and educate on the golden rule.

Wrong answers: re-force-pushing your own copy over theirs without coordination, which repeats the damage.

### Your pull request has merge conflicts with main in 14 files after two weeks of work. How do you handle it?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/git-rerere -->
Observe: the platform reports conflicts; `git merge origin/main` locally shows the list with `git diff --name-only --diff-filter=U`.

Hypothesise: long-lived branch drift, plus possibly a large refactor or rename on main.

Verify: inspect what changed upstream with `git log --oneline HEAD..origin/main --stat`, and see which files are conflicting by both content and rename.

Fix: enable better tooling, then resolve methodically. Use `merge.conflictStyle zdiff3` to see the base, resolve one file at a time, and run tests between groups. If the branch has many commits touching the same lines, a merge (one resolution session) is usually easier than rebase (per-commit conflicts); enable `rerere` if you'll retry.

```bash
git config rerere.enabled true
git config merge.conflictStyle zdiff3
git fetch origin && git merge origin/main
# resolve, run tests
git add -A && git commit
```

Talk to the owners of the conflicting upstream change where intent is unclear.

Prevent: integrate main daily, split the work into smaller PRs, use feature flags, and agree on ownership of refactors.

Wrong answers: accepting "ours" for every file, or force-pushing a copy of main with your files pasted on top.

### You committed a password to a public repository and pushed. What are your steps?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/docs/git-filter-branch#_warning -->
Observe: the secret is in a commit that has been pushed and may be cloned, forked, cached by bots or visible in pull request refs.

Hypothesise: it is already compromised; automated scrapers find leaked keys within minutes.

Verify: find every commit and file containing it: `git log -S'the-password' --all`. Check forks and whether it exists in other branches or tags.

Fix, in order: first rotate and revoke the credential and review access logs for misuse. Then remove it from the code (read from environment or a secret manager). Then, as hygiene, purge history with `git filter-repo`, force-push all refs, ask the host to clear cached refs and open PRs, and have collaborators re-clone.

```bash
git clone --mirror <url> clean.git && cd clean.git
git filter-repo --replace-text ../expressions.txt
git push --force --all && git push --force --tags
```

Prevent: pre-commit secret scanners (gitleaks, detect-secrets), push protection on the host, `.gitignore` for env files, and short-lived credentials.

Wrong answers: only deleting the file in a new commit, or rewriting history without rotating the secret; the leak must be treated as permanent.

### git push is rejected with "non-fast-forward". What does it mean and how do you proceed?
<!-- level: basic; kind: scenario; ref: https://git-scm.com/docs/git-push#_note_about_fast_forwards -->
Observe: `! [rejected] main -> main (fetch first)` or `(non-fast-forward)`.

Hypothesise: the remote branch contains commits you don't have locally, so moving it to your tip would discard them; or you rewrote local history (rebase, amend) after pushing.

Verify: `git fetch` then `git log --oneline --graph --all`, or `git status` to see "ahead 1, behind 2". Compare `git log HEAD..origin/main` to see what you lack.

Fix: if you just missed upstream commits, integrate them and push: `git pull --rebase` (for local-only commits) or `git merge origin/main`, then push normally. If you intentionally rewrote your own branch, and nobody else uses it, push with `--force-with-lease`.

```bash
git fetch
git rebase origin/main
git push
```

Prevent: pull before starting work, avoid amending pushed commits, protect shared branches.

Wrong answers: reaching for `git push --force` immediately, which can erase a teammate's commits, or deleting and re-cloning the repository, which loses unpushed work.

### You made commits directly on main that should have been on a feature branch. How do you fix it?
<!-- level: basic; kind: scenario; ref: https://git-scm.com/docs/git-branch -->
Observe: `git status` says main is ahead of origin/main by three commits; they haven't been pushed.

Hypothesise: simple branch mix-up; the commits just need a new home and main needs to go back.

Verify: `git log origin/main..main --oneline` lists exactly the commits to move.

Fix: create the branch at the current tip (so the commits are safe), then move main back to the remote state.

```bash
git branch feature/export          # keeps the commits
git reset --hard origin/main       # main back to remote state
git switch feature/export
```

If you only want part of them, create the branch from `origin/main` and `git cherry-pick` the specific commits. If the commits were already pushed to main, don't reset; revert them on main and re-apply on the feature branch with cherry-pick.

Prevent: branch protection requiring pull requests so main cannot be pushed directly, and a prompt or `status` habit showing the current branch.

Wrong answers: copying files out by hand, or resetting main before creating the branch, relying on the reflog to restore.

### Your build broke somewhere in the last 200 commits. How do you find the culprit efficiently?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/git-bisect -->
Observe: tests pass at release tag v3.2 and fail at HEAD; nobody knows which commit introduced it.

Hypothesise: a single commit changed behaviour, discoverable by binary search.

Verify: confirm the test fails reliably at HEAD and passes at the tag, since flaky tests wreck bisect.

Fix: run bisect with an automated script, about eight steps for 200 commits.

```bash
git bisect start HEAD v3.2
git bisect run sh -c 'make build && ./run_tests.sh checkout'
git bisect log
git bisect reset
```

Use exit code 125 in the script for commits that fail to build for unrelated reasons so they are skipped. When bisect names a merge commit, bisect inside the merged branch range. Read the culprit with `git show <sha>` and decide between fix-forward and `git revert`.

Prevent: keep commits small and buildable, run CI on every commit of a PR (not only the tip), and add a regression test with the fix.

Wrong answers: reading through 200 diffs by hand, or checking out commits randomly. Another trap: bisecting with a test that depends on code under test being bisected (copy the script outside the repo).

### A large binary file was committed months ago and the repository is now 2 GB. How do you slim it down?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/docs/git-count-objects -->
Observe: clones are slow; `git count-objects -vH` shows a large pack.

Hypothesise: historical blobs of big files (videos, builds, database dumps) are kept forever because every commit referencing them keeps them reachable.

Verify: list the biggest blobs in history.

```bash
git rev-list --objects --all \
 | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
 | awk '$1=="blob"' | sort -k3 -n -r | head
```

Fix: decide between removal and moving to Git LFS. Rewrite history on a mirror clone with `git filter-repo --strip-blobs-bigger-than 20M` (or `--path` removal, or `git lfs migrate import`), expire reflogs, `git gc --prune=now --aggressive`, then force-push and require everyone to re-clone. Coordinate: open PRs, signatures and commit references break.

Prevent: `.gitignore` for build output, LFS rules in `.gitattributes`, a pre-receive size limit, and storing artefacts in object storage.

Wrong answers: deleting the file in a new commit (history still holds it), or running `git gc` and expecting it to shrink.

### Git is very slow in your monorepo. How do you diagnose and speed it up?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/docs/git-maintenance -->
Observe: determine which operation is slow: clone, `git status`, `checkout`, `log`, or `fetch`.

Hypothesise: status is slow due to scanning many files; clone is slow due to history size; log is slow without commit-graph.

Verify: use `GIT_TRACE_PERFORMANCE=1 git status` and `git count-objects -vH`; check antivirus scanning, network file systems, and whether `core.fsmonitor` is on.

Fix by symptom:
- Status: enable the built-in filesystem monitor and untracked cache.
- Clone: partial clone plus sparse checkout; shallow clones in CI.
- History queries: write the commit graph and schedule maintenance.

```bash
git config core.fsmonitor true
git config core.untrackedCache true
git commit-graph write --reachable
git maintenance start
git clone --filter=blob:none --sparse <url>
```

Exclude the repository from real-time antivirus scanning, keep it on local disk.

Prevent: set `feature.manyFiles`, monitor repository growth, and avoid committing generated artefacts.

Wrong answers: running `git gc --aggressive` repeatedly, or splitting the repository before measuring what is slow.

### You need to apply a hotfix to production while your working tree is full of unfinished changes. How?
<!-- level: basic; kind: scenario; ref: https://git-scm.com/docs/git-worktree -->
Observe: uncommitted modifications on a feature branch; production runs tag v1.8.0 and needs a fix now.

Hypothesise: you need an isolated checkout of the production code without disturbing the half-finished work.

Verify: `git status` and `git stash list` to understand your state; confirm the deployed tag with `git describe`.

Fix: use a worktree so both states coexist.

```bash
git worktree add -b hotfix/1.8.1 ../hotfix v1.8.0
cd ../hotfix
# fix, test
git commit -am "Fix null discount crash"
git push -u origin hotfix/1.8.1
git tag -a v1.8.1 -m "Hotfix"
```

Alternatively, `git stash push -u -m wip`, switch, fix, switch back and `git stash pop`. After release, merge or cherry-pick the fix into main so it is not lost, and remove the worktree.

Prevent: keep release branches or tags buildable, document the hotfix flow, and avoid long-running uncommitted work.

Wrong answers: committing broken WIP to main, or editing production files by hand and copying them back.

### A submodule pointer in your project points to a commit that cannot be fetched. What happened?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/book/en/v2/Git-Tools-Submodules -->
Observe: `git submodule update` fails with "fatal: reference is not a tree" or "not our ref".

Hypothesise: a teammate committed the new submodule pointer in the parent without pushing the commit inside the submodule, or the submodule's history was force-pushed.

Verify: `git submodule status` shows the expected SHA; inside the submodule `git cat-file -t <sha>` fails; check the submodule remote's branches with `git ls-remote`.

Fix: ask the author to push the submodule commit (`git push` inside the submodule). If it is gone, recover it from their clone or reflog; otherwise move the pointer to a known-good commit, commit it, and push.

```bash
git submodule status
cd vendor/lib && git fetch origin && git cat-file -t <sha>
cd .. && git add vendor/lib && git commit -m "Point lib at published commit"
```

Prevent: set `push.recurseSubmodules=check` (or `on-demand`) so a parent push refuses unless the submodule commits are published, and use CI to run `git submodule update --init` on every build.

Wrong answers: deleting `.gitmodules` entries blindly, or re-adding the submodule from scratch, losing the pinned version.

### CI is checking out only the latest commit and git describe fails. What is wrong?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/git-describe -->
Observe: version stamping outputs `fatal: No names found, cannot describe anything` or an unexpected hash-only string.

Hypothesise: CI uses a shallow clone (`--depth 1`) without tags, so nearest tag history isn't present.

Verify: run `git rev-parse --is-shallow-repository` and `git tag | head` in the job.

Fix: fetch tags and enough history in the CI configuration, or use an explicit command.

```bash
git fetch --tags --unshallow    # or --depth=200
git describe --tags --always --dirty
```

In many CI systems this means setting the fetch depth to 0 (full) for the version-stamping job only, or fetching tags explicitly. Alternatively compute version from an environment variable injected by the pipeline.

Prevent: document which jobs need history; keep shallow clones for tests and builds that don't need it; use `--always` to fall back to a hash.

Wrong answers: hard-coding version strings, or switching everything to full clones and slowing every job.

### A file changed permissions or line endings and the whole file shows as modified. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/gitattributes -->
Observe: `git diff` shows every line changed, or `old mode 100644, new mode 100755`.

Hypothesise: CRLF/LF conversion differences between developers' machines (autocrlf), or a filesystem that cannot represent the executable bit.

Verify: `git diff --stat`, `git ls-files --eol file`, and `git diff -w` or `--ignore-space-at-eol` to confirm only whitespace differs; `git config core.autocrlf` and `core.fileMode`.

Fix: define the policy in the repository, then renormalise once.

```gitattributes
* text=auto
*.sh text eol=lf
```

```bash
git add --renormalize .
git commit -m "Normalise line endings"
git update-index --chmod=+x scripts/run.sh
```

Tell the team to pull and refresh their working trees. For mode noise on Windows mounts, `core.fileMode=false` is a local workaround.

Prevent: commit `.gitattributes`, set an `.editorconfig`, and add a CI check for CRLF in shell scripts.

Wrong answers: each developer toggling `autocrlf` until their diff looks clean, or committing mixed conversions repeatedly.

### You need to find when a specific line of config was introduced and who changed it last. How?
<!-- level: basic; kind: scenario; ref: https://git-scm.com/docs/git-blame -->
Observe: a setting `maxRetries = 0` causes a bug; you need context.

Hypothesise: a recent change, possibly bundled in a refactor, altered it; blame may point to a formatting commit.

Verify and fix, step by step:

```bash
git blame -w -C -L '/maxRetries/,+1' config/app.ini
git log -S"maxRetries = 0" --oneline -- config/app.ini
git log -L '/maxRetries/,+1:config/app.ini'
git show <sha>
```

`-w` ignores whitespace changes, `-C` follows moved lines, and `-S` (pickaxe) finds the commit that added or removed the string, even when blame is obscured by later edits. Add reformat commits to `.git-blame-ignore-revs` and configure `blame.ignoreRevsFile`. Read the commit message and linked ticket to learn intent before changing it.

Prevent: write messages that explain why, and keep refactors separate from behavioural edits.

Wrong answers: using only `git log` for the entire file, or assuming blame's author wrote the logic originally rather than last touched the line.

### Your feature branch has 12 messy "wip" and "fix typo" commits. How do you clean it up before review?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/git-rebase#_interactive_mode -->
Observe: `git log --oneline origin/main..HEAD` shows noisy history; none of it is shared yet (or only on your own remote branch).

Hypothesise: you need to group changes into a few logical commits.

Verify: confirm nobody else has based work on this branch; take a safety copy: `git branch backup/feature`.

Fix: interactive rebase against the base.

```bash
git rebase -i origin/main
# pick  a1 Add export endpoint
# fixup b2 fix typo
# fixup c3 wip
# reword d4 Add CSV streaming
git push --force-with-lease
```

For future work use `git commit --fixup <sha>` and `git rebase -i --autosquash`. If you want a single commit, `git reset --soft origin/main && git commit` achieves the same. Run tests after rewriting.

Prevent: commit atomically from the beginning with `git add -p`; or accept noisy branches and rely on squash merge.

Wrong answers: rebasing a branch others have pulled, or using `--force` instead of `--force-with-lease`.

### Reverting a merged feature branch worked, but re-merging it later brought none of the code back. Why?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/docs/git-merge#_undoing_a_merge -->
Observe: after `git revert -m 1 <merge>` and a later `git merge feature`, Git says "Already up to date" or only brings new commits.

Hypothesis: Git's merge algorithm sees the feature's commits as already merged into main (they are ancestors), so it only considers commits added since. The revert is just a later commit removing those changes, which Git does not "undo" automatically.

Verify: `git merge-base main feature` returns the old feature tip; `git log main..feature` shows only new commits.

Fix: revert the revert first, which reapplies the original changes, then merge the updated branch.

```bash
git revert <revert-commit-sha>      # re-introduces the feature
git merge feature                   # brings new work
```

Alternatively, create a fresh branch by cherry-picking or rebasing the feature commits onto main so they become new commits.

Prevent: communicate that reverting a merge is a statement about the changes, not about history; prefer fixing forward or using feature flags.

Wrong answers: re-merging repeatedly, or force-pushing to erase the revert.

### Someone asks you to split a repository's subdirectory into its own repo while keeping history. How?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/book/en/v2/Git-Tools-Submodules -->
Observe: `services/billing/` has two years of history inside a monorepo and must become an independent repository.

Hypothesise: you need to extract only commits that touched that path, rewriting paths so it is at the root.

Verify: `git log --oneline -- services/billing | wc -l` shows the history size; check for files outside the directory it depends on.

Fix: operate on a fresh clone so the original is untouched.

```bash
git clone <monorepo-url> billing-only && cd billing-only
git filter-repo --subdirectory-filter services/billing
git remote add origin <new-url>
git push -u origin --all && git push --tags
```

Alternatively `git subtree split -P services/billing -b billing-split` produces a branch with the extracted history without installing extra tooling. Then replace the directory in the monorepo with a dependency or submodule, and update CI and ownership files.

Prevent: plan module boundaries early; document where history lives after the split.

Wrong answers: copying files into a new repo (loses blame and history), or running filter-branch on the only copy.

### A rebase produces the same conflict over and over on each commit. What do you do?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/git-rerere -->
Observe: `git rebase origin/main` stops at commit after commit, each conflicting in the same lines.

Hypothesise: several of your commits touch the same hunk that upstream rewrote, so you resolve the same overlap per replay.

Verify: `git status` during the rebase and `git log origin/main --stat -- file` showing a large refactor upstream.

Fix options: abort and take a different route. `git rebase --abort`; then either squash your commits first (`git reset --soft $(git merge-base HEAD origin/main) && git commit`) so there is one conflict resolution, or merge main into the branch once. Or enable `rerere` so Git replays recorded resolutions automatically.

```bash
git config rerere.enabled true
git rebase origin/main      # resolve once; reused for repeats
```

Prevent: rebase more frequently, make smaller commits, and coordinate large refactors by announcing them and landing them quickly.

Wrong answers: skipping commits with `git rebase --skip` to make the pain go away (drops your work), or force-resolving with `--theirs` blindly.

### Two developers edited the same file and you need to combine their changes but keep specific versions of one file. How?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/git-checkout#Documentation/git-checkout.txt---ours -->
Observe: during `git merge`, `schema.sql` conflicts and the team agrees the incoming branch's version is canonical, while all other files should merge normally.

Hypothesise: per-file resolution is required; you want theirs for one path only.

Verify: `git status` lists `schema.sql` as "both modified" and shows other conflicts separately.

Fix: take the incoming file wholesale, mark resolved, then handle the others.

```bash
git checkout --theirs schema.sql
git add schema.sql
# resolve remaining files by hand
git commit
```

In a rebase, remember the inversion: `--ours` is the branch you rebase onto and `--theirs` is your own commit. For recurring cases (generated files, lockfiles) define a custom merge driver in `.gitattributes` or regenerate them after merging.

Prevent: avoid committing generated files in conflict-prone places, regenerate lockfiles with the package manager rather than hand-merging.

Wrong answers: using `git merge -s ours`, which discards everything from the other branch, or `-X theirs` globally.

### Your git clone of a repository with Git LFS files shows tiny text files instead of images. Why?
<!-- level: intermediate; kind: scenario; ref: https://git-lfs.com -->
Observe: files contain `version https://git-lfs.github.com/spec/v1` and an `oid sha256:` line.

Hypothesise: they are LFS pointer files; either the LFS client isn't installed or hooks were not set up, or the smudge filter failed (authentication or quota).

Verify: `git lfs version`; `git lfs ls-files`; `git lfs env` to see endpoint; `git lfs fsck`.

Fix: install the client, initialise filters, and download the content.

```bash
git lfs install
git lfs pull
git lfs ls-files
```

In CI ensure the checkout step enables LFS and has credentials; if the server returns 403 or bandwidth quota errors, fix permissions or quota.

Prevent: document the LFS requirement in the README, add `lfs: true` or equivalent to CI checkouts, and use `git lfs track` rules in `.gitattributes` committed with the files.

Wrong answers: committing the pointer files as if they were the assets, or adding the images normally, which bloats history.

### You accidentally committed node_modules (or build output) and pushed. How do you stop tracking it?
<!-- level: basic; kind: scenario; ref: https://git-scm.com/docs/gitignore -->
Observe: huge diffs and slow clones; `git ls-files | grep node_modules | head` shows tracked files.

Hypothesise: the directory was added before `.gitignore` existed; adding patterns afterwards doesn't affect tracked files.

Verify: `git check-ignore -v node_modules/x.js` reports nothing for tracked files; `git ls-files node_modules | wc -l`.

Fix: untrack but keep on disk, add ignore rules, commit.

```bash
echo "node_modules/" >> .gitignore
git rm -r --cached node_modules
git commit -m "Stop tracking node_modules"
```

This shrinks future commits but history still contains the files; if size matters, purge with `git filter-repo --path node_modules --invert-paths` and coordinate a force-push.

Prevent: start repos from a language-appropriate `.gitignore`, review `git status` before first commit, and add a CI check rejecting forbidden paths.

Wrong answers: deleting the folder from disk without `--cached`, then breaking teammates' installs, or expecting `.gitignore` to remove already-tracked files.

### You want to review a colleague's pull request locally and also keep working. What's the cleanest way?
<!-- level: basic; kind: scenario; ref: https://git-scm.com/docs/git-worktree -->
Observe: your working tree has uncommitted work; the PR is on a branch `alice/search`.

Hypothesise: you need a separate checkout rather than stashing or committing junk.

Verify: `git fetch origin alice/search` and `git log origin/alice/search --oneline` to see commits.

Fix: create a worktree for the review.

```bash
git fetch origin
git worktree add ../review-search origin/alice/search
cd ../review-search
npm test        # or run the app
cd - && git worktree remove ../review-search
```

On GitHub you can also fetch PR refs: `git fetch origin pull/123/head:pr-123`. Use `git diff origin/main...origin/alice/search` to see only the PR's changes and `git range-diff` for revised versions.

Prevent: keep your own WIP committed on a branch so that switching is harmless.

Wrong answers: `git checkout` with dirty changes (fails or carries edits into the review), or `git stash` and forgetting the stash.

### After a merge, the app compiles but behaves wrongly, though Git reported no conflicts. Why?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging -->
Observe: a clean merge with passing textual checks, yet a regression appears: for example, a function signature changed on one side while the other added a new caller.

Hypothesise: a semantic conflict. Git merges text, not meaning; non-overlapping edits can combine into broken logic.

Verify: `git diff <merge>^1 <merge>` and `git diff <merge>^2 <merge>` show what each side gained; run tests on the merge commit; `git log --merge` is for conflicts only. Use `git show --cc <merge>` to inspect combined diffs.

Fix: correct forward with a follow-up commit (or amend the merge if not pushed), adding a test that fails before the fix.

```bash
git show --cc <merge-sha>
git bisect start <merge-sha> <good-sha>
```

Prevent: CI that tests the merge result (merge queue or "merge ref" builds), small frequent merges, strong typing and tests, and review of both branches' changes together.

Wrong answers: "Git said no conflicts, so it must be correct", or reverting the whole merge before understanding the interplay.

### A hook blocks your commit because of lint errors, but the files look fine. How do you investigate?
<!-- level: basic; kind: scenario; ref: https://git-scm.com/docs/githooks#_pre_commit -->
Observe: `git commit` fails with a hook error; running the linter manually passes.

Hypothesise: the hook lints the staged version (index) rather than your working tree, so unstaged fixes are not seen; or the hook uses a different tool version or environment.

Verify: compare `git diff --staged` with `git diff`; run the exact hook command (`.git/hooks/pre-commit` or the path in `git config core.hooksPath`) with tracing: `sh -x .git/hooks/pre-commit`.

Fix: stage the fixed files (`git add -p`), then commit; if the hook auto-formats files, re-add them. Update the tool versions in the shared hook config so it matches CI. `--no-verify` is acceptable only as a conscious, temporary escape and the server or CI must still enforce the rule.

```bash
git diff --staged
git config --get core.hooksPath
sh -x .githooks/pre-commit
```

Prevent: pin tool versions via the hook framework (pre-commit, Husky, Lefthook), run the same checks in CI, and keep hooks fast.

Wrong answers: deleting the hook, or always using `--no-verify`.

### You must release version 2.0 while supporting 1.x security fixes. How do you structure branches and tags?
<!-- level: advanced; kind: scenario; ref: https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows -->
Observe: main contains 2.0 development; customers on 1.x need patches for months.

Hypothesise: a maintenance branch per supported minor/major line, with fixes landing first on main and backported.

Verify: identify the last 1.x release tag and ensure it's reachable: `git describe`, `git tag --contains <sha>`.

Fix: create a long-lived branch from the last 1.x tag, protect it, and backport with cherry-pick.

```bash
git branch release/1.x v1.9.3
git push -u origin release/1.x
git switch release/1.x
git cherry-pick -x <fix-sha-from-main>
git tag -a v1.9.4 -m "Security fix"
```

Fix on main first, then backport, so the fix is never lost in the newest line. Automate backports with labels and bots, and run CI for each maintained branch. Document the support window and retire branches when it ends.

Prevent: semantic versioning, protected release branches, changelog discipline.

Wrong answers: maintaining 1.x by tagging from main with flags, or fixing 1.x only and forgetting main.

### git status says your branch is "ahead 1, behind 1" after you pulled. What is going on?
<!-- level: intermediate; kind: scenario; ref: https://git-scm.com/docs/git-status -->
Observe: "Your branch and 'origin/main' have diverged, and have 1 and 1 different commits each".

Hypothesise: each side has one unique commit. Common causes: you amended or rebased a commit that was already pushed; or someone pushed while you committed locally; or a pull with fast-forward-only was refused.

Verify: `git log --oneline --left-right --graph HEAD...origin/main` marks each side. Compare with `git range-diff origin/main...HEAD` or `git show` of both commits: if they are the same patch with different IDs, you amended or rebased a pushed commit.

Fix: if same patch, reset to the remote: `git reset --hard origin/main` (after saving anything unique). If different changes, integrate: `git pull --rebase`, then push.

```bash
git fetch
git log --left-right --oneline HEAD...origin/main
git pull --rebase
```

Prevent: do not amend pushed commits; set `pull.rebase` or `pull.ff only` so divergence is explicit.

Wrong answers: force-pushing without comparing, which can drop the other commit, or merging two copies of the same patch.
