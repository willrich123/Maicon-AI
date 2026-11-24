import sql from "mssql";
import { FalhaPonte } from "../ponte/sessoes.js";

const diaMs = 86400000;
const iso = n => new Date(n).toISOString().slice(0,10);
const diaValido = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && iso(Date.parse(v)) === v;
export const normalizarBusca = v => String(v ?? "").normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
export const termoLike = v => String(v ?? "").trim().slice(0,120).replace(/[\[\]%_]/g,c=>`[${c}]`);
const dataBrasil = () => new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());

export function periodoOperacional(pedido) {
  const ate = pedido.ate || dataBrasil();
  if (!diaValido(ate)) throw new FalhaPonte("Data final inválida.");
  const de = pedido.de || iso(Date.parse(ate)-89*diaMs);
  if (!diaValido(de) || de > ate || Date.parse(ate)-Date.parse(de) > 365*diaMs) {
    throw new FalhaPonte("Escolha um período válido de até 366 dias.");
  }
  return {de,ate};
}

export function relatorioDaPergunta(pergunta) {
  const texto = normalizarBusca(pergunta);
  if (/gargal|etap|atividad/.test(texto) && /demor|tempo|gargal|prazo/.test(texto)) return "gargalos";
  if (/transportador|armador|companhia/.test(texto)) return "transportadoras";
  if (/client/.test(texto) && /atras|pontual/.test(texto)) return "atrasos-clientes";
  throw new FalhaPonte("Peça atrasos por cliente, tempo por etapa ou pontualidade por transportadora.");
}

export function filtrosDaPergunta(pedido, hoje=dataBrasil()) {
  const texto=normalizarBusca(pedido.pergunta);
  const agora=new Date(hoje);
  const modalidade=pedido.modalidade || (/maritim/.test(texto)?"M":/aere/.test(texto)?"A":/terrestr|rodoviari/.test(texto)?"T":"");
  const dias=texto.match(/ultimos? (\d{1,3}) dias/);
  if (dias && Number(dias[1]) >= 1 && Number(dias[1]) <= 366) {
    return {...pedido,modalidade,de:iso(Date.parse(hoje)-(Number(dias[1])-1)*diaMs),ate:hoje};
  }
  if (/trimestre/.test(texto)) {
    const mes=Math.floor(agora.getUTCMonth()/3)*3;
    const ano=agora.getUTCFullYear();
    if (/ultimo trimestre|trimestre anterior/.test(texto)) return {...pedido,modalidade,de:iso(Date.UTC(ano,mes-3,1)),ate:iso(Date.UTC(ano,mes,0))};
    return {...pedido,modalidade,de:iso(Date.UTC(ano,mes,1)),ate:hoje};
  }
  return {...pedido,modalidade};
}

export const escopo = `H.Data_Cancelamento IS NULL AND (@modal='' OR LEFT(H.Numero_Processo,2)=@modal OR
  (LEN(@modal)=1 AND SUBSTRING(H.Numero_Processo,2,1)=@modal))
  AND (@admin=1 OR (H.Numero_Processo NOT LIKE '% teste' AND
    (EXISTS (SELECT 1 FROM mov_Projeto_Atividade_Responsavel P WHERE P.IdProjeto_Atividade=H.IdProjeto_Atividade AND P.IdResponsavel=@pessoa)
      OR EXISTS (SELECT 1 FROM mov_Atividade A WHERE A.IdProjeto_Atividade=H.IdProjeto_Atividade AND A.IdResponsavel=@pessoa))))`;

export function escopoDaConsulta(pool, pedido, ctx) {
  const {de,ate} = periodoOperacional(pedido);
  if (!ctx.admin && !ctx.pessoa) throw new FalhaPonte("Conta sem vínculo operacional.",403);
  const modal = String(pedido.modalidade || "");
  if (modal && !/^(IM|EM|IA|EA|IT|ET|M|A|T)$/.test(modal)) throw new FalhaPonte("Modalidade inválida.");
  if (ctx.modalidade && modal && ctx.modalidade !== modal && !(modal.length===1 && ctx.modalidade.endsWith(modal))) {
    throw new FalhaPonte("Modalidade fora do seu acesso.",403);
  }
  const req = pool.request().input("de",sql.Date,de).input("ate",sql.Date,ate)
    .input("modal",sql.VarChar(2),ctx.modalidade || modal).input("admin",sql.Bit,ctx.admin)
    .input("pessoa",sql.Int,ctx.pessoa || 0).input("filtro",sql.NVarChar(250),`%${termoLike(pedido.filtro)}%`);
  return {de,ate,req};
}

const gargalos = `WITH Projetos AS (
  SELECT DISTINCT H.IdProjeto_Atividade FROM mov_Logistica_House H
  WHERE ${escopo} AND H.Data_Abertura_Processo>=@de AND H.Data_Abertura_Processo<DATEADD(day,1,@ate)
)
SELECT TOP 100 COALESCE(T.Descricao,'Atividade sem cadastro') AS Atividade,
  SUM(CASE WHEN A.Data_Termino>=A.Data_Inicio THEN 1 ELSE 0 END) AS [Com duração registrada],
  CAST(AVG(CASE WHEN A.Data_Termino>=A.Data_Inicio THEN DATEDIFF(minute,A.Data_Inicio,A.Data_Termino)/1440.0 END) AS decimal(12,2)) AS [Dias médios de execução],
  SUM(CASE WHEN A.Data_Termino IS NULL AND ISNULL(A.Situacao,0) NOT IN (4,5,6) THEN 1 ELSE 0 END) AS [Abertas hoje],
  SUM(CASE WHEN A.Data_Termino IS NULL AND ISNULL(A.Situacao,0) NOT IN (4,5,6) AND A.Previsao_Termino<CAST(GETDATE() AS date) THEN 1 ELSE 0 END) AS [Com prazo vencido]
FROM Projetos P JOIN mov_Atividade A ON A.IdProjeto_Atividade=P.IdProjeto_Atividade
LEFT JOIN cad_Tarefa T ON T.IdTarefa=A.IdTarefa
WHERE COALESCE(T.Descricao,'') LIKE @filtro
GROUP BY T.Descricao ORDER BY [Com prazo vencido] DESC,[Dias médios de execução] DESC,T.Descricao`;

const ranking = `SELECT TOP 100 COALESCE(C.Nome,'Transportadora não informada') AS Transportadora,
  O.Nome AS Origem,D.Nome AS Destino,LEFT(H.Numero_Processo,2) AS Modalidade,
  COUNT(*) AS [Trechos com previsão e chegada],
  CAST(100.0*AVG(CASE WHEN CAST(V.Data_Desembarque AS date)<=CAST(V.Data_Previsao_Desembarque AS date) THEN 1.0 ELSE 0.0 END) AS decimal(6,1)) AS [Pontualidade %],
  CAST(AVG(CASE WHEN V.Data_Desembarque>=V.Data_Embarque THEN DATEDIFF(minute,V.Data_Embarque,V.Data_Desembarque)/1440.0 END) AS decimal(12,2)) AS [Dias médios em trânsito]
FROM mov_Logistica_Viagem V JOIN mov_Logistica_House H ON H.IdLogistica_House=V.IdLogistica_House
JOIN cad_Origem_Destino O ON O.IdOrigem_Destino=V.IdOrigem JOIN cad_Origem_Destino D ON D.IdOrigem_Destino=V.IdDestino
LEFT JOIN cad_Pessoa C ON C.IdPessoa=V.IdCompanhia_Transporte
WHERE ${escopo} AND ISNULL(V.Situacao_Embarque,0)<>9 AND ISNULL(V.Ignorar_Tracking,0)=0
  AND V.Data_Desembarque>=@de AND V.Data_Desembarque<DATEADD(day,1,@ate)
  AND V.Data_Previsao_Desembarque IS NOT NULL AND CONCAT(O.Nome,' ',D.Nome,' ',C.Nome) LIKE @filtro
GROUP BY V.IdCompanhia_Transporte,C.Nome,V.IdOrigem,O.Nome,V.IdDestino,D.Nome,LEFT(H.Numero_Processo,2)
ORDER BY [Pontualidade %] DESC,[Trechos com previsão e chegada] DESC,Transportadora`;

const clientes = `SELECT TOP 100 COALESCE(C.Nome,'Cliente não informado') AS Cliente,
  COUNT(DISTINCT H.IdLogistica_House) AS [Processos avaliados],
  COUNT(DISTINCT CASE WHEN CAST(V.Data_Desembarque AS date)>CAST(V.Data_Previsao_Desembarque AS date) THEN H.IdLogistica_House END) AS [Processos com atraso],
  COUNT(*) AS [Trechos com previsão e chegada]
FROM mov_Logistica_Viagem V JOIN mov_Logistica_House H ON H.IdLogistica_House=V.IdLogistica_House
LEFT JOIN cad_Pessoa C ON C.IdPessoa=H.IdCliente
WHERE ${escopo} AND ISNULL(V.Situacao_Embarque,0)<>9 AND ISNULL(V.Ignorar_Tracking,0)=0
  AND V.Data_Desembarque>=@de AND V.Data_Desembarque<DATEADD(day,1,@ate)
  AND V.Data_Previsao_Desembarque IS NOT NULL AND COALESCE(C.Nome,'') LIKE @filtro
GROUP BY H.IdCliente,C.Nome ORDER BY [Processos com atraso] DESC,[Processos avaliados] DESC,Cliente`;

const analises = {
  gargalos:{titulo:"Gargalos por atividade", sql:gargalos, nota:"Processos abertos no período. A duração considera atividades com início e término registrados."},
  transportadoras:{titulo:"Pontualidade por rota e transportadora", sql:ranking, nota:"Trechos desembarcados no período com previsão e chegada efetiva. Compare a mesma rota e modalidade e confira o tamanho da amostra."},
  "atrasos-clientes":{titulo:"Atrasos por cliente", sql:clientes, nota:"Processo com atraso tem pelo menos um trecho desembarcado depois da data prevista no período. Não soma o mesmo processo duas vezes."},
};

export async function consultarAnalise(pool,pedido,ctx) {
  const tipo = pedido.acao === "relatorio" ? relatorioDaPergunta(pedido.pergunta) : pedido.acao;
  if (!Object.hasOwn(analises,tipo)) throw new FalhaPonte("Análise inválida.");
  const {titulo,sql:query,nota} = analises[tipo];
  const opcoes = filtrosDaPergunta(pedido);
  const {de,ate,req} = escopoDaConsulta(pool,opcoes,ctx);
  const {recordset:linhas} = await req.query(query);
  return {titulo,nota,linhas,periodo:{de,ate},limite:100};
}

export async function passagemPlantao(pool,pedido,ctx) {
  const {de,ate,req} = escopoDaConsulta(pool,filtrosDaPergunta(pedido),ctx);
  const {recordset:linhas} = await req.query(`
    SELECT TOP 60 H.Numero_Processo AS Processo,C.Nome AS Cliente,S.Descricao AS Situação,
      T.Descricao AS [Próxima atividade],F.Nome AS Responsável,P.Previsao_Termino AS Prazo,
      R.Chegada AS [Última chegada prevista],A.Titulo AS [Último acompanhamento],A.Data AS [Data do acompanhamento]
    FROM mov_Logistica_House H LEFT JOIN cad_Pessoa C ON C.IdPessoa=H.IdCliente
    LEFT JOIN cad_Status_Processo_Logistico S ON S.IdStatus_Processo_Logistico=H.IdStatus_Processo_Logistico
    OUTER APPLY (SELECT TOP 1 X.IdTarefa,X.IdResponsavel,X.Previsao_Termino FROM mov_Atividade X
      WHERE X.IdProjeto_Atividade=H.IdProjeto_Atividade AND X.Data_Termino IS NULL AND ISNULL(X.Situacao,0) NOT IN (4,5,6)
      ORDER BY CASE WHEN X.Previsao_Termino IS NULL THEN 1 ELSE 0 END,X.Previsao_Termino,X.Prioridade DESC,X.IdAtividade) P
    LEFT JOIN cad_Tarefa T ON T.IdTarefa=P.IdTarefa LEFT JOIN cad_Pessoa F ON F.IdPessoa=P.IdResponsavel
    OUTER APPLY (SELECT MAX(V.Data_Previsao_Desembarque) AS Chegada FROM mov_Logistica_Viagem V
      WHERE V.IdLogistica_House=H.IdLogistica_House AND ISNULL(V.Situacao_Embarque,0)<>9) R
    OUTER APPLY (SELECT TOP 1 X.Titulo,X.Data FROM mov_Acompanhamento X
      WHERE X.IdProjeto_Atividade=H.IdProjeto_Atividade ORDER BY X.Data DESC,X.IdAcompanhamento DESC) A
    WHERE ${escopo} AND H.Data_Fechamento_Processo IS NULL
      AND H.Data_Abertura_Processo>=@de AND H.Data_Abertura_Processo<DATEADD(day,1,@ate)
      AND CONCAT(H.Numero_Processo,' ',C.Nome) LIKE @filtro
    ORDER BY CASE WHEN P.Previsao_Termino IS NULL THEN 1 ELSE 0 END,P.Previsao_Termino,H.Numero_Processo`);
  return {titulo:"Passagem de plantão",nota:"Processos abertos nesse período, em ordem da próxima atividade com prazo.",periodo:{de,ate},limite:60,linhas};
}

export function simularPrazos(trechos, marcos, dias) {
  if (!Number.isInteger(dias) || dias < 1 || dias > 60) throw new FalhaPonte("Informe um atraso de 1 a 60 dias.");
  const ativos = trechos.filter(t => !t.cancelado && !t.ignorado && !t.desembarque && t.chegadaPrevista);
  const fim = ativos.reduce((max,t) => Math.max(max,Date.parse(t.chegadaPrevista) || 0),0);
  if (!fim) return {base:null,simulada:null,linhas:[]};
  const base = Date.parse(iso(fim));
  const simulada = base + dias * diaMs;
  const linhas = marcos.filter(m=>m.Prazo && Number.isFinite(Date.parse(m.Prazo))).map(m=>{
    const prazo = Date.parse(iso(Date.parse(m.Prazo)));
    const antes = (prazo-base)/diaMs;
    const depois = (prazo-simulada)/diaMs;
    return {...m,"Folga atual (dias)":antes,"Folga simulada (dias)":depois,Situação:depois < 0 ? (antes < 0 ? "Já sem folga" : "Perde folga") : "Dentro do prazo"};
  });
  return {base:iso(base),simulada:iso(simulada),linhas};
}
