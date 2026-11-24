import { useRef } from 'react';
import type { PointerEvent } from 'react';

export function usePlotScrub(pick: (element: HTMLDivElement, x: number) => void) {
  const drag = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null);
  function cancel() { drag.current = null; }
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!event.isPrimary || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const active = event.pointerType === 'mouse';
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, active };
      if (active) pick(event.currentTarget, event.clientX);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const start = drag.current;
      if (start?.id !== event.pointerId) return;
      if (!start.active) {
        const dx = Math.abs(event.clientX - start.x), dy = Math.abs(event.clientY - start.y);
        if (dy > 6 && dy > dx) { cancel(); return; }
        if (dx < 4) return;
        start.active = true;
      }
      pick(event.currentTarget, event.clientX);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (drag.current?.id === event.pointerId) pick(event.currentTarget, event.clientX);
      cancel();
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
}
