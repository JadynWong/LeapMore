import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { focusManager, useQueries, useQueryClient } from '@tanstack/react-query';
import licenseText from '../../../../LICENSE?raw';
import { readSetting } from '../../data/localDatabase';
import { useSetting } from '../../data/preferences';
import { backupDownloads, checkUpdates, compareVersions, gitcodeRepository, githubRepository, installedPackageUrl, officialWebsite, packageFormats,
  releasePlatform, releaseRepositoryUrl, validReleaseRepository } from '../../data/releases';
import type { ReleaseSource, ReleaseUpdate } from '../../data/releases';
import { checkLinkAccess } from '../../platform/linkAccess';
import { nativeSettings } from '../../platform/settings';
import { Section, Seg, Sheet, Switch } from '../../ui/components';
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
  manualCheck: (source: ReleaseSource) => Promise<ReleaseUpdate | null>;
  notify: boolean; setNotify: (value: boolean) => void;
} | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [notify, setNotify] = useSetting('notifyUpdates', true);
  const [skipped, setSkipped] = useSetting('skippedUpdate', '');
  const [pending, setPending] = useState<ReleaseUpdate | null>(null);
  const generation = useRef(0);
  const check = useCallback((source: ReleaseSource) => client.fetchQuery({
    queryKey: ['release-check', platform, source], queryFn: () => checkUpdates(source, repositories, platform),
    staleTime: 0, retry: false, networkMode: 'always',
  }), [client]);

  useEffect(() => {
    let active: boolean | undefined;
    function onFocus(focused: boolean) {
      if (focused === active) return;
      active = focused;
      const attempt = ++generation.current;
      setPending(null);
      if (!focused) return;
      const source = readSetting<string>('updateSource', 'github') === 'gitcode' ? 'gitcode' : 'github';
      void check(source).then(result => {
        if (attempt === generation.current && isNew(result)) setPending(result);
      }).catch(() => { /* Only manual checks display network errors. */ });
    }
    const unsubscribe = focusManager.subscribe(onFocus);
    onFocus(focusManager.isFocused());
    return () => { generation.current++; unsubscribe(); };
  }, [check]);

  function manualCheck(source: ReleaseSource) {
    generation.current++;
    setPending(null);
    return check(source);
  }
  return <UpdateContext.Provider value={{ manualCheck, notify, setNotify }}>
    {children}
    {notify && pending && (!skipped || compareVersions(pending.tag, skipped) > 0) &&
      <StartupNotice key={pending.tag} release={pending} close={() => setPending(null)}
        skip={() => { setSkipped(pending.tag); setPending(null); }} />}
  </UpdateContext.Provider>;
}

function useExternalLink() {
  const [error, setError] = useState('');
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (platform !== 'openharmony') return;
    event.preventDefault();
    setError('');
    void nativeSettings.openRelease({ url: event.currentTarget.href }).catch(() => setError('无法打开系统浏览器。'));
  }
  return { open, error };
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

function UpdateLinks({ release, open, access = {} }: {
  release: ReleaseUpdate | null; open: (event: MouseEvent<HTMLAnchorElement>) => void; access?: Record<string, string>;
}) {
  const mirrorBehind = release?.mirrorTag && compareVersions(release.mirrorTag, release.tag) < 0;
  return <>
    {downloadLinks(release).map(({ label, url, file }) => <a className={'btn update-destination ' + (file ? 'accent' : 'secondary')}
      key={url} href={url} onClick={open} target="_blank" rel="noreferrer">
      {label}{access[url] && <small role="status">{access[url]}</small>}
    </a>)}
    <p className="tiny muted">GitCode 是同步镜像，版本和安装包可能晚于 GitHub。
      {mirrorBehind && '本次在镜像中查到的最新版本为 ' + release.mirrorTag + '。'}使用网盘时请核对文件版本。</p>
    {platform !== 'android' && <p className="tiny muted">{platform === 'ios' ?
      '未签名 IPA 需为主应用和小组件签名后安装。' : '未签名 HAP 需使用匹配的证书及 Profile 签名后安装。'}</p>}
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
    <UpdateLinks release={release} open={open} />
    {error && <p role="status">{error}</p>}
    <div className="confirm-btns"><button className="btn ghost" onClick={skip}>此版本不再提示</button>
      <button className="btn secondary" onClick={close}>稍后提醒</button></div>
  </Sheet>;
}

type ReleaseCheck = { status: 'idle' | 'checking' | 'unavailable' } | { status: 'ready'; release: ReleaseUpdate | null };

export function AboutSheet({ close }: { close: () => void }) {
  const { manualCheck, notify, setNotify } = useContext(UpdateContext)!;
  const [preferred, setPreferred] = useSetting<ReleaseSource>('updateSource', 'github');
  const [result, setResult] = useState<ReleaseCheck>({ status: 'idle' });
  const { open, error } = useExternalLink();
  const [checkedAt, setCheckedAt] = useState(0);
  const latest = result.status === 'ready' ? result.release : null;
  const targets = [...downloadLinks(latest), { url: officialWebsite, file: false }];
  const probes = useQueries({ queries: targets.map(({ url, file }) => ({
    queryKey: ['release-link', checkedAt, url], queryFn: () => checkLinkAccess(url, file), enabled: checkedAt > 0,
    staleTime: Infinity, gcTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, networkMode: 'always' as const,
  })) });
  const access = checkedAt ? Object.fromEntries(targets.map(({ url }, index) =>
    [url, probes[index].data ?? (probes[index].isError ? '无法连接' : '正在检测…')])) : {};
  const checking = result.status === 'checking' || probes.some(probe => probe.isFetching);
  const source = preferred === 'gitcode' ? 'gitcode' : 'github';
  async function check() {
    setCheckedAt(Date.now());
    setResult({ status: 'checking' });
    try { setResult({ status: 'ready', release: await manualCheck(source) }); }
    catch { setResult({ status: 'unavailable' }); }
  }
  const status = result.status === 'unavailable' ? '暂时无法查询发布版本，可按访问检测结果选择下载入口。' : result.status !== 'ready' ? '' :
    !latest ? '发布源暂无 ' + packageFormats[platform] + ' 安装包。' :
    isNew(latest) ? '发现新版本 ' + latest.tag + (latest.prerelease ? ' · 预发布' : '') : '当前已是最新版本。';
  return <Sheet title="关于 LeapMore" sub={'LeapMore ' + __LEAPMORE_VERSION__} close={close} showClose>
    <p className="confirm-desc">{disclaimer}</p>
    <a className="row tap" href={officialWebsite} onClick={open} target="_blank" rel="noreferrer">
      <span className="t">LeapMore 官网<small>leapmore.mirato66.cloud</small>{access[officialWebsite] && <small role="status">{access[officialWebsite]}</small>}</span><span className="v"><Icon name="external" size={16} /></span>
    </a>
    <Section title="更新设置">
      <div className="row"><span className="t">打开时提醒新版本</span><Switch label="打开时提醒新版本" checked={notify} action={() => setNotify(!notify)} /></div>
      <Seg current={source} options={sources} disabled={checking}
        choose={next => { setPreferred(next); setCheckedAt(0); setResult({ status: 'idle' }); }} label="首选更新源" />
      {sources.map(([key, label]) => {
        const url = releaseRepositoryUrl(key, repositories[key]);
        return <a key={key} className="row tap" href={url} onClick={open} target="_blank" rel="noreferrer">
          <span className="t">{label}<small>{url}</small></span><span className="v"><Icon name="external" size={16} /></span>
        </a>;
      })}
    </Section>
    <button className="btn accent" onClick={() => void check()} disabled={checking}>{checking ? '正在检查…' : '检查更新'}</button>
    {status && <p role="status">{status}</p>}
    <UpdateLinks release={latest} open={open} access={access} />
    {error && <p role="status">{error}</p>}
    <details className="about-license">
      <summary>开源许可 · GNU GPL v3.0</summary>
      <p>版权所有 © 2026 MiRaToo。本软件按 GNU GPL v3.0 授权并无担保提供，可按许可条款再分发。</p>
      <pre className="about-license-text" tabIndex={0}>{licenseText}</pre>
    </details>
  </Sheet>;
}
