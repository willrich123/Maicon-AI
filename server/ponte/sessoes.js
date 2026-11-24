import { randomBytes, timingSafeEqual } from "node:crypto";

export class FalhaPonte extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const chave = () => randomBytes(32).toString("base64url");
const igual = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Um gateway por instalação. Não guarda senhas em disco nem usa conexão SQL. */
export class SessoesPonte {
  constructor(config = [], { timeout = 25000, agora = Date.now } = {}) {
    this.timeout = timeout; this.agora = agora; this.sessoes = new Map(); this.agentes = new Map();
    const desktops = new Set(), tokens = new Set();
    for (const item of config) {
      if (!/^[\w-]{1,64}$/.test(item.id) || typeof item.desktop !== "string" || !item.desktop || typeof item.token !== "string" || item.token.length < 32 || desktops.has(item.desktop) || tokens.has(item.token) || this.agentes.has(item.id)) throw new Error("Configuração inválida ou sessões Windows duplicadas na ponte.");
      desktops.add(item.desktop); tokens.add(item.token);
      this.agentes.set(item.id, { ...item, estado: "iniciando", visto: 0, sessao: null, trabalho: null });
    }
  }
  agente(id, token, desktop) {
    const agente = this.agentes.get(id);
    if (!agente || !igual(agente.token, token) || agente.desktop !== desktop) throw new FalhaPonte("Agente não autorizado.", 401);
    agente.visto = this.agora(); return agente;
  }
  capacidade() {
    return { configurados: this.agentes.size, disponiveis: [...this.agentes.values()].filter(a => ["livre", "pronto"].includes(a.estado) && this.agora() - a.visto < 10000).length };
  }
  enviar(a, acao, dados = {}) {
    if (a.trabalho) throw new FalhaPonte("Já existe uma operação nesta sessão.", 409);
    return new Promise((resolve, reject) => {
      const tarefa = { id: chave(), acao, ...dados };
      const timer = setTimeout(() => {
        if (a.trabalho?.tarefa.id !== tarefa.id) return;
        a.trabalho = null; a.estado = "isolado";
        reject(new FalhaPonte("O HeadCargo não confirmou a operação a tempo. A sessão foi isolada.", 504));
      }, this.timeout);
      a.trabalho = { tarefa, entregue: false, resolve, reject, timer };
    });
  }
  proximo(a) {
    if (a.estado === "iniciando" && !a.trabalho) {
      a.estado = "verificando";
      void this.enviar(a, "sondar").then(r => {
        a.usuarioAtual = r.ok === true && typeof r.usuario === "string" ? r.usuario.trim() : "";
        a.estado = a.usuarioAtual ? "pronto" : r.ok === true && r.desconectado === true ? "livre" : "isolado";
      }).catch(() => {});
    }
    if (!a.trabalho || a.trabalho.entregue) return null;
    a.trabalho.entregue = true; return a.trabalho.tarefa;
  }
  resultado(a, id, resultado) {
    const t = a.trabalho;
    if (!t || !t.entregue || t.tarefa.id !== id) throw new FalhaPonte("Resultado expirado ou de outra operação.", 409);
    clearTimeout(t.timer); a.trabalho = null;
    t.resolve(resultado && typeof resultado === "object" ? resultado : { ok: false });
  }
  async entrar(usuario, senha) {
    if (typeof usuario !== "string" || !usuario.trim() || usuario.length > 120 || typeof senha !== "string" || !senha || senha.length > 256) throw new FalhaPonte("Informe o usuário e a senha do HeadCargo.");
    usuario = usuario.trim();
    const a = [...this.agentes.values()].find(a => a.estado === "livre" && this.agora() - a.visto < 10000);
    if (!a) throw new FalhaPonte("Nenhuma sessão HeadCargo disponível neste momento.", 503);
    a.estado = "autenticando";
    try {
      const r = await this.enviar(a, "entrar", { usuario, senha });
      if (r.ok !== true || typeof r.usuario !== "string" || r.usuario.toLocaleLowerCase() !== usuario.toLocaleLowerCase()) throw new FalhaPonte("Não foi possível confirmar o login no HeadCargo.", 401);
      const token = chave(); const s = { token, usuario: r.usuario, agente: a, versao: 0, visto: this.agora(), criado: this.agora(), ocupado: false };
      this.sessoes.set(token, s); a.sessao = s; a.estado = "ocupado";
      return s;
    } catch (erro) { a.estado = "isolado"; throw erro; }
  }
  async vincular(usuario, conta) {
    const a = [...this.agentes.values()].find(a => a.estado === "pronto" && String(a.usuarioAtual).toLowerCase() === usuario.toLowerCase() && this.agora() - a.visto < 10000);
    if (!a) throw new FalhaPonte("Nenhuma sessão HeadCargo conectada ao seu usuário está disponível. Entre no aplicativo HeadCargo com sua conta para conectar ao portal.", 503);
    a.estado = "autenticando";
    try {
      const r = await this.enviar(a, "confirmar-identidade", { usuario });
      if (r.ok !== true || r.usuario?.toLowerCase() !== usuario.toLowerCase()) throw new FalhaPonte("O usuário da sessão HeadCargo não corresponde à sua conta Maicon.", 403);
      const token = chave(); const s = { token, usuario, conta, agente: a, versao: 0, visto: this.agora(), criado: this.agora(), ocupado: false };
      this.sessoes.set(token, s); a.sessao = s; a.estado = "ocupado";
      return s;
    } catch (e) { a.estado = "isolado"; throw e; }
  }
  obterDaConta(token, conta) {
    const s = this.obter(token);
    if (!s.conta || s.conta !== conta) throw new FalhaPonte("Esta conexão pertence a outra conta Maicon.", 403);
    return s;
  }
  obter(token) {
    const s = this.sessoes.get(token);
    if (!s || this.agora() - s.visto > 30 * 60000 || this.agora() - s.criado > 8 * 3600000 || s.agente.estado !== "ocupado") {
      if (s) void this.sair(token);
      throw new FalhaPonte("Sua sessão terminou. Entre novamente.", 401);
    }
    return s;
  }
  async consultar(token, { numero, versao } = {}) {
    const s = this.obter(token);
    if (s.ocupado || versao !== s.versao) throw new FalhaPonte("A tela mudou ou uma consulta está em andamento. Atualize antes de continuar.", 409);
    if (typeof numero !== "string" || !/^[A-Za-z]{1,4}\d{2,6}-\d{2}( teste)?$/i.test(numero.trim())) throw new FalhaPonte("Informe um número de processo válido.");
    s.ocupado = true; s.visto = this.agora();
    try {
      const r = await this.enviar(s.agente, "consultar", { usuario: s.usuario, numero: numero.trim() });
      if (this.sessoes.get(token) !== s) throw new FalhaPonte("Sua sessão terminou.", 401);
      if (r.ok !== true) throw new FalhaPonte("Não foi possível confirmar a tela do processo no HeadCargo.", 422);
      if (typeof r.numero !== "string" || r.numero.toLowerCase() !== numero.trim().toLowerCase() || !Array.isArray(r.atividades) || r.atividades.length > 2000) throw new FalhaPonte("A leitura do HeadCargo está incompleta ou não corresponde ao processo.", 422);
      const colunas = ["codigo", "atividade", "situacao", "responsavel", "previsao"];
      const atividades = r.atividades.map(linha => Object.fromEntries(colunas.map(c => [c, typeof linha?.[c] === "string" ? linha[c].slice(0, 500) : ""])));
      s.versao++; s.visto = this.agora();
      return { numero: r.numero, atividades, versao: s.versao };
    } finally { s.ocupado = false; }
  }
  async sair(token) {
    const s = this.sessoes.get(token);
    if (!s) return;
    this.sessoes.delete(token); const a = s.agente; a.estado = "isolado";
    if (a.trabalho) return; // Efeito incerto: nunca liberar o desktop para outra pessoa.
    try { const r = await this.enviar(a, "sair", { usuario: s.usuario }); if (r.ok === true && r.desconectado === true) { a.sessao = null; a.estado = "livre"; } } catch {}
  }
  expirar() {
    for (const s of this.sessoes.values()) if (this.agora() - s.visto > 30 * 60000 || this.agora() - s.criado > 8 * 3600000) void this.sair(s.token);
  }
}
