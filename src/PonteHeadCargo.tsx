import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import simbolo from "./assets/maicon-symbol-white.png";
import "./estilos/ponte.css";

type Sessao = { usuario: string; versao: number };
type Atividade = { codigo: string; atividade: string; situacao: string; responsavel: string; previsao: string };
type Processo = { numero: string; atividades: Atividade[]; versao: number };
type Disponibilidade = { configurados: number; disponiveis: number };
type IdentidadeMaicon = { email: string; nome: string; usuario: string };
class ErroPortal extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(caminho: string, body?: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/ponte/${caminho}`, { signal: AbortSignal.timeout(35000), credentials: "same-origin", cache: "no-store", ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  } catch { throw new ErroPortal("Não foi possível conectar ao portal. Verifique a conexão e tente novamente.", 0); }
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados) throw new ErroPortal(dados?.erro || "Não foi possível comunicar com o portal.", r.status);
  return dados as T;
}
export function PonteHeadCargo() {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [identidade, setIdentidade] = useState<IdentidadeMaicon | null>(null);
  const [identificando, setIdentificando] = useState(true);
  const [pronto, setPronto] = useState(false);
  const [disponibilidade, setDisponibilidade] = useState<Disponibilidade | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [retornoConexao, setRetornoConexao] = useState<{ tentativa: number; hora: string; texto: string } | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [processo, setProcesso] = useState<Processo | null>(null);
  const [limite, setLimite] = useState(10);
  const trava = useRef(false);
  const verificacao = useRef(false);
  const tentativasConexao = useRef(0);
  const identificarConta = useCallback(async () => {
    setIdentificando(true); setErro("");
    try { setIdentidade(await api<IdentidadeMaicon>("identidade")); }
    catch (e) { setIdentidade(null); setErro(e instanceof Error ? e.message : "Não foi possível identificar sua conta."); }
    finally { setIdentificando(false); }
  }, []);
  const verificarConexao = useCallback(async (manual = false) => {
    if (verificacao.current) return;
    verificacao.current = true; setVerificando(true);
    if (manual) setRetornoConexao(null);
    let texto = "";
    try {
      const resultado = await api<Disponibilidade>("disponibilidade");
      if (!Number.isInteger(resultado.configurados) || !Number.isInteger(resultado.disponiveis) || resultado.configurados < 0 || resultado.disponiveis < 0 || resultado.disponiveis > resultado.configurados) throw new Error("Resposta de disponibilidade inválida.");
      setDisponibilidade(resultado);
      texto = resultado.configurados === 0
        ? "O portal respondeu, mas a integração com o HeadCargo ainda não foi ativada no servidor. A conexão com as telas continua indisponível."
        : resultado.disponiveis === 0
          ? "O portal respondeu. Nenhuma sessão do aplicativo HeadCargo está disponível para conexão neste momento."
          : "Conexão disponível. Você já pode entrar com sua conta do HeadCargo.";
    }
    catch { setDisponibilidade(null); texto = "A verificação falhou: não foi possível obter a disponibilidade do HeadCargo. Confira se o servidor do portal está acessível e tente novamente."; }
    finally {
      if (manual) setRetornoConexao({ tentativa: ++tentativasConexao.current, hora: new Date().toLocaleTimeString("pt-BR"), texto });
      verificacao.current = false; setVerificando(false);
    }
  }, []);
  useEffect(() => {
    let ativo = true;
    void identificarConta();
    void api<Sessao>("sessao").then(s => { if (ativo) setSessao(s); }).catch(() => {}).finally(() => { if (ativo) setPronto(true); });
    void verificarConexao(); const timer = setInterval(() => void verificarConexao(), 10000);
    return () => { ativo = false; clearInterval(timer); };
  }, [verificarConexao, identificarConta]);
  async function executar(rotulo: string, acao: () => Promise<void>) {
    if (trava.current) return;
    trava.current = true; setOcupado(rotulo); setErro("");
    try { await acao(); }
    catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível continuar.");
      if (e instanceof ErroPortal && e.status === 401) { setSessao(null); setProcesso(null); await api("sair", {}).catch(() => {}); }
      if (e instanceof ErroPortal && e.status === 409) {
        setProcesso(null);
        await api<Sessao>("sessao").then(setSessao).catch(() => { setSessao(null); });
      }
    } finally { trava.current = false; setOcupado(""); }
  }
  function entrar() {
    if (trava.current || !identidade) return;
    void executar("Conectando sua sessão HeadCargo…", async () => {
      // Remove cookie expirado. Uma sessão válida é recuperada antes de exibir este formulário.
      await api("sair", {});
      const s = await api<Sessao>("entrar", {}); setSessao(s); setProcesso(null);
    });
  }
  function consultar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!sessao) return;
    const numero = String(new FormData(e.currentTarget).get("numero") || "").trim();
    void executar("Consultando atividades…", async () => {
      setProcesso(null);
      const r = await api<Processo>("processo", { numero, versao: sessao.versao });
      setProcesso(r); setSessao({ ...sessao, versao: r.versao }); setLimite(10);
    });
  }
  return <div className="ponte">
    <header className="ponte-topo"><a className="ponte-marca" href="/headcargo"><img src={simbolo} alt="" /><span>Maicon <span>Workspace</span></span></a><a href="/">Ir para o chat <span aria-hidden>↗</span></a></header>
    <main className={sessao ? "ponte-conteudo" : "ponte-acesso"}>
      {!pronto ? <p role="status">Verificando sua sessão…</p> : !sessao ? <section className="ponte-login">
        <span className="ponte-eyebrow">HEAD CARGO · PORTAL</span>
        <h1>Seu operacional,<br />em um só lugar.</h1>
        <p>Seu acesso usa a mesma conta Google autenticada no Maicon.</p>
        {identificando ? <p className="ponte-disponibilidade" role="status">Identificando seu usuário no HeadCargo…</p> : identidade ? <div className="ponte-identidade"><span>CONTA MAICON</span><strong>{identidade.nome || identidade.email}</strong><p>{identidade.email}</p><div>Usuário HeadCargo <b>{identidade.usuario}</b></div></div> : <button type="button" onClick={() => void identificarConta()}>Tentar identificar novamente</button>}
        {identidade && disponibilidade && disponibilidade.configurados > 0 && <button type="button" className="ponte-principal ponte-conectar" onClick={entrar} disabled={!!ocupado}>Conectar ao HeadCargo <span aria-hidden>→</span></button>}
        {disponibilidade && disponibilidade.disponiveis > 0 ? <>
        <p className="ponte-disponibilidade"><span className="ponte-online" />Acesso disponível</p></> : <div className="ponte-conexao" aria-live="polite">
          <h2>{disponibilidade?.configurados === 0 ? "Conexão com o HeadCargo pendente" : disponibilidade ? "Nenhuma sessão disponível agora" : verificando ? "Verificando conexão…" : "Não foi possível conectar"}</h2>
          <p>{disponibilidade?.configurados === 0 ? "A conexão com o aplicativo ainda precisa ser ativada. Seu acesso ao portal usa a conta Maicon, sem outra senha." : disponibilidade ? "Entre no aplicativo HeadCargo com seu usuário para conectar. As sessões também podem estar em uso ou temporariamente indisponíveis." : verificando ? "Estamos verificando se o HeadCargo está disponível para receber seu acesso." : "Não conseguimos verificar o acesso ao HeadCargo. Tente verificar a conexão novamente."}</p>
          <button type="button" onClick={() => void verificarConexao(true)} disabled={verificando}>{verificando ? "Verificando…" : "Verificar conexão"}</button>
          {retornoConexao && <div className="ponte-conexao-retorno" role="status"><span>Verificação {retornoConexao.tentativa} · {retornoConexao.hora}</span><p>{retornoConexao.texto}</p></div>}
        </div>}
      </section> : <>
        <div className="ponte-cabecalho"><div><span className="ponte-eyebrow">OPERAÇÃO</span><h1>Processos e atividades</h1><p>Consulte o andamento diretamente no HeadCargo.</p></div><div className="ponte-conta"><span>{sessao.usuario}</span><button disabled={!!ocupado} onClick={() => void executar("Encerrando sessão…", async () => { await api("sair", {}); setSessao(null); setProcesso(null); })}>Sair</button></div></div>
        <form className="ponte-busca" onSubmit={consultar}><label htmlFor="ponte-processo">Número do processo</label><div><input id="ponte-processo" name="numero" placeholder="Ex.: IM2099-25 teste" required maxLength={40} disabled={!!ocupado} /><button className="ponte-principal" disabled={!!ocupado}>Consultar <span aria-hidden>→</span></button></div></form>
        {processo ? <section className="ponte-resultado"><div className="ponte-resultado-cab"><div><span className="ponte-eyebrow">ATIVIDADES</span><h2>{processo.numero}</h2></div><span>{processo.atividades.length.toLocaleString("pt-BR")} atividades</span></div>
          {processo.atividades.length ? <><div className="ponte-tabela"><table><thead><tr><th>Código</th><th>Atividade</th><th>Situação</th><th>Responsável</th><th>Previsão</th></tr></thead><tbody>{processo.atividades.slice(0, limite).map((a, i) => <tr key={i}><td className="ponte-codigo">{a.codigo || "—"}</td><td>{a.atividade || "—"}</td><td>{a.situacao || "—"}</td><td>{a.responsavel || "—"}</td><td>{a.previsao || "—"}</td></tr>)}</tbody></table></div><div className="ponte-rodape"><span>Exibindo {Math.min(limite, processo.atividades.length)} de {processo.atividades.length}</span>{limite < processo.atividades.length && <button onClick={() => setLimite(v => v + 10)}>Ver mais <span>+10</span></button>}</div></> : <p className="ponte-vazio">Nenhuma atividade encontrada neste processo.</p>}
        </section> : !ocupado && <section className="ponte-inicio"><span aria-hidden>⌕</span><h2>Encontre um processo</h2><p>Informe o número acima para consultar suas atividades.</p></section>}
      </>}
      {ocupado && <p className="ponte-andamento" role="status"><span />{ocupado}</p>}
      {erro && <p className="ponte-erro" role="alert">{erro}</p>}
    </main>
    <footer className="ponte-footer">Maicon Workspace <span>Portal de acesso ao HeadCargo</span></footer>
  </div>;
}
