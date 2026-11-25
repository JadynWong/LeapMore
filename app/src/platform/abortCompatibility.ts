// Some supported WebViews implement AbortController without these later additions.
export const abortCompatibility = {
  check: typeof AbortSignal !== 'undefined' && typeof AbortSignal.prototype.throwIfAborted !== 'function',
  timeout: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function',
};
if (abortCompatibility.check) {
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {
    configurable: true, writable: true,
    value(this: AbortSignal) {
      if (this.aborted) throw this.reason ?? new DOMException('Aborted', 'AbortError');
    },
  });
}
if (abortCompatibility.timeout) {
  Object.defineProperty(AbortSignal, 'timeout', {
    configurable: true, writable: true,
    value(ms: number) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return controller.signal;
    },
  });
}
