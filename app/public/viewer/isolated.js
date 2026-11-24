// The opaque iframe receives only downloaded viewer assets from its parent.
window.addEventListener('message', async function start(event) {
  if (event.source !== parent || event.origin !== new URL(document.baseURI).origin || event.data?.t !== 'viewer-assets') return;
  window.removeEventListener('message', start);
  const urls = new Map(event.data.files.map(([path, bytes, type]) => [path, URL.createObjectURL(new Blob([bytes], { type }))]));
  const local = value => {
    try {
      const url = new URL(value, document.baseURI);
      return urls.get(url.pathname) ?? value;
    } catch { return value; }
  };
  const fetchAsset = window.fetch.bind(window);
  window.fetch = (input, options) => fetchAsset(input instanceof Request ? new Request(local(input.url), input) : local(input), options);
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...options) { return open.call(this, method, local(url), ...options); };
  const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { ...imageSrc, set(value) { imageSrc.set.call(this, local(value)); } });
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    return setAttribute.call(this, name, this instanceof HTMLImageElement && name.toLowerCase() === 'src' ? local(value) : value);
  };
  const WorkerFromBlob = Worker;
  window.Worker = class extends WorkerFromBlob {
    constructor(url, options) { super(local(url), options); }
    postMessage(data, ...options) { return super.postMessage(typeof data === 'string' ? local(data) : data, ...options); }
  };
  window.viewerAsset = local;
  window.viewerParentOrigin = event.origin;
  window.viewerParams = event.data.params;
  try { await import(local('./view.js')); }
  catch { parent.postMessage({ t: 'err', msg: '3D 素材未能加载。' }, event.origin); }
});
