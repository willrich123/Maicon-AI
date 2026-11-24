import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CabecalhoResposta } from "./RespostaTexto";
import { lerTokenGmail } from "./sessao";
import { MapaEmbarque, type MapaEmbarqueDados } from "./MapaEmbarque";
import { MapaCarteira } from "./MapaCarteira";
import { AnexoInteligencia, type EvidenciaDocumental } from "./AnexoInteligencia";
import "./estilos/inteligencia.css";

type Celula = string | number | boolean | null;
type Tabela = {titulo:string;linhas:Record<string,Celula>[];limite?:number};
type Fonte = {id:string;tipo:string;titulo:string;trecho:string;data?:string;pagina?:number;arquivo?:number;url?:string};
type Resultado = {titulo?:string;nota?:string;linhas?:Tabela["linhas"];limite?:number;tabelas?:Tabela[];fontes?:Fonte[];periodo?:{de:string;ate:string};evidencias?:Record<string,EvidenciaDocumental[]>};

const ferramentas = [
  {id:"fontes",nome:"Busca com fontes",dica:"Pesquise mensagens, propostas e anexos.",processo:true},
  {id:"mapa",nome:"Mapa da carga",dica:"Veja a rota e os eventos do embarque.",processo:true},
  {id:"simulador",nome:"Simulador de atrasos",dica:"Veja como um atraso afeta os prazos.",processo:true},
  {id:"documentos",nome:"Checklist documental",dica:"Confira quais documentos estão pendentes.",processo:true},
  {id:"custos",nome:"Conferência de custos",dica:"Compare a cotação, as taxas e as faturas.",processo:true},
  {id:"itens_carga",nome:"Itens da carga",dica:"Confira volumes, cubagem e pesos das embalagens.",processo:true},
  {id:"gargalos",nome:"Análise de gargalos",dica:"Identifique etapas lentas ou vencidas.",processo:false},
  {id:"transportadoras",nome:"Ranking de transportadoras",dica:"Compare pontualidade em rotas equivalentes.",processo:false},
  {id:"plantao",nome:"Passagem de plantão",dica:"Reúna pendências, prazos e responsáveis.",processo:false},
  {id:"relatorio",nome:"Relatórios por pergunta",dica:"Peça uma análise de atrasos ou pontualidade.",processo:false},
] as const;

const formatoData = new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"});
function formatar(valor:Celula) {
  if (valor == null || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") return valor.toLocaleString("pt-BR",{maximumFractionDigits:6});
  if (/^\d{4}-\d{2}-\d{2}T/.test(valor) && Number.isFinite(Date.parse(valor))) return formatoData.format(new Date(valor));
  return valor;
}

function baixar(conteudo:Blob,nome:string) {
  const url=URL.createObjectURL(conteudo);
  const a=document.createElement("a");
  a.href=url;
  a.download=nome;
  a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function tabelaCsv(tabela:Tabela) {
  const colunas=Object.keys(tabela.linhas[0]);
  const celula=(valor:Celula)=>{
    const v=typeof valor==="number"?String(valor).replace(".",","):valor==null?"":formatar(valor);
    const protegido = typeof valor === "string" && /^\s*[=+\-@\t\r]/.test(v) ? "'"+v : v;
    return '"'+protegido.replaceAll('"','""')+'"';
  };
  const texto=[colunas.map(c=>celula(c)).join(";"),...tabela.linhas.map(l=>colunas.map(c=>celula(l[c])).join(";"))].join("\r\n");
  baixar(new Blob(["\ufeff",texto],{type:"text/csv;charset=utf-8"}),`maicon-${tabela.titulo.normalize("NFD").replace(/\p{M}/gu,"").replace(/[^a-z0-9]+/gi,"-").toLowerCase()}.csv`);
}

function TabelaInteligencia({tabela,evidencias,abrir}:{tabela:Tabela;evidencias?:Resultado["evidencias"];abrir?:(arquivo:EvidenciaDocumental)=>void}) {
  const chaves=Object.keys(tabela.linhas[0]||{});
  return <section className="ma-int-bloco">
    <div className="ma-int-table-head"><h3>{tabela.titulo}</h3>
      {chaves.length>0&&<button type="button" onClick={()=>tabelaCsv(tabela)}>Baixar CSV</button>}
    </div>
    {chaves.length>0?<div className={`ma-int-overflow${evidencias?" ma-int-checklist":""}`}><table>
      <thead><tr>{chaves.map(c=><th scope="col" key={c}>{c}</th>)}</tr></thead>
      <tbody>{tabela.linhas.map((linha,i)=><tr key={i}>{chaves.map(c=>{
        const anexos=c==="Evidências"&&typeof linha.Documento==="string"?evidencias?.[linha.Documento]:undefined;
        return <td key={c}>{anexos?.length&&abrir?<ul className="ma-int-evidencias">
          {anexos.map(a=><li key={a.id}>{a.disponivel?
            <button type="button" onClick={()=>abrir(a)} aria-label={`Visualizar ${a.nome}`}>{a.nome} <span aria-hidden="true">↗</span></button>
            :<span>{a.nome} <small>(visualização indisponível)</small></span>}</li>)}
        </ul>:formatar(linha[c])}</td>;
      })}</tr>)}</tbody>
    </table></div>:<p>Nenhum registro encontrado com os dados informados.</p>}
    {tabela.limite!==undefined&&tabela.linhas.length>=tabela.limite&&<p>Resultado limitado a {tabela.limite} registros. Refine os filtros para consultar outros registros.</p>}
  </section>;
}

const periodoAtual=()=>{
  const ate=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());
  const de=new Date(Date.parse(ate)-89*86400000).toISOString().slice(0,10);
  return {de,ate};
};

type Ferramenta = typeof ferramentas[number];
type FerramentaId = Ferramenta["id"];
type Consulta = {id:string;nome:string;processo:boolean};

const consultas:Partial<Record<FerramentaId,Consulta[]>> = {
  mapa:[
    {id:"mapa",nome:"Rota e eventos",processo:true},
    {id:"devolucoes",nome:"Devolução de contêineres",processo:false},
  ],
  documentos:[
    {id:"documentos",nome:"Documentos do processo",processo:true},
    {id:"vgm_lacre",nome:"VGM e lacres",processo:true},
  ],
  custos:[
    {id:"custos",nome:"Taxas e faturas",processo:true},
    {id:"oferta_embarque",nome:"Oferta × embarque",processo:true},
    {id:"peso_aereo",nome:"Peso taxado aéreo",processo:true},
  ],
  plantao:[
    {id:"plantao",nome:"Resumo da carteira",processo:false},
    {id:"janelas",nome:"Janelas de coleta e entrega",processo:false},
  ],
};

function periodoJanelas() {
  const hoje=Date.parse(periodoAtual().ate);
  const dias=30*86400000;
  return {de:new Date(hoje-dias).toISOString().slice(0,10),ate:new Date(hoje+dias).toISOString().slice(0,10)};
}

function SeletorFerramenta({ativo,aoEscolher}:{ativo:Ferramenta;aoEscolher:(valor:Ferramenta)=>void}) {
  const [aberto,setAberto]=useState(false);
  const base=useRef<HTMLDivElement>(null);
  const gatilho=useRef<HTMLButtonElement>(null);
  const opcoes=useRef<Array<HTMLButtonElement|null>>([]);
  const menuId=useId();

  useEffect(()=>{
    if(!aberto)return;
    opcoes.current[ferramentas.indexOf(ativo)]?.focus();
    function fecharFora(e:PointerEvent) {
      if(e.target instanceof Node&&!base.current?.contains(e.target))setAberto(false);
    }
    document.addEventListener("pointerdown",fecharFora);
    return ()=>document.removeEventListener("pointerdown",fecharFora);
  },[aberto,ativo]);

  function navegar(e:KeyboardEvent<HTMLDivElement>) {
    if(e.key==="Escape"&&aberto) {
      e.preventDefault();
      e.stopPropagation();
      setAberto(false);
      gatilho.current?.focus();
      return;
    }
    if(!["ArrowDown","ArrowUp","Home","End"].includes(e.key))return;
    e.preventDefault();
    if(!aberto){setAberto(true);return;}
    const atual=opcoes.current.indexOf(document.activeElement as HTMLButtonElement);
    const total=ferramentas.length;
    const passo=e.key==="ArrowUp"?-1:1;
    const destino=e.key==="Home"?0:e.key==="End"?total-1:(atual+passo+total)%total;
    opcoes.current[destino]?.focus();
  }

  return <div className="ma-int-ferramentas-menu" ref={base}
    onKeyDown={navegar} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setAberto(false);}}>
    <button className="ma-int-menu-gatilho" type="button" ref={gatilho}
      aria-label={`Ferramenta de inteligência: ${ativo.nome}`} aria-expanded={aberto}
      aria-haspopup="listbox" aria-controls={menuId} onClick={()=>setAberto(v=>!v)}>
      <span>{ativo.nome}</span><i className="ma-int-menu-seta" aria-hidden/>
    </button>
    <ul className="ma-int-menu-opcoes" id={menuId} role="listbox" aria-label="Ferramentas de inteligência" hidden={!aberto}>
      {ferramentas.map((f,i)=><li role="presentation" key={f.id}>
        <button type="button" role="option" aria-selected={f.id===ativo.id} tabIndex={-1}
          ref={el=>{opcoes.current[i]=el;}} onClick={()=>{setAberto(false);aoEscolher(f);}}>
          <span>{f.nome}</span>{f.id===ativo.id&&<i className="ma-int-menu-check" aria-hidden/>}
        </button>
      </li>)}
    </ul>
  </div>;
}
type Turno = {
  id: number;
  pedido: string;
  ferramenta: Consulta;
  processo: string;
  resultado?: Resultado;
  mapa?: MapaEmbarqueDados;
  mensagem?: string;
  falha?: boolean;
};

const exemplos: Record<Ferramenta["id"],string> = {
  fontes:"Ex.: IM5944-26 free time",
  mapa:"Ex.: Onde está a carga do IM5944-26?",
  simulador:"Ex.: IM5944-26 com atraso de 3 dias",
  documentos:"Ex.: Checklist do processo IM5944-26",
  custos:"Ex.: Confira os custos do IM5944-26",
  itens_carga:"Ex.: Confira volumes e medidas do IM5944-26",
  gargalos:"Ex.: Quais etapas mais demoraram neste trimestre?",
  transportadoras:"Ex.: Como foi a pontualidade no marítimo nos últimos 30 dias?",
  plantao:"Ex.: Prepare a passagem da carteira dos últimos 30 dias",
  relatorio:"Ex.: Quais clientes tiveram mais atrasos marítimos no trimestre?",
};

function perguntaSugerida(ferramenta:string,numero:string) {
  const processo=numero ? `no processo ${numero}` : "no processo";
  switch(ferramenta) {
    case "fontes": return numero ? `Onde ficou combinado o free time ${processo}?` : "Onde ficou combinado o free time?";
    case "mapa": return numero ? `Onde está a carga do processo ${numero}?` : "Onde está a carga deste processo?";
    case "simulador": return `Qual seria o impacto de um atraso de 3 dias ${processo}?`;
    case "documentos": return `Quais documentos estão disponíveis e quais preciso conferir ${processo}?`;
    case "custos": return `Compare as taxas cotadas, os custos e as faturas ${processo}.`;
    case "oferta_embarque": return `Compare a oferta com o embarque ${processo} e mostre as divergências.`;
    case "peso_aereo": return `Confira os pesos bruto, cubado e taxado ${processo}.`;
    case "vgm_lacre": return `Confira VGM e lacres por contêiner ${processo}.`;
    case "itens_carga": return `Compare os volumes, a cubagem e os pesos dos itens com os totais ${processo}.`;
    case "devolucoes": return "Quais contêineres da carteira vencem nos próximos 3 dias?";
    case "janelas": return "Mostre as janelas de coleta e entrega da carteira.";
    case "gargalos": return "Quais etapas mais demoraram neste trimestre?";
    case "transportadoras": return "Como foi a pontualidade no marítimo nos últimos 30 dias?";
    case "plantao": return "Prepare a passagem de plantão da carteira dos últimos 30 dias.";
    case "relatorio": return "Quais clientes tiveram mais atrasos marítimos neste trimestre?";
    default: return "";
  }
}

export function PainelInteligencia({visivel}:{visivel:boolean}) {
  const idFerramentas=useId();
  const query=new URLSearchParams(window.location.search);
  const [ativo,setAtivo]=useState(()=>ferramentas.find(f=>f.id===query.get("ferramenta"))??ferramentas[0]);
  const [modo,setModo]=useState<Consulta>();
  const consulta=modo ?? ativo;
  const [numero,setNumero]=useState(query.get("processo") ?? "");
  const [texto,setTexto]=useState(()=>perguntaSugerida(ativo.id,numero));
  const [termoPendente,setTermoPendente]=useState("");
  const [turnos,setTurnos]=useState<Turno[]>([]);
  const [carteira,setCarteira]=useState(false);
  const [gmail,setGmail]=useState(false);
  const [periodoOperacional,setPeriodoOperacional]=useState(periodoAtual);
  const [periodoColetas,setPeriodoColetas]=useState(periodoJanelas);
  const periodo=consulta.id==="janelas" ? periodoColetas : periodoOperacional;
  const setPeriodo=consulta.id==="janelas" ? setPeriodoColetas : setPeriodoOperacional;
  const [modalidade,setModalidade]=useState("");
  const [filtro,setFiltro]=useState("");
  const [erroAnexo,setErroAnexo]=useState("");
  const [ocupado,setOcupado]=useState(false);
  const [anexo,setAnexo]=useState<number>();
  const [visualizacao,setVisualizacao]=useState<{arquivo:EvidenciaDocumental;processo:string}>();
  const atual=useRef<AbortController|null>(null);
  const rascunhos=useRef<Partial<Record<string,string>>>({});
  const entrada=useRef<HTMLTextAreaElement>(null);
  const fim=useRef<HTMLDivElement>(null);
  const ultimaResposta=useRef<HTMLDivElement>(null);
  const sequencia=useRef(0);
  useEffect(()=>()=>atual.current?.abort(),[]);
  useEffect(()=>{if(!visivel)setVisualizacao(undefined);},[visivel]);
  useEffect(()=>{
    if(!visivel||!turnos.length)return;
    if(turnos.at(-1)?.mapa) ultimaResposta.current?.scrollIntoView({block:"start"});
    else fim.current?.scrollIntoView({block:"end"});
  },[turnos,visivel]);

  function escolher(ferramenta:Ferramenta) {
    if(ativo.id===ferramenta.id){
      if(!texto.trim())setTexto(perguntaSugerida(consulta.id,numero));
      entrada.current?.focus();
      return;
    }
    trocarConsulta(ferramenta);
    setAtivo(ferramenta);setModo(undefined);setFiltro("");
  }

  function trocarConsulta(proxima:Consulta) {
    if(texto.trim() && texto!==perguntaSugerida(consulta.id,numero))rascunhos.current[consulta.id]=texto;
    else delete rascunhos.current[consulta.id];
    setTermoPendente("");
    setTexto(rascunhos.current[proxima.id] ?? perguntaSugerida(proxima.id,numero));
    entrada.current?.focus();
  }

  async function consultar(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pedido=texto.trim();
    if (!pedido||atual.current) return;
    const encontrado=pedido.match(/\b([A-Za-z]{1,4}\d{2,6}-\d{2})(\s+teste)?\b/i);
    const processo=encontrado ? encontrado[1].toUpperCase()+(encontrado[2]?" teste":"") : consulta.processo ? numero : "";
    if(encontrado)setNumero(processo);
    const turno:Turno={id:++sequencia.current,pedido,ferramenta:consulta,processo};
    const completar=(dados:Partial<Turno>)=>setTurnos(itens=>itens.map(item=>item.id===turno.id?{...item,...dados}:item));
    delete rascunhos.current[consulta.id];
    setTurnos(itens=>[...itens,turno]);setTexto("");setErroAnexo("");
    const resto=pedido.replace(encontrado?.[0]||"", "").trim();
    const termo=resto.replace(/^(?:procure|pesquise|busque|buscar|buscar por)\s+/i,"").replace(/^[:;,\s]+|[,:;\s]+$/g,"");
    const diasTextuais=consulta.id==="devolucoes"?pedido.match(/\b(\d+)\s*dias?\b/i):pedido.match(/\b(\d{1,2})\s*dias?\b/i);
    const dias = diasTextuais ? Number(diasTextuais[1]) : /^\d{1,2}$/.test(resto) ? Number(resto) : undefined;
    const termoBusca=termo||termoPendente;
    if (consulta.processo&&!processo) {
      if(ativo.id==="fontes"&&termo)setTermoPendente(termo);
      completar({mensagem:"Qual é o número do processo que você quer consultar?"});
      return;
    }
    if(ativo.id==="fontes"&&!termoBusca){
      completar({mensagem:`O que você quer encontrar em ${processo}? Pode escrever, por exemplo, “free time”.`});
      return;
    }
    if(ativo.id==="simulador"&&!dias) {
      completar({mensagem:`Quantos dias de atraso você quer simular em ${processo}?`});
      return;
    }
    setTermoPendente("");
    const ac=new AbortController();
    atual.current=ac;
    setOcupado(true);
    try {
      const porProcesso=consulta.id==="devolucoes"||consulta.id==="janelas";
      const params=consulta.processo
        ? {numero:processo,termo:termoBusca,dias,gmailToken:gmail&&ativo.id==="fontes"?lerTokenGmail():undefined}
        : {...periodo,modalidade,filtro,pergunta:pedido,...(porProcesso?{numero:processo||undefined,dias}:{})};
      const r=await fetch("/api/inteligencia",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({acao:consulta.id,...params}),signal:AbortSignal.any([ac.signal,AbortSignal.timeout(80000)])});
      const dados=await r.json();
      if(!r.ok)throw new Error(dados.erro||"Falha na consulta.");
      if(ac.signal.aborted)return;
      if(consulta.id==="mapa")completar({mapa:dados as MapaEmbarqueDados});
      else completar({resultado:dados as Resultado});
    } catch(err) {
      if(!ac.signal.aborted)completar({falha:true,mensagem:err instanceof Error?err.message:"Falha na consulta."});
    } finally {
      if(atual.current===ac){atual.current=null;setOcupado(false);}
    }
  }

  async function baixarFonte(fonte:Fonte,processo:string) {
    setAnexo(fonte.arquivo);setErroAnexo("");
    try {
      const params=new URLSearchParams({numero:processo,arquivo:String(fonte.arquivo)});
      const r=await fetch(`/api/inteligencia/anexo?${params}`,{signal:AbortSignal.timeout(45000)});
      if(!r.ok)throw new Error((await r.json().catch(()=>null))?.erro || "Anexo indisponível.");
      baixar(await r.blob(),fonte.titulo);
    } catch(e) {setErroAnexo(e instanceof Error?e.message:"Anexo indisponível.");}
    finally {setAnexo(undefined);}
  }

  if(carteira)return <section className="ma-int-chat" hidden={!visivel} aria-label="Inteligência">
    <div className="chat-mensagens ma-int-mensagens"><div className="chat-coluna">
      <MapaCarteira aoVoltar={()=>setCarteira(false)}/>
    </div></div>
  </section>;

  return <section className="ma-int-chat" hidden={!visivel} aria-label="Inteligência">
    <div className="chat-mensagens ma-int-mensagens">
      <div className="chat-coluna">
        <section className="ma-int-opcoes" aria-labelledby={idFerramentas}>
          <div className="chat-assistant ma-int-marca"><CabecalhoResposta/></div>
          <h2 id={idFerramentas}>Escolha uma ferramenta</h2>
          <ul className="ma-int-grade">
            {ferramentas.map(f=><li key={f.id}>
              <button type="button" aria-pressed={f.id===ativo.id} aria-label={f.nome}
                aria-describedby={`${idFerramentas}-${f.id}`} onClick={()=>escolher(f)}>
                <strong>{f.nome}</strong>
                <span id={`${idFerramentas}-${f.id}`}>{f.dica}</span>
                <i className="ma-int-cartao-seta" aria-hidden/>
              </button>
            </li>)}
          </ul>
        </section>
        {turnos.map(turno=>{
          const r=turno.resultado;
          const pendente=!(r||turno.mapa||turno.mensagem);
          return <div key={turno.id} className="ma-int-turno">
            <div className="chat-linha usuario"><div className="chat-msg chat-user">{turno.pedido}</div></div>
            <div className="chat-linha" ref={turno.id===turnos.at(-1)?.id?ultimaResposta:undefined}><div className={`chat-msg chat-assistant${pendente||turno.mensagem?"":" ma-int-resposta"}`}>
              <CabecalhoResposta/>
              {pendente&&<p role="status">Consultando {turno.ferramenta.nome.toLocaleLowerCase("pt-BR")}…</p>}
              {turno.mensagem&&<p role={turno.falha?"alert":undefined}>{turno.mensagem}</p>}
              {turno.mapa&&<>
                <h3>Mapa da carga · {turno.mapa.processo}</h3>
                <MapaEmbarque dados={turno.mapa}/>
                {/^[IE]M/i.test(turno.mapa.processo)&&<div className="ma-int-consultas">
                  <button type="button" onClick={()=>{
                    setModo(consultas.mapa?.find(c=>c.id==="devolucoes"));
                    setAtivo(ferramentas.find(f=>f.id==="mapa") ?? ferramentas[0]);
                    setTexto(`Confira os prazos de devolução de contêineres do processo ${turno.mapa?.processo}.`);
                    entrada.current?.focus();
                  }}>Conferir devolução de contêineres</button>
                </div>}
              </>}
              {r&&<>
                <h3>{r.titulo||turno.ferramenta.nome}</h3>
                {r.nota&&<p>{r.nota}</p>}
                {r.periodo&&<p>Período consultado: {r.periodo.de.split("-").reverse().join("/")} a {r.periodo.ate.split("-").reverse().join("/")}</p>}
                {r.linhas&&<TabelaInteligencia tabela={{titulo:"Resultados",linhas:r.linhas,limite:r.limite}}
                  evidencias={r.evidencias} abrir={arquivo=>setVisualizacao({arquivo,processo:turno.processo})}/>}
                {r.tabelas?.map(t=><TabelaInteligencia key={t.titulo} tabela={t}/>)}
                {r.fontes&&(r.fontes.length?<div className="ma-int-fontes">{r.fontes.map(f=>
                  <article key={f.id}>
                    <span>{f.tipo}{f.data?` · ${formatar(f.data)}`:""}{f.pagina?` · p. ${f.pagina}`:""}</span>
                    <h4>{f.titulo}</h4>
                    <blockquote>{f.trecho}</blockquote>
                    {f.url&&<a href={f.url} target="_blank" rel="noreferrer">Abrir e-mail ↗</a>}
                    {f.arquivo&&<button type="button" disabled={anexo===f.arquivo} onClick={()=>void baixarFonte(f,turno.processo)}>{anexo===f.arquivo?"Baixando…":"Baixar anexo"}</button>}
                  </article>)}</div>:<p>Nenhum trecho correspondente nas fontes consultadas.</p>)}
              </>}
            </div></div>
          </div>;
        })}
        {erroAnexo&&<p className="chat-erro" role="alert">{erroAnexo}</p>}
        <div ref={fim}/>
      </div>
    </div>
    <form className="chat-entrada ma-int-entrada" onSubmit={e=>void consultar(e)}>
      <div className="chat-coluna">
        <div className="ma-int-composer-meta">
          <div className="ma-int-seletor">
            <SeletorFerramenta ativo={ativo} aoEscolher={escolher}/>
            {consulta.processo&&numero&&<span>{numero}</span>}
          </div>
          {consulta.id==="mapa"&&<button className="ma-mapa-abrir-carteira" type="button" onClick={()=>setCarteira(true)}>Visão da carteira</button>}
          {ativo.id==="fontes"&&<label className="ma-int-gmail">
            <input type="checkbox" checked={gmail} onChange={e=>setGmail(e.target.checked)}/>
            <span>Incluir meu Gmail</span>
          </label>}
          {!consulta.processo&&<details><summary>Filtros</summary>
            <div className="ma-int-filtros">
              <label>{consulta.id==="devolucoes"?"Abertura a partir de":consulta.id==="janelas"?"Etapas a partir de":"De"}<input type="date" required value={periodo.de} onChange={e=>setPeriodo(v=>({...v,de:e.target.value}))}/></label>
              <label>Até<input type="date" required value={periodo.ate} onChange={e=>setPeriodo(v=>({...v,ate:e.target.value}))}/></label>
              <label>Modalidade<select value={modalidade} onChange={e=>setModalidade(e.target.value)}>
                <option value="">Todas</option>{[["IM","Marítimo importação"],["EM","Marítimo exportação"],["IA","Aéreo importação"],["EA","Aéreo exportação"],["IT","Terrestre importação"],["ET","Terrestre exportação"]].map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select></label>
              <label>Pesquisar<input type="search" maxLength={120} value={filtro} onChange={e=>setFiltro(e.target.value)}
                placeholder={consulta.id==="devolucoes"?"Cliente, processo ou contêiner":consulta.id==="janelas"?"Cliente, processo ou local":ativo.id==="gargalos"?"Atividade":ativo.id==="transportadoras"?"Rota ou transportadora":"Cliente ou processo"}/></label>
            </div>
          </details>}
        </div>
        {consultas[ativo.id]&&<div className="ma-int-consultas" role="group" aria-label={`Consultas de ${ativo.nome}`}>
          {consultas[ativo.id]?.map(opcao=><button key={opcao.id} type="button" aria-pressed={consulta.id===opcao.id}
            onClick={()=>{trocarConsulta(opcao);setModo(opcao);}}>{opcao.nome}</button>)}
        </div>}
        <div className="chat-caixa ma-int-caixa">
          <textarea ref={entrada} aria-label="Pedido de inteligência" rows={1} value={texto} maxLength={300}
            placeholder={consulta.id===ativo.id ? exemplos[ativo.id] : perguntaSugerida(consulta.id,numero)} onChange={e=>setTexto(e.target.value)} onKeyDown={e=>{
              if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}/>
          <button type="submit" className="chat-enviar" disabled={ocupado||!texto.trim()} aria-label="Enviar pedido">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>
    </form>
    {visivel&&visualizacao&&<AnexoInteligencia key={`${visualizacao.processo}:${visualizacao.arquivo.id}`}
      {...visualizacao} fechar={()=>setVisualizacao(undefined)}/>}
  </section>;
}
