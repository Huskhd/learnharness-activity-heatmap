import { execFileSync } from 'node:child_process';

export function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function ancestor(older, newer) {
  try { git('merge-base', '--is-ancestor', older, newer); return true; }
  catch (error) { if (error.status === 1) return false; throw error; }
}

export function api(endpoint, { method = 'GET', body } = {}) {
  const args = ['api', endpoint, '--method', method];
  if (body !== undefined) args.push('--input', '-');
  const result = execFileSync('gh', args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result.trim() ? JSON.parse(result) : null;
}

export function optionalApi(endpoint) {
  try { return api(endpoint); }
  catch (error) {
    if (String(error.stderr).includes('(HTTP 404)')) return null;
    throw error;
  }
}

export function allPages(endpoint) {
  const values = [];
  for (let page = 1; ; page++) {
    const data = api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(data)) throw new Error('Expected paginated array');
    values.push(...data);
    if (data.length < 100) return values;
  }
}

export function tagCommit(repository, tag) {
  let object = optionalApi(`repos/${repository}/git/ref/tags/${tag}`)?.object;
  for (let depth = 0; object?.type === 'tag'; depth++) {
    if (depth >= 8) throw new Error('Tag indirection exceeds safety limit');
    object = api(`repos/${repository}/git/tags/${object.sha}`).object;
  }
  if (object && object.type !== 'commit') throw new Error('Version tag does not point at a commit');
  return object?.sha;
}

export function repositoryName() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
    throw new Error('Set GITHUB_REPOSITORY to owner/repository');
  }
  return repository;
}
