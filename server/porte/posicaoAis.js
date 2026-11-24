const tiposPosicao = new Set([
  "PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "LongRangeAisBroadcastMessage",
]);

export function normalizarImo(valor) {
  const numero = /^(?:IMO\s*)?([1-9]\d{6})$/i.exec(String(valor ?? "").trim())?.[1];
  if (!numero) return null;
  const soma = [...numero.slice(0, 6)].reduce((peso, digito, i) => peso + Number(digito) * (7 - i), 0);
  return soma % 10 === Number(numero[6]) ? numero : null;
}

export function lerPosicaoAis(quadro) {
  const tipo = quadro?.MessageType;
  if (!tiposPosicao.has(tipo)) return null;

  const posicao = quadro.Message?.[tipo];
  const meta = quadro.MetaData;
  if (posicao?.Valid === false) return null;

  const mmsi = String(posicao?.UserID ?? meta?.MMSI ?? "");
  const latitude = posicao?.Latitude ?? meta?.latitude ?? meta?.Latitude;
  const longitude = posicao?.Longitude ?? meta?.longitude ?? meta?.Longitude;
  if (!/^[1-9]\d{8}$/.test(mmsi) || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { mmsi, latitude, longitude, horarioAis: meta?.time_utc ?? null };
}
