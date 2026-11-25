import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readDataset, updateDataset } from '../../data/localDatabase';
import { Sheet } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import type { Wrap } from './VehicleModel';

type Preset = { name: string; wrap: Wrap };

export function WrapPresets({ vehicleId, wrap, apply, close }: {
  vehicleId: string; wrap: Wrap; apply: (saved: Wrap) => void; close: () => void;
}) {
  const storeKey = 'wrap-presets:' + vehicleId;
  const client = useQueryClient();
  const queryKey = ['wrap-presets', vehicleId];
  const presets = useQuery({ queryKey, queryFn: async () => (await readDataset<Preset[]>(storeKey)) ?? [] });
  const [input, setInput] = useState('');
  const [deleting, setDeleting] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const writing = useRef(false);
  const name = input.trim();
  const existing = presets.data?.some(preset => preset.name === name);
  async function persist(key: string, remove = false) {
    if (!key || writing.current) return;
    writing.current = true;
    setBusy(true);
    setNotice('');
    try {
      await client.cancelQueries({ queryKey });
      const updated = await updateDataset<Preset[]>(storeKey, previous => {
        const rest = (previous ?? []).filter(preset => preset.name !== key);
        return remove ? rest : [{ name: key, wrap }, ...rest];
      });
      client.setQueryData(queryKey, updated);
      setDeleting('');
      if (!remove) setInput('');
      setNotice(remove ? '已删除「' + key + '」' : '已保存「' + key + '」');
    } catch {
      setNotice('预设未能写入本机，请重试。');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return <Sheet title="车衣预设" close={close} showClose className="wrap-preset-sheet">
    <form onSubmit={e => { e.preventDefault(); void persist(name); }}>
      <label htmlFor="wrap-preset-name">将当前整套车衣存为预设</label>
      <div className="wrap-preset-save"><input id="wrap-preset-name" aria-label="预设名称" placeholder="预设名称" value={input}
        onChange={e => setInput(e.target.value)} />
        <button className="btn accent sm" disabled={!name || busy || !presets.isSuccess}>{existing ? '更新同名预设' : '保存'}</button></div>
    </form>
    {presets.isError && <button className="link" onClick={() => void presets.refetch()}>读取失败，重新加载</button>}
    <p className="wrap-preset-notice" role="status">{notice || (presets.isLoading ? '正在读取预设…' : '')}</p>
    {presets.data?.length ? <ul className="wrap-preset-list">{presets.data.map(preset =>
      <li key={preset.name}>
        <div><strong>{preset.name}</strong><small>{Object.keys(preset.wrap).length ? Object.keys(preset.wrap).length + ' 个部位' : '原厂外观'}</small></div>
        {deleting === preset.name ? <>
          <button type="button" onClick={() => setDeleting('')} disabled={busy}>取消</button>
          <button type="button" className="remove" onClick={() => void persist(preset.name, true)} disabled={busy}>确认删除</button>
        </> : <>
          <button type="button" aria-label={'应用预设' + preset.name} disabled={busy} onClick={() => { apply(preset.wrap); close(); }}>应用</button>
          <button type="button" className="iconbtn" aria-label={'删除预设' + preset.name} disabled={busy}
            onClick={() => setDeleting(preset.name)}><Icon name="trash" size={17} /></button>
        </>}
      </li>)}</ul> : presets.isSuccess && <p className="muted">这辆车还没有保存的预设。</p>}
  </Sheet>;
}
