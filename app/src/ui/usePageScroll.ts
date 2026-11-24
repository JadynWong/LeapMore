import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export function usePageScroll(ref: RefObject<HTMLDivElement>, page: string, { hideNavigation, rebound }: { hideNavigation: boolean; rebound: boolean }) {
  const [hidden, setHidden] = useState(false);
  useLayoutEffect(() => {
    const viewport = ref.current;
    const content = viewport?.firstElementChild as HTMLElement | null;
    setHidden(false);
    if (!viewport || !content || !hideNavigation && !rebound) return;
    let last = viewport.scrollTop, run = 0;
    let touch: { x: number; y: number; anchor: number } | null = null;
    let pull = 0;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    function resetPull() {
      touch = null;
      pull = 0;
      content!.classList.remove('scroll-pulling');
      content!.style.removeProperty('--page-pull');
    }
    function scroll() {
      const top = Math.max(0, viewport!.scrollTop);
      const delta = top - last;
      last = top;
      if (top < 12) { run = 0; setHidden(false); return; }
      if (!delta) return;
      run = Math.sign(run) === Math.sign(delta) ? run + delta : delta;
      if (run > 35 && top > 60) { setHidden(true); run = 0; }
      if (run < -18) { setHidden(false); run = 0; }
    }
    function start(event: TouchEvent) {
      if (motion.matches || event.touches.length !== 1 || (event.target as Element).closest('.amap-drag, .appearance-controls, dialog, input, textarea, select, [data-dragging]')) {
        resetPull(); return;
      }
      const point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, anchor: point.clientY };
    }
    function move(event: TouchEvent) {
      if (!touch || event.touches.length !== 1) { if (pull) resetPull(); return; }
      const point = event.touches[0];
      const dy = point.clientY - touch.y;
      if (Math.abs(point.clientX - touch.x) > Math.max(8, Math.abs(dy))) { resetPull(); return; }
      if ((event.target as Element).closest('[data-dragging]')) { resetPull(); return; }
      const distance = point.clientY - touch.anchor;
      const canPull = distance > 0 && viewport!.scrollTop <= 1 || distance < 0 &&
        viewport!.scrollHeight - viewport!.clientHeight - viewport!.scrollTop <= 1;
      if (!canPull) {
        touch.anchor = point.clientY;
        if (!pull) return;
      }
      pull = canPull ? distance / (3 + Math.abs(distance) / 36) : 0;
      content!.classList.add('scroll-pulling');
      content!.style.setProperty('--page-pull', `0 ${pull}px`);
    }
    if (hideNavigation) viewport.addEventListener('scroll', scroll, { passive: true });
    if (rebound) {
      viewport.addEventListener('touchstart', start, { passive: true });
      viewport.addEventListener('touchmove', move, { passive: true });
      viewport.addEventListener('touchend', resetPull, { passive: true });
      viewport.addEventListener('touchcancel', resetPull, { passive: true });
    }
    return () => {
      resetPull();
      viewport.removeEventListener('scroll', scroll);
      viewport.removeEventListener('touchstart', start);
      viewport.removeEventListener('touchmove', move);
      viewport.removeEventListener('touchend', resetPull);
      viewport.removeEventListener('touchcancel', resetPull);
    };
  }, [ref, page, hideNavigation, rebound]);
  return hideNavigation && hidden;
}
