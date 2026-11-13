import assert from 'node:assert/strict';

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateVersions(plugin, release, text) {
  const version = plugin?.version;
  assert.equal(typeof version, 'string', 'Missing plugin version');
  assert.match(version, SEMVER, 'Only stable numeric x.y.z releases are supported');
  assert.equal(plugin.id, 'activity-heatmap');
  assert.equal(release?.['.'], version, 'Release manifest version differs');
  assert.equal(text.trim(), version, 'version.txt differs');
  return version;
}

export function isPromotion(pr, repositoryId, sha) {
  return Boolean(pr?.merged_at && pr.merge_commit_sha === sha &&
    pr.base?.ref === 'main' && pr.base?.repo?.id === repositoryId &&
    pr.head?.ref === 'dev' && pr.head?.repo?.id === repositoryId);
}

export function compareVersions(a, b) {
  assert.match(a, SEMVER);
  assert.match(b, SEMVER);
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => /^#{1,2} /.test(line) &&
    (line.startsWith(`## [${version}]`) || line.startsWith(`# [${version}]`) ||
     new RegExp(`^#{1,2} ${version.replaceAll('.', '\\.')}\\s*(?:\\(|$)`).test(line)));
  assert.ok(start >= 0, `CHANGELOG.md has no section for ${version}`);
  let end = start + 1;
  while (end < lines.length && !/^#{1,2} /.test(lines[end])) end++;
  const notes = lines.slice(start, end).join('\n').trim();
  assert.ok(notes.length > lines[start].length, 'Release notes section is empty');
  return notes;
}

// State machine shared with tests. Tags belong to immutable approved commits.
export function publicationPlan({ expectedSha, existingTagSha, release, assetMatches }) {
  if (existingTagSha) assert.equal(existingTagSha, expectedSha, 'Existing tag points at a different commit; refusing to move it');
  if (release && !release.draft) {
    assert.ok(assetMatches, 'Published release is missing the expected identical ZIP; refusing to overwrite it');
    return 'complete';
  }
  return release ? 'resume-draft' : 'create-draft';
}
