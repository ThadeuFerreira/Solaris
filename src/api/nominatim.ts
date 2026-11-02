// OpenStreetMap Nominatim geocoding. Usage policy: at most one request per
// second and no autocomplete — searches only run when the user submits.
// https://operations.osmfoundation.org/policies/nominatim/

import { fetchJson } from './http';

const BASE = 'https://nominatim.openstreetmap.org';

export interface Place {
  lat: number;
  lng: number;
  label: string;
}

export interface PlaceDetails {
  uf: string | null;
  state: string | null;
  city: string | null;
}

interface SearchItem {
  lat: string;
  lon: string;
  display_name: string;
}

interface ReverseItem {
  address?: Record<string, string>;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    countrycodes: 'br',
    limit: '6',
    'accept-language': 'pt-BR',
  });
  const items = await fetchJson<SearchItem[]>(`${BASE}/search?${params}`, { signal });
  return items.map((i) => ({ lat: Number(i.lat), lng: Number(i.lon), label: i.display_name }));
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<PlaceDetails> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'jsonv2',
    zoom: '10',
    addressdetails: '1',
    'accept-language': 'pt-BR',
  });
  const data = await fetchJson<ReverseItem>(`${BASE}/reverse?${params}`, { signal });
  const a = data.address ?? {};
  const iso = a['ISO3166-2-lvl4'] ?? '';
  return {
    uf: iso.startsWith('BR-') ? iso.slice(3) : null,
    state: a.state ?? null,
    city: a.city ?? a.town ?? a.municipality ?? a.village ?? null,
  };
}
