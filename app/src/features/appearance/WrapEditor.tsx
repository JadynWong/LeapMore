import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { WrapPresets } from './WrapPresets';
import { texture, type Decoration, type Face, type useVehicleVisual } from './VehicleModel';

const faces = [['front', '车头'], ['rear', '车尾'], ['left', '左侧'], ['right', '右侧'], ['top', '车顶']] as const;
const patterns = [['solid', '纯色'], ['stripe', '条纹'], ['gradient', '渐变'], ['carbon', '碳纤维']] as const;
const colors = [['薄荷绿', '#2fb8a6'], ['冰川蓝', '#70a1c7'], ['靛紫', '#8b76bf'], ['珊瑚红', '#d9655d'],
  ['琥珀黄', '#dba848'], ['珍珠白', '#f3f0e9'], ['石墨黑', '#343b42']] as const;
const sliders = [['scale', '缩放', 20, 180, '%'], ['rotation', '旋转', -180, 180, '°'], ['x', '水平移动', 0, 100, '%'],
  ['y', '垂直移动', 0, 100, '%'], ['opacity', '不透明度', 0, 100, '%']] as const;
const blank: Decoration = { kind: 'solid', color: '#2fb8a6', x: 50, y: 50, scale: 100, rotation: 0, opacity: 85 };

async function upload(file: File) {
  if (file.size > 12_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择小于 12 MB 的 PNG、JPEG 或 WebP。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error('无法读取这张图片，请重新选择。'); }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', .8);
  } finally { URL.revokeObjectURL(url); }
}

type Visual = ReturnType<typeof useVehicleVisual>;
export function WrapEditor({ vehicleId, visual, ready, focusFace, finish }: {
  vehicleId: string; visual: Visual; ready: boolean; focusFace: (face: Face) => void; finish: () => void;
}) {
  const { wrap, setWraps } = visual;
  const [face, setFace] = useState<Face>('front');
  const [notice, setNotice] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const uploads = useRef(new Map<Face, symbol>());
  const pendingFocus = useRef<Face | null>(null);
  useEffect(() => {
    if (ready && pendingFocus.current) {
      focusFace(pendingFocus.current);
      pendingFocus.current = null;
    }
  }, [ready, focusFace]);
  useEffect(() => {
    const pending = uploads.current;
    return () => pending.clear();
  }, []);
  const applied = wrap[face];
  const material = applied ?? blank;
  const editableColor = material.kind !== 'carbon' && material.kind !== 'image';

  function selectFace(side: Face) {
    setFace(side);
    setNotice('');
    if (ready) focusFace(side);
    else pendingFocus.current = side;
  }
  function changeFace(update: Partial<Decoration>, side = face) {
    setWraps(previous => {
      const car = previous[vehicleId] ?? {};
      return { ...previous, [vehicleId]: { ...car, [side]: { ...(car[side] ?? blank), ...update } } };
    });
  }
  function choosePattern(kind: Decoration['kind']) {
    uploads.current.delete(face);
    setUploading(uploads.current.size);
    setNotice('');
    changeFace({ kind });
  }
  async function chooseImage(file: File) {
    const task = Symbol();
    uploads.current.set(face, task);
    setUploading(uploads.current.size);
    setNotice('');
    try {
      const image = await upload(file);
      if (uploads.current.get(face) === task) changeFace({ kind: 'image', image });
    } catch (error) {
      if (uploads.current.get(face) === task) setNotice(error instanceof Error ? error.message : '无法读取图片，请重试。');
    } finally {
      if (uploads.current.get(face) === task) {
        uploads.current.delete(face);
        setUploading(uploads.current.size);
      }
    }
  }
  function clear(all: boolean) {
    if (all) uploads.current.clear(); else uploads.current.delete(face);
    setUploading(uploads.current.size);
    setNotice('');
    setWraps(previous => {
      const next = all ? {} : { ...previous[vehicleId] };
      delete next[face];
      return { ...previous, [vehicleId]: next };
    });
  }

  return <section className="wrap-editor" id="appearance-settings" aria-labelledby="wrap-editor-title">
    <header className="wrap-header">
      <div><h2 id="wrap-editor-title">自定义车衣</h2><span>{visual.modelName}</span></div>
      <div className="wrap-header-actions"><button className="wrap-presets-button" disabled={uploading > 0} onClick={() => setPresetsOpen(true)}>预设</button>
        <button className="btn accent sm" disabled={uploading > 0} onClick={finish}>完成</button></div>
    </header>
    <div className="wrap-body">
      <div className="wrap-faces" role="group" aria-label="车身部位">{faces.map(([key, label]) =>
        <button key={key} aria-pressed={face === key} aria-label={label} aria-description={wrap[key] ? '已设置车衣' : undefined}
          onClick={() => selectFace(key)}>{label}{wrap[key] && <i />}</button>)}</div>
      {!ready && <p className="wrap-notice" role="status">图案可预览，车模加载后可查看上车效果。</p>}
      <div className="wrap-section-heading"><h3>图案</h3>
        <label className="wrap-upload"><Icon name="plus" size={15} />上传图片
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传车衣图片" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void chooseImage(file);
          }} /></label>
      </div>
      <div className="wrap-materials" role="group" aria-label="车衣图案">
        {([...patterns, ...(material.image ? [['image', '图片'] as const] : [])]).map(([kind, label]) =>
          <button key={kind} aria-pressed={applied?.kind === kind} onClick={() => choosePattern(kind)}>
            <span className="wrap-sample" style={{ backgroundImage: 'url(' + texture({ ...material, kind }) + ')' }}>
              {applied?.kind === kind && <i><Icon name="check" size={12} /></i>}
            </span><span>{label}</span>
          </button>)}
      </div>
      {(notice || uploading > 0) && <p className="wrap-notice" role="status">{notice || '正在导入图片…'}</p>}
      {editableColor && <div className="wrap-colors">
        <div className="wrap-section-heading"><h3>颜色</h3>
          <label className="wrap-custom-color"><Icon name="palette" size={15} /><span>{material.color.toUpperCase()}</span>
            <input type="color" value={material.color} aria-label="自定义车衣颜色" onChange={e => changeFace({ color: e.target.value })} /></label>
        </div>
        <div className="wrap-palette" role="group" aria-label="车衣颜色">{colors.map(([label, hex]) =>
          <button key={hex} aria-label={label} aria-pressed={!!applied && material.color.toLowerCase() === hex}
            onClick={() => changeFace({ color: hex })}><i style={{ backgroundColor: hex }} /></button>)}</div>
      </div>}
      <details className="wrap-adjustments">
        <summary><Icon name="climatePresets" size={18} /><span>位置与透明度</span><Icon name="chevrond" size={16} /></summary>
        {sliders.map(([key, label, min, max, unit]) => <label className="wrap-slider" key={key}><span>{label}</span>
          <input type="range" min={min} max={max} aria-label={label} value={material[key]} aria-valuetext={material[key] + unit}
            onChange={e => changeFace({ [key]: e.target.valueAsNumber })} /><output>{material[key]}{unit}</output></label>)}
      </details>
      <div className="wrap-clear"><button disabled={!applied} onClick={() => clear(false)}>清除本面</button>
        <button disabled={!Object.keys(wrap).length} onClick={() => clear(true)}>清除全部</button></div>
    </div>
    {presetsOpen && <WrapPresets vehicleId={vehicleId} wrap={wrap} close={() => setPresetsOpen(false)} apply={saved => {
      uploads.current.clear();
      setNotice('');
      setWraps(previous => ({ ...previous, [vehicleId]: saved }));
    }} />}
  </section>;
}
