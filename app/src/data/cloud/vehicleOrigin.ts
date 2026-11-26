export function vehicleServiceOrigin(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/\.leapmotor\.(com|cn)$/.test(url.hostname)
      || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
