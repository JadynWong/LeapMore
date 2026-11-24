export type ReleaseSource = 'github' | 'gitcode';
export type Release = { tag: string; url: string; prerelease: boolean };
export type PublishedRelease = Release & { source: ReleaseSource };

export const githubRepository = 'MiRaToo/LeapMore';
export const gitcodeRepository = 'MiraRato/LeapMore';
const repositoryHosts = { github: 'https://github.com', gitcode: 'https://gitcode.com' };
const repositoryPath = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const validReleaseRepository = (value: string) => repositoryPath.test(value);
export const releaseRepositoryUrl = (source: ReleaseSource, repository: string) => repositoryHosts[source] + '/' + repository;

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

export function latestAndroidRelease(value: unknown, source: ReleaseSource, repository: string): Release | null {
  if (!Array.isArray(value) || !validReleaseRepository(repository)) return null;
  let latest: Release | null = null;
  for (const item of value) {
    if (!item || item.draft === true || item.release_status === 'draft' || typeof item.tag_name !== 'string') continue;
    const parsed = version(item.tag_name);
    if (!parsed || !Array.isArray(item.assets) ||
        !item.assets.some((asset: { name?: unknown } | null) => typeof asset?.name === 'string' && /\.apk$/i.test(asset.name))) continue;
    // GitCode's release list only provides an html_url on the author object.
    const releasePage = item.html_url ?? (source === 'gitcode' ? releaseRepositoryUrl(source, repository) + '/releases' : '');
    if (typeof releasePage !== 'string') continue;
    let url: URL;
    try { url = new URL(releasePage); } catch { continue; }
    if (url.origin !== repositoryHosts[source] || url.username || url.password ||
        !url.pathname.toLowerCase().startsWith('/' + repository.toLowerCase() + '/')) continue;
    if (!latest || compareVersions(item.tag_name, latest.tag) > 0) {
      latest = { tag: item.tag_name, url: url.href,
        prerelease: item.prerelease === true || item.release_status === 'pre' || parsed.prerelease.length > 0 };
    }
  }
  return latest;
}

async function checkAndroidRelease(source: ReleaseSource, repository: string): Promise<PublishedRelease | null> {
  if (!validReleaseRepository(repository)) return null;
  const endpoint = source === 'github' ? 'https://api.github.com/repos/' + repository + '/releases?per_page=30' :
    'https://api.gitcode.com/api/v5/repos/' + repository + '/releases?direction=desc&per_page=30';
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000), referrerPolicy: 'no-referrer' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('暂时无法查询发布版本。');
  const recent = latestAndroidRelease(await response.json(), source, repository);
  return recent && { ...recent, source };
}

export async function checkAndroidUpdates(preferred: ReleaseSource, repositories: Record<ReleaseSource, string>) {
  const secondary = preferred === 'github' ? 'gitcode' : 'github';
  const [first, second] = await Promise.allSettled([
    checkAndroidRelease(preferred, repositories[preferred]),
    checkAndroidRelease(secondary, repositories[secondary]),
  ]);
  const primaryRelease = first.status === 'fulfilled' ? first.value : null;
  const secondaryRelease = second.status === 'fulfilled' ? second.value : null;
  if (primaryRelease && secondaryRelease) {
    return compareVersions(primaryRelease.tag, secondaryRelease.tag) >= 0 ? primaryRelease : secondaryRelease;
  }
  if (primaryRelease || secondaryRelease) return primaryRelease ?? secondaryRelease;
  if (first.status === 'rejected' || second.status === 'rejected') throw new Error('暂时无法查询发布版本。');
  return null;
}
