import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { request } from '../../platform/network';
import { nativeSettings } from '../../platform/settings';
import { useAmapKey } from './AmapKey';

type Point = { lat: number; lon: number };
export type AmapPlace = { name: string; address: string; point: Point & { poiId?: string } };
const locationValue = ({ lat, lon }: Point) => `${lon.toFixed(5)},${lat.toFixed(5)}`;
const service = 'https://restapi.amap.com/v3/';

export function parseAmapPoint(value: unknown): Point | undefined {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value)) return undefined;
  const [lon, lat] = value.split(',').map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !lat && !lon) return undefined;
  return { lat, lon };
}

export function useAmapAddress(point: Point | null | undefined, enabled = true) {
  const { key, revision } = useAmapKey();
  const location = point ? locationValue(point) : '';
  return useQuery({ queryKey: ['amap', 'address', revision, location], enabled: enabled && !!key && !!location,
    staleTime: 15 * 60_000, gcTime: 30 * 60_000, retry: false, queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ location, key: key! });
      const reply = await request<{ status: string; regeocode?: { formatted_address?: string } }>(service + 'geocode/regeo?' + params, { signal });
      if (reply.status !== '1') throw new Error('地址解析失败，请检查高德 Key。');
      const address = reply.regeocode?.formatted_address;
      return typeof address === 'string' ? address.trim() : '';
    } });
}

export function useAmapSuggestions(input: string, origin: Point | null) {
  const { key, revision } = useAmapKey();
  const keyword = input.trim();
  const [settled, setSettled] = useState('');
  useEffect(() => {
    if (keyword.length < 2) return;
    const timer = setTimeout(() => setSettled(keyword), 280);
    return () => clearTimeout(timer);
  }, [keyword]);
  const location = origin ? `${origin.lon.toFixed(2)},${origin.lat.toFixed(2)}` : '';
  const enabled = !!key && !!settled && settled === keyword;
  const query = useQuery({ queryKey: ['amap', 'suggestions', revision, settled, location], enabled, retry: false,
    staleTime: 5 * 60_000, queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ key: key!, keywords: settled, datatype: 'poi', ...(location ? { location } : {}) });
      const result = await request<{ status: string; tips?: { name?: unknown; id?: unknown; location?: unknown; address?: unknown; district?: unknown }[] }>(
        service + 'assistant/inputtips?' + params, { signal });
      if (result.status !== '1') throw new Error('无法读取高德地点建议。');
      return (Array.isArray(result.tips) ? result.tips : []).flatMap((tip): AmapPlace[] => {
        const point = parseAmapPoint(tip.location);
        if (typeof tip.name !== 'string' || !tip.name.trim() || !point) return [];
        const address = [tip.district, tip.address].filter(value => typeof value === 'string' && value.trim()).join('');
        return [{ name: tip.name, address, point: { ...point, poiId: typeof tip.id === 'string' && tip.id ? tip.id : undefined } }];
      }).slice(0, 6);
    } });
  return { places: enabled ? query.data ?? [] : [], failed: enabled && query.isError };
}

export async function openAmapNavigation(point: Point, title: string) {
  const target = { dlat: point.lat.toFixed(6), dlon: point.lon.toFixed(6), dname: title, sourceApplication: 'LeapMore', dev: '0', t: '0' };
  const platform = Capacitor.getPlatform();
  const app = (platform === 'ios' ? 'iosamap://path?' : 'amapuri://route/plan/?') + new URLSearchParams(target);
  const web = 'https://uri.amap.com/navigation?' + new URLSearchParams({ to: `${target.dlon},${target.dlat}`, mode: 'car', src: 'LeapMore',
    callnative: Capacitor.isNativePlatform() ? '0' : '1' });
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LeapSettings')) {
    await nativeSettings.openAmap({ app, web });
  } else window.open(web, '_blank', 'noopener,noreferrer');
}
