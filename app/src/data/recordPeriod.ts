export const recordPeriods = [['week', '周'], ['month', '月'], ['year', '年'], ['all', '全']] as const;
export type RecordPeriod = typeof recordPeriods[number][0];
export const periodTitles = { week: '本周', month: '本月', year: '本年', all: '全部' };

export function periodStart(period: RecordPeriod, now = Date.now()) {
  if (period === 'all') return 0;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  else if (period === 'month') start.setDate(1);
  else start.setMonth(0, 1);
  return start.getTime();
}
