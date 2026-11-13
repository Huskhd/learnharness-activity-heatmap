import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { api, allPages, optionalApi, tagCommit, ancestor, git, repositoryName } from './github-api.mjs';
import { compareVersions, isPromotion, publicationPlan, releaseNotes, validateVersions } from './release-guards.mjs';

const repository = repositoryName();
assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Only main may publish');
const sha = process.env.GITHUB_SHA;
assert.match(sha || '', /^[a-f0-9]{40}$/, 'Expected immutable workflow commit');
assert.equal(git('rev-parse', 'HEAD'), sha, 'Checkout must match the workflow commit');
git('fetch', 'origin', 'main', '--tags');
assert.ok(ancestor(sha, 'origin/main'), 'Release commit is no longer on main');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const version = validateVersions(json('dist/manifest.json'), json('.release-please-manifest.json'),
  readFileSync('version.txt', 'utf8'));
if (process.env.EXPECTED_VERSION) assert.equal(version, process.env.EXPECTED_VERSION, 'Unexpected release version');
const parents = git('show', '-s', '--format=%P', sha).split(' ');
assert.equal(parents.length, 2, 'Promotions must use a merge commit, not squash/rebase');
const previous = JSON.parse(git('show', `${parents[0]}:dist/manifest.json`)).version;
if (version === previous) {
  console.log(`No version change (${version}); no release will be published.`);
  process.exit(0);
}
assert.ok(compareVersions(version, previous) > 0, 'Release version must increase');
const repo = api(`repos/${repository}`);
const associated = allPages(`repos/${repository}/commits/${sha}/pulls`);
const promotions = associated.filter(pr => isPromotion(pr, repo.id, sha));
assert.equal(promotions.length, 1, 'Expected one merged same-repository dev → main PR');
assert.equal(promotions[0].head.sha, parents[1], 'Promotion must preserve the reviewed dev head');

// Only a merged release-please version PR promoted through this merge may publish.
const candidates = allPages(`repos/${repository}/pulls?state=closed&base=dev`).filter(pr =>
  pr.merged_at && pr.head.repo?.id === repo.id &&
  pr.head.ref.startsWith('release-please--branches--dev') &&
  pr.labels.some(label => ['autorelease: pending', 'autorelease: tagged'].includes(label.name)));
const versionPRs = candidates.filter(pr => {
  if (!ancestor(pr.merge_commit_sha, parents[1])) return false;
  const value = JSON.parse(git('show', `${pr.merge_commit_sha}:.release-please-manifest.json`));
  return value['.'] === version;
});
assert.equal(versionPRs.length, 1, 'Expected one merged release-please PR for this version');
const tag = `v${version}`;
const name = `activity-heatmap-${version}.zip`;
const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
const archive = readFileSync(`release-artifacts/${name}`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let release = optionalApi(`repos/${repository}/releases/tags/${tag}`);
assert.ok(!release?.prerelease, 'Existing prerelease requires manual reconciliation');
const existingTagSha = tagCommit(repository, tag);
assert.ok(!release || existingTagSha || release.draft, 'Published release has no tag');
if (release?.draft) {
  assert.equal(release.target_commitish, sha, 'Existing draft is for a different commit');
  assert.equal(release.body.trim(), notes.trim(), 'Existing draft has different release notes');
}
const existing = release?.assets.filter(asset => asset.name === name) || [];
assert.ok(existing.length <= 1, 'Duplicate release ZIP assets');
let assetMatches = false;
if (existing.length) {
  const remote = execFileSync('gh', ['api', `repos/${repository}/releases/assets/${existing[0].id}`,
    '-H', 'Accept: application/octet-stream'], { maxBuffer: 64 * 1024 * 1024 });
  assetMatches = digest(remote) === digest(archive);
  assert.ok(assetMatches, 'Existing ZIP bytes differ; refusing to replace the asset');
}
const plan = publicationPlan({ expectedSha: sha, existingTagSha, release, assetMatches });
if (plan === 'complete') {
  console.log(`Already published: ${release.html_url}`);
  process.exit(0);
}
if (!existingTagSha) {
  api(`repos/${repository}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${tag}`, sha } });
}
if (!release) {
  release = api(`repos/${repository}/releases`, { method: 'POST', body: {
    tag_name: tag, target_commitish: sha, name: tag, body: notes, draft: true, prerelease: false,
  } });
}
if (!assetMatches) {
  execFileSync('gh', ['release', 'upload', tag, `release-artifacts/${name}`, '--repo', repository], { stdio: 'inherit' });
}
// Verify the uploaded bytes before making the release public. Never --clobber.
release = api(`repos/${repository}/releases/${release.id}`);
const assets = release.assets.filter(asset => asset.name === name);
assert.equal(assets.length, 1, 'Expected exactly one installable ZIP');
const remote = execFileSync('gh', ['api', `repos/${repository}/releases/assets/${assets[0].id}`,
  '-H', 'Accept: application/octet-stream'], { maxBuffer: 64 * 1024 * 1024 });
assert.equal(digest(remote), digest(archive), 'Uploaded ZIP digest mismatch');
assert.equal(tagCommit(repository, tag), sha, 'Tag changed during publication');
const published = api(`repos/${repository}/releases/${release.id}`, { method: 'PATCH', body: { draft: false } });
console.log(`Published ${published.html_url}`);
console.log('Merge main back into dev without squash/rebase, then run Prepare release from main.');
console.log('The preparation guard finalizes pending PR labels only after publication and ancestry synchronization.');
