const cache = new Map<string, Intl.NumberFormat>();

function formatter(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(key);
  if (!f) cache.set(key, (f = new Intl.NumberFormat('pt-BR', options)));
  return f;
}

export function fmtNumber(value: number, digits = 0): string {
  return formatter(`n${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function fmtCompact(value: number): string {
  return formatter('compact', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function fmtBRL(value: number, digits = 0): string {
  return formatter(`brl${digits}`, {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function fmtPct(fraction: number, digits = 1): string {
  return `${fmtNumber(fraction * 100, digits)}%`;
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

export function fmtMonthYear(iso: string): string {
  const [y, m] = iso.split('-');
  const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return m ? `${names[Number(m) - 1]}/${y}` : iso;
}

export function fmtYears(years: number): string {
  let whole = Math.floor(years);
  let months = Math.round((years - whole) * 12);
  if (months === 12) {
    whole += 1;
    months = 0;
  }
  const y = whole === 1 ? '1 ano' : `${whole} anos`;
  const m = months === 1 ? '1 mês' : `${months} meses`;
  if (whole === 0) return m;
  return months ? `${y} e ${m}` : y;
}

export function compassName(deg: number): string {
  const names = ['Norte', 'Nordeste', 'Leste', 'Sudeste', 'Sul', 'Sudoeste', 'Oeste', 'Noroeste'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
