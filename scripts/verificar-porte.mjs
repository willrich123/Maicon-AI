import "../server/env.js";
import sql from "mssql";
import { protegerPool } from "../server/seguranca.js";
import { consultarProcessoWeb, listarProcessosWeb } from "../server/porte/processo.js";
import { usuarioPonteDaConta } from "../server/ponte/identidade.js";
import { permissaoDe } from "../server/acesso.js";
import { consultarOperacional } from "../server/porte/operacional.js";
import {destinoSqlHeadcargo} from '../server/ambienteHeadcargo.js';
const email = process.argv[2]; const numero = process.argv[3];
if (!email || !numero) throw new Error("Informe email da conta e número de processo para verificar a consulta.");
const destino=destinoSqlHeadcargo();
const pool = new sql.ConnectionPool({
  server: destino.instancia ? `${destino.servidor}\\${destino.instancia}` : destino.servidor,
  port: Number(destino.porta || 1433), database: destino.banco,
  user: destino.usuario, password: destino.senha,
  options: { encrypt: process.env.SQL_ENCRYPT !== "false", trustServerCertificate: process.env.SQL_TRUST_CERT !== "false", readOnlyIntent: true },
  connectionTimeout: 10000, requestTimeout: 30000,
});
try {
  await pool.connect(); const protegido = protegerPool(pool);
  const vinculo = await usuarioPonteDaConta(protegido,{email});
  const resultado = await consultarProcessoWeb(protegido,numero,{admin:permissaoDe(email).papel === "admin",pessoa:vinculo.idPessoa});
  console.log(JSON.stringify({ok:true,usuarioIdentificado:Boolean(vinculo.usuario),processoEncontrado:Boolean(resultado.numero),atividades:resultado.atividades.length,modo:resultado.modo}));
  if (process.argv.includes("--pendentes")) console.log(JSON.stringify(resultado.atividades.filter(a=>![4,5,6].includes(Number(a.Situacao))).slice(0,8).map(a=>({id:a.IdAtividade,codigo:a.Codigo,atividade:a.Atividade}))));
  if (process.argv.includes("--esquema")) {
    const r=await protegido.request().query(`SELECT T.name AS Tabela,C.name AS Coluna FROM sys.tables T JOIN sys.columns C ON C.object_id=T.object_id WHERE T.name LIKE 'mov[_]%' AND C.name IN ('IdLogistica_House','IdLogistica_Master','IdProjeto_Atividade') ORDER BY T.name,C.name`);
    console.log(JSON.stringify(r.recordset));
  }
  if(process.argv.includes("--operacional")) {
    const ctx={admin:permissaoDe(email).papel==="admin",pessoa:vinculo.idPessoa};
    const lista=await consultarOperacional(protegido,{numero,acao:"secoes"},ctx);
    const resultados=[];
    for(const s of lista.secoes){try{const d=await consultarOperacional(protegido,{numero,acao:"dados",secao:s.id,pagina:0},ctx);resultados.push({secao:s.titulo,total:d.total,colunas:d.colunas.length});}catch(e){resultados.push({secao:s.titulo,erro:e.code||e.status||"consulta_falhou"});}}
    console.log(JSON.stringify({secoes:resultados}));
    if(resultados.some(s=>s.erro))process.exitCode=1;
  }
  if(process.argv.includes("--listagem")){const r=await listarProcessosWeb(protegido,{busca:numero},{admin:permissaoDe(email).papel==="admin",pessoa:vinculo.idPessoa});console.log(JSON.stringify({listagem:true,linhas:r.linhas.length,temMais:r.temMais,encontrou:r.linhas.some(l=>l.Numero===numero)}));}
} catch (e) {
  console.error(JSON.stringify({ok:false,code:e.code || "consulta_nao_confirmada",status:e.status || 500}));process.exitCode=1;
} finally { await pool.close(); }
