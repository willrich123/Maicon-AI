import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const arquivo = process.env.HC_AMBIENTE === "homologacao" ? "./catalogo.homologacao.json.gz" : "./catalogo.json.gz";
function carregarCatalogo() {
  try {
    return JSON.parse(gunzipSync(readFileSync(new URL(arquivo, import.meta.url))));
  } catch (erro) {
    if (erro.code !== "ENOENT") throw erro;
    return { fontes: [], telas: [], falhas: [] };
  }
}
const bruto = carregarCatalogo();
const telas = bruto.telas.filter(t => t.arquivo.endsWith(".hsm") && /^Tfrm/.test(t.raiz.classe));
const ids = new Map(telas.map(t => [t.id, t]));
const componentes = new Map();
for (const t of bruto.telas) { const atual = componentes.get(t.raiz.classe); if (!atual || atual.filhos.length < t.raiz.filhos.length) componentes.set(t.raiz.classe, t.raiz); }
const texto = s => String(s || "").replace(/&/g, "").replace(/\s+/g," ").trim();
const rotulo = s => texto(s.replace(/\.hsm$/i, "").replace(/([a-zá-ú])([A-Z])/g,"$1 $2"));
export function catalogoWeb() {
  return { fontes: bruto.fontes.length, definicoes: bruto.telas.length, falhas: bruto.falhas.length,
    modulos: [...new Set(telas.map(t => t.arquivo))].map(arquivo => ({ id: arquivo, nome: rotulo(arquivo), telas: telas.filter(t => t.arquivo === arquivo).map(t => ({ id: t.id, titulo: /^frm/.test(t.titulo) ? rotulo(t.titulo.replace(/^frm/,"")) : t.titulo, modo: "estrutura" })) })) };
}
export function telaWeb(id) {
  const t = ids.get(id); if (!t) return null;
  const controles = [], acoes = [], labels = new Map();
  const rotular = o => { if (o.propriedades.FocusControl && o.propriedades.Caption) labels.set(o.propriedades.FocusControl, texto(o.propriedades.Caption)); o.filhos.forEach(rotular); };
  rotular(t.raiz);
  const walk = (o, grupo = "Geral", caminho = "", pilha = new Set()) => {
    const p = o.propriedades;
    const campo = texto(p.DataField || p["DataBinding.DataField"] || p.FieldName);
    if (p.Visible === false || /senha|password|connection/i.test(o.nome + " " + campo)) return;
    if (/TabSheet|GroupBox|cxGroupBox/.test(o.classe) && p.Caption) grupo = texto(p.Caption);
    if (p.Action || p.OnClick || p.OnDblClick || p.OnExecute || p.ModalResult || /Action$|MenuItem|Button$/.test(o.classe)) {
      acoes.push({
        id: caminho + o.nome,
        grupo,
        rotulo: texto(p.Caption || p.Hint || o.nome),
        comando: texto(p.Action || p.OnClick || p.OnDblClick || p.OnExecute || o.nome),
        validacao: "estrutura",
      });
    }
    if (campo || /Edit|ComboBox|Memo|CheckBox|DateTimePicker/.test(o.classe) && !/BarEditItem/.test(o.classe)) {
      const label = labels.get(o.nome) || texto(p.DisplayLabel || p.Caption) || campo.replaceAll("_"," ") || rotulo(o.nome.replace(/^(edt|cbo|chk|mem|dtp)/,""));
      controles.push({ id: caminho + o.nome, grupo, rotulo: label, campo, tipo: /Check|Boolean/.test(o.classe) ? "booleano" : /Memo/.test(o.classe) ? "texto-longo" : /Date/.test(o.classe) ? "data" : /Integer|Float|Currency|BCD/.test(o.classe) ? "numero" : "texto" });
    }
    if (Array.isArray(p.Columns)) p.Columns.forEach((coluna, i) => {
      const campo = texto(coluna.FieldName || coluna.DataField || coluna["DataBinding.DataField"]);
      if (campo && coluna.Visible !== false && !/senha|password|connection/i.test(campo)) {
        controles.push({id: caminho+o.nome+'/coluna-'+i, grupo, rotulo: texto(coluna["Title.Caption"]) || campo.replaceAll("_"," "), campo, tipo:"coluna"});
      }
    });
    const frame = /^Tfra/.test(o.classe) && !pilha.has(o.classe) ? componentes.get(o.classe) : null;
    if (frame && frame !== o) {
      rotular(frame);
      const nomes = new Set(o.filhos.map(f=>f.nome));
      const prox = new Set([...pilha,o.classe]);
      frame.filhos.filter(f=>!nomes.has(f.nome)).forEach(f=>walk(f,grupo,caminho+o.nome+"/",prox));
    }
    o.filhos.forEach(f => walk(f, grupo, caminho + o.nome + "/", pilha));
  };
  walk(t.raiz);
  return { id: t.id, titulo: /^frm/.test(t.titulo) ? rotulo(t.titulo.replace(/^frm/,"")) : t.titulo, modulo: rotulo(t.arquivo), origem: { arquivo: t.arquivo, recurso: t.recurso }, modo: "estrutura", acoes, grupos: [...new Set(controles.map(c=>c.grupo))].map(nome => ({ nome, campos: controles.filter(c=>c.grupo === nome) })) };
}

export function mapaComercialWeb() {
  const modulos = catalogoWeb().modulos.filter(m => /^(PropostaLogistica|TarifarioLogistica|ConsultasComerciais)\.hsm$/i.test(m.id));
  return modulos.map(m => ({
    id: m.id,
    nome: ({'PropostaLogistica.hsm':'Propostas e ofertas','TarifarioLogistica.hsm':'Tarifários','ConsultasComerciais.hsm':'Consultas comerciais'})[m.id] || m.nome,
    telas: m.telas.map(t => {
      const {id,titulo,grupos} = telaWeb(t.id);
      return {id,titulo,grupos};
    }),
  }));
}
