import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import sql from "mssql";
import { processoAutorizado } from "./processo.js";
import { FalhaPonte } from "../ponte/sessoes.js";
import { consultarNavioAis, normalizarImo } from "./rastreamentoAis.js";

let locais;
const normal = valor => String(valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hora = valor => valor ? Date.parse(valor) : NaN;

export function localizarCadastro({ nome, codigo, sigla, pais }, modal) {
  locais ??= JSON.parse(gunzipSync(readFileSync(new URL("../geografia-embarques.json.gz", import.meta.url))));
  const iso = normal(pais);
  const codigos = [normal(codigo), normal(sigla)].filter(Boolean);
  const len = /^[A-Z]{2}$/;
  for (const id of codigos) {
    if (modal === 1 && /^[A-Z]{3}$/.test(id)) {
      const ponto = len.test(iso) ? locais[iso + id + ":iata"] : locais[id];
      if (ponto) return { nome, codigo:id, coords:ponto };
    }
    const chave = /^[A-Z]{2}[A-Z0-9]{3}$/.test(id) ? id : len.test(iso) && /^[A-Z0-9]{3}$/.test(id) ? iso + id : "";
    if (chave && (!len.test(iso) || chave.startsWith(iso))) {
      const ponto = (modal === 1 ? locais[chave + ":iata"] : null) || locais[chave];
      if (ponto) return { nome, codigo:chave, coords:ponto };
    }
  }
  const nomeNormal = normal(String(nome ?? "").normalize("NFD").replace(/\p{M}/gu,""));
  const localPorNome = len.test(iso) && nomeNormal ? locais[iso + ":" + nomeNormal] : null;
  if (localPorNome) return {nome,codigo:localPorNome[0],coords:localPorNome[1]};
  return { nome, codigo:codigos[0] || "", coords:null };
}

export function situarEmbarque(trechos, limite = Date.now()) {
  const eventos = trechos.flatMap((trecho, indice) => {
    if (trecho.cancelado || trecho.ignorado) return [];
    return [
      { id:trecho.id, indice, ordem:0, tipo:"embarque", local:trecho.origem, data:trecho.embarque },
      { id:trecho.id, indice, ordem:1, tipo:"desembarque", local:trecho.destino, data:trecho.desembarque },
    ].filter(evento => hora(evento.data) <= limite);
  });
  eventos.sort((a,b) => hora(b.data) - hora(a.data) || b.indice - a.indice || b.ordem - a.ordem);
  const ultimo = eventos[0] ?? null;
  return { ultimo, emTransito:ultimo?.tipo === "embarque", eventos };
}

const rad=Math.PI/180;
const vetor=([lat,lon])=>[Math.cos(lat*rad)*Math.cos(lon*rad),Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad)];
const anguloEntre=(u,v)=>Math.acos(Math.min(1,Math.max(-1,u.reduce((s,n,i)=>s+n*v[i],0))));
let redeMaritima;
const cacheMaritimo=new Map();

async function rotaMaritima(a,b) {
  const chave=a.join(",")+"/"+b.join(",");
  if(cacheMaritimo.has(chave))return cacheMaritimo.get(chave);
  redeMaritima ??= Promise.all([import("searoute-ts"),import("searoute-ts/marnet-20km")]);
  const [{seaRoute},{DEFAULT_MARNET}]=await redeMaritima;
  let rota=null;
  try {
    const linha=seaRoute([a[1],a[0]],[b[1],b[0]],{
      network:DEFAULT_MARNET,units:"kilometers",maxSnapDistanceKm:180,returnPassages:true,
    });
    rota={tipo:"maritima",km:Math.round(linha.properties.length),
      pontos:linha.geometry.coordinates.map(([lon,lat])=>[lat,lon]),passagens:linha.properties.passages};
  } catch(e) {
    if(e.name!=="SnapFailedError"&&e.name!=="NoRouteError")throw e;
  }
  if(cacheMaritimo.size>=300)cacheMaritimo.delete(cacheMaritimo.keys().next().value);
  cacheMaritimo.set(chave,rota);
  return rota;
}

async function tracarTrecho(trecho) {
  const {coords:a}=trecho.origem, {coords:b}=trecho.destino;
  if (!a || !b || trecho.cancelado || trecho.ignorado) return null;
  if (Number(trecho.modal) === 2) {
    const rota=await rotaMaritima(a,b);
    if(rota)return rota;
  }
  if (Number(trecho.modal) !== 1) return {tipo:"ligacao",pontos:[a,b]};
  const u=vetor(a),v=vetor(b);
  const angulo=anguloEntre(u,v);
  const seno=Math.sin(angulo);
  const pontos=seno<1e-8?[a,b]:Array.from({length:49},(_,i)=>{
    const t=i/48;
    const [x,y,z]=u.map((n,j)=>(n*Math.sin((1-t)*angulo)+v[j]*Math.sin(t*angulo))/seno);
    return [Math.atan2(z,Math.hypot(x,y))/rad,Math.atan2(y,x)/rad];
  });
  return {tipo:"aerea",km:Math.round(6371*angulo),pontos};
}

export function historicoPrevisoes(trechos, registros) {
  const dia=data=>Number.isFinite(hora(data))?new Date(data).toISOString().slice(0,10):null;
  return trechos.flatMap(trecho=>{
    const versoes=registros.filter(r=>r.idTrecho===trecho.id);
    return versoes.flatMap((anterior,i)=>{
      const seguinte=versoes[i+1];
      const atual=seguinte ?? trecho;
      return ["saidaPrevista","chegadaPrevista"].flatMap(campo=>{
        const de=dia(anterior[campo]),para=dia(atual[campo]);
        return de===para?[]:[{id:anterior.id,idTrecho:trecho.id,campo,de,para,
          data:seguinte?.data ?? null,
          dias:de&&para?(hora(para)-hora(de))/86400000:null}];
      });
    });
  });
}

const colunasNavio = new WeakMap();

async function colunaImo(pool) {
  if (!colunasNavio.has(pool)) {
    colunasNavio.set(pool, pool.request().query("SELECT COL_LENGTH('dbo.cad_Navio','Identificador_IMO') AS tamanho")
      .then(({ recordset }) => recordset[0]?.tamanho != null)
      .catch(erro => { colunasNavio.delete(pool); throw erro; }));
  }
  return colunasNavio.get(pool);
}

async function consultarTrechos(pool, house, incluirNavio) {
  const temImo = incluirNavio && await colunaImo(pool);
  const r = await pool.request().input("house",sql.Int,house.IdLogistica_House).query(`
    SELECT TOP 201 V.IdLogistica_Viagem AS id,V.Sequencia AS sequencia,V.Modalidade_Transporte AS modal,
      V.Situacao_Embarque AS situacao,V.Ignorar_Tracking AS ignorado,
      V.Data_Previsao_Embarque AS saidaPrevista,V.Data_Previsao_Desembarque AS chegadaPrevista,
      V.Data_Embarque AS embarque,V.Data_Desembarque AS desembarque,V.Viagem_Voo AS viagem,
      ${incluirNavio ? `N.Nome AS navio,N.Lloyds_Code AS lloyds,${temImo ? "N.Identificador_IMO" : "NULL"} AS imo,` : ""}
      C.Nome AS transportadora,O.Nome AS origem,O.Codigo AS codOrigem,O.Sigla AS siglaOrigem,PO.Sigla AS paisOrigem,
      D.Nome AS destino,D.Codigo AS codDestino,D.Sigla AS siglaDestino,PD.Sigla AS paisDestino
    FROM mov_Logistica_Viagem V
    LEFT JOIN cad_Origem_Destino O ON O.IdOrigem_Destino=V.IdOrigem
    LEFT JOIN cad_Origem_Destino D ON D.IdOrigem_Destino=V.IdDestino
    LEFT JOIN cad_Pais PO ON PO.IdPais=O.IdPais LEFT JOIN cad_Pais PD ON PD.IdPais=D.IdPais
    LEFT JOIN cad_Pessoa C ON C.IdPessoa=V.IdCompanhia_Transporte
    ${incluirNavio ? `LEFT JOIN mov_Viagem_Navio VN ON VN.IdViagem_Navio=V.IdViagem_Navio
    LEFT JOIN cad_Navio N ON N.IdNavio=COALESCE(NULLIF(V.IdNavio,0),VN.IdNavio)` : ""}
    WHERE V.IdLogistica_House=@house
    ORDER BY COALESCE(V.Sequencia,2147483647),V.Data_Previsao_Embarque,V.IdLogistica_Viagem`);
  const trechos = r.recordset.slice(0,200).map(v => ({
    id:v.id, sequencia:v.sequencia, modal:v.modal, embarque:v.embarque, desembarque:v.desembarque,
    saidaPrevista:v.saidaPrevista, chegadaPrevista:v.chegadaPrevista, viagem:v.viagem, transportadora:v.transportadora,
    navio:v.navio||null, imo:normalizarImo(v.imo)??normalizarImo(v.lloyds),
    cancelado:Number(v.situacao) === 9, ignorado:Boolean(v.ignorado),
    origem:localizarCadastro({nome:v.origem || "Origem não informada",codigo:v.codOrigem,sigla:v.siglaOrigem,pais:v.paisOrigem},Number(v.modal)),
    destino:localizarCadastro({nome:v.destino || "Destino não informado",codigo:v.codDestino,sigla:v.siglaDestino,pais:v.paisDestino},Number(v.modal)),
  }));
  return { processo:house.Numero_Processo, trechos, limitado:r.recordset.length > 200, ...situarEmbarque(trechos) };
}

export function rastrearTrechoMaritimo(resumo, pedido = {}) {
  const {trechos, ultimo}=resumo;
  if (ultimo?.tipo !== "embarque") return null;
  const trecho=trechos[ultimo.indice];
  if (Number(trecho?.modal) !== 2) return null;
  const navio={trecho:trecho.id,nome:trecho.navio,imo:trecho.imo,manual:false};
  if (pedido.imo != null && !navio.imo && pedido.trecho === trecho.id) {
    const imo=normalizarImo(pedido.imo);
    if (!imo) throw new FalhaPonte("Informe um IMO válido de sete dígitos.");
    navio.imo=imo;
    navio.manual=true;
  }
  return {...navio,...(navio.imo?consultarNavioAis(navio.imo):{estado:"semImo",posicao:null})};
}

export async function consultarAisDoProcesso(pool, processo, pedido) {
  return rastrearTrechoMaritimo(await consultarTrechos(pool, processo, true), pedido);
}

export async function consultarMapaEmbarque(pool, numero, contexto, processo, detalhado = true) {
  const house = processo || await processoAutorizado(pool, numero, contexto);
  const resumo = await consultarTrechos(pool, house, detalhado);
  if (!detalhado) return resumo;
  const {trechos}=resumo;
  const [historico,tracking]=await Promise.all([
    pool.request().input("house",sql.Int,house.IdLogistica_House).query(`
      SELECT * FROM (
        SELECT TOP 501 H.IdLogistica_Viagem_Historico AS id,H.IdLogistica_Viagem AS idTrecho,
          H.Data_Atualizacao AS data,H.Data_Previsao_Embarque AS saidaPrevista,H.Data_Previsao_Desembarque AS chegadaPrevista
        FROM mov_Logistica_Viagem_Historico H JOIN mov_Logistica_Viagem V ON V.IdLogistica_Viagem=H.IdLogistica_Viagem
        WHERE V.IdLogistica_House=@house
        ORDER BY H.Data_Atualizacao DESC,H.IdLogistica_Viagem_Historico DESC
      ) D ORDER BY D.data,D.id`),
    pool.request().input("house",sql.Int,house.IdLogistica_House).input("master",sql.Int,house.IdLogistica_Master).query(`
      SELECT TOP 30 E.IdTracking_Carga_Evento AS id,E.Evento_Descricao AS descricao,E.Data_Efetiva AS data,
        E.Local_Nome AS local,TRY_CONVERT(float,NULLIF(E.Local_Latitude,'')) AS lat,
        TRY_CONVERT(float,NULLIF(E.Local_Longitude,'')) AS lon
      FROM mov_Tracking_Carga_Evento E JOIN mov_Tracking_Carga T ON T.IdTracking_Carga=E.IdTracking_Carga
      WHERE T.IdLogistica_Master=@master AND T.Corrente=1 AND E.Corrente=1 AND E.Evento_Ocorreu=1
        AND E.Data_Efetiva<=SYSDATETIME()
        AND NOT EXISTS(SELECT 1 FROM mov_Logistica_House H WHERE H.IdLogistica_Master=@master AND H.IdLogistica_House<>@house)
      ORDER BY E.Data_Efetiva DESC,E.IdTracking_Carga_Evento DESC`),
  ]);
  const rotas=await Promise.all(trechos.map(tracarTrecho));
  const eventosTracking=tracking.recordset.map(({lat,lon,...evento})=>({...evento,fonte:"Tracking HeadCargo",
    coords:lat!=null&&lon!=null&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&(lat!==0||lon!==0)?[lat,lon]:null}));
  return {...resumo,trechos:trechos.map((trecho,i)=>({...trecho,rota:rotas[i]})),
    historico:historicoPrevisoes(trechos,historico.recordset.slice(-500)),historicoLimitado:historico.recordset.length>500,
    eventosTracking,posicao:eventosTracking.find(e=>e.coords)??null,ais:rastrearTrechoMaritimo(resumo)};
}

export async function consultarCarteiraMapa(pool, pedido, {admin=false,pessoa,modalidade=""}={}) {
  if(!admin&&(!Number.isSafeInteger(pessoa)||pessoa<=0))throw new FalhaPonte("Conta sem vínculo operacional.",403);
  const estados=["","atrasado","semAtualizacao","transito","previsto","desembarcado"];
  const situacao=pedido.situacao ?? "";
  const modal=String(pedido.modal ?? "");
  if(!estados.includes(situacao)||!["","1","2","3"].includes(modal))throw new FalhaPonte("Filtro do mapa inválido.");
  function termo(campo) {
    const valor=pedido[campo]??"";
    if(typeof valor!=="string"||valor.length>100)throw new FalhaPonte("Filtro do mapa inválido.");
    const texto=valor.trim();
    return texto?`%${texto.replace(/[\[\]%_]/g,c=>`[${c}]`)}%`:"%";
  }
  const hoje=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format();
  const r=await pool.request().input("admin",sql.Bit,admin).input("pessoa",sql.Int,pessoa||0)
    .input("escopo",sql.VarChar(8),modalidade?`${modalidade}%`:"%").input("cliente",sql.VarChar(310),termo("cliente"))
    .input("transportadora",sql.VarChar(310),termo("transportadora")).input("situacao",sql.VarChar(20),situacao)
    .input("modal",sql.Int,Number(modal)).input("hoje",sql.VarChar(10),hoje).query(`
    SELECT H.Numero_Processo AS processo, C.Nome AS cliente, T.Nome AS transportadora,
      V.Modalidade_Transporte AS modal,V.Data_Previsao_Desembarque AS eta,M.data,M.tipo,M.modalEvento,S.estado,
      O.Nome AS nome,O.Codigo AS codigo,O.Sigla AS sigla,P.Sigla AS pais,
      G.Nome AS origem,G.Codigo AS codOrigem,G.Sigla AS siglaOrigem,PG.Sigla AS paisOrigem,
      D.Nome AS destino,D.Codigo AS codDestino,D.Sigla AS siglaDestino,PD.Sigla AS paisDestino
    FROM mov_Logistica_House H
    LEFT JOIN cad_Pessoa C ON C.IdPessoa=H.IdCliente
    CROSS APPLY (
      SELECT TOP 1 L.Modalidade_Transporte,L.IdCompanhia_Transporte,L.Data_Previsao_Desembarque,L.Data_Previsao_Embarque,L.IdOrigem,L.IdDestino
      FROM mov_Logistica_Viagem L WHERE L.IdLogistica_House=H.IdLogistica_House
        AND ISNULL(L.Situacao_Embarque,0)<>9 AND ISNULL(L.Ignorar_Tracking,0)=0
      ORDER BY CASE WHEN L.Data_Desembarque IS NULL OR L.Data_Desembarque>SYSDATETIME() THEN 0 ELSE 1 END,
        CASE WHEN L.Data_Desembarque<=SYSDATETIME() THEN L.Data_Desembarque END DESC,
        COALESCE(L.Sequencia,2147483647),L.Data_Previsao_Embarque,L.IdLogistica_Viagem
    ) V
    OUTER APPLY (
      SELECT TOP 1 X.data,X.local,X.tipo,L.Modalidade_Transporte AS modalEvento
      FROM mov_Logistica_Viagem L
      CROSS APPLY (VALUES(L.Data_Embarque,L.IdOrigem,'embarque',0),(L.Data_Desembarque,L.IdDestino,'desembarque',1)) X(data,local,tipo,ordem)
      WHERE L.IdLogistica_House=H.IdLogistica_House AND X.data<=SYSDATETIME()
        AND ISNULL(L.Situacao_Embarque,0)<>9 AND ISNULL(L.Ignorar_Tracking,0)=0
      ORDER BY X.data DESC,COALESCE(L.Sequencia,2147483647) DESC,X.ordem DESC,L.IdLogistica_Viagem DESC
    ) M
    CROSS APPLY (
      SELECT CASE
        WHEN M.tipo='desembarque' AND NOT EXISTS(SELECT 1 FROM mov_Logistica_Viagem L
          WHERE L.IdLogistica_House=H.IdLogistica_House AND ISNULL(L.Situacao_Embarque,0)<>9 AND ISNULL(L.Ignorar_Tracking,0)=0
            AND (L.Data_Desembarque IS NULL OR L.Data_Desembarque>SYSDATETIME())) THEN 'desembarcado'
        WHEN V.Data_Previsao_Desembarque<@hoje OR (M.tipo IS NULL AND V.Data_Previsao_Embarque<@hoje) THEN 'atrasado'
        WHEN M.data<DATEADD(day,-6,CONVERT(date,@hoje)) AND M.tipo='embarque' THEN 'semAtualizacao'
        WHEN M.tipo='embarque' THEN 'transito' ELSE 'previsto' END AS estado
    ) S
    LEFT JOIN cad_Pessoa T ON T.IdPessoa=V.IdCompanhia_Transporte
    LEFT JOIN cad_Origem_Destino O ON O.IdOrigem_Destino=M.local
    LEFT JOIN cad_Pais P ON P.IdPais=O.IdPais
    LEFT JOIN cad_Origem_Destino G ON G.IdOrigem_Destino=V.IdOrigem
    LEFT JOIN cad_Pais PG ON PG.IdPais=G.IdPais
    LEFT JOIN cad_Origem_Destino D ON D.IdOrigem_Destino=V.IdDestino
    LEFT JOIN cad_Pais PD ON PD.IdPais=D.IdPais
    WHERE H.Data_Cancelamento IS NULL AND H.Data_Abertura_Processo>=DATEADD(day,-180,CONVERT(date,@hoje))
      AND (@cliente='%' OR C.Nome LIKE @cliente) AND (@transportadora='%' OR T.Nome LIKE @transportadora)
      AND (@situacao='' OR S.estado=@situacao)
      AND (@modal=0 OR V.Modalidade_Transporte=@modal OR (@modal=3 AND V.Modalidade_Transporte=4))
      AND (@admin=1 OR (H.Numero_Processo NOT LIKE '% teste' AND H.Numero_Processo LIKE @escopo AND
        (EXISTS(SELECT 1 FROM mov_Projeto_Atividade_Responsavel R WHERE R.IdProjeto_Atividade=H.IdProjeto_Atividade AND R.IdResponsavel=@pessoa)
          OR EXISTS(SELECT 1 FROM mov_Atividade A WHERE A.IdProjeto_Atividade=H.IdProjeto_Atividade AND A.IdResponsavel=@pessoa))))
    ORDER BY CASE S.estado WHEN 'atrasado' THEN 0 WHEN 'semAtualizacao' THEN 1 ELSE 2 END,
      H.Data_Abertura_Processo DESC,H.IdLogistica_House DESC`);
  return {linhas:r.recordset.map(({nome,codigo,sigla,pais,modalEvento,origem,codOrigem,siglaOrigem,paisOrigem,
    destino,codDestino,siglaDestino,paisDestino,...linha})=>{
    const candidatas=[
      ["evento",{nome,codigo,sigla,pais},modalEvento],
      ["origem",{nome:origem,codigo:codOrigem,sigla:siglaOrigem,pais:paisOrigem},linha.modal],
      ["destino",{nome:destino,codigo:codDestino,sigla:siglaDestino,pais:paisDestino},linha.modal],
    ];
    for(const [referencia,cadastro,modalLocal] of candidatas){
      if(!cadastro.nome)continue;
      const local=localizarCadastro(cadastro,Number(modalLocal));
      if(local.coords)return {...linha,local,referencia,localEvento:nome};
    }
    return {...linha,local:null,referencia:null,localEvento:nome};
  })};
}
