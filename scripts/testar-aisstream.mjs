import "../server/env.js";
import { lerPosicaoAis } from "../server/porte/posicaoAis.js";
import { abrirWebSocketAis, prazoAberturaAis } from "../server/porte/rastreamentoAis.js";

const chave = process.env.AISSTREAM_API_KEY?.trim();
if (!chave) {
  console.error("Configure AISSTREAM_API_KEY no .env local.");
  process.exit(1);
}

const regioesDisponiveis = [
  { nome: "Santos e sudeste do Brasil", cantos: [[-22.5, -43], [-25.1, -47.4]] },
  { nome: "Roterdã", cantos: [[52.3, 5], [51.4, 3]] },
  { nome: "Singapura", cantos: [[1.6, 104.5], [0.9, 103.3]] },
  { nome: "Sul da Flórida", cantos: [[25.835, -80.208], [25.603, -79.879]] },
];
const regioes = (process.argv.includes("--santos") ? regioesDisponiveis.slice(0, 1) : regioesDisponiveis)
  .map(regiao => ({ ...regiao, navios: new Set(), posicoes: 0 }));

const socket = abrirWebSocketAis();
const inicio = performance.now();
let aberturaMs = null;
let confirmada = false;
let compressao = false;
let total = 0;
let foraDasAreas = 0;
let quadros = 0;
let encerrado = false;
let prazo = setTimeout(() => terminar("A abertura do WebSocket excedeu o prazo."), prazoAberturaAis);

function terminar(resultado) {
  if (encerrado) return;
  encerrado = true;
  clearTimeout(prazo);
  socket.terminate();
  console.log({ resultado, aberturaMs, confirmada, compressao, quadros, total, foraDasAreas, regioes: regioes.map(regiao => ({
    nome: regiao.nome, posicoes: regiao.posicoes, navios: regiao.navios.size,
  })) });
  if (total === foraDasAreas) process.exitCode = 1;
}

socket.on("open", () => {
  aberturaMs = Math.round(performance.now() - inicio);
  clearTimeout(prazo);
  prazo = setTimeout(() => terminar("Janela de teste concluída."), 35_000);
  socket.send(JSON.stringify({ APIKey: chave, BoundingBoxes: regioes.map(r => r.cantos) }));
});

socket.on("message", raw => {
  quadros++;
  let quadro;
  try { quadro = JSON.parse(raw.toString("utf8")); } catch { return; }
  if (quadro?.MessageType === "SubscriptionConfirmation") {
    confirmada = true;
    compressao = quadro.Message?.CompressionEnabled === true;
    return;
  }
  if (quadro?.error || quadro?.Error) {
    terminar("O AISStream retornou um erro na inscrição.");
    return;
  }
  const posicao = lerPosicaoAis(quadro);
  if (!posicao) return;
  total++;
  const regiao = regioes.find(({ cantos: [[norte, oeste], [sul, leste]] }) =>
    posicao.latitude >= sul && posicao.latitude <= norte &&
    posicao.longitude >= oeste && posicao.longitude <= leste);
  if (!regiao) { foraDasAreas++; return; }
  regiao.posicoes++;
  regiao.navios.add(posicao.mmsi);
});

socket.on("unexpected-response", (_pedido, resposta) => {
  resposta.resume();
  terminar(`WebSocket respondeu HTTP ${resposta.statusCode}.`);
});
socket.on("close", codigo => terminar(`WebSocket encerrado (${codigo}).`));
socket.on("error", erro => terminar(/timed out/i.test(erro.message)
  ? "A abertura do WebSocket excedeu o prazo." : "Falha na conexão com o AISStream."));
