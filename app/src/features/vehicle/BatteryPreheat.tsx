import { Picker, TimePicker } from '../../ui/Picker';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { samePreheatPlan, validPreheatTime } from '../../data/cloud/preheat';
import type { PreheatSchedule, PreheatSettings } from '../../data/cloud/preheat';
import { Section, Switch } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useModelContext } from '../context';
import { useCommands } from './commands';
import { usePreheatSchedules } from './chargeSchedules';
import { repeatLabel, WeekdaySelector } from './WeekdaySelector';

const empty: PreheatSettings = { enabled: false, start: '07:00', days: [] };

export function BatteryPreheat() {
  const model = useModelContext();
  const command = useCommands();
  const qc = useQueryClient();
  const [selected, select] = useState('');
  const [draft, setDraft] = useState<Partial<PreheatSettings>>({});
  const { schedules, permitted, canRead, key } = usePreheatSchedules();
  const plans = schedules.data ?? [];
  const active = plans.find(plan => plan.id === selected) ?? plans[0];
  const saved = active ?? empty;
  const fields = { enabled: draft.enabled ?? saved.enabled, start: draft.start ?? saved.start, days: draft.days ?? saved.days };
  const ready = permitted && schedules.data !== undefined && (model.simulated || canRead);
  const blocked = !ready || schedules.isError || !!command.reason('preheat');
  const changed = !samePreheatPlan(fields, saved);
  const status = !permitted ? '未授权' : !canRead ? '当前为只读接入' : schedules.isError ? '预约暂不可用' : '正在读取…';

  function save() {
    if (blocked || !changed || !validPreheatTime(fields.start)) return;
    command.ask({ kind: 'preheat', title: fields.enabled ? '保存电池预热预约' : '关闭电池预热预约', icon: 'flame',
      description: fields.enabled ? fields.start + ' · ' + repeatLabel(fields.days) : undefined,
      remote: { kind: 'preheat', edit: { ...fields, previous: active } }, onComplete: () => setDraft({}),
      apply: () => qc.setQueryData<PreheatSchedule[]>(key, previous => {
        const plan = { ...fields, id: active?.id ?? 'demo-preheat' };
        return active ? (previous ?? []).map(row => row.id === active.id ? plan : row) : [plan];
      }),
    });
  }

  return <Section>
    <div className="cRow"><span className="cIC"><Icon name="flame" size={18} /></span><span className="cL">电池预热预约</span>
      {ready ? <Switch checked={fields.enabled} label="电池预热预约" disabled={blocked}
        action={() => setDraft(previous => ({ ...previous, enabled: !fields.enabled }))} /> : <span className="tiny muted" role="status">{status}</span>}
    </div>
    {canRead && schedules.isError && <div className="between"><span className="tiny muted" role="status">暂时无法读取已有预约。</span>
      <button type="button" className="btn secondary sm" disabled={schedules.isFetching} onClick={() => void schedules.refetch()}>重新读取</button></div>}
    {ready && plans.length > 1 && <div className="schedule-grid preheat-time"><label>选择预约<Picker aria-label="选择预约" value={active.id} disabled={blocked}
      onValue={v => { select(v); setDraft({}); }}>
      {plans.map((plan, index) => <option key={plan.id} value={plan.id}>{index + 1} · {plan.start} · {plan.enabled ? '已开启' : '已关闭'}</option>)}
    </Picker></label></div>}
    {ready && fields.enabled && <>
      <div className="schedule-grid"><label>预热开始时间<TimePicker aria-label="预热开始时间" value={fields.start} disabled={blocked}
        onValue={v => setDraft({ ...draft, start: v })} /></label>
        <div className="schedule-readonly"><span>结束时间</span><b>车辆自动结束</b></div>
      </div>
      <WeekdaySelector days={fields.days} label="预热重复日期" disabled={blocked} change={days => setDraft({ ...draft, days })} />
    </>}
    {ready && (fields.enabled || changed) && <button type="button" className="btn secondary sm" disabled={blocked || !changed || !validPreheatTime(fields.start)}
      onClick={save}>保存预热预约</button>}
  </Section>;
}
