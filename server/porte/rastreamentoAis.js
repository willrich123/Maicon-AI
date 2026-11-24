import WebSocket from "ws";
import { lerPosicaoAis, normalizarImo } from "./posicaoAis.js";
export { normalizarImo } from "./posicaoAis.js";

const endpoint = "wss://stream.aisstream.io/v0/stream";
const tipos = ["ShipStaticData", "PositionReport", "StandardClassBPositionReport",
  "ExtendedClassBPositionReport", "LongRangeAisBroadcastMessage"];
const minuto = 60_000;
const vidaInteresse = 2 * minuto;
const vidaIdentidade = 24 * 60 * minuto;
const vidaPosicao = 24 * 60 * minuto;
const limiteNavios = 200;
export const prazoAberturaAis = 60_000;

export function abrirWebSocketAis() {
  return new WebSocket(endpoint, {
    perMessageDeflate: true, handshakeTimeout: prazoAberturaAis, maxPayload: 128 * 1024,
  });
}

function instanteAis(valor, agora) {
  if (typeof valor !== "string") return null;
  // Algumas mensagens usam o formato de timestamp do Go, com nanossegundos e sufixo UTC.
  const data = Date.parse(valor.replace(/(\.\d{3})\d+(?=\s|Z|[+-])/, "$1")
    .replace(/ \+0000 UTC$/, "Z").replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  return Number.isFinite(data) && data > 0 && data <= agora + minuto ? Math.min(data, agora) : null;
}

export function criarIndiceAis() {
  const navios = new Map();
  const vinculos = new Map();

  function limpar(agora) {
    for (const [imo, interesse] of navios) {
      if (agora - interesse > vidaPosicao) navios.delete(imo);
    }
    for (const [mmsi, vinculo] of vinculos) {
      if (!navios.has(vinculo.imo) || agora - vinculo.atualizadoEm > vidaIdentidade) vinculos.delete(mmsi);
    }
  }

  function acompanhar(imo, agora) {
    limpar(agora);
    navios.delete(imo);
    navios.set(imo, agora);
    if (navios.size > limiteNavios) navios.delete(navios.keys().next().value);
  }

  function registrar(quadro, agora) {
    if (quadro?.MessageType === "ShipStaticData") {
      const dados = quadro.Message?.ShipStaticData;
      const imo = normalizarImo(dados?.ImoNumber);
      const mmsi = String(dados?.UserID ?? quadro.MetaData?.MMSI ?? "");
      if (!imo || dados?.Valid === false || !/^[1-9]\d{8}$/.test(mmsi)) return;
      const anterior = vinculos.get(mmsi);
      if (anterior && anterior.imo !== imo) vinculos.delete(mmsi);
      if (navios.has(imo)) {
        vinculos.set(mmsi, { imo, atualizadoEm: agora, nomeAis: typeof dados?.Name === "string" ? dados.Name.trim().slice(0, 40) : null,
          posicao: anterior?.imo === imo ? anterior.posicao : null });
        if (vinculos.size > 2 * limiteNavios) vinculos.delete(vinculos.keys().next().value);
      }
      return;
    }

    const posicao = lerPosicaoAis(quadro);
    const vinculo = posicao && vinculos.get(posicao.mmsi);
    if (!vinculo || !navios.has(vinculo.imo) || agora - vinculo.atualizadoEm > vidaIdentidade) return;
    const dataAis = instanteAis(posicao.horarioAis, agora);
    const data = dataAis ?? agora;
    if (agora - data > vidaPosicao || (vinculo.posicao && data <= vinculo.posicao.data)) return;
    vinculo.posicao = {
      mmsi: posicao.mmsi, coords: [posicao.latitude, posicao.longitude], data, horarioRecepcao: dataAis == null,
    };
  }

  function consultar(imo, agora) {
    const vinculados = [...vinculos.values()].filter(v => v.imo === imo && agora - v.atualizadoEm <= vidaIdentidade);
    if (vinculados.length > 1) return { estado: "ambiguo", posicao: null };
    const posicao = vinculados[0]?.posicao;
    if (!posicao || agora - posicao.data > vidaPosicao) return { estado: "aguardando", posicao: null };
    return {
      estado: agora - posicao.data > 30 * minuto ? "antiga" : "recebida",
      posicao: { ...posicao, data: new Date(posicao.data).toISOString(),
        ...(vinculados[0].nomeAis ? { nomeAis: vinculados[0].nomeAis } : {}) },
    };
  }

  return { acompanhar, registrar, consultar, limpar,
    emUso: agora => [...navios.values()].some(interesse => agora - interesse <= vidaInteresse) };
}

const indice = criarIndiceAis();
let socket;
let manutencao;
let tentativa = 0;
let reconectarEm = 0;
let ultimoQuadro = 0;
let inscrito = false;

function conectar(chave) {
  const conexao = abrirWebSocketAis();
  socket = conexao;
  inscrito = false;
  ultimoQuadro = Date.now();
  conexao.on("open", () => {
    // O IMO só aparece na mensagem cadastral. Até conhecer o MMSI, a busca precisa abranger a rota inteira.
    conexao.send(JSON.stringify({ APIKey: chave, BoundingBoxes: [[[90, -180], [-90, 180]]], FilterMessageTypes: tipos }));
  });
  conexao.on("message", raw => {
    if (socket !== conexao) return;
    let quadro;
    try { quadro = JSON.parse(raw.toString("utf8")); } catch { return; }
    if (quadro?.MessageType === "SubscriptionConfirmation") {
      inscrito = true;
      ultimoQuadro = Date.now();
      return;
    }
    if (quadro?.Error || quadro?.error) {
      conexao.terminate();
      return;
    }
    if (!tipos.includes(quadro?.MessageType)) return;
    ultimoQuadro = Date.now();
    tentativa = 0;
    indice.registrar(quadro, ultimoQuadro);
  });
  conexao.on("error", () => conexao.terminate());
  conexao.on("close", () => {
    if (socket !== conexao) return;
    socket = undefined;
    inscrito = false;
    reconectarEm = Date.now() + Math.min(120_000, 5_000 * 2 ** Math.min(tentativa++, 5)) + Math.random() * 2_000;
  });
}

function verificarConexao(chave) {
  const agora = Date.now();
  indice.limpar(agora);
  if (!indice.emUso(agora)) {
    socket?.terminate();
    clearInterval(manutencao);
    manutencao = undefined;
    return;
  }
  if (!socket && agora >= reconectarEm) conectar(chave);
  else if (socket?.readyState === WebSocket.OPEN && agora - ultimoQuadro > 90_000) socket.terminate();
  else if (socket?.readyState === WebSocket.OPEN) socket.ping();
}

export function consultarNavioAis(imo) {
  const chave = process.env.AISSTREAM_API_KEY?.trim();
  if (!chave) return { estado: "desativado", posicao: null };
  const agora = Date.now();
  indice.acompanhar(imo, agora);
  if (!manutencao) {
    verificarConexao(chave);
    manutencao = setInterval(() => verificarConexao(chave), 15_000);
    manutencao.unref();
  }
  const resultado = indice.consultar(imo, agora);
  if (resultado.estado !== "aguardando" || inscrito) return resultado;
  return { ...resultado, estado: tentativa > 0 ? "reconectando" : "conectando" };
}
