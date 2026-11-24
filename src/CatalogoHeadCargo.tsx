import { useEffect, useState, type FormEvent } from "react";
import simbolo from "./assets/maicon-symbol-white.png";
import "./estilos/ponte.css";
import "./estilos/headcargo-web.css";
import { OperacionalProcesso } from "./OperacionalProcesso";

type TelaResumo = { id: string; titulo: string; modo: string };
type Modulo = { id: string; nome: string; telas: TelaResumo[] };
type Catalogo = { fontes: number; definicoes: number; modulos: Modulo[] };
type Campo = { id: string; rotulo: string; campo: string; tipo: string };
type Tela = { titulo: string; modulo: string; modo: string; grupos: { nome: string; campos: Campo[] }[] };
type AtividadeWeb = { IdAtividade: number; Codigo: string; Atividade: string; SituacaoTexto: string; Responsavel: string; Previsao_Termino: string; Data_Termino: string };
type ProcessoWeb = { numero: string; cliente: string; referencia: string; situacao: string; abertura: string; atividades: AtividadeWeb[] };
async function api<T>(caminho: string, body?: object): Promise<T> {
  let r: Response;
  try { r = await fetch(`/api/ponte/${caminho}`, { cache: "no-store", signal: AbortSignal.timeout(45000), ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error("O servidor não respondeu. Verifique a conexão e tente novamente."); }
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados) throw new Error(dados?.erro || "Não foi possível carregar esta consulta.");
  return dados;
}
const data = (v: string) => v && !Number.isNaN(Date.parse(v)) ? new Date(v).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";
const normal = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function CatalogoHeadCargo() {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [identidade, setIdentidade] = useState<{ nome: string; usuario: string } | null>(null);
  const [modulo, setModulo] = useState(() => new URLSearchParams(window.location.search).get("modulo") || "");
  const [busca, setBusca] = useState("");
  const [tela, setTela] = useState<Tela | null>(null);
  const [grupo, setGrupo] = useState("");
  const [processo, setProcesso] = useState<ProcessoWeb | null>(null);
  const [limite, setLimite] = useState(10);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState("");
  const [iniciando, setIniciando] = useState(true);
  useEffect(() => {
    let ativo = true;
    Promise.all([api<Catalogo>("web/catalogo"), api<{ nome: string; usuario: string }>("identidade")])
      .then(([c,i]) => { if (ativo) { setCatalogo(c); setIdentidade(i); } })
      .catch(e => { if (ativo) setErro(e.message); }).finally(() => { if (ativo) setIniciando(false); });
    return () => { ativo = false; };
  }, []);
  async function abrir(id: string) {
    if (carregando) return;
    setCarregando("Carregando tela…"); setErro(""); setTela(null);
    try { const t = await api<Tela>(`web/telas/${encodeURIComponent(id)}`); setTela(t); setGrupo(t.grupos[0]?.nome || ""); }
    catch(e) { setErro(e instanceof Error ? e.message : "Falha ao abrir a tela."); }
    finally { setCarregando(""); }
  }
  async function consultar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (carregando) return;
    const numero = String(new FormData(e.currentTarget).get("numero") || "");
    setCarregando("Consultando processo…"); setErro(""); setProcesso(null);
    try { setProcesso(await api<ProcessoWeb>("web/processo", { numero })); setLimite(10); }
    catch(e) { setErro(e instanceof Error ? e.message : "Não foi possível consultar o processo."); }
    finally { setCarregando(""); }
  }
  const modulos = catalogo?.modulos || [];
  const selecionado = modulos.find(m => m.id === modulo);
  const encontrados = (selecionado ? [selecionado] : modulos).flatMap(m => m.telas.map(t => ({ ...t, modulo: m.nome }))).filter(t => !busca || normal(t.titulo + " " + t.modulo).includes(normal(busca)));
  return <div className="ponte hc-web">
    <header className="ponte-topo"><a className="ponte-marca" href="/headcargo"><img src={simbolo} alt=""/><span>Maicon <span>HeadCargo Web</span></span></a><div className="hc-topo-conta"><span>{identidade?.nome || "Workspace"}</span><a href="/">Voltar ao chat ↗</a></div></header>
    <div className="hc-layout">
      <aside className="hc-sidebar"><span className="ponte-eyebrow">WORKSPACE</span><button className={!modulo && !busca ? "hc-selecionado" : ""} onClick={() => { setModulo(""); setBusca(""); setTela(null); setErro(""); }}>Processos e atividades <span>Consulta</span></button>
        <div className="hc-menu-titulo">Módulos <span>{modulos.length}</span></div>
        <nav aria-label="Módulos do HeadCargo">{modulos.map(m => <button key={m.id} className={modulo === m.id ? "hc-selecionado" : ""} onClick={() => { setModulo(m.id); setTela(null); setBusca(""); setErro(""); }}>{m.nome}<span>{m.telas.length}</span></button>)}</nav>
        <p className="hc-sidebar-nota">Ambiente de consulta<br/>Sem gravações no HeadCargo</p>
      </aside>
      <main className="hc-main">
        <div className="hc-breadcrumb">Workspace <span>/</span> {selecionado?.nome || "Operação"}{tela && <> <span>/</span> {tela.titulo}</>}</div>
        {iniciando ? <p role="status">Carregando workspace…</p> : !catalogo ? <div className="hc-titulo"><div><h1>Workspace indisponível</h1><p>Não foi possível confirmar o acesso ao catálogo de telas.</p></div></div> : <>
          <div className="hc-titulo"><div><span className="ponte-eyebrow">{tela ? "ESTRUTURA RECUPERADA" : selecionado ? "MÓDULO" : "VISÃO OPERACIONAL"}</span><h1>{tela?.titulo || selecionado?.nome || "Processos e atividades"}</h1><p>{tela ? "Organização de campos recuperada dos arquivos instalados. Os dados desta tela ainda não estão conectados." : selecionado ? "Selecione uma tela para visualizar sua estrutura na web." : "Consulte processos e acompanhe atividades diretamente no navegador."}</p></div><span className="hc-selo">Somente leitura</span></div>
          {!modulo && !busca && !tela && <>
            <form className="ponte-busca" onSubmit={consultar}><label htmlFor="hc-numero">Número do processo</label><div><input id="hc-numero" name="numero" placeholder="Ex.: IM2099-25 teste" required maxLength={40} disabled={!!carregando}/><button className="ponte-principal" disabled={!!carregando}>Consultar →</button></div></form>
            {processo ? <section className="hc-processo"><div className="hc-processo-cab"><div><span className="ponte-eyebrow">PROCESSO</span><h2>{processo.numero}</h2><p>{processo.cliente || "Cliente não informado"}</p></div><span className="hc-selo">{processo.situacao || "Situação não informada"}</span></div>
              <dl className="hc-resumo"><div><dt>Referência</dt><dd>{processo.referencia || "—"}</dd></div><div><dt>Abertura</dt><dd>{data(processo.abertura)}</dd></div><div><dt>Atividades</dt><dd>{processo.atividades.length}</dd></div></dl>
              <OperacionalProcesso key={processo.numero} numero={processo.numero}><h3>Atividades do processo</h3>{processo.atividades.length ? <><div className="ponte-tabela"><table><thead><tr><th>Código</th><th>Atividade</th><th>Situação</th><th>Responsável</th><th>Previsão</th><th>Conclusão</th></tr></thead><tbody>{processo.atividades.slice(0,limite).map(a => <tr key={a.IdAtividade}><td className="ponte-codigo">{a.Codigo || "—"}</td><td>{a.Atividade || "—"}</td><td>{a.SituacaoTexto}</td><td>{a.Responsavel || "—"}</td><td>{data(a.Previsao_Termino)}</td><td>{data(a.Data_Termino)}</td></tr>)}</tbody></table></div><div className="ponte-rodape"><span>Exibindo {Math.min(limite,processo.atividades.length)} de {processo.atividades.length}</span>{limite < processo.atividades.length && <button onClick={() => setLimite(v=>v+10)}>Ver mais +10</button>}</div></> : <p>Nenhuma atividade neste processo.</p>}</OperacionalProcesso>
            </section> : <div className="hc-boas-vindas"><h2>Seu HeadCargo no navegador</h2><p>A consulta de processos funciona sem conexão com o desktop. Nos módulos ao lado, explore as estruturas recuperadas dos formulários originais.</p><span>{modulos.reduce((n,m)=>n+m.telas.length,0)} telas mapeadas · {catalogo?.fontes || 0} arquivos analisados</span></div>}
          </>}
          {tela ? <section className="hc-formulario"><div className="hc-tabs" role="tablist" aria-label="Seções da tela">{tela.grupos.map(g => <button role="tab" aria-selected={grupo===g.nome} key={g.nome} onClick={()=>setGrupo(g.nome)}>{g.nome}</button>)}</div><div className="hc-campos" role="tabpanel">{tela.grupos.find(g=>g.nome===grupo)?.campos.map(c => <div className="hc-campo" key={c.id}><span>{c.rotulo}</span><div className="hc-valor-vazio">Dados ainda não conectados</div></div>)}</div>{!tela.grupos.length && <p>Este formulário não contém campos de dados recuperáveis. Sua lógica permanece no módulo original.</p>}</section> : <>
            <div className="hc-catalogo-cab"><h2>{selecionado ? "Telas do módulo" : "Explorar telas"}</h2><input aria-label="Pesquisar telas" placeholder="Pesquisar tela ou módulo…" value={busca} onChange={e=>setBusca(e.target.value)}/></div>
            {(modulo || busca) && <div className="hc-lista-telas">{encontrados.map(t => <button key={t.id} disabled={!!carregando} onClick={()=>void abrir(t.id)}><span><strong>{t.titulo}</strong><small>{t.modulo}</small></span><span className="hc-estrutura">Estrutura recuperada <b aria-hidden>↗</b></span></button>)}{!encontrados.length && <p>Nenhuma tela encontrada.</p>}</div>}
            {!modulo && !busca && <div className="hc-modulos">{modulos.map(m=><button key={m.id} onClick={()=>{setModulo(m.id);setTela(null);}}><strong>{m.nome}</strong><span>{m.telas.length} telas recuperadas →</span></button>)}</div>}
          </>}
        </>}
        {carregando && <p className="ponte-andamento" role="status"><span/>{carregando}</p>}
        {erro && <p className="ponte-erro" role="alert">{erro}</p>}
      </main>
    </div>
  </div>;
}
