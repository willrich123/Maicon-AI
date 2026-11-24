import sql from "mssql";
import { FalhaPonte } from "../ponte/sessoes.js";
import { escopo, escopoDaConsulta, filtrosDaPergunta } from "./analisesOperacionais.js";

const limite = 200;
const registro = limite + 1;
const hojeBrasil = () => new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());
const tabela = (titulo,linhas) => ({titulo,linhas:linhas.slice(0,limite),limite:linhas.length>limite ? limite : undefined});
const consultaHouse = (pool,house,query) => pool.request().input("house",sql.Int,house).query(query).then(r=>r.recordset);
const valor = v => typeof v === "string" && !v.trim() ? null : v ?? null;
const casas = n => Number(n.toFixed(6));

function comparar(campo,cotado,processo,titulo="Oferta") {
  const anterior=valor(cotado);
  const atual=valor(processo);
  const dif=typeof anterior==="number" && typeof atual==="number" ? casas(atual-anterior) : null;
  const iguais=dif===null ? anterior===atual : dif===0;
  return {Campo:campo,[titulo]:anterior,Processo:atual,Diferença:dif,
    Situação:anterior===null || atual===null ? "Dados incompletos" : iguais ? "Igual" : "Divergente"};
}

const medidas = [
  ["Quantidade_Volumes","Volumes"],["Metros_Cubicos","Cubagem (m³)"],
  ["Peso_Bruto","Peso bruto (kg)"],["Peso_Liquido","Peso líquido (kg)"],
];

async function conferirOferta(pool,house) {
  const [base,equipamentos]=await Promise.all([
    consultaHouse(pool,house,`SELECT O.Numero_Oferta,
      C.Quantidade_Volumes AS OfertaVolumes,C.Metros_Cubicos AS OfertaCubagem,C.Peso_Bruto AS OfertaBruto,C.Peso_Liquido AS OfertaLiquido,
      H.Quantidade_Volumes,H.Metros_Cubicos,H.Peso_Bruto,H.Peso_Liquido,
      O.IdOrigem AS OfertaIdOrigem,O.IdDestino AS OfertaIdDestino,V1.IdOrigem,V2.IdDestino,
      A.Nome AS OfertaOrigem,B.Nome AS OfertaDestino,C1.Nome AS Origem,C2.Nome AS Destino
      FROM mov_Logistica_House H LEFT JOIN mov_Oferta_Frete O ON O.IdOferta_Frete=H.IdOferta_Frete
      LEFT JOIN mov_Proposta_Frete_Carga C ON C.IdProposta_Frete_Carga=O.IdProposta_Frete_Carga
      OUTER APPLY (SELECT TOP 1 V.IdOrigem FROM mov_Logistica_Viagem V
        WHERE V.IdLogistica_House=@house AND ISNULL(V.Situacao_Embarque,0)<>9 AND ISNULL(V.Ignorar_Tracking,0)=0
        ORDER BY V.Sequencia,V.IdLogistica_Viagem) V1
      OUTER APPLY (SELECT TOP 1 V.IdDestino FROM mov_Logistica_Viagem V
        WHERE V.IdLogistica_House=@house AND ISNULL(V.Situacao_Embarque,0)<>9 AND ISNULL(V.Ignorar_Tracking,0)=0
        ORDER BY V.Sequencia DESC,V.IdLogistica_Viagem DESC) V2
      LEFT JOIN cad_Origem_Destino A ON A.IdOrigem_Destino=O.IdOrigem
      LEFT JOIN cad_Origem_Destino B ON B.IdOrigem_Destino=O.IdDestino
      LEFT JOIN cad_Origem_Destino C1 ON C1.IdOrigem_Destino=V1.IdOrigem
      LEFT JOIN cad_Origem_Destino C2 ON C2.IdOrigem_Destino=V2.IdDestino
      WHERE H.IdLogistica_House=@house`),
    consultaHouse(pool,house,`WITH Cotados AS (
      SELECT E.IdEquipamento_Maritimo,SUM(E.Quantidade) AS Quantidade
      FROM mov_Logistica_House H JOIN mov_Oferta_Frete O ON O.IdOferta_Frete=H.IdOferta_Frete
      JOIN mov_Proposta_Frete_Equipamento E ON E.IdProposta_Frete_Carga=O.IdProposta_Frete_Carga
      WHERE H.IdLogistica_House=@house AND E.IdEquipamento_Maritimo IS NOT NULL GROUP BY E.IdEquipamento_Maritimo
    ), Operacionais AS (
      SELECT IdEquipamento_Maritimo,COUNT(*) AS Quantidade FROM mov_Logistica_Maritima_Container
      WHERE IdLogistica_House=@house AND IdEquipamento_Maritimo IS NOT NULL GROUP BY IdEquipamento_Maritimo
    )
    SELECT COALESCE(E.Descricao,CONCAT('Código ',COALESCE(C.IdEquipamento_Maritimo,O.IdEquipamento_Maritimo))) AS Equipamento,
      CASE WHEN C.IdEquipamento_Maritimo IS NULL AND EXISTS (SELECT 1 FROM Cotados) THEN 0 ELSE C.Quantidade END AS Oferta,
      CASE WHEN O.IdEquipamento_Maritimo IS NULL AND EXISTS (SELECT 1 FROM Operacionais) THEN 0 ELSE O.Quantidade END AS Processo
    FROM Cotados C FULL OUTER JOIN Operacionais O ON O.IdEquipamento_Maritimo=C.IdEquipamento_Maritimo
    LEFT JOIN cad_Equipamento_Maritimo E ON E.IdEquipamento_Maritimo=COALESCE(C.IdEquipamento_Maritimo,O.IdEquipamento_Maritimo)
    ORDER BY Equipamento`),
  ]);
  const d=base[0];
  if (!d?.Numero_Oferta) return {nota:"O processo está sem oferta vinculada."};
  const colunas=["OfertaVolumes","OfertaCubagem","OfertaBruto","OfertaLiquido"];
  const linhas=medidas.map(([chave,campo],i)=>comparar(campo,d[colunas[i]],d[chave]));
  for (const campo of ["Origem","Destino"]) {
    const cotado=d[`OfertaId${campo}`];
    const atual=d[`Id${campo}`];
    linhas.push({Campo:campo,Oferta:d[`Oferta${campo}`] ?? cotado,Processo:d[campo] ?? atual,Diferença:null,
      Situação:cotado==null || atual==null ? "Dados incompletos" : cotado===atual ? "Igual" : "Divergente"});
  }
  linhas.push(...equipamentos.map(e=>comparar(e.Equipamento,e.Oferta,e.Processo)));
  const alertas=linhas.filter(l=>l.Situação!=="Igual");
  return {nota:`Oferta ${d.Numero_Oferta}. ${alertas.length ? "A tabela mostra divergências e campos incompletos." : "Os campos comparados coincidem."} ${equipamentos.length?"":"Sem equipamento marítimo identificado nas duas bases."}`.trim(),
    tabelas:alertas.length?[tabela("Comparação de carga, rota e equipamento",alertas)]:[]};
}

async function conferirPeso(pool,house) {
  const [d]=await consultaHouse(pool,house,`SELECT TOP 1 O.Numero_Oferta,
    H.Peso_Bruto,H.Peso_Cubado,A.Peso_Taxado,C.Peso_Bruto AS Bruto_Oferta,C.Peso_Cubado AS Cubado_Oferta,C.Peso_Taxado AS Taxado_Oferta
    FROM mov_Logistica_House H JOIN mov_Logistica_Aerea_House A ON A.IdLogistica_House=H.IdLogistica_House
    LEFT JOIN mov_Oferta_Frete O ON O.IdOferta_Frete=H.IdOferta_Frete
    LEFT JOIN mov_Proposta_Frete_Carga C ON C.IdProposta_Frete_Carga=O.IdProposta_Frete_Carga
    WHERE H.IdLogistica_House=@house`);
  if (!d) return {nota:"O processo está sem ficha aérea vinculada."};
  return {nota:`Pesos em kg conforme registrados no HeadCargo. ${d.Numero_Oferta ? `Oferta ${d.Numero_Oferta}.` : "O processo está sem oferta vinculada."}`,
    tabelas:[tabela("Pesos da oferta e do embarque",[
      comparar("Peso bruto",d.Bruto_Oferta,d.Peso_Bruto),
      comparar("Peso cubado",d.Cubado_Oferta,d.Peso_Cubado),
      comparar("Peso taxado",d.Taxado_Oferta,d.Peso_Taxado),
    ])]};
}

async function conferirVgm(pool,house) {
  const linhas=await consultaHouse(pool,house,`SELECT TOP ${registro} C.Number AS Contêiner,E.Descricao AS Equipamento,
    C.Seal AS Lacre,C.Bar_Seal AS [Lacre de barra],C.Tare AS Tara,C.Gross_Weight AS [Peso bruto],
    V.Peso_Total AS VGM,V.Unidade_Medida AS [Unidade VGM],V.Metodo AS Método,V.Data_Verificacao AS [Verificado em],
    CASE WHEN NULLIF(LTRIM(RTRIM(C.Seal)),'') IS NULL AND NULLIF(LTRIM(RTRIM(C.Bar_Seal)),'') IS NULL THEN 'Pendente' ELSE 'Registrado' END AS [Situação do lacre],
    CASE WHEN ISNULL(V.Peso_Total,0)<=0 THEN 'VGM pendente'
      WHEN ISNULL(V.Unidade_Medida,0)=0 OR V.Data_Verificacao IS NULL THEN 'VGM incompleto' ELSE 'VGM registrado' END AS [Situação do VGM]
    FROM mov_Logistica_Maritima_Container C
    LEFT JOIN cad_Equipamento_Maritimo E ON E.IdEquipamento_Maritimo=C.IdEquipamento_Maritimo
    OUTER APPLY (SELECT TOP 1 X.Peso_Total,X.Unidade_Medida,X.Metodo,X.Data_Verificacao FROM mov_VGM_Container X
      WHERE X.IdLogistica_Maritima_Container=C.IdLogistica_Maritima_Container
      ORDER BY X.Data_Verificacao DESC,X.IdVGM_Container DESC) V
    WHERE C.IdLogistica_House=@house
    ORDER BY CASE WHEN ISNULL(V.Peso_Total,0)<=0 OR ISNULL(V.Unidade_Medida,0)=0 OR V.Data_Verificacao IS NULL
      OR (NULLIF(LTRIM(RTRIM(C.Seal)),'') IS NULL AND NULLIF(LTRIM(RTRIM(C.Bar_Seal)),'') IS NULL) THEN 0 ELSE 1 END,C.IdLogistica_Maritima_Container`);
  return {nota:linhas.length?"Última verificação cadastrada por contêiner. A unidade e o método VGM são exibidos conforme o cadastro.":"Sem contêineres vinculados ao processo.",
    tabelas:linhas.length?[tabela("Contêineres, VGM e lacres",linhas)]:[]};
}

async function conferirItens(pool,house) {
  const [totais,itens]=await Promise.all([
    consultaHouse(pool,house,`SELECT H.Quantidade_Volumes,H.Metros_Cubicos,H.Peso_Bruto,H.Peso_Liquido,
      I.Total,I.Volumes,I.Cubagem,I.Bruto,I.Liquido
      FROM mov_Logistica_House H CROSS APPLY (
        SELECT COUNT(*) AS Total,
          CASE WHEN COUNT(NULLIF(Quantidade,0))=COUNT(*) THEN SUM(CONVERT(bigint,Quantidade)) END AS Volumes,
          CASE WHEN COUNT(NULLIF(Metros_Cubicos,0))=COUNT(*) THEN SUM(Metros_Cubicos) END AS Cubagem,
          CASE WHEN COUNT(NULLIF(Peso_Bruto,0))=COUNT(*) THEN SUM(Peso_Bruto) END AS Bruto,
          CASE WHEN COUNT(NULLIF(Peso_Liquido,0))=COUNT(*) THEN SUM(Peso_Liquido) END AS Liquido
        FROM mov_Logistica_Embalagem WHERE IdLogistica_House=@house
      ) I WHERE H.IdLogistica_House=@house`),
    consultaHouse(pool,house,`SELECT TOP ${registro} ROW_NUMBER() OVER(ORDER BY IdLogistica_Embalagem) AS Item,
      Quantidade AS Volumes,Comprimento,Largura,Altura,Metros_Cubicos AS [Cubagem (m³)],
      Peso_Bruto AS [Peso bruto (kg)],Peso_Liquido AS [Peso líquido (kg)],
      CASE WHEN ISNULL(Quantidade,0)<=0 OR ISNULL(Comprimento,0)<=0 OR ISNULL(Largura,0)<=0
        OR ISNULL(Altura,0)<=0 OR ISNULL(Metros_Cubicos,0)<=0 OR ISNULL(Peso_Bruto,0)<=0 OR ISNULL(Peso_Liquido,0)<=0
        THEN 'Conferir medidas ou pesos' ELSE 'Completo' END AS Situação
      FROM mov_Logistica_Embalagem WHERE IdLogistica_House=@house ORDER BY IdLogistica_Embalagem`),
  ]);
  const d=totais[0];
  if (!d?.Total) return {nota:"O processo está sem itens de embalagem cadastrados."};
  const colunas=["Volumes","Cubagem","Bruto","Liquido"];
  const resumo=medidas.map(([chave,campo],i)=>comparar(campo,d[colunas[i]]==null ? null : Number(d[colunas[i]]),d[chave],"Itens"));
  return {nota:`${d.Total} linhas de embalagem. Campos vazios ou zerados em qualquer item deixam o total correspondente incompleto.`,
    tabelas:[tabela("Totais dos itens e do processo",resumo),
      tabela("Itens de embalagem",itens)]};
}

const individuais = {
  oferta_embarque:{titulo:"Oferta × embarque",consultar:conferirOferta},
  peso_aereo:{titulo:"Conferência de peso taxado",consultar:conferirPeso},
  vgm_lacre:{titulo:"Conferência de VGM e lacre",consultar:conferirVgm},
  itens_carga:{titulo:"Fechamento de volumes e medidas",consultar:conferirItens},
};

export const acoesCarga = Object.keys(individuais);

export function exigirAcessoOperacional(ctx) {
  if (!ctx.admin && ctx.recorte?.semOperacional) throw new FalhaPonte("A consulta exige acesso operacional.",403);
}

export async function consultarCarga(pool,acao,processo,ctx) {
  exigirAcessoOperacional(ctx);
  const {titulo,consultar}=individuais[acao];
  return {titulo:`${titulo} · ${processo.Numero_Processo}`,...await consultar(pool,processo.IdLogistica_House)};
}

export async function consultarDevolucoes(pool,pedido,ctx,processo) {
  exigirAcessoOperacional(ctx);
  const dias=pedido.dias ?? 3;
  if (!Number.isInteger(dias) || dias<1 || dias>90) throw new FalhaPonte("Informe um prazo de 1 a 90 dias.");
  const carteira=processo ? null : escopoDaConsulta(pool,pedido,ctx);
  const req=carteira?.req ?? pool.request().input("house",sql.Int,processo.IdLogistica_House);
  const filtro=carteira ? `${escopo} AND H.Data_Abertura_Processo>=@de AND H.Data_Abertura_Processo<DATEADD(day,1,@ate)
      AND CONCAT(H.Numero_Processo,' ',P.Nome,' ',C.Number) LIKE @filtro` : "H.IdLogistica_House=@house";
  const {recordset}=await req.input("hoje",sql.Date,hojeBrasil()).input("dias",sql.Int,dias).query(`
    WITH Devolucoes AS (
    SELECT H.Numero_Processo AS Processo,P.Nome AS Cliente,C.Number AS Contêiner,
      C.Free_Time_Master AS [Free time master (dias)],C.Free_Time_House AS [Free time house (dias)],
      C.Data_Limite_Devolucao AS [Limite de devolução],C.Data_Devolucao AS [Devolvido em],
      CASE WHEN C.Data_Devolucao IS NOT NULL THEN 'Devolvido'
        WHEN C.Data_Limite_Devolucao IS NULL THEN 'Sem prazo'
        WHEN C.Data_Limite_Devolucao<@hoje THEN 'Vencido'
        WHEN C.Data_Limite_Devolucao<DATEADD(day,@dias+1,@hoje) THEN 'Vence em breve' ELSE 'A vencer' END AS Situação
    FROM mov_Logistica_House H JOIN mov_Logistica_Maritima_Container C ON C.IdLogistica_House=H.IdLogistica_House
    LEFT JOIN cad_Pessoa P ON P.IdPessoa=H.IdCliente WHERE ${filtro}
    ), Classificadas AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY Situação ORDER BY
        CASE WHEN Situação='Devolvido' THEN [Devolvido em] END DESC,[Limite de devolução],Processo,Contêiner) AS Linha
      FROM Devolucoes
    )
    SELECT Processo,Cliente,Contêiner,[Free time master (dias)],[Free time house (dias)],
      [Limite de devolução],[Devolvido em],Situação
    FROM Classificadas WHERE Linha<=${registro} ORDER BY Linha`);
  const titulos={"Vence em breve":"Vencem em breve","Vencido":"Vencidos","A vencer":"A vencer","Sem prazo":"Sem prazo","Devolvido":"Devolvidos"};
  const tabelas=Object.entries(titulos).map(([situacao,titulo])=>tabela(titulo,recordset.filter(l=>l.Situação===situacao)));
  return {titulo:processo ? `Devolução de contêineres · ${processo.Numero_Processo}` : "Devolução de contêineres · Carteira",
    nota:`Em breve inclui hoje e os próximos ${dias} dias corridos. A situação usa o prazo e a devolução efetiva registrados no processo.`,
    ...(carteira&&{periodo:{de:carteira.de,ate:carteira.ate}}),
    tabelas:recordset.length ? tabelas.filter(t=>t.linhas.length) : [tabela("Prazos de devolução",[])]};
}

export async function consultarJanelas(pool,pedido,ctx,processo) {
  exigirAcessoOperacional(ctx);
  const carteira=processo ? null : escopoDaConsulta(pool,filtrosDaPergunta(pedido),ctx);
  const req=carteira?.req ?? pool.request().input("house",sql.Int,processo.IdLogistica_House);
  const filtro=carteira ? `${escopo} AND CONCAT(H.Numero_Processo,' ',C.Nome,' ',J.Local) LIKE @filtro
    AND ((J.Prevista>=@de AND J.Prevista<DATEADD(day,1,@ate)) OR (J.Efetiva>=@de AND J.Efetiva<DATEADD(day,1,@ate)))`
    : "H.IdLogistica_House=@house AND (J.Prevista IS NOT NULL OR J.Efetiva IS NOT NULL OR NULLIF(J.Local,'') IS NOT NULL)";
  const {recordset}=await req.input("hoje",sql.Date,hojeBrasil()).query(`
    WITH Janelas AS (
    SELECT H.Numero_Processo AS Processo,C.Nome AS Cliente,J.Etapa,J.Local,J.Ordem,
      J.Prevista AS Previsão,J.Efetiva AS Realizada,DATEDIFF(day,J.Prevista,J.Efetiva) AS [Diferença (dias)],
      CASE WHEN J.Efetiva IS NOT NULL AND J.Prevista IS NULL THEN 'Realizada'
        WHEN DATEDIFF(day,J.Prevista,J.Efetiva)>0 THEN 'Realizada com atraso'
        WHEN DATEDIFF(day,J.Prevista,J.Efetiva)<0 THEN 'Realizada antes do prazo'
        WHEN J.Efetiva IS NOT NULL THEN 'Realizada no prazo'
        WHEN J.Prevista IS NULL THEN 'Sem previsão' WHEN J.Prevista<@hoje THEN 'Pendente vencida' ELSE 'Prevista' END AS Situação,
      CASE WHEN J.Efetiva IS NOT NULL THEN 3 WHEN J.Prevista<@hoje THEN 1 ELSE 2 END AS Grupo
    FROM mov_Logistica_House H LEFT JOIN cad_Pessoa C ON C.IdPessoa=H.IdCliente
    CROSS APPLY (VALUES
      (1,'Coleta na origem',CONVERT(nvarchar(300),H.Local_Coleta),H.Data_Previsao_Coleta,H.Data_Coleta),
      (2,'Entrega na origem',CONVERT(nvarchar(300),H.Local_Entrega_Origem),H.Data_Previsao_Entrega_Origem,H.Data_Entrega_Origem),
      (3,'Coleta no destino',CONVERT(nvarchar(300),H.Local_Coleta_Destino),H.Data_Previsao_Coleta_Destino,H.Data_Coleta_Destino),
      (4,'Entrega final',CONVERT(nvarchar(300),H.Local_Entrega),H.Data_Previsao_Entrega,H.Data_Entrega)
    ) J(Ordem,Etapa,Local,Prevista,Efetiva)
    WHERE ${filtro}
    ), Classificadas AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY Grupo ORDER BY
        CASE WHEN Grupo=3 THEN Realizada END DESC,Previsão,Processo,Ordem) AS Linha FROM Janelas
    )
    SELECT Processo,Cliente,Etapa,Local,Previsão,Realizada,[Diferença (dias)],Situação,Grupo
    FROM Classificadas WHERE Linha<=${registro} ORDER BY ${carteira ? "Grupo,Linha" : "Ordem"}`);
  const tabelas=carteira ? ["Pendências vencidas","Próximas etapas","Etapas realizadas"].map((titulo,i)=>
    tabela(titulo,recordset.filter(l=>l.Grupo===i+1).map(({Grupo,...linha})=>linha))).filter(t=>t.linhas.length) : [];
  return {titulo:processo ? `Janelas de coleta e entrega · ${processo.Numero_Processo}` : "Janelas de coleta e entrega · Carteira",
    nota:"Prazos previstos e realizados no HeadCargo. As diferenças são calculadas em dias corridos.",
    ...(carteira&&{periodo:{de:carteira.de,ate:carteira.ate}}),
    tabelas:carteira&&tabelas.length ? tabelas : [tabela("Coletas e entregas",recordset.map(({Grupo,...linha})=>linha))]};
}
