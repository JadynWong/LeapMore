import { useState } from 'react';
import type { Charge } from '../../data/ha/measurements';
import { Sheet } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useModelContext } from '../context';

export function EditChargeFee({ charge, estimated }: { charge: Charge; estimated?: number }) {
  const { chargeFees } = useModelContext();
  const manual = chargeFees.get(charge);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const normalized = draft?.normalize('NFKC').trim() ?? '';
  const amount = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized) ? Number(normalized) : NaN;
  const valid = Number.isSafeInteger(Math.round(amount * 100));
  const close = () => { if (!saving) setDraft(null); };
  async function save(next: number | null) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await chargeFees.save(charge, next);
      setDraft(null);
    } catch { setError('保存失败，请重试。'); }
    finally { setSaving(false); }
  }
  if (chargeFees.readError) return <button className="link" onClick={() => void chargeFees.retry()}>重新读取本次电费</button>;
  return <><button className="link" disabled={!chargeFees.ready} onClick={() => {
    setError('');
    setDraft(manual?.toFixed(2) ?? '');
  }}><Icon name="edit" size={14} />修改本次电费</button>
    {draft !== null && <Sheet title="修改本次电费" sub={estimated == null ? '本次暂无自动估算金额' : '自动估算 ¥' + estimated.toFixed(2)} close={close} showClose>
      <form className="charge-fee-form" onSubmit={event => { event.preventDefault(); if (valid) void save(amount); }}>
        <label>本次实付金额<div className="field"><input inputMode="decimal" value={draft} placeholder="0.00"
          aria-label="本次实付金额" aria-invalid={!!normalized && !valid} aria-describedby="charge-fee-hint"
          onChange={event => setDraft(event.target.value)} disabled={saving} /><span>元</span></div></label>
        <p className="tiny muted" id="charge-fee-hint">{normalized && !valid ? '请输入非负金额，最多保留两位小数。' : '金额保存在本机，可随时恢复自动估算。'}</p>
        {error && <p role="alert">{error}</p>}
        <div className="confirm-btns">{manual !== undefined && <button type="button" className="btn ghost" disabled={saving} onClick={() => void save(null)}>恢复自动估算</button>}
          <button className="btn accent" type="submit" disabled={!valid || saving}>{saving ? '正在保存…' : '保存'}</button></div>
      </form>
    </Sheet>}
  </>;
}
