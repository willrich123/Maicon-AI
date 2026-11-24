import test from "node:test";
import assert from "node:assert/strict";
import { concluirAtividadeNoHeadCargo, lerSaidaDoBot, numeroCitado, numeroParaConsulta, processoDeTeste } from "../server/headcargoDesktop.js";

test("só é teste o processo que já traz a palavra teste", () => {
  assert.deepEqual(processoDeTeste("IM2099-25 teste"), { codigo: "IM2099-25", teste: true, rotulo: "IM2099-25 teste" });
  assert.deepEqual(processoDeTeste("IM3896-26"), { codigo: "IM3896-26", teste: false, rotulo: "IM3896-26" });
  assert.equal(processoDeTeste("processo").teste, false);
});

test("administrador pode pedir o processo teste e os demais não", () => {
  assert.deepEqual(numeroParaConsulta("IM2099-25 teste", true), { ok: true, numero: "IM2099-25 teste" });
  assert.equal(numeroParaConsulta("abre o IM2099-25 teste", false).ok, false);
  assert.deepEqual(numeroParaConsulta("IM3896-26", true), { ok: true, numero: "" });
  assert.equal(numeroCitado("follow do IM2099-25 teste"), "IM2099-25 teste");
  assert.equal(numeroCitado("follow do IM3896-26"), "IM3896-26");
});

test("bloqueia mutações fora da homologação, inclusive em um processo teste", async () => {
  for (const pedido of [
    { numero: "IM3896-26", nome: "CONFIRMAR EMBARQUE" },
    { numero: "IM2099-25 teste", nome: "ANTECIPAÇÃO DESBLOQUEIO", acao: "restaurar" },
    { numero: "IM2099-25 teste", nome: "CONFIRMAR CHEGADA DO COURIER", botao: "CANCELAR" },
  ]) {
    const resultado = await concluirAtividadeNoHeadCargo(pedido);
    assert.equal(resultado.ok, false);
    assert.match(resultado.texto, /apenas em homologação/);
  }
});

test("aviso de campo e pergunta de caminho chegam inteiros", () => {
  const campos = lerSaidaDoBot("ERRO Não concluí a atividade X. Para confirmar, o HeadCargo pediu para preencher: Tipo embalagem container; Nome Marca.");
  assert.equal(campos.ok, false);
  assert.match(campos.texto, /Tipo embalagem container/);
  assert.match(campos.texto, /Nome Marca/);
  const caminho = lerSaidaDoBot("PERGUNTA O HeadCargo pediu um caminho. Qual seguir? Previsão mantida; Previsão alterada.");
  assert.equal(caminho.ok, false);
  assert.match(caminho.texto, /Qual seguir/);
  assert.match(caminho.texto, /Previsão alterada/);
  assert.equal(lerSaidaDoBot("OK Clique enviado na atividade X.").ok, true);
});
