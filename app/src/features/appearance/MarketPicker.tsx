import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMarketColors, fetchMarketModels, fetchMarketVariants } from '../../data/cloud/market';
import type { MarketColor, MarketEnergy } from '../../data/cloud/market';

import { Picker, YearPicker } from '../../ui/Picker';

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
  const variants = useQuery({ queryKey: ['market', 'variants', model, code], enabled: catalog.isSuccess && !!code,
    queryFn: ({ signal }) => fetchMarketVariants(model, code!, signal), retry: false, staleTime: 3_600_000 });
  const base = variants.data ?? [];
  const probeYear = !!year && !base.some(row => row.year === year) && (variants.isSuccess || variants.isError);
  const exact = useQuery({ queryKey: ['market', 'year', model, year], enabled: probeYear,
    queryFn: ({ signal }) => fetchMarketVariants(model, year + model, signal, year), retry: false, staleTime: 3_600_000 });
  const rows = [...(probeYear ? exact.data ?? [] : []), ...base];
  const years = [...new Set(rows.map(row => row.year))].sort().reverse();
  const shownYear = year || years[0] || '';
  const fetching = catalog.isFetching || variants.isFetching || probeYear && exact.isFetching;
  const lookupFailed = variants.isError || probeYear && exact.isError;
  const request = useRef<AbortController>();
  useEffect(() => () => request.current?.abort(), []);
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
      const controller = new AbortController();
      request.current = controller;
      const colors = await fetchMarketColors(chosen, controller.signal);
      controller.signal.throwIfAborted();
      if (!colors.length) { setNote('该版本暂无可用的商城车漆图片。'); return; }
      const paint = colors.find(item => item.color === selection?.color) ?? colors[0]!;
      select({ model, year: chosen.year, energy: chosen.energy, trim: chosen.trim, variantId: chosen.id, colors, color: paint.color, image: paint.url });
    } catch { if (!request.current?.signal.aborted) setNote('暂时无法读取商城图片，请重试。'); }
    finally { setBusy(false); }
  }

  return <div className="c3d-sec">
    <div className="c3d-sec-h">2D 商城车模</div>
    <label className="market-line"><span>车型</span><Picker aria-label="车型" className="setting-select" value={model} disabled={busy} onValue={v => { setModel(v); setYear(''); setEdition(''); setNote(''); }}>
      {[...models.keys()].map(name => <option key={name}>{name}</option>)}
    </Picker></label>
    <label className="market-line"><span>年款</span><YearPicker value={shownYear} years={years} disabled={busy}
      onValue={v => { setYear(v); setEdition(''); setNote(''); }} /></label>
    <label className="market-line"><span>动力</span><Picker aria-label="动力" className="setting-select" value={shownEnergy ?? ''} disabled={busy || !energies.length}
      onValue={v => { setEnergy(v as MarketEnergy); setEdition(''); setNote(''); }}>
      {!energies.length && <option value="">—</option>}{energies.map(value => <option key={value}>{value}</option>)}
    </Picker></label>
    <label className="market-line"><span>版本</span><Picker aria-label="版本" className="setting-select" value={chosen?.id ?? ''} disabled={busy || !chosen}
      onValue={v => { setEdition(v); setNote(''); }}>
      {!chosen && <option value="">—</option>}{editions.map(row => <option value={row.id} key={row.id}>{row.trim}</option>)}
    </Picker></label>
    <button className="btn secondary sm" disabled={!chosen || busy} onClick={() => void loadColors()}>{busy ? '读取颜色中…' : '查询商城车模'}</button>
    {palette.length > 0 && selection && <div className="market-line"><span>车漆</span><div className="market-trims" role="group" aria-label="商城车漆">
      {palette.map(paint => <button key={paint.color} className={selection.color === paint.color ? 'on' : ''} aria-pressed={selection.color === paint.color}
        onClick={() => select({ ...selection, color: paint.color, image: paint.url })}>{paint.color}</button>)}
    </div></div>}
    {(note || fetching || !chosen) && <p className="tiny muted" role="status">{note || (fetching ? '正在读取商城配置…' :
      lookupFailed ? '商城连接失败，可重新查询。' : shownYear ? '暂未查到 ' + model + ' ' + shownYear + ' 款的外观图。' : '暂未查到这个车型的商城配置。')}</p>}
    {!fetching && !chosen && lookupFailed && <button className="link" onClick={() => {
      if (variants.isError) void variants.refetch();
      if (probeYear && exact.isError) void exact.refetch();
    }}>重新查询</button>}
    {!fetching && !chosen && years.length > 0 && <div className="market-line"><span>可用年款</span><div className="market-trims">
      {years.map(y => <button key={y} onClick={() => { setYear(y); setEdition(''); setNote(''); }}>{y} 款</button>)}</div></div>}

  </div>;
}
