import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { recursosDfm, lerDfm } from "../server/porte/dfm.js";

const origem = process.argv[2] || "C:/Program Files (x86)/HeadCargo Conline";
const saida = path.resolve(process.argv[3] || "server/porte/catalogo.json.gz");
const nomes=await readdir(origem);
const omitidos=nomes.filter(n=>/-DESKTOP-[A-Z0-9]+/i.test(n));
const arquivos = nomes.filter(n => /\.(hsm|bpl|exe)$/i.test(n) && !/^(unins|openssl|hcopy|update)/i.test(n) && !omitidos.includes(n)).sort();
const telas = [], fontes = [], falhas = [];
const permitido = /^(Caption|Hint|DataField|DataSource|DataBinding\.DataField|DataBinding\.DataSource|FieldName|DisplayLabel|DisplayWidth|Width|Height|Left|Top|TabOrder|Visible|Enabled|ReadOnly|FocusControl|Alignment|Align|PageIndex|FieldKind|Required|MaxLength|Size|Items\.Strings|Title\.Caption|Columns|BandIndex|Action|OnClick|OnDblClick|OnExecute|OnUpdate|OnChange|OnEditValueChanged|OnValidate|OnExit|ShortCut|ModalResult|TabVisible|Properties\.ReadOnly|OptionsData\.Editing|OptionsData\.Inserting|OptionsData\.Deleting)$/;
function limpar(o) {
  return { classe: o.classe, nome: o.nome, propriedades: Object.fromEntries(Object.entries(o.propriedades).filter(([k]) => permitido.test(k) && !/password|senha|connection/i.test(o.nome)).map(([k,v]) => [k, k === "Columns" && Array.isArray(v) ? v.map(c => Object.fromEntries(Object.entries(c).filter(([p]) => permitido.test(p)))) : v])), filhos: o.filhos.map(limpar) };
}
for (const arquivo of arquivos) {
  const b = await readFile(path.join(origem, arquivo));
  const sha256 = createHash("sha256").update(b).digest("hex");
  let recursos;
  try { recursos = recursosDfm(b); } catch { falhas.push({ arquivo, recurso: null, motivo: "PE não interpretado" }); continue; }
  fontes.push({ arquivo, bytes: b.length, sha256, formularios: recursos.length });
  for (const r of recursos) {
    try {
      const raiz = limpar(lerDfm(r.dados));
      const id = createHash("sha256").update(arquivo + ":" + r.recurso).digest("hex").slice(0,20);
      telas.push({ id, arquivo, recurso: r.recurso, offset: r.offset, tamanho: r.tamanho, titulo: String(raiz.propriedades.Caption || raiz.nome).replace(/&/g,""), raiz });
    } catch (e) { falhas.push({ arquivo, recurso: r.recurso, motivo: e.message }); }
  }
}
await mkdir(path.dirname(saida), { recursive: true });
await writeFile(saida, gzipSync(JSON.stringify({ geradoEm: new Date().toISOString(), metodo: "Leitura estática PE/DFM; sem executar módulos ou recuperar handlers", fontes, falhas, omitidos:omitidos.map(arquivo=>({arquivo,motivo:'Cópia de conflito de sincronização; versão canônica analisada'})), telas }), { level: 9 }));
console.log(JSON.stringify({ fontes: fontes.length, telas: telas.length, falhas: falhas.length, exemplosFalhas: falhas.slice(0,5), exemplos: telas.filter(t=>/LogisticaInternacional|InterfaceMenu/.test(t.arquivo)).slice(0,8).map(t=>({id:t.id,titulo:t.titulo,arquivo:t.arquivo})) },null,2));
