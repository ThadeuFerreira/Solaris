// Hints that map a location to the distributor that most likely serves it.
// ANEEL publishes concession areas only as GIS layers, so the main
// distributor of each state is matched by name against the agents returned by
// the tariff API (names vary, e.g. "CPFL-PAULISTA" vs "CPFL PAULISTA").

const BY_UF: Record<string, string[]> = {
  AC: ['ENERGISA AC', 'ELETROACRE'],
  AL: ['EQUATORIAL AL', 'CEAL'],
  AM: ['AMAZONAS'],
  AP: ['CEA', 'EQUATORIAL AP'],
  BA: ['COELBA'],
  CE: ['ENEL CE', 'COELCE'],
  DF: ['NEOENERGIA DF', 'NEOENERGIA BRASILIA', 'CEB'],
  ES: ['EDP ES', 'ESCELSA'],
  GO: ['EQUATORIAL GO', 'ENEL GO', 'CELG'],
  MA: ['EQUATORIAL MA', 'CEMAR'],
  MG: ['CEMIG'],
  MS: ['ENERGISA MS', 'ENERSUL'],
  MT: ['ENERGISA MT', 'CEMAT'],
  PA: ['EQUATORIAL PA', 'CELPA'],
  PB: ['ENERGISA PB', 'EPB'],
  PE: ['NEOENERGIA PE', 'CELPE'],
  PI: ['EQUATORIAL PI', 'CEPISA'],
  PR: ['COPEL'],
  RJ: ['LIGHT', 'ENEL RJ', 'AMPLA'],
  RN: ['COSERN'],
  RO: ['ENERGISA RO', 'CERON'],
  RR: ['RORAIMA', 'BOA VISTA'],
  RS: ['CEEE', 'RGE'],
  SC: ['CELESC'],
  SE: ['ENERGISA SE', 'ESE'],
  SP: ['ENEL SP', 'ELETROPAULO', 'CPFL PAULISTA', 'ELEKTRO', 'EDP SP'],
  TO: ['ENERGISA TO', 'CELTINS'],
};

// Large cities served by a distributor other than the state's first hint.
const BY_CITY: Record<string, string[]> = {
  CAMPINAS: ['CPFL PAULISTA'],
  'RIBEIRAO PRETO': ['CPFL PAULISTA'],
  SOROCABA: ['CPFL PIRATININGA'],
  SANTOS: ['CPFL PIRATININGA'],
  GUARULHOS: ['EDP SP'],
  'SAO JOSE DOS CAMPOS': ['EDP SP'],
  NITEROI: ['ENEL RJ', 'AMPLA'],
  'CAXIAS DO SUL': ['RGE'],
  'SANTA MARIA': ['RGE'],
  'PASSO FUNDO': ['RGE'],
};

function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function matches(agent: string, hint: string): boolean {
  const tokens = normalise(agent).split(' ');
  return normalise(hint)
    .split(' ')
    .every((t) => tokens.includes(t));
}

/** Picks the most likely distributor among the available agent names. */
export function guessDistributor(agents: string[], uf: string | null, city: string | null): string | null {
  const hints = [...(city ? (BY_CITY[normalise(city)] ?? []) : []), ...(uf ? (BY_UF[uf] ?? []) : [])];
  for (const hint of hints) {
    const found = agents.find((a) => matches(a, hint));
    if (found) return found;
  }
  return null;
}

/** Modal ICMS rate per state for residential energy (2025/26), used as a default. */
export const ICMS_BY_UF: Record<string, number> = {
  AC: 19, AL: 20, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23, MG: 18, MS: 17,
  MT: 17, PA: 19, PB: 20, PE: 20.5, PI: 22.5, PR: 19.5, RJ: 20, RN: 20, RO: 19.5, RR: 20, RS: 17, SC: 17,
  SE: 20, SP: 18, TO: 20,
};
