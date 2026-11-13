import assert from 'node:assert/strict';
import { api, allPages, ancestor, git, repositoryName, tagCommit } from './github-api.mjs';
import { validateVersions } from './release-guards.mjs';

const repository = repositoryName();
assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Run release preparation from the main workflow');
git('fetch', 'origin', 'main', 'dev', '--tags');
const dev = git('rev-parse', 'origin/dev');
const main = git('rev-parse', 'origin/main');
assert.ok(ancestor(main, dev), 'Merge main back into dev (without squash/rebase) before preparing a release');
const read = path => git('show', `${dev}:${path}`);
const version = validateVersions(JSON.parse(read('dist/manifest.json')),
  JSON.parse(read('.release-please-manifest.json')), read('version.txt'));
const release = api(`repos/${repository}/releases/tags/v${version}`);
assert.ok(!release.draft && !release.prerelease, 'Publish the pending version before preparing the next release');
const sha = tagCommit(repository, `v${version}`);
assert.ok(sha && ancestor(sha, dev), 'Published release commit must be an ancestor of dev');
assert.ok(release.assets.some(asset => asset.name === `activity-heatmap-${version}.zip` && asset.size > 0),
  'Published baseline is missing its installable ZIP');
const pending = allPages(`repos/${repository}/pulls?state=closed&base=dev`).filter(pr =>
  pr.merged_at && pr.labels.some(label => label.name === 'autorelease: pending'));
for (const pr of pending) {
  assert.equal(pr.head.repo?.full_name, repository, 'Pending release PR must belong to this repository');
  assert.ok(pr.head.ref.startsWith('release-please--branches--dev'), 'Unexpected pending PR source');
  assert.ok(ancestor(pr.merge_commit_sha, main), 'Pending release PR has not been promoted to main');
  const saved = JSON.parse(git('show', `${pr.merge_commit_sha}:.release-please-manifest.json`));
  assert.equal(saved['.'], version, 'Pending release PR version does not match the published baseline');
}
// Validate the entire pending set before changing any labels. Only finalized,
// published and ancestry-synchronized release PRs can leave the pending state.
for (const pr of pending) {
  api(`repos/${repository}/issues/${pr.number}/labels`, {
    method: 'POST', body: { labels: ['autorelease: tagged'] },
  });
  api(`repos/${repository}/issues/${pr.number}/labels/autorelease%3A%20pending`, { method: 'DELETE' });
}
console.log(`Ready: dev ${dev}, published baseline v${version} at ${sha}`);
