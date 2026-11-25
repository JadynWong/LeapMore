import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUpdates, compareVersions, gitcodeRepository, githubRepository, installedPackageUrl, latestRelease } from '../src/data/releases.ts';

const repositories = { github: githubRepository, gitcode: gitcodeRepository };
const android = [{ name: 'LeapMore-android.apk' }];
const release = (tag: string, extra = {}) => ({
  tag_name: tag, html_url: `https://github.com/${githubRepository}/releases/tag/${tag}`, assets: android, ...extra,
});
const mirrorRelease = (tag: string) => ({ tag_name: tag, release_status: 'pre', assets: android });

test('each native platform selects its newest published package and validates the GitHub download link', async t => {
  const asset = (tag: string, name: string) => ({ name, state: 'uploaded',
    browser_download_url: 'https://github.com/' + githubRepository + '/releases/download/' + tag + '/' + name });
  const apk = asset('v0.2.0', 'LeapMore-android.apk');
  const ipa = asset('v0.1.1', 'LeapMore-ios-unsigned.ipa');
  const hap = asset('v0.1.1', 'LeapMore-harmonyos-unsigned.hap');
  const releases = [release('v0.2.0', { assets: [apk] }), release('v0.1.1', { assets: [
    asset('v0.1.1', 'LeapMore-ios-build1-unsigned.ipa'), ipa, hap] })];
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.includes('api.github.com') ? releases : []));
  for (const [platform, expected] of [['android', apk], ['ios', ipa], ['openharmony', hap]] as const) {
    assert.equal((await checkUpdates('gitcode', repositories, platform))?.downloadUrl, expected.browser_download_url);
  }
  assert.equal(latestRelease(releases.slice(0, 1), 'github', githubRepository, 'ios'), null);
  assert.equal(latestRelease([release('v0.2.0', { assets: [{...apk, browser_download_url: 'https://other.example/a.apk'}] })],
    'github', githubRepository, 'android')?.downloadUrl, undefined);
});

test('the Android updater finds published prereleases and ignores drafts and releases without an APK', () => {
  const expected = release('v0.1.0', { prerelease: true });
  const results = [release('v0.2.0', { draft: true }), release('v0.3.0', { assets: [] }), expected,
    release('v0.0.9'), release('v0.1.1', { html_url: 'https://github.com/other/repo/releases/tag/v0.1.1' })];
  assert.deepEqual(latestRelease(results, 'github', githubRepository, 'android'), { tag: 'v0.1.0', url: expected.html_url, prerelease: true });
});

test('GitCode releases link to the repository release list when the API only provides an author URL', () => {
  const list = [{ ...mirrorRelease('v0.2.0'), author: { html_url: 'https://gitcode.com/MiraRato' } },
    { ...mirrorRelease('v0.3.0'), assets: [{ name: 'source.zip' }] }];
  assert.deepEqual(latestRelease(list, 'gitcode', gitcodeRepository, 'android'), {
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
  assert.equal((await checkUpdates('gitcode', repositories, 'android'))?.source, 'gitcode');
  assert.equal((await checkUpdates('github', repositories, 'android'))?.source, 'github');
  const same = await checkUpdates('gitcode', repositories, 'android');
  assert.equal(same?.pages.github, release('v0.2.0').html_url);
  assert.equal(same?.pages.gitcode, 'https://gitcode.com/' + gitcodeRepository + '/releases');
  mirrorTag = 'v0.1.0';
  const behind = await checkUpdates('gitcode', repositories, 'android');
  assert.equal(behind?.mirrorTag, mirrorTag);
  assert.equal(behind?.source, 'github');
  assert.equal(behind?.pages.gitcode, 'https://gitcode.com/' + gitcodeRepository + '/releases');
  mirrorTag = 'v0.3.0';
  const ahead = await checkUpdates('github', repositories, 'android');
  assert.equal(ahead?.pages.github, 'https://github.com/' + githubRepository + '/releases');
  assert.equal(ahead?.downloadUrl, undefined);
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
    assert.equal((await checkUpdates('gitcode', repositories, 'android'))?.source, 'github');
  }
});

test('release version ordering compares numbers and prerelease tags', () => {
  assert.ok(compareVersions('v0.12.0', '0.9.1') > 0);
  assert.ok(compareVersions('v0.1.0', '0.1.0-rc.2') > 0);
  assert.ok(compareVersions('0.1.0-rc.10', '0.1.0-rc.2') > 0);
  assert.equal(compareVersions('v0.1.0', '0.1.0'), 0);
});

test('current version downloads use the published filenames for all three platforms', () => {
  for (const [platform, file] of [['android', 'android.apk'], ['ios', 'ios-unsigned.ipa'], ['openharmony', 'harmonyos-unsigned.hap']] as const) {
    assert.equal(installedPackageUrl('0.1.1', platform, githubRepository),
      'https://github.com/MiRaToo/LeapMore/releases/download/v0.1.1/LeapMore-v0.1.1-' + file);
  }
  assert.equal(installedPackageUrl('0.1.1', 'android', 'other/repository'), undefined);
});
