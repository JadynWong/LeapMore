// These upstream H5 builds reference the wrong CSV loader in CarC01 and skip
// forwarding callbacks registered before its CarNode exists.
const affected = new Set([
  '9d5d7318bc1abdc6f148343d0978febc71cdf21aa099b83c9d3d31486964f5a6',
  'ea1ab3f8ac19f281973d8ec2ad44d9ce0fba6ec479a6bb10cbc894266dc0f48e',
]);

export function needsC01Viewer(car: string | null, hash: string) {
  return car === 'C01' && affected.has(hash);
}

export function correctedC01Viewer(original: Uint8Array): Uint8Array {
  const source = new TextDecoder().decode(original);
  const createNode = 'this.__carNode__=new CarNode(this.cartype,this.caryear),';
  const forward = [
    'this.__onStarterCarLoadedCallbacks__.splice(0).forEach(cb=>this.__carNode__.addOnStarterCarLoadedCallback(cb))',
    'this.__pendingFullCarLoadedCallbacks__.splice(0).forEach(cb=>this.__carNode__.addOnFullCarLoadedCallback(cb))',
  ].join(',');
  return new TextEncoder().encode(source
    .replace('new CarModelModules(', 'new CarModelModules_CarModelModules(')
    .replace(createNode, createNode + forward + ','));
}
