import type { HAConfig } from './schema.ts';

export const historyKey = (config: HAConfig, vehicle: string, vin?: string) =>
  'entities-v2:' + JSON.stringify(vin ? [config.localScope, config.url, vehicle, vin] : [config.localScope, config.url, vehicle]);
export const ledgerKey = (config: HAConfig, vin: string) => 'ha-ledger-v3:' + JSON.stringify([config.localScope, config.url, vin, config.days]);
export const archivePointer = (config: HAConfig, vehicle: string) => 'archive-link-v2:' + JSON.stringify([config.localScope, config.url, vehicle]);
export const archiveKey = (config: HAConfig, source: string, dataset: string, vehicle: string) =>
  'archive-v2:' + JSON.stringify([config.localScope, source, dataset, vehicle]);
