import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { focusManager, useQueries, useQueryClient } from '@tanstack/react-query';
import licenseText from '../../../../LICENSE?raw';
import { readSetting } from '../../data/localDatabase';
import { useSetting } from '../../data/preferences';
import { backupDownloads, checkUpdates, compareVersions, gitcodeRepository, githubRepository, installedPackageUrl, officialWebsite, packageFormats,
  releasePlatform, releaseRepositoryUrl, validReleaseRepository } from '../../data/releases';
import type { ReleaseUpdate } from '../../data/releases';
import { checkLinkAccess } from '../../platform/linkAccess';
import { useExternalLink } from './useExternalLink';
import { Sheet, Switch } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { disclaimer } from '../account/pages';

function repository(value: string | undefined, fallback: string) {
  const path = value?.trim() ?? '';
  return validReleaseRepository(path) ? path : fallback;
}
const repositories = {
  github: repository(import.meta.env.VITE_RELEASE_REPOSITORY, githubRepository),
  gitcode: repository(import.meta.env.VITE_GITCODE_RELEASE_REPOSITORY, gitcodeRepository),
};
const sources = [['github', 'GitHub'], ['gitcode', 'GitCode']] as const;
const platform = releasePlatform(Capacitor.getPlatform());
const isNew = (release: ReleaseUpdate | null) => !!release && compareVersions(release.tag, __LEAPMORE_VERSION__) > 0;
const UpdateContext = createContext<{
  manualCheck: () => Promise<ReleaseUpdate | null>;
  notify: boolean; setNotify: (value: boolean) => void;
} | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [notify, setNotify] = useSetting('notifyUpdates', true);
  const [skipped, setSkipped] = useSetting('skippedUpdate', '');
  const [pending, setPending] = useState<ReleaseUpdate | null>(null);
  const generation = useRef(0);
  const check = useCallback(() => {
    const source = readSetting<string>('updateSource', 'github') === 'gitcode' ? 'gitcode' : 'github';
    return client.fetchQuery({
      queryKey: ['release-check', platform, source], queryFn: () => checkUpdates(source, repositories, platform),
      staleTime: 0, retry: false, networkMode: 'always',
    });
  }, [client]);

  useEffect(() => {
    let active: boolean | undefined;
    function onFocus(focused: boolean) {
      if (focused === active) return;
      active = focused;
      const attempt = ++generation.current;
      setPending(null);
      if (!focused) return;
      void check().then(result => {
        if (attempt === generation.current && isNew(result)) setPending(result);
      }).catch(() => { /* Only manual checks display network errors. */ });
    }
    const unsubscribe = focusManager.subscribe(onFocus);
    onFocus(focusManager.isFocused());
    return () => { generation.current++; unsubscribe(); };
  }, [check]);

  function manualCheck() {
    generation.current++;
    setPending(null);
    return check();
  }
  return <UpdateContext.Provider value={{ manualCheck, notify, setNotify }}>
    {children}
    {notify && pending && (!skipped || compareVersions(pending.tag, skipped) > 0) &&
      <StartupNotice key={pending.tag} release={pending} close={() => setPending(null)}
        skip={() => { setSkipped(pending.tag); setPending(null); }} />}
  </UpdateContext.Provider>;
}

function downloadLinks(release: ReleaseUpdate | null) {
  const compare = release ? compareVersions(release.tag, __LEAPMORE_VERSION__) : 0;
  const url = (compare >= 0 ? release?.downloadUrl : undefined) ??
    (compare <= 0 ? installedPackageUrl(__LEAPMORE_VERSION__, platform, repositories.github) : undefined);
  const tag = compare > 0 ? release!.tag : 'v' + __LEAPMORE_VERSION__;
  const order = release?.source === 'gitcode' ? [sources[1], sources[0]] : sources;
  return [
    ...(url ? [{ label: '下载 ' + tag + ' · ' + packageFormats[platform], url, file: true }] : []),
    ...order.map(([source, label]) => ({ label: label + ' 发布页',
      url: release?.pages[source] ?? releaseRepositoryUrl(source, repositories[source]) + '/releases', file: false })),
    { label: '夸克网盘备用下载', url: backupDownloads, file: false },
  ];
}

function UpdateLink({ link, open, status }: {
  link: ReturnType<typeof downloadLinks>[number]; open: (event: MouseEvent<HTMLAnchorElement>) => void; status?: string;
}) {
  return <a className={'btn update-destination ' + (link.file ? 'accent' : 'secondary')} href={link.url}
    onClick={open} target="_blank" rel="noreferrer">{link.label}{status && <small role="status">{status}</small>}</a>;
}

function DownloadNotes({ release }: { release: ReleaseUpdate | null }) {
  const mirrorBehind = release?.mirrorTag && compareVersions(release.mirrorTag, release.tag) < 0;
  return <>
    <p className="tiny muted">GitCode 是同步镜像，版本和安装包可能晚于 GitHub。
      {mirrorBehind && '本次在镜像中查到的最新版本为 ' + release.mirrorTag + '。'}使用网盘时请核对文件版本。</p>
    {platform !== 'android' && <p className="tiny muted">{platform === 'ios' ?
      '使用 SideStore 安装 IPA 时选择保留扩展，即可同时安装桌面小组件。' : '未签名 HAP 需使用匹配的证书及 Profile 签名后安装。'}</p>}
  </>;
}

function StartupNotice({ release, close, skip }: { release: ReleaseUpdate; close: () => void; skip: () => void }) {
  const [available, setAvailable] = useState(false);
  const { open, error } = useExternalLink();
  useEffect(() => {
    // Leave onboarding, authorization and vehicle control dialogs uninterrupted.
    const showWhenFree = () => {
      if (document.querySelector('dialog[open]')) return;
      observer.disconnect();
      setAvailable(true);
    };
    const observer = new MutationObserver(showWhenFree);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    showWhenFree();
    return () => observer.disconnect();
  }, []);
  if (!available) return null;
  return <Sheet title={'发现新版本 ' + release.tag} sub={'当前版本 ' + __LEAPMORE_VERSION__ + (release.prerelease ? ' · 可用更新为预发布版' : '')} close={close} showClose>
    <div className="update-links">{downloadLinks(release).map(link => <UpdateLink key={link.url} link={link} open={open} />)}</div>
    <DownloadNotes release={release} />
    {error && <p role="status">{error}</p>}
    <div className="confirm-btns"><button className="btn ghost" onClick={skip}>此版本不再提示</button>
      <button className="btn secondary" onClick={close}>稍后提醒</button></div>
  </Sheet>;
}

type ReleaseCheck = { status: 'idle' | 'checking' | 'unavailable' } | { status: 'ready'; release: ReleaseUpdate | null };

export function AboutSheet({ close }: { close: () => void }) {
  const { manualCheck, notify, setNotify } = useContext(UpdateContext)!;
  const [result, setResult] = useState<ReleaseCheck>({ status: 'idle' });
  const { open, error } = useExternalLink();
  const [checkedAt, setCheckedAt] = useState(0);
  const latest = result.status === 'ready' ? result.release : null;
  const destinations = downloadLinks(latest);
  const installer = destinations.find(link => link.file);
  const website = { label: 'LeapMore 官网', url: officialWebsite, file: false };
  const targets = [...destinations, website];
  const probes = useQueries({ queries: targets.map(({ url, file }) => ({
    queryKey: ['release-link', checkedAt, url], queryFn: () => checkLinkAccess(url, file), enabled: checkedAt > 0,
    staleTime: Infinity, gcTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, networkMode: 'always' as const,
  })) });
  const access = checkedAt ? Object.fromEntries(targets.map(({ url }, index) =>
    [url, probes[index].data ?? (probes[index].isError ? '无法连接' : '正在检测…')])) : {};
  const checking = result.status === 'checking' || probes.some(probe => probe.isFetching);
  async function check() {
    setCheckedAt(Date.now());
    setResult({ status: 'checking' });
    try { setResult({ status: 'ready', release: await manualCheck() }); }
    catch { setResult({ status: 'unavailable' }); }
  }
  const status = result.status === 'unavailable' ? '暂时无法查询发布版本，可按访问检测结果选择下载入口。' : result.status !== 'ready' ? '' :
    !latest ? '发布源暂无 ' + packageFormats[platform] + ' 安装包。' :
    isNew(latest) ? '发现新版本 ' + latest.tag + (latest.prerelease ? ' · 预发布' : '') : '当前已是最新版本。';
  return <Sheet className="about-sheet" title="关于 LeapMore" sub={'当前版本 v' + __LEAPMORE_VERSION__} close={close} showClose>
    <div className="about-update-actions"><button className="btn secondary" onClick={() => void check()} disabled={checking}>{checking ? '正在检查…' : '检查更新'}</button>
      {installer && <UpdateLink link={installer} open={open} status={access[installer.url]} />}</div>
    {status && <p role="status">{status}</p>}
    <div className="about-update-settings row"><span className="t">打开时提醒新版本</span><Switch label="打开时提醒新版本" checked={notify} action={() => setNotify(!notify)} /></div>
    <section className="about-channels" aria-label="发布页和备用下载">
      <h3>发布页和备用下载</h3>
      <div className="update-links">{destinations.filter(link => !link.file).map(link =>
        <UpdateLink key={link.url} link={link} open={open} status={access[link.url]} />)}</div>
      <DownloadNotes release={latest} />
    </section>
    <a className="btn about-website" href={website.url} onClick={open} target="_blank" rel="noreferrer">
      <span>{website.label}</span>{access[website.url] && <small role="status">{access[website.url]}</small>}<Icon name="external" size={15} /></a>
    {error && <p role="status">{error}</p>}
    <details className="about-license">
      <summary>应用说明与开源许可<Icon name="chevron" size={15} /></summary>
      <p className="tiny muted">{disclaimer}</p><b>GNU GPL v3.0</b>
      <pre className="about-license-text" tabIndex={0}>{licenseText}</pre>
    </details>
  </Sheet>;
}
