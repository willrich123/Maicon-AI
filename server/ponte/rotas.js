import express from "express";
import { SessoesPonte, FalhaPonte } from "./sessoes.js";

const COOKIE = "__Secure-headcargo";
const cookie = req => String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1) || "";
export function tratarErroCorpoPonte(erro, req, res, next) {
  if (!/^\/api\/ponte(?:\/|$)/.test(req.path)) return next(erro);
  // O parser JSON pode incluir trechos do corpo na mensagem da exceção.
  res.status(erro?.status === 413 ? 413 : 400).json({ erro: "Corpo da solicitação inválido." });
}
export function criarRotasPonte({ motor, origens = [], agora = Date.now, autenticar, identificar, catalogo, tela, consultarWeb, operacionalWeb, novoProcesso, arquivosWeb, comercialWeb } = {}) {
  const router = express.Router(); const tentativas = new Map();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use((req, res, next) => {
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
    if (!req.socket.encrypted && !local) return res.status(403).json({ erro: "Use o endereço HTTPS do portal." });
    next();
  });
  router.use((req, res, next) => {
    if (req.path.startsWith("/agentes/")) return next();
    // Origem explícita também protege o cookie de sessão contra CSRF.
    if (req.method !== "GET" && !origens.includes(req.get("origin"))) return res.status(403).json({ erro: "Origem não permitida." });
    next();
  });
  router.use(async (req, res, next) => {
    if (req.path.startsWith("/agentes/")) return next();
    try {
      req.contaPonte = await autenticar?.(req);
      if (!req.contaPonte?.email) throw new FalhaPonte("Entre no Maicon com sua conta Google.", 401);
      if (req.contaPonte.entregarSessao) res.set("X-Sessao", req.contaPonte.entregarSessao);
      next();
    } catch (e) { next(e instanceof FalhaPonte ? e : new FalhaPonte("Sua sessão Maicon terminou. Entre novamente.", 401)); }
  });
  const rota = (metodo, url, executar) => router[metodo](url, async (req, res, next) => { try { await executar(req, res); } catch (e) { next(e); } });
  const identidade = async req => {
    if (!identificar) throw new FalhaPonte("Identificação do HeadCargo não configurada.", 503);
    return identificar(req.contaPonte);
  };
  const propria = req => motor.obterDaConta(cookie(req), req.contaPonte.email);
  rota("get", "/identidade", async (req, res) => res.json(await identidade(req)));
  rota('post','/web/arquivos',async(req,res)=>{const vinculo=await identidade(req);if(!arquivosWeb)throw new FalhaPonte('Consulta de arquivos não configurada.',503);res.json(await arquivosWeb(req.contaPonte,vinculo,{...req.body,acao:'listar'}));});
  rota('get','/web/arquivos/conteudo',async(req,res)=>{const vinculo=await identidade(req);if(!arquivosWeb)throw new FalhaPonte('Consulta de arquivos não configurada.',503);const d=await arquivosWeb(req.contaPonte,vinculo,{numero:req.query.numero,arquivo:req.query.arquivo,acao:'conteudo'});const inline=req.query.visualizar==='1'&&d.tipo!=='application/octet-stream';res.set({'Content-Type':d.tipo,'Content-Length':String(d.conteudo.length),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`${inline?'inline':'attachment'}; filename="anexo"; filename*=UTF-8''${encodeURIComponent(d.nome)}`});res.send(d.conteudo);});
  for(const acao of ['configuracao','clientes','criar','status'])rota('post',`/web/novo-processo/${acao}`,async(req,res)=>{const vinculo=await identidade(req);if(!novoProcesso)throw new FalhaPonte('Criação de processos não configurada.',503);const resultado=await novoProcesso(req.contaPonte,vinculo,{...req.body,acao});res.status(acao==='criar'?202:200).json(resultado);});
  rota("get", "/web/catalogo", async (req,res) => { await identidade(req); if (!catalogo) throw new FalhaPonte("Catálogo não disponível.",503); res.json(catalogo()); });
  rota("get", "/web/telas/:id", async (req,res) => { await identidade(req); const t = tela?.(req.params.id); if (!t) throw new FalhaPonte("Tela não encontrada.",404); res.json(t); });
  rota("post", "/web/processo", async (req,res) => { const vinculo = await identidade(req); if (!consultarWeb) throw new FalhaPonte("Consulta não disponível.",503); res.json(await consultarWeb(req.contaPonte, vinculo, req.body?.numero)); });
  for(const acao of ["secoes","dados","processos"]) rota("post",`/web/operacional/${acao}`,async(req,res)=>{const vinculo=await identidade(req);if(!operacionalWeb)throw new FalhaPonte("Consulta operacional não disponível.",503);res.json(await operacionalWeb(req.contaPonte,vinculo,{...req.body,acao}));});
  rota("post", "/web/comercial", async (req,res) => {
    const vinculo = await identidade(req);
    if (!comercialWeb) throw new FalhaPonte("Consulta comercial não disponível.", 503);
    res.json(await comercialWeb(req.contaPonte, vinculo, req.body || {}));
  });
  rota("get", "/disponibilidade", (_req, res) => res.json(motor.capacidade()));
  rota("post", "/entrar", async (req, res) => {
    const ip = req.socket.remoteAddress || "local"; const chave = req.contaPonte.email;
    for (const [k, v] of tentativas) if (agora() - v.inicio > 60000) tentativas.delete(k);
    const limite = k => { const v = tentativas.get(k) || { inicio: agora(), numero: 0 }; if (++v.numero > 10) throw new FalhaPonte("Aguarde um minuto antes de tentar novamente.", 429); tentativas.set(k, v); };
    limite(ip); limite(chave);
    if (cookie(req)) throw new FalhaPonte("Encerre a sessão atual antes de entrar novamente.", 409);
    const vinculo = await identidade(req);
    const s = await motor.vincular(vinculo.usuario, req.contaPonte.email);
    // Se o navegador desistiu do login, não deixar uma sessão reservada.
    if (res.destroyed) { void motor.sair(s.token); return; }
    res.cookie(COOKIE, s.token, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/ponte", maxAge: 8 * 3600000 });
    res.json({ usuario: s.usuario, versao: s.versao });
  });
  rota("get", "/sessao", (req, res) => { const s = propria(req); res.json({ usuario: s.usuario, versao: s.versao }); });
  rota("post", "/processo", async (req, res) => { propria(req); res.json(await motor.consultar(cookie(req), req.body)); });
  rota("post", "/sair", (req, res) => {
    if (motor.sessoes.get(cookie(req))?.conta === req.contaPonte.email) void motor.sair(cookie(req));
    res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/ponte" }); res.json({ ok: true });
  });
  router.use("/agentes/:id", (req, res, next) => {
    try { req.agentePonte = motor.agente(req.params.id, String(req.get("authorization") || "").replace(/^Bearer /, ""), req.get("x-desktop")); next(); } catch (e) { next(e); }
  });
  rota("post", "/agentes/:id/proximo", (req, res) => res.json({ tarefa: motor.proximo(req.agentePonte) }));
  rota("post", "/agentes/:id/resultado", (req, res) => { motor.resultado(req.agentePonte, req.body?.id, req.body?.resultado); res.json({ ok: true }); });
  router.use((_req, res) => res.status(404).json({ erro: "Operação da ponte não encontrada." }));
  router.use((erro, _req, res, _next) => res.status(erro instanceof FalhaPonte ? erro.status : 500).json({ erro: erro instanceof FalhaPonte ? erro.message : "Não foi possível executar a operação da ponte." }));
  return router;
}

export function instalarPonte(app, { autenticar, identificar, catalogo, tela, consultarWeb, operacionalWeb, novoProcesso, arquivosWeb, comercialWeb } = {}) {
  // Não há agente compartilhado implícito. Sem configuração, o portal informa indisponibilidade.
  let config;
  try { config = JSON.parse(process.env.HC_PONTE_AGENTES || "[]"); if (!Array.isArray(config)) throw new Error(); }
  catch { throw new Error("HC_PONTE_AGENTES deve conter uma lista JSON válida."); }
  const motor = new SessoesPonte(config);
  const origens = String(process.env.HC_PONTE_ORIGENS || "https://localhost:5173,https://maicon.conlinebr.com.br:5173").split(",").map(x => x.trim()).filter(Boolean);
  app.use("/api/ponte", criarRotasPonte({ motor, origens, autenticar, identificar, catalogo, tela, consultarWeb, operacionalWeb, novoProcesso, arquivosWeb, comercialWeb }));
  const timer = setInterval(() => motor.expirar(), 30000); timer.unref();
  return motor;
}
