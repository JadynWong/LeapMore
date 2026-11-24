import { useEffect, useRef } from 'react';

export function useCardReorder<Card extends string>(editing: boolean, move: (from: Card, to: Card) => void) {
  const page = useRef<HTMLDivElement>(null);
  const reorder = useRef(move);
  reorder.current = move;

  useEffect(() => {
    const panel = page.current;
    if (!editing || !panel) return;
    type Press = { card: HTMLElement; id: number; x: number; y: number; active: boolean; timer: number };
    let press: Press | undefined;
    let target: HTMLElement | null = null;
    const viewport = panel.closest<HTMLElement>('.app-view');
    let scrollFrame = 0;
    let position = { x: 0, y: 0 };
    const cardAt = (element: Element | null) => element?.closest<HTMLElement>('[data-energy-card]') ?? null;
    function clear() {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      if (press) {
        clearTimeout(press.timer);
        press.card.removeAttribute('data-dragging');
      }
      target?.removeAttribute('data-drop-target');
      target = null;
      press = undefined;
    }
    function start(origin: EventTarget | null, id: number, x: number, y: number) {
      if (press || !(origin instanceof Element) || origin.closest('button, a, input, .energy-plot')) return;
      const card = cardAt(origin);
      if (!card) return;
      const timer = window.setTimeout(() => {
        if (!press) return;
        press.active = true;
        card.dataset.dragging = '';
      }, 240);
      press = { card, id, x, y, active: false, timer };
    }
    function updateTarget(x: number, y: number) {
      const hit = cardAt(document.elementFromPoint(x, y));
      const next = hit === press?.card ? null : hit;
      if (next === target) return;
      target?.removeAttribute('data-drop-target');
      target = next;
      if (target) target.dataset.dropTarget = '';
    }
    function scrollNearEdge() {
      scrollFrame = 0;
      if (!press?.active || !viewport) return;
      const { top, bottom } = viewport.getBoundingClientRect();
      const edge = 55;
      const step = position.y < top + edge ? -Math.min(12, (top + edge - position.y) / 5) :
        position.y > bottom - edge ? Math.min(12, (position.y - (bottom - edge)) / 5) : 0;
      if (!step) return;
      const before = viewport.scrollTop;
      viewport.scrollTop += step;
      if (before === viewport.scrollTop) return;
      updateTarget(position.x, position.y);
      scrollFrame = requestAnimationFrame(scrollNearEdge);
    }
    function movePress(id: number, x: number, y: number) {
      if (press?.id !== id) return false;
      if (!press.active) {
        if (Math.hypot(x - press.x, y - press.y) > 9) clear();
        return false;
      }
      position = { x, y };
      updateTarget(x, y);
      if (!scrollFrame) scrollNearEdge();
      return true;
    }
    function end(id: number, x: number, y: number) {
      if (press?.id !== id) return false;
      const active = press.active;
      const from = press.card.dataset.energyCard as Card;
      const to = cardAt(document.elementFromPoint(x, y))?.dataset.energyCard as Card | undefined;
      clear();
      if (active && to && from !== to) reorder.current(from, to);
      return active;
    }
    function touchStart(event: TouchEvent) {
      if (event.touches.length !== 1) { clear(); return; }
      const point = event.changedTouches[0];
      start(event.target, point.identifier, point.clientX, point.clientY);
    }
    function touchMove(event: TouchEvent) {
      const point = event.changedTouches[0];
      if (point && movePress(point.identifier, point.clientX, point.clientY) && event.cancelable) event.preventDefault();
    }
    function touchEnd(event: TouchEvent) {
      const point = event.changedTouches[0];
      if (point && end(point.identifier, point.clientX, point.clientY) && event.cancelable) event.preventDefault();
    }
    function mouseStart(event: PointerEvent) {
      if (event.pointerType !== 'touch' && event.isPrimary && event.button === 0) start(event.target, event.pointerId, event.clientX, event.clientY);
    }
    function mouseMove(event: PointerEvent) {
      if (event.pointerType !== 'touch') movePress(event.pointerId, event.clientX, event.clientY);
    }
    function mouseEnd(event: PointerEvent) {
      if (event.pointerType !== 'touch') end(event.pointerId, event.clientX, event.clientY);
    }
    function eventCancel(event: PointerEvent) { if (event.pointerType !== 'touch') clear(); }
    panel.addEventListener('touchstart', touchStart, { passive: true });
    panel.addEventListener('touchmove', touchMove, { passive: false });
    panel.addEventListener('touchend', touchEnd, { passive: false });
    panel.addEventListener('touchcancel', clear);
    panel.addEventListener('pointerdown', mouseStart);
    window.addEventListener('pointermove', mouseMove);
    window.addEventListener('pointerup', mouseEnd);
    window.addEventListener('pointercancel', eventCancel);
    window.addEventListener('blur', clear);
    return () => {
      clear();
      panel.removeEventListener('touchstart', touchStart);
      panel.removeEventListener('touchmove', touchMove);
      panel.removeEventListener('touchend', touchEnd);
      panel.removeEventListener('touchcancel', clear);
      panel.removeEventListener('pointerdown', mouseStart);
      window.removeEventListener('pointermove', mouseMove);
      window.removeEventListener('pointerup', mouseEnd);
      window.removeEventListener('pointercancel', eventCancel);
      window.removeEventListener('blur', clear);
    };
  }, [editing]);
  return page;
}
