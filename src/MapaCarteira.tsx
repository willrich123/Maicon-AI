import { useEffect, useRef, useState, type FormEvent } from "react";
import { MapaEmbarque, dataBrasil, estadosCarteira, nomeModal, referenciasCarteira, type MapaEmbarqueDados, type MarcadorCarteira } from "./MapaEmbarque";

type Carteira = {linhas:MarcadorCarteira[]};
const filtrosIniciais={cliente:"",transportadora:"",modal:"",situacao:""};
const loteLista=100;

export function useConsultaMapa<T>(pedido:object, versao=0) {
  const corpo=JSON.stringify(pedido);
  const [consulta,setConsulta]=useState<{corpo:string;versao:number;dados?:T;erro?:string}>();
  useEffect(()=>{
    const ac=new AbortController();
    void (async()=>{
      try {
        const r=await fetch("/api/inteligencia",{method:"POST",headers:{"Content-Type":"application/json"},body:corpo,
          signal:AbortSignal.any([ac.signal,AbortSignal.timeout(45000)])});
        const dados=await r.json();
        if(!r.ok)throw new Error(dados.erro||"Não foi possível consultar o mapa.");
        if(!ac.signal.aborted)setConsulta({corpo,versao,dados});
      }catch(e){
        if(!ac.signal.aborted)setConsulta({corpo,versao,erro:e instanceof Error&&e.name!=="TimeoutError"?e.message:"A consulta do mapa demorou demais."});
      }
    })();
    return ()=>ac.abort();
  },[corpo,versao]);
  return consulta?.corpo===corpo&&consulta.versao===versao?consulta:{dados:undefined,erro:undefined};
}

export function MapaConsultaProcesso({numero,versao=0}:{numero:string;versao?:number}) {
  const {dados,erro}=useConsultaMapa<MapaEmbarqueDados>({acao:"mapa",numero},versao);
  return dados?<MapaEmbarque key={`${numero}:${versao}`} dados={dados}/>
    :erro?<p role="alert">{erro}</p>:<p role="status">Buscando as viagens do processo…</p>;
}

export function MapaCarteira({aoVoltar}:{aoVoltar:()=>void}) {
  const [filtros,setFiltros]=useState(filtrosIniciais);
  const [consulta,setConsulta]=useState(filtrosIniciais);
  const [versao,setVersao]=useState(0);
  const [selecionado,setSelecionado]=useState("");
  const [grupo,setGrupo]=useState<MarcadorCarteira[]>();
  const [limiteLista,setLimiteLista]=useState(loteLista);
  const cabecalhoGrupo=useRef<HTMLHeadingElement>(null);
  const {dados,erro}=useConsultaMapa<Carteira>({acao:"mapa_carteira",...consulta},versao);
  const abrir=(processo:string)=>setSelecionado(processo);
  const linhas=grupo??dados?.linhas??[];
  const mapeados=dados?.linhas.filter(l=>l.local?.coords).length??0;
  const semLocal=(dados?.linhas.length??0)-mapeados;

  useEffect(()=>{
    if(grupo&&!selecionado)cabecalhoGrupo.current?.focus();
  },[grupo,selecionado]);

  function selecionarPonto(ponto:MarcadorCarteira[]){
    if(ponto.length===1){abrir(ponto[0].processo);return;}
    setLimiteLista(loteLista);
    setGrupo(ponto);
  }

  function aplicar(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setGrupo(undefined);
    setLimiteLista(loteLista);
    setConsulta(filtros);
    setVersao(n=>n+1);
  }

  return <section className="ma-mapa ma-carteira" aria-label="Carteira de embarques">
    <header className="ma-carteira-cabecalho">
      <h3>{selecionado||"Carteira de embarques"}</h3>
      <button type="button" onClick={selecionado?()=>setSelecionado(""):aoVoltar}>{selecionado?"← Voltar à carteira":"← Voltar ao mapa do processo"}</button>
    </header>
    {selecionado?<MapaConsultaProcesso numero={selecionado}/>:<>
      <form className="ma-carteira-filtros" onSubmit={aplicar}>
        <label>Cliente<input type="search" maxLength={100} value={filtros.cliente} onChange={e=>setFiltros({...filtros,cliente:e.target.value})}/></label>
        <label>Transportadora<input type="search" maxLength={100} value={filtros.transportadora} onChange={e=>setFiltros({...filtros,transportadora:e.target.value})}/></label>
        <label>Modalidade<select value={filtros.modal} onChange={e=>setFiltros({...filtros,modal:e.target.value})}>
          <option value="">Todas</option><option value="1">Aéreo</option><option value="2">Marítimo</option><option value="3">Terrestre</option>
        </select></label>
        <label>Situação<select value={filtros.situacao} onChange={e=>setFiltros({...filtros,situacao:e.target.value})}>
          <option value="">Todas</option>{Object.entries(estadosCarteira).map(([chave,estado])=><option key={chave} value={chave}>{estado}</option>)}
        </select></label>
        <button type="submit">Aplicar filtros</button>
      </form>
      {erro?<p role="alert">{erro}</p>:!dados?<p role="status">Buscando os processos da carteira…</p>
      :dados.linhas.length===0?<p>Nenhum processo com viagens nos últimos 180 dias corresponde aos filtros.</p>:<>
        <p>{dados.linhas.length.toLocaleString("pt-BR")} processos · {mapeados.toLocaleString("pt-BR")} no mapa
          {semLocal>0?` · ${semLocal.toLocaleString("pt-BR")} sem coordenadas, disponíveis na lista`:""} · aberturas nos últimos 180 dias.</p>
        <MapaEmbarque key={versao} carteira={dados.linhas} aoSelecionarPonto={selecionarPonto}/>
        <p>Os números nas bolinhas indicam quantos processos estão no ponto. Quando falta um evento localizável, o mapa usa a origem ou o destino cadastrado.</p>
        {grupo&&<div className="ma-carteira-cabecalho">
          <h4 ref={cabecalhoGrupo} tabIndex={-1}>{grupo.length.toLocaleString("pt-BR")} processos no ponto selecionado</h4>
          <button type="button" onClick={()=>{setGrupo(undefined);setLimiteLista(loteLista);}}>Mostrar toda a carteira</button>
        </div>}
        <ul className="ma-mapa-etapas ma-carteira-lista">{linhas.slice(0,limiteLista).map(l=><li key={l.processo}>
          <button type="button" onClick={()=>abrir(l.processo)}>
            <strong>{l.processo} · {l.cliente||"Cliente não informado"}</strong>
            <span className={l.estado==="atrasado"||l.estado==="semAtualizacao"?"ma-mapa-alerta":undefined}>{estadosCarteira[l.estado]}</span>
            <span>{[nomeModal(l.modal),l.transportadora].filter(Boolean).join(" · ")}</span>
            {l.data&&<span>{l.tipo==="embarque"?"Embarque":"Desembarque"} em {l.localEvento||"local não identificado"} · {dataBrasil(l.data)}</span>}
            {l.local&&l.referencia&&l.referencia!=="evento"&&<span>{referenciasCarteira[l.referencia]} · {l.local.nome}</span>}
            {l.eta&&<span>Chegada prevista · {dataBrasil(l.eta)}</span>}
          </button>
        </li>)}</ul>
        {linhas.length>limiteLista&&<div className="ma-carteira-cabecalho">
          <button type="button" onClick={()=>setLimiteLista(n=>n+loteLista)}>Mostrar mais processos ({limiteLista.toLocaleString("pt-BR")} de {linhas.length.toLocaleString("pt-BR")})</button>
        </div>}
      </>}
    </>}
  </section>;
}
