import { useLayoutEffect, useRef, useState } from 'react';

export function useChartReveal(active: boolean, hasData: boolean) {
  const revealed = useRef(false);
  const [playing, setPlaying] = useState(false);
  useLayoutEffect(() => {
    if (!active || !hasData) {
      setPlaying(false);
    } else if (!revealed.current) {
      revealed.current = true;
      setPlaying(true);
    }
  }, [active, hasData]);
  return {
    'data-reveal': active && playing ? '' : undefined,
    onAnimationEnd: () => setPlaying(false),
  };
}
