import {useCallback, useEffect, useState} from 'react';
import {MaiconOperacional} from './MaiconOperacional';
import {CabecalhoWorkspace, RecolherWorkspace} from './CabecalhoWorkspace';
import {CamposComerciais, type ModuloComercial} from './CamposComerciais';
import {RascunhoComercial} from './RascunhoComercial';
import {EdicaoProposta, type CamposEdicao} from './EdicaoProposta';
import './estilos/comercial-web.css';

type Valor = string | number | boolean | null;
type Linha = Record<string, Valor>;
type Lista = {linhas: Linha[]; temMais: boolean};
type Secao = {id: string; nome: string};
type Proposta = {dados: Linha; secoes: Secao[]};
const situacoes = ['Todas as situações', 'Aguardando aprovação', 'Aprovada', 'Não aprovada', 'Não enviada', 'Pré-proposta', 'Enviada'];
const modulos = [
  {id: 'propostas', nome: 'Propostas'},
  {id: 'ofertas', nome: 'Ofertas'},
  {id: 'tarifario', nome: 'Tarifários'},
  {id: 'contratos', nome: 'Contratos de frete'},
];
const abasProposta = [
  ['proposta','Proposta'],['carga','Carga'],['detention','Tarifas detention'],['comissoes','Comissões'],
  ['taxas','Taxas'],['atividades','Atividades'],['acompanhamentos','Acompanhamentos'],['mensagens','Mensagens'],
  ['arquivos','Arquivos'],['fechamento','Fechamento'],
];
const subAbasProposta = [
  ['contatos','Contatos'],['viagens','Embarque'],['informacoes','Informações'],['remarks','Remarks'],
  ['condicoes','Condições'],['instrucoes','Instruções'],['adicionais','Informações adicionais'],
  ['dadosProposta','Dados da proposta'],['processos','Processos gerados'],['ofertas','Ofertas'],
  ['contatosProjeto','Contatos vinculados'],['freeTime','Free time'],
];
const abasEmbarque = [
  ['viagens','Viagens'],['embarqueClassico','Embarque clássico'],['escalas','Escalas e transbordos'],
  ['coletaEntrega','Coleta e entrega'],['complemento','Complemento'],['servicos','Serviços'],
];

async function consultar<T>(body: object, signal: AbortSignal, prazo=25000): Promise<T> {
  const r = await fetch('/api/ponte/web/comercial', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(prazo)]),
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados) throw Error(dados?.erro || 'Não foi possível consultar o Comercial.');
  return dados;
}

function valor(v: Valor) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return v.toLocaleString('pt-BR', {maximumFractionDigits: 6});
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString('pt-BR', {timeZone:'UTC'});
  return v;
}

function Tabela({linhas, abrir, abrirTarifario}: {linhas: Linha[]; abrir?: (numero:string,chave:number)=>void; abrirTarifario?: (linha:Linha)=>void}) {
  if (!linhas.length) return <p className="mc-vazio">Nenhum registro encontrado.</p>;
  const colunas = Object.keys(linhas[0]).filter(c => c !== 'chave');
  return <div className="ponte-tabela"><table>
    <thead><tr>{colunas.map(c => <th key={c} scope="col">{c === 'Situacao' ? 'Situação' : c}</th>)}{abrirTarifario && <th scope="col">Detalhes</th>}</tr></thead>
    <tbody>{linhas.map((linha, i) => <tr key={i}>{colunas.map(c => <td key={c}>
      {c === 'Proposta' && abrir && linha[c] ? <button className="mw-ask-row" onClick={() => abrir(String(linha[c]),Number(linha.chave))}>{valor(linha[c])} ↗</button>
      : c === 'Processo' && linha[c] ? <a href={'/headcargo?processo='+encodeURIComponent(String(linha[c]))}>{valor(linha[c])} ↗</a>
      : <span className={['Aprovada','Concluída'].includes(String(linha[c])) ? 'mw-status-concluida' : undefined}>{valor(linha[c])}</span>}
    </td>)}{abrirTarifario && <td><button className="mw-ask-row" onClick={() => abrirTarifario(linha)}>Ver taxas ↗</button></td>}</tr>)}</tbody>
  </table></div>;
}

export function ComercialWeb() {
  const [modulo, setModulo] = useState('propostas');
  const [tarifarios, setTarifarios] = useState<Secao[]>([]);
  const [tipo, setTipo] = useState('maritimo');
  const [tarifario, setTarifario] = useState<Linha>();
  const [busca, setBusca] = useState('');
  const [estado, setEstado] = useState(0);
  const [numero, setNumero] = useState('');
  const [chave, setChave] = useState(0);
  const [detalhe, setDetalhe] = useState<Proposta>();
  const [secao, setSecao] = useState('contatos');
  const [lista, setLista] = useState<Lista>();
  const [listaLateral,setListaLateral]=useState<Linha[]>([]);
  const [pagina, setPagina] = useState(0);
  const [revisao, setRevisao] = useState(0);
  const [erro, setErro] = useState('');
  const [erroDetalhe, setErroDetalhe] = useState('');
  const [ocupado, setOcupado] = useState(true);
  const [ia, setIa] = useState(true);
  const [recolhida, setRecolhida] = useState(false);
  const [pedido, setPedido] = useState<{id:number; texto:string}>();
  const [ambiente,setAmbiente]=useState('');
  const [usuario,setUsuario]=useState('');
  const [rascunho,setRascunho]=useState(false);
  const [edicao,setEdicao]=useState(false);
  const [mapa,setMapa]=useState<ModuloComercial[]>();
  const carregarEdicao=useCallback((oferta:number|null,sinal:AbortSignal)=>
    consultar<CamposEdicao>({acao:'camposEdicao',numero,chave,oferta},sinal),[numero,chave]);

  useEffect(() => {
    const ac = new AbortController();
    void consultar<{tarifarios: Secao[]}>({acao: 'configuracao'}, ac.signal)
      .then(d => {if (!ac.signal.aborted) setTarifarios(d.tarifarios);})
      .catch(() => {});
    void fetch('/api/ponte/identidade',{signal:ac.signal}).then(async r => {
      if(!r.ok)return;
      const d=await r.json();
      if(!ac.signal.aborted){setAmbiente(d.ambiente||'');setUsuario(d.usuario||'');}
    }).catch(()=>{});
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!numero) return;
    const ac = new AbortController();
    setErroDetalhe('');
    void consultar<Proposta>({acao:'proposta', numero, chave}, ac.signal)
      .then(d => {if (!ac.signal.aborted) setDetalhe(d);})
      .catch(e => {if (!ac.signal.aborted) setErroDetalhe(e.message);});
    return () => ac.abort();
  }, [numero, chave, revisao]);

  useEffect(() => {
    const ac = new AbortController();
    if (numero && !detalhe) return;
    setOcupado(true);
    setErro('');
    if (modulo==='mapa') {
      void consultar<{modulos:ModuloComercial[]}>({acao:'mapa'},ac.signal)
        .then(d=>{if(!ac.signal.aborted)setMapa(d.modulos);})
        .catch(e=>{if(!ac.signal.aborted)setErro(e.message);})
        .finally(()=>{if(!ac.signal.aborted)setOcupado(false);});
      return ()=>ac.abort();
    }
    const filtros = tarifario ? {acao:'tarifarioDetalhe', secao:tipo, id:tarifario.chave, pagina}
      : numero ? {acao:'secao', numero, chave, secao, pagina}
      : {acao:modulo, secao:tipo, busca, estado, pagina};
    const timer = setTimeout(() => {
      void consultar<Lista>(filtros, ac.signal)
        .then(d => {
          if (!ac.signal.aborted) {
            setLista(atual => pagina && atual ? {...d, linhas:[...atual.linhas,...d.linhas]} : d);
            if (!numero && ['propostas','ofertas'].includes(modulo)) {
              setListaLateral(atual=>pagina?[...atual,...d.linhas]:d.linhas);
            }
          }
        })
        .catch(e => {
          if (!ac.signal.aborted) {
            setErro(e.message);
          }
        })
        .finally(() => {if (!ac.signal.aborted) setOcupado(false);});
    }, numero || tarifario ? 0 : 240);
    return () => {clearTimeout(timer); ac.abort();};
  }, [numero, chave, Boolean(detalhe), secao, modulo, tipo, tarifario, busca, estado, pagina, revisao]);

  function reiniciarLista() {
    setLista(undefined);
    setPagina(0);
    setOcupado(true);
    setErro('');
  }
  function abrir(n: string, id=0) {
    if (n === numero && id === chave) return;
    reiniciarLista();
    setErroDetalhe('');
    setDetalhe(undefined);
    setPedido(undefined);
    setEdicao(false);
    setSecao('contatos');
    setNumero(n);
    setChave(id);
  }
  function mudarModulo(id: string) {
    setRascunho(false);
    setEdicao(false);
    if (id === modulo && !numero && !tarifario) return;
    if (numero) abrir('');
    setTarifario(undefined);
    setListaLateral([]);
    reiniciarLista();
    setModulo(id);
    setBusca('');
    setEstado(0);
  }
  function atualizar() {
    reiniciarLista();
    setRevisao(v => v + 1);
  }

  const menus = [...(tarifarios.length ? modulos : modulos.slice(0,2)),{id:'mapa',nome:'Mapa de campos'}];
  const titulo = menus.find(m => m.id === modulo)?.nome;
  const secoes = numero ? detalhe?.secoes : modulo === 'tarifario' ? tarifarios : [];
  const selecionada = numero ? secao : tipo;
  const abaEmbarque=abasEmbarque.some(([id])=>id===secao);
  const abaProposta=abaEmbarque||subAbasProposta.some(([id])=>id===secao);
  const buscar=(texto:string)=>{
    if(numero)abrir('');
    setListaLateral([]);
    reiniciarLista();
    setBusca(texto);
  };
  return <div className="ponte mw-workspace mc-workspace">
    <CabecalhoWorkspace area="comercial" ambiente={ambiente} painelIA={ia} alternarIA={()=>setIa(v=>!v)}/>
    <div className={'mw-shell'+(ia?'':' mw-sem-ia')+(recolhida?' mw-sidebar-recolhida':'')}>
      <aside className="mw-processes" aria-label="Módulos comerciais">
        <div className="mw-sidebar-title">
          <RecolherWorkspace recolhida={recolhida} alternar={()=>setRecolhida(v=>!v)} alvo="mc-modulos" descricao="módulos comerciais"/>
          <h2>Comercial</h2><button className="mw-sidebar-new" onClick={()=>setRascunho(true)} aria-label="Montar proposta com IA">✦ Proposta</button>
        </div>
        <div className="mw-process-list mc-menu" id="mc-modulos">{menus.map(m => <button key={m.id} aria-current={m.id===modulo?'page':undefined} className={m.id===modulo?'mw-process-selected':''} onClick={() => mudarModulo(m.id)}><div><strong>{m.nome}</strong><span>↗</span></div></button>)}</div>
        {modulo==='propostas'&&<>
          <div className="mw-search"><span aria-hidden>⌕</span><input type="search" value={busca} maxLength={120} onChange={e=>buscar(e.target.value)} placeholder="Buscar proposta ou cliente" aria-label="Buscar proposta ou cliente"/></div>
          <div className="mw-list-label"><span>PROPOSTAS</span><span>{listaLateral.length}</span></div>
          <div className="mw-process-list">{listaLateral.map(l=><button key={String(l.chave)} className={chave===l.chave?'mw-process-selected':''} onClick={()=>abrir(String(l.Proposta),Number(l.chave))}>
            <div><strong>{valor(l.Proposta)}</strong><span>↗</span></div><p>{valor(l.Cliente)}</p><small>{valor(l.Situacao)}<span>{valor(l.Data)}</span></small>
          </button>)}</div>
        </>}
        <footer><a href="/headcargo/catalogo?modulo=ConsultasComerciais.hsm">Consultas no catálogo ↗</a></footer>
      </aside>
      <main className="mw-main">
        <div className="mw-page-path">Comercial <span>/</span> {titulo}{numero && <> <span>/</span> {numero}</>}</div>
        {edicao ? <EdicaoProposta carregar={carregarEdicao} fechar={()=>setEdicao(false)}/> : rascunho ? <RascunhoComercial
          origem={detalhe?numero:undefined} fechar={()=>setRascunho(false)}
          gerar={async (briefing,sinal)=>(await consultar<{texto:string}>({
            acao:'rascunho',briefing,...(detalhe?{numero,chave}:{}),
          },sinal,55000)).texto}
        /> : <>
        {!numero && modulo==='propostas' ? <div className="mw-overview mc-overview">
          <span className="mw-eyebrow">CENTRAL COMERCIAL</span>
          <h1>Propostas e ofertas</h1>
          <p>Selecione uma proposta para consultar a versão, as ofertas e os campos do HeadCargo.</p>
          <div className="mw-overview-actions">
            <button onClick={()=>setRascunho(true)}><span>✦</span><strong>Montar proposta com IA</strong><p>Gere um rascunho a partir de um briefing.</p></button>
            <button onClick={()=>mudarModulo('mapa')}><span>☷</span><strong>Mapa de campos</strong><p>Consulte os formulários e vínculos recuperados do HeadCargo.</p></button>
          </div>
        </div> : <header className="mw-detail-title">
          <div><h1>{tarifario ? 'Taxas do tarifário' : numero || titulo}</h1>{detalhe && <p>{valor(detalhe.dados.Cliente)}</p>}
            {tarifario && <p>{valor(tarifario['Transportadora ou parceiro'])}</p>}</div>
          {detalhe && <span className="mw-badge">{valor(detalhe.dados.Situacao)}</span>}
        </header>}
        {tarifario ? <div className="mw-context-actions"><button onClick={() => {reiniciarLista();setTarifario(undefined);}}>← Voltar aos tarifários</button></div> : numero ? <>
          <div className="mw-context-actions">
            {detalhe && <button onClick={()=>setRascunho(true)}>✦ Montar proposta com IA</button>}
            {detalhe && ambiente==='homologacao' && <button onClick={()=>setEdicao(true)}>Preparar alterações</button>}
            {detalhe && <button onClick={() => {setIa(true);setPedido({id:Date.now(),texto:'Resuma a proposta e compare suas ofertas.'});}}>✦ Analisar com Maicon</button>}
            <button onClick={() => abrir('')}>← Voltar à lista</button>
            <button onClick={atualizar}>↻ Atualizar</button>
          </div>
          {detalhe && <dl className="mw-process-meta mc-ficha">{Object.entries(detalhe.dados).filter(([c]) => !['Proposta','Cliente','Situacao'].includes(c)).map(([c,v]) => <div key={c}><dt>{c}</dt><dd>{valor(v)}</dd></div>)}</dl>}
        </> : modulo==='mapa' ? mapa && <CamposComerciais modulos={mapa}/> : <div className="mc-filtros">
          <div className="mw-search"><span aria-hidden>⌕</span><input value={busca} maxLength={120} aria-label="Pesquisar registros comerciais" placeholder={modulo==='propostas'||modulo==='ofertas'?'Buscar número ou cliente':'Buscar número ou parceiro'} onChange={e => {reiniciarLista();setBusca(e.target.value);}}/></div>
          {(modulo==='propostas'||modulo==='ofertas') && <select aria-label="Situação da proposta" value={estado} onChange={e => {reiniciarLista();setEstado(Number(e.target.value));}}>{situacoes.map((s,i) => <option key={i} value={i}>{s}</option>)}</select>}
          <button onClick={atualizar} disabled={ocupado}>↻ Atualizar</button>
        </div>}
        {numero && detalhe && <>
          <nav className="hc-secoes mc-secoes" aria-label="Dados da proposta">{abasProposta.filter(([id])=>id==='proposta'||secoes?.some(s=>s.id===id)).map(([id,nome])=>
            <button key={id} aria-current={(id==='proposta'?abaProposta:secao===id)?'page':undefined} onClick={()=>{const destino=id==='proposta'?'contatos':id;if(destino!==secao){reiniciarLista();setSecao(destino);}}}>{nome}</button>)}</nav>
          {abaProposta&&<nav className="op-subtabs" aria-label="Seções da proposta">{subAbasProposta.map(([id,nome])=>
            <button key={id} aria-current={(id===secao||(id==='viagens'&&abaEmbarque))?'page':undefined} onClick={()=>{if(id!==secao){reiniciarLista();setSecao(id);}}}>{nome}</button>)}</nav>}
          {abaEmbarque&&<nav className="op-subtabs mc-embarque" aria-label="Seções de embarque">{abasEmbarque.map(([id,nome])=>
            <button key={id} aria-current={id===secao?'page':undefined} onClick={()=>{if(id!==secao){reiniciarLista();setSecao(id);}}}>{nome}</button>)}</nav>}
        </>}
        {!numero && !tarifario && !!secoes?.length && <nav className="hc-secoes mc-secoes" aria-label="Tipos de tarifário">{secoes.map(s => <button key={s.id} aria-pressed={s.id===selecionada} onClick={() => {if(s.id===selecionada)return;reiniciarLista();setTipo(s.id);}}>{s.nome}</button>)}</nav>}
        {(erroDetalhe || erro) && <div className="mw-alert" role="alert">{erroDetalhe || erro}<button onClick={atualizar}>Tentar novamente</button></div>}
        {ocupado && !lista && !erroDetalhe && <p className="mw-loading" role="status">Consultando o HeadCargo…</p>}
        {lista && <>
          <Tabela linhas={lista.linhas} abrir={numero?undefined:abrir} abrirTarifario={modulo==='tarifario'&&!tarifario?linha=>{reiniciarLista();setTarifario(linha);}:undefined}/>
          <footer className="ponte-rodape"><span role="status">{ocupado?'Carregando…':lista.linhas.length+' registros exibidos'}</span>
            {lista.temMais && <button disabled={ocupado || !!erro} onClick={() => setPagina(p => p+1)}>Ver mais</button>}</footer>
        </>}
        </>}
        <footer className="mw-page-footer"><span>{usuario||'Maicon Workspace'}</span><span>Dados do HeadCargo · Ações conforme suas permissões</span></footer>
      </main>
      {ia && <MaiconOperacional key={numero} proposta={numero || undefined} pedido={pedido} aoAtualizar={atualizar}/>}
    </div>
  </div>;
}
