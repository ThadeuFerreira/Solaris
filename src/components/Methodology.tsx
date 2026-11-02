import { FLAG_DATASET_URL, TARIFF_DATASET_URL } from '../api/aneel';
import { SAMP_DATASET_URL } from '../api/samp';

export function Methodology() {
  return (
    <section className="card method" id="metodologia">
      <h2>Como o cálculo é feito</h2>
      <p>
        Esta é uma estimativa para planejamento. Um projeto real precisa de visita técnica, análise de sombreamento e
        aprovação da distribuidora.
      </p>

      <h3>Área e painéis</h3>
      <p>
        A área desenhada é a projeção horizontal vista do satélite. Os módulos são posicionados em fileiras perpendiculares à
        direção escolhida, respeitando o recuo das bordas. A inclinação encurta a projeção de cada módulo (cos θ). Em laje ou
        solo, as fileiras são afastadas para não se sombrearem entre 9h e 15h no solstício de inverno.
      </p>

      <h3>Sol e irradiação</h3>
      <ul>
        <li>
          Pela latitude: declinação solar, ângulo do pôr do sol e irradiação no topo da atmosfera (Duffie &amp; Beckman).
        </li>
        <li>
          Céu real: climatologia mensal de irradiação global horizontal e temperatura do{' '}
          <a href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer">
            NASA POWER
          </a>{' '}
          (médias de 2001–2020, dados de satélite). Se a API estiver indisponível, a irradiação é estimada pela latitude com
          índice de claridade típico de 0,52.
        </li>
        <li>
          No plano dos painéis: separação difusa/direta pela correlação de Erbs e modelo isotrópico de Liu &amp; Jordan, com
          integração ao longo do dia para qualquer orientação e albedo de 0,2.
        </li>
      </ul>

      <h3>Produção</h3>
      <p>
        Energia = potência (kWp) × horas de sol pleno × dias × (1 − perdas) × fator de temperatura. A temperatura da célula
        é estimada a partir da média mensal do ar e do NOCT do módulo. A degradação segue a garantia linear do fabricante
        (WEG: 12 anos de produto, 25 anos de performance).
      </p>

      <h3>Tarifa e economia</h3>
      <ul>
        <li>
          Tarifa: TUSD + TE residencial B1 convencional da{' '}
          <a href={TARIFF_DATASET_URL} target="_blank" rel="noreferrer">
            base de tarifas homologadas da ANEEL
          </a>
          , acrescida da{' '}
          <a href={FLAG_DATASET_URL} target="_blank" rel="noreferrer">
            bandeira tarifária vigente
          </a>{' '}
          e de tributos “por dentro”: preço = tarifa ÷ (1 − ICMS − PIS/COFINS).
        </li>
        <li>
          Quando a tarifa da distribuidora não está disponível, usamos a média nacional residencial do último ano completo
          {' '}validado do <a href={SAMP_DATASET_URL} target="_blank" rel="noreferrer">ANEEL/SAMP</a>:
          {' '}receita faturada dividida pelo consumo faturado. Essa referência já inclui os impostos e as bandeiras do ano,
          {' '}sem acrescentá-los novamente. O valor informado da conta de luz sempre tem prioridade.
        </li>
        <li>O reajuste anual padrão é a variação média da tarifa da distribuidora nos últimos 8 anos.</li>
        <li>
          Lei 14.300/2022: a energia injetada na rede passa a pagar parte do Fio B (15% em 2023, até 90% em 2028 e
          integral a partir de 2029, por hipótese). A energia consumida no momento da geração não é afetada.
        </li>
        <li>Com o consumo informado, a economia é limitada ao consumo acima do custo de disponibilidade.</li>
      </ul>

      <h3>Fontes abertas</h3>
      <ul>
        <li>Mapa: OpenStreetMap e imagens de satélite Esri World Imagery, com Leaflet e Leaflet-Geoman.</li>
        <li>Busca de endereços: Nominatim (OpenStreetMap).</li>
        <li>Irradiação e temperatura: NASA POWER.</li>
        <li>Tarifas e bandeiras: ANEEL Dados Abertos (CKAN).</li>
        <li>
          Cache local: o servidor do Solaris guarda tarifas e bandeiras (atualizadas a cada 24 h), a irradiação da NASA e
          as simulações salvas em um banco SQLite.
        </li>
        <li>
          Módulos WEG: datasheets oficiais em{' '}
          <a href="https://www.weg.net/" target="_blank" rel="noreferrer">
            weg.net
          </a>{' '}
          (a WEG não oferece API pública).
        </li>
      </ul>
    </section>
  );
}
