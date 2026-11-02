-- DESENHO DE REFERÊNCIA, não executar como migração. SQLite.
-- Implementação B1: server/migrations/002-energy-history.sql e 003-tariff-resolutions.sql.
-- A coleta de tarifas e bandeiras já está implementada por npm run collect:history.
-- A tabela de médias anuais foi criada, mas a ingestão SAMP ainda está pendente.
-- O desenho abaixo permite múltiplos perfis para uma expansão futura; a tabela
-- atual aceita exclusivamente o recorte residencial convencional B1 validado.
-- API validada em 2026-11-02, via GET sem chave:
-- https://dadosabertos.aneel.gov.br/api/3/action/datastore_search
-- Tarifas: resource_id=fcf2906c-7c32-4b9b-a637-054e7a5234f4
-- Bandeiras: resource_id=0591b8f6-fe54-437b-b72b-1aa2efd46e42
-- Histórico de consumo/receita: https://dadosabertos.aneel.gov.br/dataset/samp
-- Licença dos dados: ODbL 1.0; preservar atribuição e licença da base derivada.
--
-- O banco mantém tariffs, tariff_flags e meta para compatibilidade com a API.
-- A carga cadastra identidades por CNPJ e guarda todos os atos em tariff_history.
-- O cache tariffs seleciona o ato mais recente quando há o mesmo início de vigência.
-- O catálogo JSON incluído no aplicativo tem as siglas e os CNPJs para a carga inicial.
--
-- Valores monetários em milionésimos de R$/kWh (1 real = 1.000.000), inteiros.
-- Converter a unidade declarada pela ANEEL: R$/MWh / 1000 = R$/kWh.
-- Datas YYYY-MM-DD; timestamps UTC ISO 8601.

CREATE TABLE distributors (
  id INTEGER PRIMARY KEY,
  cnpj TEXT NOT NULL UNIQUE CHECK(length(cnpj) = 14 AND cnpj NOT GLOB '*[^0-9]*'),
  agent_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  source_url TEXT NOT NULL,
  source_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Permite carregar simulações antigas após mudanças de sigla.
CREATE TABLE distributor_aliases (
  agent_code TEXT PRIMARY KEY,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id)
);

CREATE TABLE tariff_history (
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  subgroup TEXT NOT NULL,
  modality TEXT NOT NULL,
  consumer_class TEXT NOT NULL,
  consumer_subclass TEXT NOT NULL,
  detail TEXT NOT NULL,
  tariff_post TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  tusd_microrl_per_kwh INTEGER NOT NULL CHECK(tusd_microrl_per_kwh >= 0),
  te_microrl_per_kwh INTEGER NOT NULL CHECK(te_microrl_per_kwh >= 0),
  resolution TEXT NOT NULL,
  source_resource_id TEXT NOT NULL,
  source_date TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  CHECK(end_date IS NULL OR end_date >= start_date),
  PRIMARY KEY(distributor_id, subgroup, modality, consumer_class,
              consumer_subclass, detail, tariff_post, start_date, resolution)
);

CREATE INDEX tariff_history_lookup ON tariff_history(distributor_id, start_date DESC);

-- Média observada no mercado cativo; não é média simples entre distribuidoras.
-- Calcular SUM(receita) / SUM(consumo em kWh) com o mesmo recorte de classe,
-- período, tributos e mercado. Validar primeiro os detalhamentos no dicionário SAMP.
-- Não somar registros de totalização e componentes da mesma receita/energia.
CREATE TABLE annual_tariff_averages (
  geography_type TEXT NOT NULL CHECK(geography_type IN ('country', 'region', 'state')),
  geography_code TEXT NOT NULL, -- BR, código da região ou UF
  reference_year INTEGER NOT NULL CHECK(reference_year >= 1991),
  consumer_class TEXT NOT NULL,
  tax_basis TEXT NOT NULL CHECK(tax_basis IN ('with_taxes', 'without_taxes')),
  includes_flags INTEGER NOT NULL CHECK(includes_flags IN (0, 1)),
  tariff_microrl_per_kwh INTEGER NOT NULL CHECK(tariff_microrl_per_kwh > 0),
  complete_year INTEGER NOT NULL CHECK(complete_year IN (0, 1)),
  data_through TEXT NOT NULL, -- última competência incluída, YYYY-MM
  methodology TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_resource_id TEXT NOT NULL,
  source_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(geography_type, geography_code, reference_year,
              consumer_class, tax_basis, includes_flags)
);

-- Ingestão proposta:
-- 1. Coleta manual implementada; atualização diária sob demanda na API existente.
--    Um agendamento da coleta completa ainda deve ser configurado, se desejado.
--    Paginar limit/offset até result.total.
-- 2. Validar a resposta inteira e fazer UPSERT numa transação, sem DELETE global.
-- 3. Atualizar meta.*_fetched_at apenas depois do commit de uma carga válida.
-- 4. Selecionar tarifa por perfil e start_date <= hoje <= end_date (quando houver).
-- 5. A falha de atualização não deve apagar tarifas nem as médias anuais salvas.
-- 6. Manter a tabela existente tariff_flags separada das tarifas-base.
-- 7. A UI informa fonte, vigência/ano e se usa dado antigo ou média nacional.
--
-- Prioridade de preço: valor manual da conta > tarifa vigente da selecionada >
-- última tarifa conhecida (rotulada histórica) > média nacional residencial do
-- último ano completo (rotulada estimativa). A média nacional ainda NÃO está
-- implementada no cálculo; hoje a UI identifica explicitamente o valor de exemplo.
-- Não reaplicar tributos ou bandeira quando já estiverem na média escolhida.
-- Geração solar x tarifa é valor bruto de referência; economia efetiva depende
-- de autoconsumo, compensação, cobrança de rede e mínimo faturável.
