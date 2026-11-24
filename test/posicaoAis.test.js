import test from "node:test";
import assert from "node:assert/strict";
import { lerPosicaoAis } from "../server/porte/posicaoAis.js";
import { criarIndiceAis, normalizarImo } from "../server/porte/rastreamentoAis.js";

test("lê coordenadas dos quadros reais com metadados em minúsculas", () => {
  const dado = { MessageType: "PositionReport", MetaData: {
    MMSI: 368207620, latitude: -24, longitude: -46, time_utc: "2026-11-23T13:00:00Z",
  } };
  assert.deepEqual(lerPosicaoAis(dado), {
    mmsi: "368207620", latitude: -24, longitude: -46, horarioAis: "2026-11-23T13:00:00Z",
  });
});

test("prioriza o corpo da posição e aceita a grafia dos metadados documentada", () => {
  const quadro = { MessageType: "PositionReport", MetaData: { MMSI: 368207620, Latitude: 23, Longitude: 43 },
    Message: { PositionReport: { UserID: 244780543, Latitude: 25, Longitude: -80, Valid: true } } };
  assert.equal(lerPosicaoAis(quadro).mmsi, "244780543");
  assert.equal(lerPosicaoAis(quadro).longitude, -80);
  assert.equal(lerPosicaoAis({ ...quadro, Message: undefined }).longitude, 43);
});

test("ignora mensagens de controle, dados cadastrais e posições inválidas", () => {
  const dados = { MMSI: 368207620, latitude: 91, longitude: 20 };
  assert.equal(lerPosicaoAis({ MessageType: "SubscriptionConfirmation", MetaData: dados }), null);
  assert.equal(lerPosicaoAis({ MessageType: "ShipStaticData", MetaData: { ...dados, latitude: 30 } }), null);
  assert.equal(lerPosicaoAis({ MessageType: "PositionReport", MetaData: dados }), null);
  assert.equal(lerPosicaoAis({ MessageType: "PositionReport", Message: {
    PositionReport: { UserID: 368207620, Latitude: 25, Longitude: -80, Valid: false },
  } }), null);
});

test("vincula o IMO ao MMSI pelo quadro cadastral e conserva a posição mais recente", () => {
  const indice = criarIndiceAis();
  const agora = Date.parse("2026-11-23T15:00:00Z");
  const imo = normalizarImo("IMO 9811000");
  assert.equal(imo, "9811000");
  assert.equal(normalizarImo("9811001"), null);
  assert.equal(normalizarImo("IMO 9603221"), "9603221");
  assert.equal(normalizarImo("9603222"), null);
  indice.acompanhar(imo, agora);
  const cadastro = { MessageType: "ShipStaticData", Message: { ShipStaticData: {
    UserID: 353136000, ImoNumber: 9811000, Valid: true,
  } } };
  const posicao = { MessageType: "PositionReport", MetaData: {
    MMSI: 353136000, latitude: -24, longitude: -46, time_utc: "2026-11-23 14:59:30.123456 +0000 UTC",
  } };
  indice.registrar(posicao, agora);
  assert.equal(indice.consultar(imo, agora).estado, "aguardando");
  indice.registrar(cadastro, agora);
  indice.registrar(posicao, agora);
  indice.registrar({ ...posicao, MetaData: { ...posicao.MetaData, latitude: 30,
    time_utc: "2026-11-23T14:58:00Z" } }, agora);
  assert.deepEqual(indice.consultar(imo, agora), { estado: "recebida", posicao: {
    mmsi: "353136000", coords: [-24, -46], data: "2026-11-23T14:59:30.123Z", horarioRecepcao: false,
  } });
  assert.equal(indice.consultar(imo, agora + 31 * 60_000).estado, "antiga");
  indice.registrar({ ...cadastro, Message: {
    ShipStaticData: { ...cadastro.Message.ShipStaticData, UserID: 353136001 },
  } }, agora);
  assert.equal(indice.consultar(imo, agora).estado, "ambiguo");
});
