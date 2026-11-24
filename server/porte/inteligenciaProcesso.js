import sql from "mssql";
import { gunzipSync, inflateSync } from "node:zlib";
import { FalhaPonte } from "../ponte/sessoes.js";
import { mensagensDaConsulta } from "../gmail.js";
import { arquivosProcesso } from "./arquivos.js";
import { processoAutorizado } from "./processo.js";
import { consultarAisDoProcesso, consultarCarteiraMapa, consultarMapaEmbarque } from "./mapaEmbarque.js";
import { consultarAnalise, normalizarBusca, passagemPlantao, simularPrazos } from "./analisesOperacionais.js";
import { acoesCarga, consultarCarga, consultarDevolucoes, consultarJanelas } from "./cargaInteligencia.js";

const lista = ["gargalos","transportadoras","relatorio"];
const limparTexto = v => String(v ?? "").replace(/<[^>]*>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();
export function textoMensagemHeadcargo(dados) {
  if (!Buffer.isBuffer(dados)) return typeof dados==="string" ? dados : "";
  let corpo=dados;
  try {
    if (dados[0]===0x1f && dados[1]===0x8b) corpo=gunzipSync(dados,{maxOutputLength:512*1024});
    else if (dados[0]===0x78 && [1,94,156,218].includes(dados[1])) corpo=inflateSync(dados,{maxOutputLength:512*1024});
  } catch {return "";}
  if (corpo[0]===0xff && corpo[1]===0xfe) return corpo.subarray(2).toString("utf16le");
  const bruto=corpo.toString("utf8");
  const texto=bruto.includes("\ufffd") ? new TextDecoder("windows-1252").decode(corpo) : bruto;
  return /[\x00-\x08\x0e-\x1f]/.test(texto) ? "" : texto;
}
const prazoAtividade = `SELECT TOP 80 T.Descricao AS Marco,A.Previsao_Termino AS Prazo,P.Nome AS Responsável
  FROM mov_Atividade A LEFT JOIN cad_Tarefa T ON T.IdTarefa=A.IdTarefa LEFT JOIN cad_Pessoa P ON P.IdPessoa=A.IdResponsavel
  WHERE A.IdProjeto_Atividade=@projeto AND A.Data_Termino IS NULL AND ISNULL(A.Situacao,0) NOT IN (4,5,6)
  AND A.Previsao_Termino IS NOT NULL ORDER BY A.Previsao_Termino,A.IdAtividade`;

async function documentosDe(pool,pedido,ctx,maxPaginas) {
  const arquivos = [];
  for (let pagina=0;pagina<maxPaginas;pagina++) {
    const r = await arquivosProcesso(pool,{acao:"listar",numero:pedido.numero,pagina},ctx);
    arquivos.push(...r.arquivos);
    if (!r.temMais) return {arquivos,limitado:false};
  }
  return {arquivos,limitado:true};
}

const documentosComuns = [
  ["Fatura comercial",/commercial invoice|fatura comercial|\binvoice\b/],
  ["Packing list",/packing\s*list|romaneio/],
  ["Conhecimento marítimo",/bill of lading|\b(?:hbl|mbl|bl)\b|conhecimento maritimo/,/^[IE]M/],
  ["Conhecimento aéreo",/air waybill|\b(?:awb|mawb|hawb)\b|conhecimento aereo/,/^[IE]A/],
  ["Conhecimento rodoviário",/conhecimento rodoviario|\b(?:crt|ct-e|cte)\b/,/^[IE]T/],
];
async function checklist(pool,pedido,ctx) {
  const {arquivos,limitado} = await documentosDe(pool,pedido,ctx,10);
  const evidencias = {};
  const linhas = documentosComuns.filter(([, ,modal])=>!modal||modal.test(pedido.numero.toUpperCase())).map(([nome,regra])=>{
    const candidatos = arquivos.filter(a=>a.ativo!==false && regra.test(normalizarBusca(`${a.nome} ${a.descricao || ""} ${a.grupo}`)));
    evidencias[nome] = candidatos.map(a=>({id:a.id,nome:a.nome,disponivel:a.disponivel}));
    return {Documento:nome,Estado:candidatos.length ? "Anexo identificado" : "A conferir",
      Evidências:candidatos.map(a=>a.nome).join(" · ") || "Sem correspondência na consulta"};
  });
  return {titulo:"Checklist documental",linhas,evidencias,nota:"Lista de referência por modalidade. A identificação usa nome, descrição e grupo do anexo. A validade e as exigências específicas ainda precisam de conferência."+(limitado?" Pesquisa limitada a 300 anexos.":"")};
}

function trechoQueCorresponde(texto,palavras) {
  const original = limparTexto(texto);
  const normalizado = normalizarBusca(original);
  const encontrados = palavras.map(p=>normalizado.indexOf(p)).filter(i=>i>=0);
  if (!encontrados.length) return null;
  const i = Math.min(...encontrados);
  return {trecho:(i>85?"…":"")+original.slice(Math.max(0,i-85),i+210)+(i+210<original.length?"…":""),relevancia:encontrados.length};
}

async function buscarEmPdf(buffer,palavras) {
  const {getDocument} = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false,verbosity:0});
  try {
    const doc = await pdf.promise;
    let melhor;
    for (let pagina=1;pagina<=Math.min(doc.numPages,20);pagina++) {
      const page = await doc.getPage(pagina);
      try {
        const {items} = await page.getTextContent();
        const candidato = trechoQueCorresponde(items.map(i=>i.str||"").join(" "),palavras);
        if (candidato && (!melhor || candidato.relevancia > melhor.relevancia)) melhor={...candidato,pagina};
        if (melhor?.relevancia === palavras.length) break;
      } finally {page.cleanup();}
    }
    return melhor;
  } finally {await pdf.destroy();}
}

async function buscarFontes(pool,pedido,ctx,processo) {
  const palavras = [...new Set(normalizarBusca(pedido.termo).match(/[a-z0-9-]{2,}/g) || [])]
    .filter(p=>!["onde","ficou","esta","combinado","processo","qual","que","para","com","dos","das","este","esse","como","foi","por","uma","nos","nas","no","na","do","da","de","em","um"].includes(p)).slice(0,8);
  if (!palavras.length) throw new FalhaPonte("Informe um termo, como free time, booking ou packing list.");
  const req = () => pool.request().input("projeto",sql.Int,processo.IdProjeto_Atividade);
  const mostrarOferta = processo.IdOferta_Frete && !ctx.recorte?.semComercial;
  const leituras = await Promise.allSettled([
    req().query(`SELECT TOP 100 A.IdAcompanhamento AS id,A.Titulo AS titulo,A.Data AS data,
      CONCAT(CONVERT(nvarchar(max),A.Descricao),' ',CONVERT(nvarchar(max),A.Observacao)) AS conteudo
      FROM mov_Acompanhamento A WHERE A.IdProjeto_Atividade=@projeto ORDER BY A.Data DESC,A.IdAcompanhamento DESC`),
    req().query(`SELECT TOP 60 M.IdMensagem AS id,M.Assunto AS titulo,M.Data_Envio AS data,
      CASE WHEN DATALENGTH(M.Corpo_Mensagem)<=131072 THEN CONVERT(varbinary(max),M.Corpo_Mensagem) END AS conteudo FROM mov_Projeto_Atividade_Mensagem L
      JOIN mov_Mensagem M ON M.IdMensagem=L.IdMensagem WHERE L.IdProjeto_Atividade=@projeto
      AND ISNULL(M.Excluida,0)=0 ORDER BY M.Data_Envio DESC,M.IdMensagem DESC`),
    mostrarOferta ? pool.request().input("oferta",sql.Int,processo.IdOferta_Frete).query(`
      SELECT O.IdOferta_Frete AS id,CONCAT(P.Numero_Proposta,' · ',O.Numero_Oferta) AS titulo,
        CONCAT(CONVERT(nvarchar(max),O.Observacao),' ',CONVERT(nvarchar(max),O.Remarks),' ',
          CONVERT(nvarchar(max),O.Remarks_Free_Time),' ',CONVERT(nvarchar(max),O.Instrucoes_Operacional),' ',
          F.conteudo) AS conteudo
      FROM mov_Oferta_Frete O LEFT JOIN mov_Proposta_Frete P ON P.IdProposta_Frete=O.IdProposta_Frete
      OUTER APPLY (SELECT STRING_AGG(CONVERT(nvarchar(max),CONCAT(
        'Free time master origem ',X.Master_Origem,', house origem ',X.House_Origem,
        ', master destino ',X.Master_Destino,', house destino ',X.House_Destino,' ',X.Observacao)),' ') AS conteudo
        FROM mov_Oferta_Frete_Free_Time X WHERE X.IdOferta_Frete=O.IdOferta_Frete) F
      WHERE O.IdOferta_Frete=@oferta`) : {recordset:[]},
    documentosDe(pool,pedido,ctx,3),
    typeof pedido.gmailToken === "string" && pedido.gmailToken
      ? mensagensDaConsulta(pedido.gmailToken,`"${processo.Numero_Processo}" {${palavras.map(p=>`"${p}"`).join(" ")}}`,8) : [],
  ]);
  const [acompanhamentos,mensagens,oferta,docs,emails] = leituras.map(r=>r.status==="fulfilled"?r.value:null);
  const fontes = [];
  function incluir(linha,tipo,elo={}) {
    const achado = trechoQueCorresponde(linha.conteudo || linha.titulo,palavras) || trechoQueCorresponde(linha.titulo,palavras);
    if (achado) fontes.push({id:`${tipo}-${linha.id}`,tipo,titulo:linha.titulo || tipo,data:linha.data,...achado,...elo});
  }
  acompanhamentos?.recordset.forEach(r=>incluir(r,"Acompanhamento"));
  mensagens?.recordset.forEach(r=>incluir({...r,conteudo:textoMensagemHeadcargo(r.conteudo)},"Mensagem HeadCargo"));
  oferta?.recordset.forEach(r=>incluir(r,"Oferta vinculada"));
  emails?.forEach(r=>incluir({id:r.id,titulo:r.assunto,data:r.data,conteudo:r.trecho},"Gmail",
    /^[\w-]+$/.test(r.id)?{url:`https://mail.google.com/mail/u/0/#all/${r.id}`}:{}));
  const arquivos = docs?.arquivos || [];
  arquivos.forEach(a=>incluir({id:a.id,titulo:a.nome,data:a.criadoEm,conteudo:a.descricao},"Anexo · cadastro",
    a.disponivel?{arquivo:a.id}:{}));
  let pdfsIndisponiveis = 0;
  const pdfs = arquivos.filter(a=>a.disponivel&&Number(a.tamanho)>0&&Number(a.tamanho)<=5*1024*1024&&/\.pdf$/i.test(a.nome)).slice(0,5);
  for (const a of pdfs) {
    try {
      const {conteudo,tipo}=await arquivosProcesso(pool,{acao:"conteudo",numero:pedido.numero,arquivo:a.id},ctx);
      if (tipo!=="application/pdf" || conteudo.length>5*1024*1024) continue;
      const achado=await buscarEmPdf(conteudo,palavras);
      if (achado) fontes.push({id:`pdf-${a.id}`,tipo:"PDF",titulo:a.nome,data:a.criadoEm,arquivo:a.id,...achado});
    } catch {pdfsIndisponiveis++;}
  }
  fontes.sort((a,b)=>b.relevancia-a.relevancia || Number(b.tipo==="PDF")-Number(a.tipo==="PDF"));
  const parciais = leituras.some(r=>r.status==="rejected") || pdfsIndisponiveis>0;
  return {titulo:"Busca com fontes",fontes:fontes.slice(0,30),nota:
    "Pesquisa nos registros vinculados ao processo e em até cinco PDFs de até 5 MB nas primeiras 20 páginas com texto."+
    (pedido.gmailToken?" Gmail pesquisado na conta conectada.":"")+
    (parciais?" Algumas fontes não puderam ser consultadas.":"")};
}

async function custos(pool,processo,ctx) {
  if (!ctx.admin && !ctx.recorte?.financeiro) throw new FalhaPonte("A conferência de custos exige acesso financeiro.",403);
  const req = () => pool.request().input("house",sql.Int,processo.IdLogistica_House);
  const [taxas,faturas] = await Promise.all([
    req().query(`SELECT TOP 101 COALESCE(E.Nome,'Taxa sem descrição') AS Taxa,
      MP.Sigla AS [Moeda de custo],MR.Sigla AS [Moeda da cobrança],
      CASE WHEN T.IdMoeda_Pagamento=O.IdMoeda_Pagamento THEN O.Valor_Pagamento_Total END AS [Custo cotado],
      T.Valor_Pagamento_Total AS [Custo no processo],
      CASE WHEN T.IdMoeda_Pagamento=O.IdMoeda_Pagamento THEN T.Valor_Pagamento_Total-O.Valor_Pagamento_Total END AS [Diferença de custo],
      CASE WHEN T.IdMoeda_Recebimento=O.IdMoeda_Recebimento THEN O.Valor_Recebimento_Total END AS [Cobrança cotada],
      T.Valor_Recebimento_Total AS [Cobrança no processo],
      CASE WHEN T.IdMoeda_Recebimento=O.IdMoeda_Recebimento THEN T.Valor_Recebimento_Total-O.Valor_Recebimento_Total END AS [Diferença de cobrança],
      R.Numero AS [Fatura vinculada à cobrança],
      COUNT(*) OVER(PARTITION BY T.IdTaxa_Logistica_Exibicao,T.IdMoeda_Pagamento,T.IdMoeda_Recebimento,
        T.IdPessoa_Pagamento,T.IdPessoa_Recebimento,T.Valor_Pagamento_Total,T.Valor_Recebimento_Total) AS [Ocorrências iguais]
      FROM mov_Logistica_Taxa T LEFT JOIN mov_Oferta_Frete_Taxa O ON O.IdOferta_Frete_Taxa=T.IdOferta_Frete_Taxa AND ISNULL(O.Restrita,0)=0
      LEFT JOIN cad_Taxa_Logistica_Exibicao E ON E.IdTaxa_Logistica_Exibicao=T.IdTaxa_Logistica_Exibicao
      LEFT JOIN cad_Moeda MP ON MP.IdMoeda=T.IdMoeda_Pagamento LEFT JOIN cad_Moeda MR ON MR.IdMoeda=T.IdMoeda_Recebimento
      LEFT JOIN mov_Registro_Financeiro R ON R.IdRegistro_Financeiro=T.IdRegistro_Recebimento
        AND EXISTS (SELECT 1 FROM mov_Logistica_Fatura F WHERE F.IdLogistica_House=@house AND F.IdRegistro_Financeiro=R.IdRegistro_Financeiro)
      WHERE T.IdLogistica_House=@house ORDER BY E.Nome,T.IdLogistica_Taxa`),
    req().query(`SELECT DISTINCT TOP 60 R.Numero AS Fatura,F.Data_Faturamento AS [Data de faturamento],
      M.Sigla AS Moeda,R.Valor_Total AS [Total da fatura]
      FROM mov_Logistica_Fatura F JOIN mov_Registro_Financeiro R ON R.IdRegistro_Financeiro=F.IdRegistro_Financeiro
      LEFT JOIN cad_Moeda M ON M.IdMoeda=R.IdMoeda WHERE F.IdLogistica_House=@house
      ORDER BY [Data de faturamento] DESC,Fatura`),
  ]);
  return {titulo:"Conferência de custos",nota:"Comparação por vínculo de taxa e mesma moeda. Duas ocorrências iguais indicam possível duplicidade. As faturas são apresentadas separadamente.",
    tabelas:[{titulo:"Taxas do processo e da oferta",linhas:taxas.recordset.slice(0,100),limite:100},
      {titulo:"Faturas vinculadas ao processo",linhas:faturas.recordset,limite:60}]};
}

export async function consultarInteligencia(pool,pedido,ctx) {
  if (lista.includes(pedido.acao)) return consultarAnalise(pool,pedido,ctx);
  if (pedido.acao === "plantao") return passagemPlantao(pool,pedido,ctx);
  if (pedido.acao === "mapa_carteira") return consultarCarteiraMapa(pool,pedido,ctx);
  if (pedido.acao === "devolucoes" || pedido.acao === "janelas") {
    const processo=pedido.numero ? await processoAutorizado(pool,pedido.numero,ctx) : null;
    const consultar=pedido.acao==="devolucoes" ? consultarDevolucoes : consultarJanelas;
    return consultar(pool,pedido,ctx,processo);
  }
  if (acoesCarga.includes(pedido.acao)) {
    const processo=await processoAutorizado(pool,pedido.numero,ctx);
    return consultarCarga(pool,pedido.acao,processo,ctx);
  }
  if (!["fontes","simulador","documentos","custos","mapa","mapa_ais"].includes(pedido.acao)) throw new FalhaPonte("Ferramenta desconhecida.");
  const processo=await processoAutorizado(pool,pedido.numero,ctx);
  if (pedido.acao==="mapa_ais") return consultarAisDoProcesso(pool,processo,pedido);
  if (pedido.acao==="fontes") return buscarFontes(pool,pedido,ctx,processo);
  if (pedido.acao==="documentos") return checklist(pool,pedido,ctx);
  if (pedido.acao==="custos") return custos(pool,processo,ctx);
  const mapa=await consultarMapaEmbarque(pool,pedido.numero,ctx,processo,pedido.acao==="mapa");
  if (pedido.acao==="mapa") return mapa;
  const atividades=await pool.request().input("projeto",sql.Int,processo.IdProjeto_Atividade).query(prazoAtividade);
  const previsao=await pool.request().input("house",sql.Int,processo.IdLogistica_House).query(
    "SELECT Data_Previsao_Entrega AS Prazo FROM mov_Logistica_House WHERE IdLogistica_House=@house");
  const marcos = [...atividades.recordset];
  if (!ctx.recorte?.semOperacional && previsao.recordset[0]?.Prazo) marcos.push({Marco:"Previsão de entrega",Prazo:previsao.recordset[0].Prazo});
  const r=simularPrazos(mapa.trechos,marcos,pedido.dias);
  return {titulo:"Simulador de atraso",...r,nota:r.base
    ? `Chegada de referência ${r.base.split("-").reverse().join("/")}. Na simulação, ${r.simulada.split("-").reverse().join("/")}. A folga indica a diferença em dias corridos entre a chegada e cada prazo.`
    : "Nenhum trecho em aberto tem chegada prevista para esta simulação."};
}
