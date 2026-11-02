import { useId, useState } from 'react';
import { filterDistributors, type DistributorOption } from '../data/distributorCatalog';

interface Props {
  options: DistributorOption[];
  value: string | null;
  onChange: (distributor: string | null) => void;
  placeLabel: string | null;
}

export function DistributorSelect({ options, value, onChange, placeLabel }: Props) {
  const [query, setQuery] = useState('');
  const id = useId();
  const filtered = filterDistributors(options, query);
  const selectedOutsideSearch = options.find((entry) => entry.distributor === value && !filtered.includes(entry));

  return (
    <div>
      <label className="field" htmlFor={`${id}-search`}>
        <span>Buscar distribuidora</span>
        <input
          id={`${id}-search`}
          type="search"
          placeholder="Digite a sigla ou o CNPJ"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby={`${id}-count`}
        />
      </label>
      <label className="field" htmlFor={`${id}-select`}>
        <span>Distribuidora{placeLabel ? ` (local: ${placeLabel})` : ''}</span>
        <select id={`${id}-select`} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
          <option value="">Selecione sua distribuidora…</option>
          {selectedOutsideSearch && (
            <option value={selectedOutsideSearch.distributor}>{selectedOutsideSearch.distributor} (selecionada)</option>
          )}
          {filtered.map((entry) => (
            <option key={entry.distributor} value={entry.distributor}>{entry.distributor}</option>
          ))}
        </select>
      </label>
      <p className="hint" id={`${id}-count`} aria-live="polite">
        {filtered.length ? `${filtered.length} distribuidoras encontradas.` : 'Nenhuma distribuidora encontrada. Tente outra sigla ou CNPJ.'}
        {' '}Confira a sigla na sua conta de luz. Sua escolha será mantida ao mudar de local.
      </p>
    </div>
  );
}
