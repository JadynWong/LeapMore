export function maskPhone(value: string) {
  const digits = value.replace(/\s|-/g, '').replace(/^\+86/, '');
  return /^1\d{10}$/.test(digits) ? digits.slice(0, 3) + '****' + digits.slice(-4) : '';
}
