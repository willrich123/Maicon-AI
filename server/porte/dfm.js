// Leitor estático: não carrega DLLs, não executa handlers e não lê arquivos de conexão.
export function recursosDfm(b) {
  const pe = b.readUInt32LE(0x3c);
  if (b.toString("ascii", pe, pe + 4) !== "PE\0\0") throw new Error("Arquivo PE inválido");
  const n = b.readUInt16LE(pe + 6), optSize = b.readUInt16LE(pe + 20), opt = pe + 24;
  const sec = opt + optSize, sections = [];
  for (let i = 0; i < n; i++) { const o = sec + i * 40; sections.push({ rva: b.readUInt32LE(o + 12), size: Math.max(b.readUInt32LE(o + 8), b.readUInt32LE(o + 16)), raw: b.readUInt32LE(o + 20) }); }
  const offset = rva => { const s = sections.find(s => rva >= s.rva && rva < s.rva + s.size); if (!s) throw new Error("RVA inválido"); return s.raw + rva - s.rva; };
  const baseRva = b.readUInt32LE(opt + (b.readUInt16LE(opt) === 0x20b ? 112 : 96) + 16);
  if (!baseRva) return [];
  const base = offset(baseRva), result = [];
  const walk = (relative, names = []) => {
    if (names.length > 4) throw new Error("Árvore de recursos inválida");
    const dir = base + relative, count = b.readUInt16LE(dir + 12) + b.readUInt16LE(dir + 14);
    for (let i = 0; i < count; i++) {
      const o = dir + 16 + i * 8, id = b.readUInt32LE(o), target = b.readUInt32LE(o + 4);
      const label = id & 0x80000000 ? (() => { const p = base + (id & 0x7fffffff); return b.toString("utf16le", p + 2, p + 2 + b.readUInt16LE(p) * 2); })() : id;
      if (target & 0x80000000) walk(target & 0x7fffffff, [...names, label]);
      else {
        const d = base + target, p = offset(b.readUInt32LE(d)), size = b.readUInt32LE(d + 4);
        if (p + size > b.length) throw new Error("Recurso truncado");
        if (b.toString("ascii", p, p + 4) === "TPF0") result.push({ recurso: [...names, label].join("/"), offset: p, tamanho: size, dados: b.subarray(p, p + size) });
      }
    }
  };
  walk(0); return result;
}

export function lerDfm(b) {
  let p = 4, componentes = 0, valores = 0;
  const take = n => { if (!Number.isSafeInteger(n) || n < 0 || p + n > b.length) throw new Error("DFM truncado"); const start = p; p += n; return start; };
  const byte = () => b[take(1)];
  const uint = () => b.readUInt32LE(take(4));
  const str = (n, enc = "latin1") => { const start = take(n); return b.toString(enc, start, p); };
  const short = () => str(byte());
  const props = () => { const r = {}; let name; while ((name = short())) r[name] = value(); return r; };
  const value = (depth = 0) => {
    if (++valores > 1000000 || depth > 100) throw new Error("Limite DFM");
    const type = byte();
    switch (type) {
      case 0: case 13: return null;
      case 1: { const r = []; while (b[p] !== 0) r.push(value(depth + 1)); byte(); return r; }
      case 2: return b.readInt8(take(1));
      case 3: return b.readInt16LE(take(2));
      case 4: return b.readInt32LE(take(4));
      case 5: take(10); return null;
      case 6: case 7: return short();
      case 8: return false;
      case 9: return true;
      case 10: take(uint()); return null;
      case 11: { const r = []; let item; while ((item = short())) r.push(item); return r; }
      case 12: return str(uint());
      case 14: { const r = []; while (b[p] !== 0) { if ([2,3,4].includes(b[p])) value(depth + 1); if (byte() !== 1) throw new Error("Coleção DFM inválida"); r.push(props()); } byte(); return r; }
      case 15: return b.readFloatLE(take(4));
      case 16: case 19: return b.readBigInt64LE(take(8)).toString();
      case 17: case 21: return b.readDoubleLE(take(8));
      case 18: return str(uint() * 2, "utf16le");
      case 20: return str(uint(), "utf8");
      default: throw new Error(`Tipo DFM não suportado: ${type}`);
    }
  };
  const object = (depth = 0) => {
    if (depth > 100 || ++componentes > 30000) throw new Error("Limite de componentes");
    if ((b[p] & 0xf0) === 0xf0) { const flags = byte() & 15; if (flags & 2) value(); }
    const classe = short(), nome = short();
    if (!classe) throw new Error("Classe vazia");
    const propriedades = props(), filhos = [];
    while (b[p] !== 0) filhos.push(object(depth + 1)); byte();
    return { classe, nome, propriedades, filhos };
  };
  if (b.toString("ascii", 0, 4) !== "TPF0") throw new Error("Assinatura DFM inválida");
  const raiz = object();
  if (p !== b.length) throw new Error("Recurso DFM com bytes não interpretados");
  return raiz;
}
