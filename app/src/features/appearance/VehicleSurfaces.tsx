import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Home } from '../vehicle/Home';
import { AppearancePage } from './pages';
import type { AppearancePanel } from './pages';
import { useVehicleVisual, VehicleModel } from './VehicleModel';
import type { Face, ModelStatus } from './VehicleModel';

export function VehicleSurfaces({ view }: { view: 'home' | 'appearance' | null }) {
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<ModelStatus>('loading');
  const [panel, setPanel] = useState<AppearancePanel>('settings');
  const visual = useVehicleVisual(paused, !!view);
  const root = useRef<HTMLDivElement>(null);
  const homeSlot = useRef<HTMLDivElement>(null);
  const appearanceSlot = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  function focusFace(face: Face) {
    scene.current?.querySelector('iframe')?.contentWindow?.postMessage({ t: 'wrap-face', face }, visual.cloud.data?.webId ? '*' : location.origin);
  }
  const atHome = view === 'home';
  useEffect(() => { if (atHome) setPaused(false); }, [atHome]);
  useLayoutEffect(() => {
    const container = root.current, target = scene.current;
    const slot = view === 'home' ? homeSlot.current : view === 'appearance' ? appearanceSlot.current : null;
    if (!container || !target || !slot) return;
    function position() {
      const outer = container!.getBoundingClientRect();
      const box = slot!.getBoundingClientRect();
      Object.assign(target!.style, { top: box.top - outer.top + 'px', left: box.left - outer.left + 'px', width: box.width + 'px', height: box.height + 'px' });
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(slot);
    observer.observe(container);
    return () => observer.disconnect();
  }, [view]);

  return <div className="vehicle-surfaces" data-view={view} ref={root} hidden={!view}>
    <div hidden={!atHome}><Home active={atHome} modelSlot={homeSlot} /></div>
    <div className="appearance-route" hidden={view !== 'appearance'}>
      <AppearancePage active={view === 'appearance'} show={panel} setShow={setPanel} visual={visual} setPaused={setPaused} modelStatus={status} modelSlot={appearanceSlot} focusFace={focusFace} />
    </div>
    <div className="vehicle-scene" ref={scene}>
      <VehicleModel visual={visual} home={atHome} editingWrap={view === 'appearance' && panel === 'wrap'} onStatus={setStatus} />
    </div>
  </div>;
}
