import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { usePlotScrub } from './usePlotScrub';

export function useDailyPlot(rows: { day: string }[], width: number, left: number, right: number, active: boolean) {
  const [day, setDay] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const plot = useRef<HTMLDivElement>(null);
  const selected = rows.findIndex(row => row.day === day);
  const index = selected >= 0 ? selected : rows.length - 1;
  const spacing = (right - left) / Math.max(1, rows.length);
  const x = (i: number) => left + (i + .5) * spacing;

  useEffect(() => {
    if (!active) { setGuide(false); return; }
    function dismiss(event: globalThis.PointerEvent) {
      if (!plot.current?.contains(event.target as Node)) setGuide(false);
    }
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [active]);

  function choose(i: number) {
    if (!rows[i]) return;
    setDay(rows[i].day);
    setGuide(true);
  }
  function chooseAt(clientX: number) {
    const rect = plot.current?.querySelector('svg')?.getBoundingClientRect();
    if (!rect?.width) return;
    const column = ((clientX - rect.left) * width / rect.width - left) / spacing;
    choose(Math.max(0, Math.min(rows.length - 1, Math.floor(column))));
  }
  const scrub = usePlotScrub((_, clientX) => chooseAt(clientX));
  const bindings = {
    ...scrub,
    ref: plot,
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      choose(event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
        Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1))));
    },
  };
  return { bindings, guide, index, spacing, x };
}
