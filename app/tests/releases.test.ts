import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAndroidUpdates, compareVersions, gitcodeRepository, githubRepository, latestAndroidRelease } from '../src/data/releases.ts';

const repositories = { github: githubRepository, gitcode: gitcodeRepository };
const android = [{ name: 'LeapMore-android.apk' }];
const release = (tag: string, extra = {}) => ({
  tag_name: tag, html_url: `https://github.com/${githubRepository}/releases/tag/${tag}`, assets: android, ...extra,
});
const mirrorRelease = (tag: string) => ({ tag_name: tag, release_status: 'pre', assets: android });

test('the Android updater finds published prereleases and ignores drafts and releases without an APK', () => {
  const expected = release('v0.1.0', { prerelease: true });
  const results = [release('v0.2.0', { draft: true }), release('v0.3.0', { assets: [] }), expected,
    release('v0.0.9'), release('v0.1.1', { html_url: 'https://github.com/other/repo/releases/tag/v0.1.1' })];
  assert.deepEqual(latestAndroidRelease(results, 'github', githubRepository), { tag: 'v0.1.0', url: expected.html_url, prerelease: true });
});

test('GitCode releases link to the repository release list when the API only provides an author URL', () => {
  const list = [{ ...mirrorRelease('v0.2.0'), author: { html_url: 'https://gitcode.com/MiraRato' } },
    { ...mirrorRelease('v0.3.0'), assets: [{ name: 'source.zip' }] }];
  assert.deepEqual(latestAndroidRelease(list, 'gitcode', gitcodeRepository), {
    tag: 'v0.2.0', url: `https://gitcode.com/${gitcodeRepository}/releases`, prerelease: true,
  });
});

test('updates use the newest APK and prefer the selected release source for equal versions', async t => {
  let mirrorTag = 'v0.2.0';
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === `https://api.github.com/repos/${githubRepository}/releases?per_page=30`) return Response.json([release('v0.2.0')]);
    assert.equal(url, `https://api.gitcode.com/api/v5/repos/${gitcodeRepository}/releases?direction=desc&per_page=30`);
    return Response.json([mirrorRelease(mirrorTag)]);
  });
  assert.equal((await checkAndroidUpdates('gitcode', repositories))?.source, 'gitcode');
  assert.equal((await checkAndroidUpdates('github', repositories))?.source, 'github');
  mirrorTag = 'v0.1.0';
  assert.equal((await checkAndroidUpdates('gitcode', repositories))?.source, 'github');
});

test('updates fall back to GitHub when GitCode is absent, has no APK, or cannot be reached', async t => {
  let mirrorStatus = 404;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('api.github.com')) return Response.json([release('v0.1.0')]);
    if (mirrorStatus === 503) throw new TypeError('Network unavailable');
    return Response.json([], { status: mirrorStatus });
  });
  for (const status of [404, 200, 503]) {
    mirrorStatus = status;
    assert.equal((await checkAndroidUpdates('gitcode', repositories))?.source, 'github');
  }
});

test('release version ordering compares numbers and prerelease tags', () => {
  assert.ok(compareVersions('v0.12.0', '0.9.1') > 0);
  assert.ok(compareVersions('v0.1.0', '0.1.0-rc.2') > 0);
  assert.ok(compareVersions('0.1.0-rc.10', '0.1.0-rc.2') > 0);
  assert.equal(compareVersions('v0.1.0', '0.1.0'), 0);
});
