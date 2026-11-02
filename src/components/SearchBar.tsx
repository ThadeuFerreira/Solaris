import { useRef, useState, type FormEvent } from 'react';
import { searchPlaces, type Place } from '../api/nominatim';

interface SearchBarProps {
  onSelect: (place: Place) => void;
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 3) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    try {
      const found = await searchPlaces(q, controller.signal);
      if (controller.signal.aborted) return;
      setStatus('idle');
      if (found.length === 1) {
        onSelect(found[0]);
        setResults(null);
      } else {
        setResults(found);
        setMessage(found.length ? '' : 'Nenhum resultado no Brasil para essa busca.');
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus('error');
      setResults([]);
      setMessage(`Busca indisponível: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <form className="search-bar" onSubmit={submit} role="search">
      <label className="visually-hidden" htmlFor="address">
        Endereço
      </label>
      <input
        id="address"
        type="search"
        placeholder="Endereço, bairro ou cidade (ex.: Av. Paulista 1000, São Paulo)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setResults(null)}
        autoComplete="street-address"
      />
      <button className="btn btn-primary" type="submit" disabled={status === 'loading'}>
        {status === 'loading' ? 'Buscando…' : 'Buscar'}
      </button>
      {results && (
        <ul className="search-results">
          {results.length === 0 && <li className="hint" style={{ padding: '8px 10px' }}>{message}</li>}
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onSelect(r);
                  setResults(null);
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
