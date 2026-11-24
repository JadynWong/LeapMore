const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

export function repeatLabel(days: number[]) {
  return days.length === 7 ? '每天' : days.length ? days.map(day => '周' + weekdays[day]).join('、') : '仅一次';
}

export function WeekdaySelector({ days, label, disabled, change }: {
  days: number[] | null; label: string; disabled: boolean; change: (days: number[]) => void;
}) {
  return <div className="preheat-repeat">
    <div className="between tiny muted"><span>重复</span><span>{days === null ? '—' : days.length ? '' : '仅一次'}</span></div>
    <div className="preheat-week" role="group" aria-label={label}>{weekdays.map((day, index) => <button key={day} type="button"
      aria-label={'周' + day} aria-pressed={days?.includes(index) ?? false} disabled={disabled}
      onClick={() => change(days?.includes(index) ? days.filter(value => value !== index) : [...(days ?? []), index].sort((a, b) => a - b))}>{day}</button>)}</div>
  </div>;
}
