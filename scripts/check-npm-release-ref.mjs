// Release authorization gate. Does not contact npm or publish anything.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function resolveRelease({ tag, eventName, ref, repository, event, workflowSha, cwd = process.cwd() }) {
  if (repository !== 'LienDeadline/liendeadline-mcp') throw new Error('Unexpected repository');
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) {
    throw new Error('Release tag must be stable v<major>.<minor>.<patch>');
  }
  if (eventName === 'push') {
    if (ref !== `refs/tags/${tag}` || event.created !== true || event.deleted || event.forced) {
      throw new Error('Only a newly created release tag may publish automatically');
    }
  } else {
    throw new Error('Unsupported release event');
  }
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sha = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  git('merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main');
  if (workflowSha !== sha) throw new Error('Workflow provenance commit must equal the release tag commit');
  if (eventName === 'push' && ![sha, git('rev-parse', `refs/tags/${tag}`)].includes(event.after)) {
    throw new Error('Pushed tag no longer matches the event');
  }
  const pkg = JSON.parse(git('show', `${sha}:package.json`));
  if (pkg.name !== 'liendeadline-mcp' || `v${pkg.version}` !== tag) {
    throw new Error('Release tag does not match package identity/version');
  }
  return { tag, version: pkg.version, sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = resolveRelease({
    tag: process.env.RELEASE_TAG,
    eventName: process.env.GITHUB_EVENT_NAME,
    workflowSha: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
  });
  for (const [key, value] of Object.entries(result)) console.log(`${key}=${value}`);
}
