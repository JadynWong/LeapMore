import md5 from 'blueimp-md5';

// Legacy favorites were keyed only by vehicle and have no trustworthy owner.
export function favoriteScope(mode: string | null, cloudKey: string, haScope: string | undefined, vin: string, vehicleId: string) {
  const parts = mode === 'cloud' && cloudKey ? ['cloud', cloudKey] :
    mode === 'ha' && haScope && vin ? ['ha', haScope, vin] :
    mode === 'demo' && vehicleId ? ['demo', vehicleId] : null;
  return parts ? md5(JSON.stringify(parts)) : '';
}
