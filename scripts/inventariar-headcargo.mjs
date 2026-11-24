import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const [origem, saida] = process.argv.slice(2);
if (!origem || !saida) {
  throw new Error('Uso: node scripts/inventariar-headcargo.mjs <catalogo-dfm.json.gz> <inventario.json>');
}

const catalogo = JSON.parse(gunzipSync(await readFile(origem)));
const resumo = { fontes: catalogo.fontes.length, definicoes: 0, formularios: 0, campos: 0, acoes: 0 };
const campoDe = p => p.DataField || p['DataBinding.DataField'] || p.FieldName;
const listas = new Set(['Columns', 'Items.Strings']);
const metadados = p => Object.fromEntries(Object.entries(p).filter(([chave]) => !listas.has(chave)));

function inventariar(definicao) {
  const campos = [];
  const acoes = [];
  const controles = [];
  function percorrer(no, pai = '', visivel = true) {
    const p = no.propriedades;
    const caminho = pai + '/' + no.nome;
    const visivelNoDfm = visivel && p.Visible !== false && p.TabVisible !== false;
    const sensivel = /senha|password|connection/i.test(no.nome + ' ' + (campoDe(p) || ''));
    if (!sensivel) {
      const entrada = { caminho, classe: no.classe, visivelNoDfm, ...metadados(p) };
      controles.push(entrada);
      if (campoDe(p) || /Edit|ComboBox|Memo|CheckBox|DateTimePicker|Spin/.test(no.classe)) {
        campos.push({ caminho, campo: campoDe(p) || null, fonte: p.DataSource || p['DataBinding.DataSource'] || null });
      }
      if (Array.isArray(p.Columns)) {
        p.Columns.forEach((coluna, i) => {
          const campo = campoDe(coluna);
          if (campo && !/senha|password|connection/i.test(campo)) {
            campos.push({ caminho, coluna: i + 1, campo, propriedades: metadados(coluna) });
          }
        });
      }
      if (p.Action || p.OnClick || p.OnDblClick || p.OnExecute || p.ModalResult ||
          /Action$|MenuItem|Button$/.test(no.classe)) {
        acoes.push({ caminho, validacao: 'estrutura', gravacaoConfigurada: false });
      }
    }
    for (const filho of no.filhos) percorrer(filho, caminho, visivelNoDfm);
  }
  percorrer(definicao.raiz);
  resumo.definicoes++;
  if (/^Tfrm/i.test(definicao.raiz.classe)) resumo.formularios++;
  resumo.campos += campos.length;
  resumo.acoes += acoes.length;
  return {
    id: definicao.id, arquivo: definicao.arquivo, recurso: definicao.recurso,
    titulo: definicao.titulo, classe: definicao.raiz.classe,
    campos, acoes, controles,
  };
}

const definicoes = catalogo.telas.map(inventariar);
const json = {
  metodo: 'Recursos PE/DFM. Seletores, regras compiladas e gravações exigem evidência da sessão nativa.',
  geradoEm: catalogo.geradoEm,
  resumo,
  fontes: catalogo.fontes,
  falhas: catalogo.falhas,
  omitidos: catalogo.omitidos,
  definicoes,
};
await writeFile(saida, JSON.stringify(json) + '\n');
console.log(JSON.stringify({ ...resumo, falhas: catalogo.falhas.length, saida }));
