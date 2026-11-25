import { NetworkError, request } from '../platform/network.ts';

export type ReleaseSource = 'github' | 'gitcode';
export type ReleasePlatform = 'android' | 'ios' | 'openharmony';
export const packageFormats = { android: 'APK', ios: 'IPA', openharmony: 'HAP' } as const;
export const releasePlatform = (platform: string): ReleasePlatform =>
  platform === 'ios' || platform === 'openharmony' ? platform : 'android';
export type Release = { tag: string; url: string; prerelease: boolean; downloadUrl?: string };
export type PublishedRelease = Release & { source: ReleaseSource };

export type ReleaseUpdate = PublishedRelease & { pages: Record<ReleaseSource, string>; mirrorTag?: string };
export const officialWebsite = 'https://leapmore.mirato66.cloud/';
export const backupDownloads = 'https://pan.quark.cn/s/9e6168a73f21';
export const githubRepository = 'MiRaToo/LeapMore';
export const gitcodeRepository = 'MiraRato/LeapMore';
const repositoryHosts = { github: 'https://github.com', gitcode: 'https://gitcode.com' };
const repositoryPath = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const validReleaseRepository = (value: string) => repositoryPath.test(value);
export const releaseRepositoryUrl = (source: ReleaseSource, repository: string) => repositoryHosts[source] + '/' + repository;

export function installedPackageUrl(current: string, platform: ReleasePlatform, repository: string) {
  if (repository !== githubRepository || !/^\d+\.\d+\.\d+$/.test(current)) return undefined;
  const suffix = { android: 'android.apk', ios: 'ios-unsigned.ipa', openharmony: 'harmonyos-unsigned.hap' }[platform];
  return releaseRepositoryUrl('github', repository) + '/releases/download/v' + current + '/LeapMore-v' + current + '-' + suffix;
}

function version(tag: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag);
  return match ? { number: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? [] } : null;
}

export function compareVersions(a: string, b: string) {
  const left = version(a), right = version(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index++) {
    const difference = left.number[index] - right.number[index];
    if (difference) return difference;
  }
  if (!left.prerelease.length || !right.prerelease.length) return right.prerelease.length - left.prerelease.length;
  for (let index = 0; index < Math.min(left.prerelease.length, right.prerelease.length); index++) {
    const l = left.prerelease[index], r = right.prerelease[index];
    if (l === r) continue;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return Number(l) - Number(r);
    if (ln !== rn) return ln ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return left.prerelease.length - right.prerelease.length;
}

export function latestRelease(value: unknown, source: ReleaseSource, repository: string, platform: ReleasePlatform): Release | null {
  if (!Array.isArray(value) || !validReleaseRepository(repository)) return null;
  let latest: Release | null = null;
  for (const item of value) {
    if (!item || item.draft === true || item.release_status === 'draft' || typeof item.tag_name !== 'string') continue;
    const parsed = version(item.tag_name);
    if (!parsed || !Array.isArray(item.assets)) continue;
    const suffix = '.' + packageFormats[platform].toLowerCase();
    const files = item.assets.filter((asset: { name?: unknown; state?: string } | null) => typeof asset?.name === 'string' &&
      asset.name.toLowerCase().endsWith(suffix) && (!asset.state || asset.state === 'uploaded'));
    // Published hotfixes may keep an old -build1 copy beside the current generic filename.
    const asset = files.find((file: { name: string }) => !/-build\d+\b/i.test(file.name)) ?? files[0];
    if (!asset) continue;
    // GitCode's release list only provides an html_url on the author object.
    const releasePage = item.html_url ?? (source === 'gitcode' ? releaseRepositoryUrl(source, repository) + '/releases' : '');
    if (typeof releasePage !== 'string') continue;
    let url: URL;
    try { url = new URL(releasePage); } catch { continue; }
    if (url.origin !== repositoryHosts[source] || url.username || url.password ||
        !url.pathname.toLowerCase().startsWith('/' + repository.toLowerCase() + '/')) continue;
    if (!latest || compareVersions(item.tag_name, latest.tag) > 0) {
      const download = asset.browser_download_url;
      const packageUrl = releaseRepositoryUrl(source, repository) + '/releases/download/' +
        encodeURIComponent(item.tag_name) + '/' + encodeURIComponent(asset.name);
      latest = { tag: item.tag_name, url: url.href,
        ...(download === packageUrl ? { downloadUrl: download } : {}),
        prerelease: item.prerelease === true || item.release_status === 'pre' || parsed.prerelease.length > 0 };
    }
  }
  return latest;
}

async function checkRelease(source: ReleaseSource, repository: string, platform: ReleasePlatform): Promise<PublishedRelease | null> {
  if (!validReleaseRepository(repository)) return null;
  const endpoint = source === 'github' ? 'https://api.github.com/repos/' + repository + '/releases?per_page=30' :
    'https://api.gitcode.com/api/v5/repos/' + repository + '/releases?direction=desc&per_page=30';
  let list: unknown;
  try { list = await request(endpoint); }
  catch (error) {
    if (error instanceof NetworkError && error.status === 404) return null;
    throw error;
  }
  const recent = latestRelease(list, source, repository, platform);
  return recent && { ...recent, source };
}

export async function checkUpdates(preferred: ReleaseSource, repositories: Record<ReleaseSource, string>, platform: ReleasePlatform) {
  const [githubResult, gitcodeResult] = await Promise.allSettled([
    checkRelease('github', repositories.github, platform),
    checkRelease('gitcode', repositories.gitcode, platform),
  ]);
  const github = githubResult.status === 'fulfilled' ? githubResult.value : null;
  const gitcode = gitcodeResult.status === 'fulfilled' ? gitcodeResult.value : null;
  let newest = github ?? gitcode;
  if (github && gitcode) {
    const difference = compareVersions(gitcode.tag, github.tag);
    if (difference > 0 || difference === 0 && preferred === 'gitcode') newest = gitcode;
  }
  if (!newest) {
    if (githubResult.status === 'rejected' || gitcodeResult.status === 'rejected') throw new Error('暂时无法查询发布版本。');
    return null;
  }
  const matchingGitHub = github && compareVersions(github.tag, newest.tag) === 0 ? github : null;
  const matchingGitCode = gitcode && compareVersions(gitcode.tag, newest.tag) === 0 ? gitcode : null;
  return {
    ...newest, downloadUrl: newest.downloadUrl ?? matchingGitHub?.downloadUrl ?? matchingGitCode?.downloadUrl, mirrorTag: gitcode?.tag,
    pages: {
      github: matchingGitHub?.url ?? releaseRepositoryUrl('github', repositories.github) + '/releases',
      gitcode: matchingGitCode?.url ?? releaseRepositoryUrl('gitcode', repositories.gitcode) + '/releases',
    },
  } satisfies ReleaseUpdate;
}
