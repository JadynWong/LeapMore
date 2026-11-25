export function widgetVectorSvg(xml) {
  const attribute = (source, key) => source.match(new RegExp('android:' + key + '="([^"]+)"'))[1];
  const width = attribute(xml, 'viewportWidth');
  const height = attribute(xml, 'viewportHeight');
  const paths = Array.from(xml.matchAll(/<path\s+([^>]+)\/>/g), ([, source]) => {
    const get = key => attribute(source, key);
    const fill = get('fillColor') === '#00000000' ? 'none' : 'black';
    return `<path d="${get('pathData')}" fill="${fill}" stroke="black" stroke-width="${get('strokeWidth')}" stroke-linecap="${get('strokeLineCap')}" stroke-linejoin="${get('strokeLineJoin')}"/>`;
  });
  if (!paths.length) throw Error('桌面卡片图标缺少路径');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths.join('')}</svg>`;
}
