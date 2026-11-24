import test from "node:test";
import assert from "node:assert/strict";
import { MODELO_OPENROUTER, modeloDaEtapa, modelosOpenRouter, pedirOpenRouter } from "../server/openrouter.js";

test("usa somente o Gemma 4 configurado", () => {
  assert.deepEqual(modelosOpenRouter("gemma-4-31b-it"), [MODELO_OPENROUTER]);
});

test("sem modelo informado usa o Gemma 4 31B", () => {
  assert.deepEqual(modelosOpenRouter(""), [MODELO_OPENROUTER]);
});

test("consulta e resposta usam o mesmo Gemma 4", () => {
  const modelo = modelosOpenRouter()[0];
  assert.equal(modeloDaEtapa("consulta"), modelo);
  assert.equal(modeloDaEtapa("previa"), modelo);
  assert.equal(modeloDaEtapa("relatorio"), modelo);
  assert.equal(modeloDaEtapa("resposta"), modelo);
});

test("um 429 do Gemma não aciona outro modelo", async (t) => {
  const chamada = t.mock.method(globalThis, "fetch", async (_url, req) => {
    assert.equal(JSON.parse(req.body).model, MODELO_OPENROUTER);
    return Response.json({ error: { message: "Rate limit" } }, { status: 429 });
  });
  await assert.rejects(pedirOpenRouter("teste", { messages: [] }), { status: 429 });
  assert.equal(chamada.mock.callCount(), 1);
});

test("limite temporário do provedor repete a solicitação no mesmo Gemma e com a mesma chave", async (t) => {
  const pedidos = [];
  t.mock.method(globalThis, "fetch", async (_url, req) => {
    const corpo = JSON.parse(req.body);
    pedidos.push([req.headers.Authorization, corpo.model, corpo.stream]);
    return corpo.stream
      ? Response.json({ error: { message: "Rate limit", metadata: { provider_name: "Google AI Studio" } } }, { status: 429 })
      : Response.json({ choices: [{ message: { content: "OK" } }] });
  });
  const r = await pedirOpenRouter("chave-exemplo", { messages: [] });
  assert.equal(r.content, "OK");
  assert.deepEqual(pedidos, [
    ["Bearer chave-exemplo", MODELO_OPENROUTER, true],
    ["Bearer chave-exemplo", MODELO_OPENROUTER, false],
  ]);
});
