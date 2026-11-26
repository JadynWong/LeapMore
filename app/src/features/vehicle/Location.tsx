import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useModelContext } from '../context';
import { ControlNotice, useCommands } from './commands';
import { useVehicleControls } from './controls';
import { AmapView } from './AmapView';
import { AmapKeySheet, useAmapKey } from './AmapKey';
import { openAmapNavigation, useAmapAddress, useAmapSuggestions } from './amapServices';
import type { AmapPlace } from './amapServices';
import type { Favorite } from '../../data/preferences';
import { readSetting } from '../../data/localDatabase';
import { AppBar, Hint, Row, Section, Sheet, SheetButtons, stamp } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { mapPoint, resolveDestination } from './navigationDestination';

export { mapPoint } from './navigationDestination';
export function ParkingPhoto({ close }: { close: () => void }) {
  const m = useModelContext();
  const photo = useQuery({
    queryKey: ['cloud', 'parking-photo', m.vehicleId],
    queryFn: () => m.client!.getParkingPhoto(m.vehicleId),
    enabled: !!m.client && m.canSee('location'), retry: false, gcTime: 0,
  });
  const known = photo.data?.url?.startsWith('https://') ? photo.data.url : null;
  return <Sheet close={close} title="驻车照片">
    {known ? <img className="parking-photo" alt="车辆驻车照片" referrerPolicy="no-referrer" src={known} />
      : <p className="confirm-desc">{photo.isFetching ? '正在读取驻车照片…' : '当前数据源暂无驻车照片。'}</p>}
    <button className="btn ghost" onClick={close}>关闭</button>
  </Sheet>;
}
export function LocationPage() {
  const m = useModelContext();
  const { find, reason } = useVehicleControls();
  const command = useCommands();
  const [manage, setManage] = useState(false);
  const [configureKey, setConfigureKey] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [place, setPlace] = useState<AmapPlace | null>(null);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const navigationJob = useRef<AbortController | null>(null);
  const [loadingDestination, setLoadingDestination] = useState(false);
  const { key } = useAmapKey();
  useEffect(() => {
    setLoadingDestination(false);
    return () => { navigationJob.current?.abort(); navigationJob.current = null; };
  }, [m.vehicleId]);
  async function navigateTo(fav: Favorite) {
    const confirmation = { kind: 'navigation' as const, title: '发送导航到' + fav.name, description: fav.address, icon: 'locate' as const };
    if (m.simulated) { command.ask(confirmation); return; }
    if (!key && !fav.point) { setConfigureKey(true); return; }
    if (navigationJob.current && !navigationJob.current.signal.aborted) return;
    const job = new AbortController();
    navigationJob.current = job;
    setLoadingDestination(true);
    try {
      const destination = await resolveDestination(fav, key, m.vehicle?.abilities, job.signal);
      if (job.signal.aborted) return;
      command.ask({ ...confirmation, description: destination.address, remote: { kind: 'navigation', destination } });
    } catch {
      if (!job.signal.aborted) m.setToast('无法解析常用地址，请检查地址和高德 Key。');
    } finally {
      if (navigationJob.current === job) { navigationJob.current = null; setLoadingDestination(false); }
    }
  }
  const permitted = m.canSee('location');
  const raw = permitted ? m.current.location : null;
  const point = raw && raw.coordinate !== 'unknown' ? mapPoint(raw) : null;
  const formatted = raw ? raw.lat.toFixed(m.simulated ? 4 : 6) + ', ' + raw.lon.toFixed(m.simulated ? 4 : 6) : '暂无定位';
  const updated = raw ? m.simulated ? '2 分钟前' : stamp(raw.at) : '';
  const addressResult = useAmapAddress(point, !m.simulated);
  const suggestions = useAmapSuggestions(manage && removeIndex === null && !place ? address : '', point);
  const demoAddress = m.simulated && key && raw;
  const addressLabel = demoAddress ? '上海市浦东新区花木路 · 精度约 15 米' : addressResult.data;
  const favoriteIcons = ['home', 'car', 'bolt'] as const;
  return <><AppBar title="车辆位置" back="/home" sub={updated ? '定位 ' + updated : undefined} /><div className="page no-nav location-page">
    {!permitted ? <div className="card grant-card"><div className="confirm-ic"><Icon name="locate" /></div><b>车辆定位未授权</b>
      <Link className="link" to="/vehicle-access">查看车辆授权</Link></div> :
      <>
        <ControlNotice />
        <div className="bigmap location-map">
          {point ? <AmapView lat={point.lat} lon={point.lon} height={300} name="车辆位置" illustrated={m.simulated} /> :
            <p className="location-map-empty">{raw ? '坐标系未知，暂无法在地图定位。' : '尚未读取到车辆定位。'}</p>}
        </div>
        <section className="card location-card">
          <div className="location-summary"><div>
            <h2>{demoAddress ? '停车位 · 世纪公园' : addressLabel ? '车辆位置' : raw ? '坐标位置' : '暂无定位'}</h2>
            <p className="tiny muted">{addressLabel || (raw ? formatted + (!key ? ' · 未配置高德 Key，无法解析地址' : '') : '等待车辆位置更新，可检查定位实体映射。')}</p>
          </div>{updated && <span className="pill">{updated}</span>}</div>
          <div className="loc-actions">
            <button className="btn secondary sm" disabled={!point} onClick={() => {
              if (point) void openAmapNavigation(point, '车辆位置').catch(() => m.setToast('暂时无法打开高德地图'));
            }}>导航</button>
            <button className="btn secondary sm" disabled={!!reason('find')} onClick={find}>鸣笛寻车</button>
          </div>
        </section>
        {!key && <Hint>没有高德 Key 时只能显示坐标，无法把 GPS 解析成地址。<button className="link" onClick={() => setConfigureKey(true)}>去配置</button></Hint>}
        {addressResult.isError && <Hint kind="warn" icon="alert">地址解析失败，当前显示坐标。<button className="link" onClick={() => setConfigureKey(true)}>检查高德 Key</button></Hint>}
        <Section className="location-favorites" title={<>常用地址<button className="link more" onClick={() => setManage(true)}>管理</button></>}>
          {m.favorites.length ? m.favorites.map((fav, i) => <Row key={fav.name + ':' + i} icon={favoriteIcons[i] ?? 'locate'}
            title={fav.name} sub={fav.address} right="发送导航" label={'发送导航到' + fav.name}
            disabled={loadingDestination || !!reason('navigation')} onClick={() => void navigateTo(fav)} />) :
            <p className="tiny muted">暂无常用地址</p>}
        </Section>
        <details className="inline-details"><summary>定位说明</summary><p>地库或弱信号时，请留意最近的定位时间。</p></details>
      </>}
    {configureKey && <AmapKeySheet close={() => setConfigureKey(false)} />}
    {manage && removeIndex === null && <Sheet title="常用地址" sub="快捷发送到车机导航" close={() => setManage(false)} showClose className="favorites-sheet">
      {Object.keys(readSetting<Record<string, Favorite[]>>('favorites', {})).length > 0 && <p className="tiny muted">旧版常用地址未记录所属账号，因此不会自动显示。请为当前账号重新添加。</p>}
      {m.favorites.map((fav, i) => <div className="row" key={fav.name + ':' + i}><span className="ic"><Icon name="home" size={18} /></span>
        <span className="t">{fav.name}<small>{fav.address}</small></span><button className="link" aria-label={'删除' + fav.name} onClick={() => setRemoveIndex(i)}>删除</button></div>)}
      {m.favorites.length > 0 && <div className="divider" />}
      <form onSubmit={e => {
        e.preventDefault();
        if (!name.trim() || !address.trim()) return;
        m.setFavorites([...m.favorites, { name: name.trim(), address: address.trim(), point: place?.point }]);
        setName(''); setAddress(''); setPlace(null);
      }}>
        <div className="field"><input value={name} onChange={e => setName(e.target.value)} aria-label="名称" placeholder="名称（如 家 / 公司）" maxLength={30} /></div>
        <div className="field"><input value={address} onChange={e => { setPlace(null); setAddress(e.target.value); }} aria-label="地址"
          placeholder={key ? '搜索高德地点或输入地址' : '地址'} maxLength={100} autoComplete="off" /></div>
        {suggestions.places.length > 0 && <div className="address-suggestions" role="group" aria-label="高德地点建议">
          {suggestions.places.map((item, index) => <Row key={item.point.poiId ?? `${item.name}-${index}`} icon="locate"
            title={item.name} sub={item.address} onClick={() => {
              setPlace(item);
              setAddress([item.address, item.name].filter(Boolean).join(' · '));
            }} />)}
        </div>}
        {suggestions.failed && <p className="tiny muted" role="status">无法读取高德地点建议，可以手动填写地址。</p>}
        <button className="btn secondary sm" disabled={!name.trim() || !address.trim()}>添加常用地址</button>
      </form>
    </Sheet>}
    {removeIndex !== null && <Sheet title="删除常用地址？" close={() => setRemoveIndex(null)}><SheetButtons cancel={() => setRemoveIndex(null)} label="删除" action={() => {
      m.setFavorites(m.favorites.filter((_, i) => i !== removeIndex)); setRemoveIndex(null);
    }} /></Sheet>}
  </div></>;
}
