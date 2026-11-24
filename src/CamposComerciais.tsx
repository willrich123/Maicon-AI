import {useState} from 'react';

type Campo = {id:string; rotulo:string; campo:string; tipo:string};
type Tela = {id:string; titulo:string; grupos:{nome:string; campos:Campo[]}[]};
export type ModuloComercial = {id:string; nome:string; telas:Tela[]};
const normalizar = (texto:string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const tipos: Record<string,string> = {texto:'Texto','texto-longo':'Texto longo',data:'Data',numero:'Número',booleano:'Sim ou não',coluna:'Coluna da grade'};

export function CamposComerciais({modulos}:{modulos:ModuloComercial[]}) {
  const [modulo, setModulo] = useState('');
  const [busca, setBusca] = useState('');
  const [tela, setTela] = useState('');
  const termo = normalizar(busca.trim());
  const resultados = modulos.filter(m => !modulo || m.id === modulo).flatMap(m =>
    m.telas.map(t => ({
      ...t, modulo:m.nome,
      grupos:t.grupos.map(g => ({
        ...g, campos:g.campos.filter(c => normalizar([m.nome,t.titulo,g.nome,c.rotulo,c.campo].join(' ')).includes(termo)),
      })).filter(g => g.campos.length),
    })).filter(t => !termo || t.grupos.length || normalizar(t.titulo).includes(termo)));
  const selecionada = resultados.find(t => t.id === tela);
  return <section className="mw-process-data">
    <p className="mc-vazio">Estrutura recuperada dos formulários do HeadCargo, incluindo campos e colunas de grade.</p>
    <div className="mc-filtros">
      <div className="mw-search"><span aria-hidden>⌕</span><input type="search" value={busca} maxLength={120} onChange={e=>setBusca(e.target.value)} aria-label="Pesquisar formulários e campos" placeholder="Buscar formulário ou campo"/></div>
      <select aria-label="Módulo" value={modulo} onChange={e=>{setModulo(e.target.value);setTela('');}}>
        <option value="">Todos os módulos</option>{modulos.map(m=><option key={m.id} value={m.id}>{m.nome}</option>)}
      </select>
    </div>
    <div className="mc-filtros mc-mapa-formulario"><label htmlFor="mc-formulario">Formulário</label>
      <select id="mc-formulario" value={selecionada?.id || ''} onChange={e=>setTela(e.target.value)}>
        <option value="">Selecione entre {resultados.length} formulários</option>
        {resultados.map(t=><option key={t.id} value={t.id}>{t.titulo} · {t.modulo}</option>)}
      </select>
    </div>
    {selecionada && !selecionada.grupos.length && <p className="mc-vazio">Nenhum campo recuperado para este formulário com os filtros atuais.</p>}
    {selecionada?.grupos.map(g=><section key={g.nome}>
      <div className="mw-table-heading"><h2>{g.nome}</h2><span>{g.campos.length} campos</span></div>
      <div className="ponte-tabela"><table><thead><tr><th scope="col">Campo</th><th scope="col">Vínculo no HeadCargo</th><th scope="col">Tipo</th></tr></thead>
        <tbody>{g.campos.map(c=><tr key={c.id}><td>{c.rotulo}</td><td>{c.campo||'—'}</td><td>{tipos[c.tipo]||c.tipo}</td></tr>)}</tbody>
      </table></div>
    </section>)}
  </section>;
}
