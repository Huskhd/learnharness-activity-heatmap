# Development and releases

## Bootstrap status / owner approval

This setup deliberately **does not activate branch protection or release publication**.
The initial `dev → main` PR needs independent human review. A collaborator with Write
access can install these files but cannot enable repository rulesets or restricted
Actions settings.

Release jobs run only when the repository Actions variable
`RELEASE_AUTOMATION_ENABLED` is exactly `true`. Leave it unset until the owner has
reviewed this design, applied protections, and enabled bot PR creation if necessary.
This variable is an operational safety switch, not a substitute for protections.

### Owner checklist after merging the bootstrap PR

1. Protect `dev`: active branch ruleset targeting `refs/heads/dev`, restrict deletions,
   block force pushes, empty bypass list.
2. Protect `main`: the same rules plus required PRs, stale-approval dismissal, resolved
   review conversations, and one approving review for today's two-person team.
3. Require **Promotion source** and **Validate plugin (ubuntu-latest)**,
   **Validate plugin (windows-latest)**, **Validate plugin (macos-latest)** after those
   checks have actually run. Do not enable a blanket Restrict updates rule that also
   prevents legitimate merges. The source workflow is trusted-base logic: it may not
   run on the initial bootstrap PR until present on `main`; verify on the next PR.
4. Allow merge commits; use **Create a merge commit** for every `dev → main` promotion.
   Disable automatic head-branch deletion. Keep `dev` as a permanent branch.
5. In Actions settings, permit the pinned actions in these workflows and enable
   **Allow GitHub Actions to create and approve pull requests** for release-please.
   Automation here creates PRs; it does not approve them.
6. Resolve the unanimous-approval requirement below before declaring the intended
   protection complete. Then explicitly approve enabling the release variable.

**Approval limitation:** one native approving review implements “the other
collaborator approves” only for human-authored PRs with the current two-person team.
The `Promotion source` check enforces branch/repository identity, **not unanimity**.
Bot-authored promotions need both humans; additional collaborators need a different
policy. Native CODEOWNERS and a fixed review count do not identify “all collaborators.”
A dynamic reviewer check needs trusted review-event execution, roster access,
revalidation, and a decision about residual race windows. That is intentionally not
silently replaced with a weaker rule in this bootstrap. No bot opens promotion PRs.
The owner/user must approve a follow-up design if exact dynamic unanimity is required.

Owner edits to rules can always remove protections; undeletable means blocked while
the rules are active, not irrevocable protection against the administrator.

## Local checks (no application build needed)

Developer prerequisites: Git, Node.js 22+, and Python 3.10+. End users still install the
prebuilt `dist` without any of those tools. Run from the repository root:

```text
python -m unittest discover -s tests -p "test_*.py"
node --test tests/release-guards.test.mjs
python scripts/package_plugin.py --check
python scripts/package_plugin.py --output-dir release-artifacts
```

Use `python3` if your OS names Python 3 that way. Packaging is Python-standard-library
only and produces deterministic, uncompressed ZIPs. It validates three matching
stable versions: `dist/manifest.json`, `version.txt`, and
`.release-please-manifest.json`. It refuses symlinks and common non-distributable paths;
this is not a general secret-content scanner.

The GitHub Actions validation matrix runs on Linux, Windows, and macOS. JavaScript
syntax validation explicitly selects Bash on those runners; local commands above do
not assume a particular shell. Symlink fixture tests skip where OS permissions do
not allow creating symlinks.

## Normal release cycle

### 1. Develop on dev

Use Conventional Commits (`fix:`, `feat:`, `feat!:` / `BREAKING CHANGE:`) for changes
that should cause release-please to propose a version. CI/config-only bootstrap work
uses `chore:` and need not trigger a release. Keep normal feature PRs targeted at `dev`.

### 2. Prepare the version PR

After protections and the release variable are approved, dispatch **Prepare release**
from **main** in Actions (or `gh workflow run prepare-release.yml --ref main`).

The trusted main script checks that:

- Current `main` and the last published version's exact tag commit are ancestors of `dev`.
- The version files on `dev` agree and their baseline release is published with its ZIP.
- Any pending release PR being finalized belongs to this repository, was promoted,
  and matches the published baseline.

It then finalizes eligible `autorelease: pending` labels and runs release-please in
manifest mode, targeting `dev` with **GitHub release creation disabled**. The `simple`
strategy updates `version.txt`, `CHANGELOG.md`, the release manifest, and the JSON
version field in `dist/manifest.json`. No Node package is required for this plugin.

Review the generated version/changelog PR and merge it into `dev`. Do not manually
change the approved version or promote unversioned runtime changes directly to `main`.

**Bot-trigger limitation:** most events produced by `GITHUB_TOKEN` do not trigger
other Actions runs. If the generated release PR lacks validation, a human can close
and reopen it to trigger ordinary PR checks. Alternatively run validation explicitly
on that PR branch, understanding that a dispatch is not automatically the same
required PR check. Never waive required checks to work around this. No PAT/App secret
is needed for the manual close/reopen approach.

### 3. Promote dev to main

Open a **human-authored** PR from this repository's `dev` into `main`, obtain all
required human approval, and merge with **Create a merge commit**. Keep the reviewed
version and changes together. Do not delete `dev`.

The publisher validates the actual merge SHA and parents, the associated same-repo
promotion PR, a reachable merged release-please PR, matching version files, increasing
version, and a matching changelog section. A bootstrap merge with no version change
is a no-op. Publication is not a substitute for review/protection enforcement.

### 4. Publish and synchronize

With the release variable enabled, the push to `main` builds and validates the ZIP,
creates an immutable `vX.Y.Z` tag at the approved main merge SHA, creates a draft
release, uploads/verifies the ZIP, and only then publishes it. Existing mismatched
tags/assets are rejected, not moved or overwritten. The ZIP layout is:

```text
activity-heatmap/dist/manifest.json
activity-heatmap/dist/main.js
activity-heatmap/dist/backend.cjs
activity-heatmap/dist/styles.css
```

Additional legitimate `dist` assets are included. `data/`, dependencies, and development
files are excluded. Nothing writes to a user's installed plugin or learning data.

After publication, **synchronize main back into dev, preserving ancestry**. If dev has
not advanced, this can be done locally:

```text
git fetch origin
git switch dev
git merge --ff-only origin/main
git push origin dev
```

If dev has advanced, use a normal merge of main into dev or a main→dev PR merged with
a merge commit. Resolve conflicts deliberately; never force-push, reset, squash, or
rebase away the published tag's ancestry. The next Prepare release run confirms the
sync and finalizes release-please's pending label before preparing a new version.

Release-please matches published versions by tag SHA in dev's history. Copying the
same files is not enough; both **ancestry synchronization and label finalization** are
necessary for subsequent cycles. Do not remove a pending label before publication.

## Recovery and verification limits

- Failed publication: fix the cause and rerun the original **Publish release** run at
  the original merge SHA. Its draft/tag can be resumed; already matching published
  state is a no-op. Never delete/move the tag or use upload `--clobber` as a shortcut.
- Manual dispatch accepts an expected version and uses the chosen `main` revision;
  use the original run to retry an older release. A normal no-version-change merge
  intentionally does not publish a historical pending version.
- Different existing tag/asset/draft notes: stop and reconcile manually; the script
  refuses to overwrite unexpected state.
- Prep blocked by pending version: publish it, sync main into dev, then rerun prep.
- Disable new release work by unsetting `RELEASE_AUTOMATION_ENABLED`; this does not
  cancel an already running job. Cancel it separately if necessary and inspect state.

Tests cover packaging, pure release guards, and two local Git ancestry cycles.
They do **not** claim a live two-cycle release-please/GitHub release test. Initial live
release preparation/publication and token permissions remain owner-supervised checks.
No production release is created to validate the bootstrap.

## Implementation references

- [release-please action](https://github.com/googleapis/release-please-action)
- [Manifest releaser](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [Extra-file version updaters](https://github.com/googleapis/release-please/blob/main/docs/customizing.md)
- [GitHub workflow trigger limitations](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)
