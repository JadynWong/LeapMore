import { useEffect, useState } from 'react';
import { secureGet, secureRemove, secureSet } from '../../platform/secure';
import { Sheet, SheetButtons } from '../../ui/components';
import { useExternalLink } from '../settings/useExternalLink';

const storageKey = 'amap-key';
const changed = 'leapmore-amap-key-changed';
let revision = 0;

export function useAmapKey() {
  const [config, setConfig] = useState<{ key?: string; revision: number }>({ revision });
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const latest = revision;
      void secureGet<string>(storageKey).then(value => {
        if (active && latest === revision) setConfig({ key: value ?? undefined, revision: latest });
      }).catch(() => {});
    };
    refresh();
    window.addEventListener(changed, refresh);
    return () => { active = false; window.removeEventListener(changed, refresh); };
  }, []);
  return config;
}

export function AmapKeySheet({ close }: { close: () => void }) {
  const { key } = useAmapKey();
  const external = useExternalLink();
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  async function update(remove: boolean) {
    const next = value.trim();
    if (!remove && !/^[0-9a-fA-F]{32}$/.test(next)) { setNotice('请输入 32 位高德 Web 服务 Key。'); return; }
    setSaving(true);
    try {
      if (remove) await secureRemove(storageKey);
      else await secureSet(storageKey, next);
      revision++;
      window.dispatchEvent(new Event(changed));
      close();
    } catch { setNotice(remove ? '清除失败。' : '无法安全保存 Key。'); }
    finally { setSaving(false); }
  }

  return <Sheet title="高德地图 Key" className="amap-key-sheet" sub="Web 服务 Key · 只存本机" close={close} showClose>
    <p className="amap-key-purpose">配置后，首页和车辆位置页可显示停车地址，行程详情可显示起点和终点地址。添加常用地址时可以搜索地点，也可以把手填地址转换为车机导航目的地。</p>
    <ol className="amap-key-steps">
      <li><strong>注册高德开发者</strong>
        <p>进入<a href="https://lbs.amap.com/" onClick={external.open} target="_blank" rel="noreferrer">高德开放平台官网</a>，用手机号注册或登录，完成实名认证。</p></li>
      <li><strong>创建密钥</strong>
        <p>进入<a href="https://console.amap.com/dev/key/app" onClick={external.open} target="_blank" rel="noreferrer">控制台 → 我的应用</a>，点击「创建新应用」。在应用中添加 Key，服务平台选择「Web 服务」，将生成的 Key 粘贴到下方并保存。</p></li>
    </ol>
    {external.error && <p className="tiny muted" role="status">{external.error}</p>}
    <div className="field"><input type="password" aria-label="高德地图 Key" autoComplete="off" value={value}
      onChange={e => setValue(e.target.value)} placeholder={key ? '已配置 · 可输入新 Key' : '粘贴高德 Web 服务 Key'} /></div>
    {notice && <p className="tiny muted" role="status">{notice}</p>}
    <SheetButtons cancel={close} label="保存" disabled={saving} action={() => void update(false)} />
    {key && <button className="btn ghost" disabled={saving} onClick={() => void update(true)}>清除自填 Key</button>}
  </Sheet>;
}
