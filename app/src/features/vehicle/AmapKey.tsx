import { useEffect, useState } from 'react';
import { secureGet, secureRemove, secureSet } from '../../platform/secure';
import { Hint, Sheet, SheetButtons } from '../../ui/components';

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

  return <Sheet title="高德地图 Key" sub="Web 服务 Key · 只存本机" close={close} showClose>
    <Hint>高德 Web 服务 Key 用于把车辆 GPS 坐标解析成地址。</Hint>
    <a className="link small" href="https://lbs.amap.com/api/webservice/gettingstarted" target="_blank" rel="noreferrer">查看高德 Web 服务 API 配置</a>
    <div className="field"><input type="password" aria-label="高德地图 Key" autoComplete="off" value={value}
      onChange={e => setValue(e.target.value)} placeholder={key ? '已配置 · 可输入新 Key' : '粘贴高德 Web 服务 Key'} /></div>
    {notice && <p className="tiny muted" role="status">{notice}</p>}
    <SheetButtons cancel={close} label="保存" disabled={saving} action={() => void update(false)} />
    {key && <button className="btn ghost" disabled={saving} onClick={() => void update(true)}>清除自填 Key</button>}
  </Sheet>;
}
