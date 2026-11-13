import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, isPromotion, publicationPlan, releaseNotes, validateVersions } from '../scripts/release-guards.mjs';

test('version files must agree and use stable numeric versions', () => {
  assert.equal(validateVersions({ id: 'activity-heatmap', version: '1.2.3' }, { '.': '1.2.3' }, '1.2.3\n'), '1.2.3');
  for (const invalid of ['v1.0.0', '1.0.0-rc.1', '01.0.0', '', null]) {
    assert.throws(() => validateVersions({ id: 'activity-heatmap', version: invalid }, { '.': invalid }, String(invalid)));
  }
  assert.throws(() => validateVersions({ id: 'activity-heatmap', version: '1.0.1' }, { '.': '1.0.0' }, '1.0.1'));
  assert.throws(() => validateVersions({ id: 'other', version: '1.0.0' }, { '.': '1.0.0' }, '1.0.0'));
});

test('semantic versions compare numerically, not lexicographically', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('publication requires the actual merged same-repository dev promotion', () => {
  const pr = { merged_at: '2026-01-01', merge_commit_sha: 'abc',
    base: { ref: 'main', repo: { id: 1 } }, head: { ref: 'dev', repo: { id: 1 } } };
  assert.equal(isPromotion(pr, 1, 'abc'), true);
  assert.equal(isPromotion({ ...pr, merged_at: null }, 1, 'abc'), false);
  assert.equal(isPromotion(pr, 1, 'other'), false);
  assert.equal(isPromotion({ ...pr, head: { ref: 'dev', repo: { id: 2 } } }, 1, 'abc'), false);
  assert.equal(isPromotion({ ...pr, head: { ref: 'feature', repo: { id: 1 } } }, 1, 'abc'), false);
  assert.equal(isPromotion({ ...pr, head: { ref: 'dev', repo: null } }, 1, 'abc'), false);
});

test('extract exactly one release section and retain nested feature headings', () => {
  const text = '# Changelog\n\n## [1.1.0](https://example.test) (2026-01-01)\n\n### Features\n\n* New feature\n\n## [1.0.0](url)\n\n* Old feature';
  const notes = releaseNotes(text, '1.1.0');
  assert.match(notes, /New feature/);
  assert.doesNotMatch(notes, /Old feature/);
  assert.throws(() => releaseNotes(text, '2.0.0'));
  assert.throws(() => releaseNotes('## 1.1.0\n', '1.1.0'));
});

test('publication retries preserve immutable tags/assets', () => {
  const state = { expectedSha: 'approved', existingTagSha: undefined, release: null, assetMatches: false };
  assert.equal(publicationPlan(state), 'create-draft');
  assert.equal(publicationPlan({ ...state, existingTagSha: 'approved' }), 'create-draft');
  assert.equal(publicationPlan({ ...state, existingTagSha: 'approved', release: { draft: true } }), 'resume-draft');
  assert.equal(publicationPlan({ ...state, existingTagSha: 'approved', release: { draft: false }, assetMatches: true }), 'complete');
  assert.throws(() => publicationPlan({ ...state, existingTagSha: 'different' }));
  assert.throws(() => publicationPlan({ ...state, release: { draft: false } }));
});

test('two local release cycles require the exact published main SHA in dev history', () => {
  const root = mkdtempSync(join(tmpdir(), 'heatmap-release-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commitVersion = (version, message) => {
    writeFileSync(join(root, 'version.txt'), `${version}\n`);
    git('add', 'version.txt'); git('commit', '-m', message);
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release test'); git('config', 'user.email', 'release-test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    commitVersion('1.0.0', 'chore: baseline'); git('tag', 'v1.0.0'); git('switch', '-c', 'dev');
    for (const [old, version] of [['1.0.0', '1.1.0'], ['1.1.0', '1.2.0']]) {
      git('merge-base', '--is-ancestor', `v${old}`, 'dev');
      commitVersion(version, `chore(dev): release ${version}`);
      const devHead = git('rev-parse', 'HEAD');
      git('switch', 'main'); git('merge', '--no-ff', 'dev', '-m', `Promote ${version}`);
      const published = git('rev-parse', 'HEAD'); git('tag', `v${version}`);
      assert.notEqual(published, devHead);
      assert.throws(() => git('merge-base', '--is-ancestor', published, 'dev'));
      git('switch', 'dev'); git('merge', '--ff-only', 'main');
      git('merge-base', '--is-ancestor', published, 'dev');
      assert.equal(git('rev-list', '--count', `v${version}..dev`), '0');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
