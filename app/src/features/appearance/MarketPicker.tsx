import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMarketColors, fetchMarketModels, fetchMarketVariants } from '../../data/cloud/market';
import type { MarketColor, MarketEnergy } from '../../data/cloud/market';

export type MarketSelection = { model: string; year: string; trim: string; energy?: MarketEnergy; variantId?: string;
  color?: string; image?: string; colors?: MarketColor[] };

export function MarketPicker({ car, year: carYear, energy: carEnergy, selection, select }: {
  car: string; year?: number; energy: MarketEnergy; selection?: MarketSelection; select: (next: MarketSelection) => void;
}) {
  const [model, setModel] = useState(selection?.model || car);
  const [year, setYear] = useState(selection?.year || String(carYear || ''));
  const [energy, setEnergy] = useState<MarketEnergy>(selection?.energy || carEnergy);
  const [edition, setEdition] = useState(selection?.variantId || '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const catalog = useQuery({ queryKey: ['market', 'catalog'], queryFn: ({ signal }) => fetchMarketModels(signal), staleTime: 3_600_000 });
  const models = new Map((catalog.data ?? []).map(row => [row.name, row.code]));
  if (model && !models.has(model)) models.set(model, model);
  const code = models.get(model);
  const preferredYear = model === car ? carYear : undefined;
  const variants = useQuery({ queryKey: ['market', 'variants', model, code, preferredYear], enabled: catalog.isSuccess && !!code,
    queryFn: ({ signal }) => fetchMarketVariants(model, code!, signal, preferredYear), retry: false, staleTime: 3_600_000 });
  const rows = variants.data ?? [];
  const years = [...new Set(rows.map(row => row.year))];
  const shownYear = years.includes(year) ? year : year ? '' : years[0] ?? '';
  const energies = [...new Set(rows.filter(row => row.year === shownYear).map(row => row.energy))];
  const shownEnergy = energies.includes(energy) ? energy : energies[0];
  const editions = rows.filter(row => row.year === shownYear && row.energy === shownEnergy);
  const chosen = editions.find(row => row.id === edition) ?? editions[0];
  const palette = chosen && chosen.id === selection?.variantId ? selection.colors ?? [] : [];

  async function loadColors() {
    if (!chosen || busy) return;
    setNote('');
    setBusy(true);
    try {
      const colors = await fetchMarketColors(chosen);
      if (!colors.length) { setNote('该版本暂无可用的商城车漆图片。'); return; }
      const paint = colors.find(item => item.color === selection?.color) ?? colors[0]!;
      select({ model, year: chosen.year, energy: chosen.energy, trim: chosen.trim, variantId: chosen.id, colors, color: paint.color, image: paint.url });
    } catch { setNote('暂时无法读取商城颜色，请稍后再试。'); }
    finally { setBusy(false); }
  }

  return <div className="c3d-sec">
    <div className="c3d-sec-h">2D 商城车模</div>
    <label className="market-line"><span>车型</span><select className="setting-select" value={model} disabled={busy} onChange={e => { setModel(e.target.value); setYear(''); setEdition(''); setNote(''); }}>
      {[...models.keys()].map(name => <option key={name}>{name}</option>)}
    </select></label>
    <label className="market-line"><span>年款</span><select className="setting-select" value={shownYear} disabled={busy || !years.length}
      onChange={e => { setYear(e.target.value); setEdition(''); setNote(''); }}>
      {!shownYear && <option value="" disabled>{years.length ? '选择年款' : '—'}</option>}{years.map(value => <option key={value}>{value}</option>)}
    </select></label>
    <label className="market-line"><span>动力</span><select className="setting-select" value={shownEnergy ?? ''} disabled={busy || !energies.length}
      onChange={e => { setEnergy(e.target.value as MarketEnergy); setEdition(''); setNote(''); }}>
      {!energies.length && <option value="">—</option>}{energies.map(value => <option key={value}>{value}</option>)}
    </select></label>
    <label className="market-line"><span>版本</span><select className="setting-select" value={chosen?.id ?? ''} disabled={busy || !chosen}
      onChange={e => { setEdition(e.target.value); setNote(''); }}>
      {!chosen && <option value="">—</option>}{editions.map(row => <option value={row.id} key={row.id}>{row.trim}</option>)}
    </select></label>
    <button className="btn secondary sm" disabled={!chosen || busy} onClick={() => void loadColors()}>{busy ? '读取颜色中…' : '查询商城车模'}</button>
    {palette.length > 0 && selection && <div className="market-line"><span>车漆</span><div className="market-trims" role="group" aria-label="商城车漆">
      {palette.map(paint => <button key={paint.color} className={selection.color === paint.color ? 'on' : ''} aria-pressed={selection.color === paint.color}
        onClick={() => select({ ...selection, color: paint.color, image: paint.url })}>{paint.color}</button>)}
    </div></div>}
    {(note || catalog.isFetching || variants.isFetching || variants.isSuccess && !rows.length) &&
      <p className="tiny muted" role="status">{note || (catalog.isFetching || variants.isFetching ? '正在读取商城配置…' : '暂未查到这个车型的官方商城配置。')}</p>}
  </div>;
}
