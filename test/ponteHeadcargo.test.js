import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { SessoesPonte } from "../server/ponte/sessoes.js";
import { criarRotasPonte, tratarErroCorpoPonte } from "../server/ponte/rotas.js";
import { usuarioPonteDaConta } from "../server/ponte/identidade.js";

const configuracao = n => Array.from({ length: n }, (_, i) => ({ id: `agente-${i}`, token: `segredo-individual-${i}-`.padEnd(48, "x"), desktop: `servidor:${i + 10}` }));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function preparar(n = 1, opcoes) {
  const config = configuracao(n); const motor = new SessoesPonte(config, opcoes);
  const agentes = config.map(c => motor.agente(c.id, c.token, c.desktop));
  for (const a of agentes) { const t = motor.proximo(a); assert.equal(t.acao, "sondar"); motor.resultado(a, t.id, { ok: true, desconectado: true }); }
  await tick(); return { config, motor, agentes };
}
async function login(motor, a, usuario = "eduardo") {
  const promessa = motor.entrar(usuario, "senha-nao-persistida"); const t = motor.proximo(a);
  assert.equal(t.acao, "entrar"); assert.equal(t.usuario, usuario);
  motor.resultado(a, t.id, { ok: true, usuario }); return promessa;
}

test("seis usuários concorrentes não compartilham desktop, tarefas nem resultado", async () => {
  const { motor, agentes } = await preparar(6);
  const entradas = agentes.map((a, i) => login(motor, a, `conta${i}`));
  const sessoes = await Promise.all(entradas);
  assert.equal(new Set(sessoes.map(s => s.token)).size, 6);
  assert.equal(motor.capacidade().disponiveis, 0);
  await assert.rejects(motor.entrar("setimo", "senha"), /Nenhuma sessão/);
  const consultas = sessoes.map((s, i) => motor.consultar(s.token, { numero: `IM20${i}9-25`, versao: 0 }));
  for (let i = 0; i < agentes.length; i++) {
    const t = motor.proximo(agentes[i]); assert.equal(t.usuario, `conta${i}`);
    assert.throws(() => motor.resultado(agentes[(i + 1) % 6], t.id, { ok: true }), /outra operação/);
    motor.resultado(agentes[i], t.id, { ok: true, numero: t.numero, atividades: [{ atividade: `Atividade ${i}`, codigo: `${i}`, segredo: "não transmitir" }] });
  }
  const respostas = await Promise.all(consultas);
  respostas.forEach((r, i) => { assert.equal(r.atividades[0].atividade, `Atividade ${i}`); assert.equal(r.atividades[0].segredo, undefined); assert.equal(r.versao, 1); });
});

test("autenticação do agente e vínculo Windows são obrigatórios e únicos", async () => {
  const { motor, config } = await preparar(); const c = config[0];
  assert.throws(() => motor.agente(c.id, "invalido", c.desktop), /não autorizado/);
  assert.throws(() => motor.agente(c.id, c.token, "outro:10"), /não autorizado/);
  assert.throws(() => new SessoesPonte([c, { ...c, id: "outro" }]), /duplicadas/);
  assert.equal(new SessoesPonte().capacidade().disponiveis, 0);
});

test("identidade diferente, processo diferente e resultados expirados são recusados", async () => {
  const { motor, agentes: [a] } = await preparar();
  const p = motor.entrar("eduardo", "senha"); const t = motor.proximo(a);
  motor.resultado(a, t.id, { ok: true, usuario: "administrador" });
  await assert.rejects(p, /confirmar o login/); assert.equal(a.estado, "isolado");
  const outro = await preparar(); const s = await login(outro.motor, outro.agentes[0]);
  const q = outro.motor.consultar(s.token, { numero: "IM2099-25", versao: 0 }); const trabalho = outro.motor.proximo(outro.agentes[0]);
  outro.motor.resultado(outro.agentes[0], trabalho.id, { ok: true, numero: "IM0000-25", atividades: [] });
  await assert.rejects(q, /não corresponde/);
  assert.throws(() => outro.motor.resultado(outro.agentes[0], trabalho.id, { ok: true }), /expirado/);
});

test("comando duplicado e tela antiga não movimentam o desktop", async () => {
  const { motor, agentes: [a] } = await preparar(); const s = await login(motor, a);
  const p = motor.consultar(s.token, { numero: "IM2099-25 teste", versao: 0 });
  await assert.rejects(motor.consultar(s.token, { numero: "IM2099-25 teste", versao: 0 }), /em andamento/);
  const t = motor.proximo(a); assert.equal(motor.proximo(a), null);
  motor.resultado(a, t.id, { ok: true, numero: t.numero, atividades: [] }); await p;
  await assert.rejects(motor.consultar(s.token, { numero: t.numero, versao: 0 }), /tela mudou/i);
  await assert.rejects(motor.consultar("outra-sessao", { numero: t.numero, versao: 1 }), /terminou/);
});

test("logout libera agente somente após confirmação nativa; saída durante ação isola", async () => {
  const { motor, agentes: [a] } = await preparar(); const s = await login(motor, a);
  const saida = motor.sair(s.token); assert.throws(() => motor.obter(s.token), /terminou/);
  assert.equal(motor.capacidade().disponiveis, 0);
  const t = motor.proximo(a); assert.equal(t.acao, "sair"); motor.resultado(a, t.id, { ok: true, desconectado: true });
  await saida; assert.equal(motor.capacidade().disponiveis, 1);
  const nova = await login(motor, a, "outro");
  const consulta = motor.consultar(nova.token, { numero: "IM2099-25", versao: 0 });
  const tarefa = motor.proximo(a); await motor.sair(nova.token);
  motor.resultado(a, tarefa.id, { ok: true, numero: tarefa.numero, atividades: [] });
  await assert.rejects(consulta, /terminou/); assert.equal(a.estado, "isolado");
});

test("timeout não repete a ação e não libera desktop com resultado incerto", async () => {
  const { motor, agentes: [a] } = await preparar(1, { timeout: 20 });
  const p = motor.entrar("eduardo", "senha"); const t = motor.proximo(a);
  await assert.rejects(p, /não confirmou/);
  assert.equal(a.estado, "isolado"); assert.equal(motor.proximo(a), null);
  assert.throws(() => motor.resultado(a, t.id, { ok: true, usuario: "eduardo" }), /expirado/);
  assert.equal(a.trabalho, null);
});

test("expiração não é prolongada por consultas passivas de sessão", async () => {
  let tempo = 1000;
  const { motor, agentes: [a] } = await preparar(1, { agora: () => tempo }); const s = await login(motor, a);
  tempo += 30 * 60000 + 1; assert.throws(() => motor.obter(s.token), /terminou/);
  const t = motor.proximo(a); motor.resultado(a, t.id, { ok: true, desconectado: true }); await tick();
  assert.equal(a.estado, "livre");
});

test("HTTP usa cookie protegido, CSRF, autenticação própria e contrato restrito", async t => {
  const { motor, agentes: [a], config: [c] } = await preparar();
  a.estado = "pronto"; a.usuarioAtual = "eduardo";
  const app = express(); app.use(express.json()); app.use(tratarErroCorpoPonte); app.use("/api/ponte", criarRotasPonte({ motor, origens: ["https://portal.local"],
    autenticar: req => req.get("authorization") === "Bearer maicon-valido" ? { email: "eduardo@empresa.local" } : req.get("authorization") === "Bearer outra-conta" ? { email: "outra@empresa.local" } : null,
    identificar: conta => ({ email: conta.email, usuario: "eduardo", idPessoa: 23 }),
    catalogo: () => ({ modulos: [{ id: "logistica" }] }),
    tela: id => id === "conhecida" ? { titulo: "Processo", modo: "estrutura" } : null,
    consultarWeb: async (conta, vinculo, numero) => { assert.equal(conta.email,"eduardo@empresa.local");assert.equal(vinculo.idPessoa,23);return { numero, modo:"somente-leitura" }; },
    novoProcesso: async(conta,vinculo,pedido)=>{assert.equal(conta.email,'eduardo@empresa.local');assert.equal(vinculo.usuario,'eduardo');assert.equal(pedido.acao,'criar');return {id:'tarefa',estado:'fila'};},
  }));
  const servidor = app.listen(0, "127.0.0.1"); await new Promise(r => servidor.once("listening", r));
  t.after(() => new Promise(r => { servidor.closeAllConnections(); servidor.close(r); }));
  const base = `http://127.0.0.1:${servidor.address().port}/api/ponte`;
  const post = (p, b, headers = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", origin: "https://portal.local", authorization: "Bearer maicon-valido", ...headers }, body: JSON.stringify(b) });
  assert.equal((await post("/entrar", {}, { origin: "https://invasor.local" })).status, 403);
  assert.equal((await fetch(base + "/sessao")).status, 401);
  assert.equal((await fetch(base + "/web/catalogo")).status, 401);
  assert.equal((await post('/web/novo-processo/criar',{}, {origin:'https://invasor.local'})).status,403);
  assert.equal((await post('/web/novo-processo/criar',{}, {authorization:'Bearer invalido'})).status,401);
  const criacao=await post('/web/novo-processo/criar',{acao:'executar-sql'});assert.equal(criacao.status,202);assert.equal((await criacao.json()).estado,'fila');
  assert.equal((await fetch(base + "/web/telas/inexistente", {headers:{authorization:"Bearer maicon-valido"}})).status,404);
  const web = await post("/web/processo", {numero:"IM2099-25",idPessoa:999,admin:true});
  assert.equal(web.status,200);assert.equal((await web.json()).modo,"somente-leitura");
  const invalido = await fetch(base + "/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: '{"senha":"NAO-EXIBIR-ESTE-SEGREDO"' });
  assert.equal(invalido.status, 400); assert.doesNotMatch(await invalido.text(), /NAO-EXIBIR/);
  assert.equal((await post(`/agentes/${c.id}/proximo`, {}, { authorization: "Bearer incorreto", "x-desktop": c.desktop })).status, 401);
  const entrada = post("/entrar", { usuario: "eduardo", senha: "segredo" });
  while (!a.trabalho) await tick(); const tarefa = motor.proximo(a);
  assert.equal(tarefa.acao, "confirmar-identidade"); assert.equal(tarefa.senha, undefined);
  const resultado = await post(`/agentes/${c.id}/resultado`, { id: tarefa.id, resultado: { ok: true, usuario: "eduardo" } }, { authorization: `Bearer ${c.token}`, "x-desktop": c.desktop });
  assert.equal(resultado.status, 200);
  const resposta = await entrada; assert.equal(resposta.status, 200);
  const header = resposta.headers.get("set-cookie"); assert.match(header, /HttpOnly/); assert.match(header, /Secure/); assert.match(header, /SameSite=Strict/);
  const publico = await resposta.json(); assert.deepEqual(publico, { usuario: "eduardo", versao: 0 });
  const cookie = header.split(";")[0];
  assert.equal((await fetch(base + "/sessao", { headers: { cookie, authorization: "Bearer maicon-valido" } })).status, 200);
  assert.equal((await fetch(base + "/sessao", { headers: { cookie, authorization: "Bearer outra-conta" } })).status, 403);
  assert.equal((await post("/executar-sql", { sql: "DELETE FROM ERP" }, { cookie })).status, 404);
  assert.equal((await post("/processo", { numero: "DROP TABLE", versao: 0 }, { cookie })).status, 400);
});

test("SSO seleciona somente sessão nativa do usuário vinculado, sem enviar senha", async () => {
  const { motor, agentes: [a, b] } = await preparar(2);
  a.estado = b.estado = "pronto"; a.usuarioAtual = "outro"; b.usuarioAtual = "eduardo";
  const p = motor.vincular("eduardo", "eduardo@empresa.local");
  assert.equal(motor.proximo(a), null);
  const t = motor.proximo(b); assert.equal(t.acao, "confirmar-identidade"); assert.equal(t.senha, undefined);
  motor.resultado(b, t.id, { ok: true, usuario: "eduardo" }); const s = await p;
  assert.equal(motor.obterDaConta(s.token, "eduardo@empresa.local").usuario, "eduardo");
  assert.throws(() => motor.obterDaConta(s.token, "outro@empresa.local"), /outra conta/);
  await assert.rejects(motor.vincular("inexistente", "inexistente@empresa.local"), /Nenhuma sessão/);
});

test("vínculo SSO usa e-mail completo e recusa ausência ou ambiguidade", async () => {
  let consulta = "", parametro = "";
  const pool = linhas => ({ request: () => ({ input(_nome, _tipo, valor) { parametro = valor; return this; }, async query(texto) { consulta = texto; return { recordset: linhas }; } }) });
  const conta = { email: "EDUARDO@EMPRESA.LOCAL", nome: "Eduardo" };
  assert.equal((await usuarioPonteDaConta(pool([{ IdUsuario: 1, Usuario: "eduardo" }]), conta)).usuario, "eduardo");
  assert.equal(parametro, "eduardo@empresa.local"); assert.doesNotMatch(consulta, /@login|Senha|Password/i);
  await assert.rejects(usuarioPonteDaConta(pool([]), conta), /vínculo único/);
  await assert.rejects(usuarioPonteDaConta(pool([{ Usuario: "a" }, { Usuario: "b" }]), conta), /vínculo único/);
});
