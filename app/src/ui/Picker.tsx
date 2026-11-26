import { Children, isValidElement, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Sheet, SheetButtons } from './components';

type FieldProps = { 'aria-label': string; value: string; onValue: (value: string) => void; disabled?: boolean };
type FrameProps = { label: string; display: ReactNode; disabled?: boolean; className?: string;
  children: (close: () => void) => ReactNode };

function PickerFrame({ label, display, children, disabled, className = '' }: FrameProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const displayId = useId();
  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  return <><button type="button" ref={trigger} className={'choice-trigger ' + className} aria-label={label}
    aria-haspopup="dialog" aria-describedby={displayId} aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
    <span id={displayId}>{display}</span><Icon name="chevrond" size={15} /></button>
    {open && createPortal(<Sheet title={label} close={close} showClose className="choice-sheet">{children(close)}</Sheet>, document.body)}</>;
}

type Option = { value?: string | number; disabled?: boolean; children?: ReactNode };
function OptionList({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = ref.current;
      const active = list?.querySelector<HTMLButtonElement>('[aria-pressed=true]');
      if (list && active) list.scrollTop = Math.max(0, active.offsetTop - (list.clientHeight - active.clientHeight) / 2);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={ref} className="choice-list" onKeyDown={e => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const choices = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled'));
    const index = choices.indexOf(e.target as HTMLButtonElement);
    if (index === -1) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : index + (e.key === 'ArrowDown' ? 1 : -1);
    choices[Math.max(0, Math.min(choices.length - 1, next))]?.focus();
  }}>{children}</div>;
}
function Choice({ value, active, disabled, choose, children }: { value: string; active: boolean; disabled?: boolean; choose: () => void; children: ReactNode }) {
  return <button type="button" className="choice-row" data-value={value} aria-pressed={active} disabled={disabled} onClick={choose}>
    <span>{children}</span>{active && <Icon name="check" size={17} />}</button>;
}
export function Picker({ value, onValue, children, className, disabled, 'aria-label': label }: Omit<FieldProps, 'value'> & {
  value: string | number; children: ReactNode; className?: string;
}) {
  const options = Children.toArray(children).filter(isValidElement<Option>).map(({ props }) => ({
    value: String(props.value ?? props.children), label: props.children, disabled: props.disabled,
  }));
  return <PickerFrame label={label} display={options.find(row => row.value === String(value))?.label ?? '请选择'} disabled={disabled} className={className}>
    {close => <OptionList>{options.map(row => <Choice key={row.value} value={row.value} active={row.value === String(value)}
      disabled={row.disabled} choose={() => { onValue(row.value); close(); }}>{row.label}</Choice>)}</OptionList>}</PickerFrame>;
}

export function YearPicker({ value, years, onValue, disabled }: { value: string; years: string[]; onValue: (year: string) => void; disabled?: boolean }) {
  return <PickerFrame label="年款" display={value ? value + ' 款' : '选择年款'} disabled={disabled}>
    {close => <YearForm value={value} years={years} apply={year => { onValue(year); close(); }} />}</PickerFrame>;
}
function YearForm({ value, years, apply }: { value: string; years: string[]; apply: (year: string) => void }) {
  const [draft, setDraft] = useState(value);
  return <><form className="choice-entry" onSubmit={e => { e.preventDefault(); if (/^[1-9]\d{3}$/.test(draft)) apply(draft); }}>
    <input aria-label="输入四位年份" inputMode="numeric" placeholder="输入四位年份" maxLength={4} value={draft}
      onFocus={e => e.currentTarget.select()} onChange={e => setDraft(e.target.value.replace(/\D/g, ''))} />
    <button className="btn accent sm" disabled={!/^[1-9]\d{3}$/.test(draft)}>确定</button></form>
    {years.length > 0 && <><h3 className="choice-caption">商城年款</h3><OptionList>{years.map(y =>
      <Choice key={y} value={y} active={y === value} choose={() => apply(y)}>{y} 款</Choice>)}</OptionList></>}</>;
}

const two = (n: number) => String(n).padStart(2, '0');
export function TimePicker(props: FieldProps) {
  return <PickerFrame label={props['aria-label']} display={props.value || '选择时间'} disabled={props.disabled}>
    {close => <TimeForm value={props.value} apply={props.onValue} close={close} />}</PickerFrame>;
}
function TimeForm({ value, apply, close }: { value: string; apply: FieldProps['onValue']; close: () => void }) {
  const [time, setTime] = useState((value || '00:00').split(':'));
  return <><div className="time-columns">{['小时', '分钟'].map((label, index) => <div key={label}>
    <h3 className="choice-caption">{label}</h3><OptionList>{Array.from({ length: index ? 60 : 24 }, (_, n) =>
      <Choice key={n} value={two(n)} active={time[index] === two(n)} choose={() => setTime(time.map((v, i) => i === index ? two(n) : v))}>{two(n)}</Choice>)}</OptionList>
    </div>)}</div><SheetButtons cancel={close} action={() => { apply(time.join(':')); close(); }} label="确定" /></>;
}

const isoDay = (d: Date) => String(d.getFullYear()).padStart(4, '0') + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
type DateProps = FieldProps & { min?: string; max?: string };
export function DatePicker(props: DateProps) {
  return <PickerFrame label={props['aria-label']} display={props.value || '选择日期'} disabled={props.disabled}>
    {close => <Calendar {...props} close={close} />}</PickerFrame>;
}
function Calendar({ value, min, max, onValue, close }: DateProps & { close: () => void }) {
  const initial = new Date((value || isoDay(new Date())) + 'T12:00:00');
  const [month, setMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [draft, setDraft] = useState(value);
  const date = new Date(draft + 'T12:00:00');
  const allowed = (day: string) => (!min || day >= min) && (!max || day <= max);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(draft) && Number.isFinite(+date) && isoDay(date) === draft && allowed(draft);
  const shift = (n: number) => new Date(month.getFullYear(), month.getMonth() + n, 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return <><div className="calendar-heading"><button type="button" className="iconbtn" aria-label="上个月" onClick={() => setMonth(shift(-1))}><Icon name="back" size={17} /></button>
    <b>{month.getFullYear()} 年 {month.getMonth() + 1} 月</b><button type="button" className="iconbtn" aria-label="下个月" onClick={() => setMonth(shift(1))}><Icon name="chevron" size={17} /></button></div>
    <div className="calendar-grid">{Array.from('一二三四五六日', d => <small key={d}>{d}</small>)}
      {Array.from({ length: (month.getDay() + 6) % 7 }, (_, i) => <span key={'blank' + i} />)}
      {Array.from({ length: days }, (_, i) => { const day = isoDay(new Date(month.getFullYear(), month.getMonth(), i + 1));
        return <button type="button" key={day} aria-label={day} disabled={!allowed(day)} aria-pressed={day === draft} onClick={() => setDraft(day)}>{i + 1}</button>; })}</div>
    <input className="choice-input" aria-label="输入日期" placeholder="YYYY-MM-DD" maxLength={10} value={draft} onChange={e => {
      const next = e.target.value; setDraft(next);
      const parsed = new Date(next + 'T12:00:00');
      if (/^\d{4}-\d{2}-\d{2}$/.test(next) && Number.isFinite(+parsed) && isoDay(parsed) === next) setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    }} /><SheetButtons cancel={close} disabled={!valid} action={() => { onValue(draft); close(); }} label="确定" /></>;
}

export function ColorPicker(props: FieldProps) {
  return <PickerFrame label={props['aria-label']} display={<><i className="choice-swatch" style={{ background: props.value }} />{props.value.toUpperCase()}</>}>
    {close => <ColorForm value={props.value} apply={props.onValue} close={close} />}</PickerFrame>;
}
function ColorForm({ value, apply, close }: { value: string; apply: FieldProps['onValue']; close: () => void }) {
  const [hex, setHex] = useState(value);
  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  const channels = [1, 3, 5].map(start => parseInt((valid ? hex : value).slice(start, start + 2), 16));
  return <><div className="color-preview" style={{ background: valid ? hex : value }} />
    {['红', '绿', '蓝'].map((label, i) => <label key={label} className="color-channel">{label}<input type="range" min={0} max={255} value={channels[i]}
      onChange={e => setHex('#' + channels.map((v, j) => (i === j ? e.target.valueAsNumber : v).toString(16).padStart(2, '0')).join(''))} /><span>{channels[i]}</span></label>)}
    <input className="choice-input" aria-label="十六进制颜色" value={hex} maxLength={7} onChange={e => setHex(e.target.value)} />
    <SheetButtons cancel={close} disabled={!valid} action={() => { apply(hex.toLowerCase()); close(); }} label="确定" /></>;
}
