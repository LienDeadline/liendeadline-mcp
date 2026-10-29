import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveRelease } from '../scripts/check-npm-release-ref.mjs';

test('release resolution binds approved tag, event and main ancestry', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'npm-release-ref-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Release gate test');
    git('config', 'user.email', 'release-test@example.invalid');
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'liendeadline-mcp', version: '0.5.6' }));
    git('add', 'package.json');
    git('commit', '-m', 'Reviewed source');
    const sha = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', sha);
    git('tag', 'v0.5.6');
    const dispatch = { cwd, tag: 'v0.5.6', eventName: 'workflow_dispatch', ref: 'refs/heads/main', repository: 'LienDeadline/liendeadline-mcp', event: { inputs: { tag: 'v0.5.6' } } };
    assert.deepEqual(resolveRelease(dispatch), { tag: 'v0.5.6', version: '0.5.6', sha });
    const push = { ...dispatch, eventName: 'push', ref: 'refs/tags/v0.5.6', event: { created: true, deleted: false, forced: false, after: sha } };
    assert.equal(resolveRelease(push).sha, sha);
    assert.throws(() => resolveRelease({ ...dispatch, ref: 'refs/heads/feature' }), /on main/);
    assert.throws(() => resolveRelease({ ...dispatch, tag: 'v0.5.6-rc.1' }), /stable/);
    assert.throws(() => resolveRelease({ ...dispatch, repository: 'other/fork' }), /repository/);
    assert.throws(() => resolveRelease({ ...push, event: { ...push.event, created: false } }), /newly created/);
    assert.throws(() => resolveRelease({ ...push, event: { ...push.event, after: '0'.repeat(40) } }), /no longer matches/);
    git('tag', '-d', 'v0.5.6');
    git('tag', '-a', 'v0.5.6', '-m', 'Annotated release');
    assert.equal(resolveRelease(push).sha, sha);
    assert.equal(resolveRelease({ ...push, event: { ...push.event, after: git('rev-parse', 'refs/tags/v0.5.6') } }).sha, sha);
    git('tag', '-a', 'v0.5.7', '-m', 'Wrong package version');
    assert.throws(() => resolveRelease({ ...dispatch, tag: 'v0.5.7', event: { inputs: { tag: 'v0.5.7' } } }), /identity\/version/);
    git('switch', '-c', 'unreviewed');
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'liendeadline-mcp', version: '0.5.8' }));
    git('commit', '-am', 'Unreviewed source');
    git('tag', 'v0.5.8');
    assert.throws(() => resolveRelease({ ...dispatch, tag: 'v0.5.8', event: { inputs: { tag: 'v0.5.8' } } }));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
