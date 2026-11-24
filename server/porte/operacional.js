import sql from "mssql";
import { processoAutorizado } from "./processo.js";
import { colunaBloqueada } from "../recorte.js";
import { FalhaPonte } from "../ponte/sessoes.js";
import {nomesOperacionais,camposLivresOperacionais} from './valores.js';

const tabelas = {
  mov_Logistica_House:"Dados do processo",mov_Logistica_Master:"Dados do master",
  mov_Acompanhamento:"Acompanhamentos",mov_Agenda:"Agenda",mov_Projeto_Atividade:"Projeto de atividades",
  mov_Projeto_Atividade_Arquivo:"Documentos e arquivos",mov_Projeto_Atividade_Contato:"Contatos do processo",mov_Projeto_Atividade_Responsavel:"Responsáveis",mov_Projeto_Atividade_Mensagem:"Mensagens do processo",
  mov_Logistica_Aerea_House:"Aéreo · House",mov_Logistica_Aerea_Master:"Aéreo · Master",mov_Logistica_Aerea_Escala:"Escalas aéreas",
  mov_Logistica_Maritima_House:"Marítimo · House",mov_Logistica_Maritima_Master:"Marítimo · Master",mov_Logistica_Maritima_Container:"Contêineres",mov_Logistica_Maritima_Equipamento:"Equipamentos",mov_Logistica_Maritima_Transbordo:"Transbordos",
  mov_Logistica_Terrestre_House:"Terrestre · House",mov_Logistica_Terrestre_Master:"Terrestre · Master",
  mov_Logistica_Embalagem:"Embalagens e carga",mov_Bill_Lading_NCM:"NCM da carga",mov_Conhecimento_Embarque:"Conhecimentos de embarque",
  mov_Logistica_Campo_Livre:"Campos livres",mov_Logistica_Evento:"Eventos",mov_Logistica_Prazo:"Prazos",mov_Logistica_Viagem:"Viagens",mov_Logistica_Viagem_Historico:"Histórico de viagens",mov_Logistica_Historico_Embarque:"Histórico de embarque",mov_Historico_Vinculo_Master:"Histórico de vínculo ao master",
  mov_Historico_Liberacao_Booking:"Histórico de booking",mov_Ordem_Embarque:"Ordens de embarque",mov_Loading_Plan:"Loading plan",mov_Loading_Plan_Free_Hand:"Loading plan free hand",
  mov_Desvio_Logistica:"Desvios operacionais",mov_Logistica_Validacao_Excecao:"Exceções de validação",mov_Etapa_Atividade:"Etapas do projeto",
  mov_Tracking_Carga:"Rastreamento de carga",mov_Tracking_Process_Container:"Rastreamento de contêineres",mov_TRK_House:"Tracking do house",mov_TRK_House_Atualizacao:"Atualizações de tracking",
  mov_Logistica_Taxa:"Taxas do processo",mov_Logistica_Master_Taxa:"Taxas do master",mov_Logistica_Fatura:"Faturas do processo",mov_Logistica_Moeda:"Moedas do processo",mov_Logistica_Moeda_Historico:"Histórico de moedas",mov_Logistica_Fiscal:"Dados fiscais",mov_Logistica_Comissao:"Comissões",
};
const financeiros = /Taxa|Fatura|Moeda|Fiscal|Comissao/;
const segredo = /senha|password|token|secret|credential|private.?key|connection|conexao/i;
const quote = n => { if (!/^[A-Za-z_]\w{0,127}$/.test(n)) throw new FalhaPonte("Identificador de dados inválido."); return `[${n}]`; };
const cache = new WeakMap();
export async function esquemaOperacional(pool) {
  const salvo=cache.get(pool);if(salvo&&Date.now()-salvo.quando<300000)return salvo.valor;
  const r=await pool.request().query(`SELECT T.name AS Tabela,C.name AS Coluna,TYPE_NAME(C.system_type_id) AS Tipo,C.column_id AS Ordem,
    CASE WHEN EXISTS(SELECT 1 FROM sys.index_columns IC JOIN sys.indexes I ON I.object_id=IC.object_id AND I.index_id=IC.index_id WHERE IC.object_id=C.object_id AND IC.column_id=C.column_id AND I.is_primary_key=1) THEN 1 ELSE 0 END AS PK
    FROM sys.tables T JOIN sys.schemas S ON S.schema_id=T.schema_id JOIN sys.columns C ON C.object_id=T.object_id JOIN sys.types Y ON Y.user_type_id=C.user_type_id WHERE S.name='dbo' AND T.name LIKE 'mov[_]%' ORDER BY T.name,C.column_id`);
  const valor=r.recordset.filter(c=>Object.hasOwn(tabelas,c.Tabela)); cache.set(pool,{quando:Date.now(),valor});return valor;
}
function secoes(esquema,ctx) {
  return Object.entries(tabelas).filter(([id])=>(ctx.admin||ctx.recorte?.financeiro||!financeiros.test(id))&&esquema.some(c=>c.Tabela===id&&["IdLogistica_House","IdLogistica_Master","IdProjeto_Atividade"].includes(c.Coluna))).map(([id,titulo])=>({id,titulo}));
}
export async function consultarOperacional(pool, pedido, ctx) {
  const h=await processoAutorizado(pool,pedido.numero,ctx);
  const esquema=await esquemaOperacional(pool), disponiveis=secoes(esquema,ctx);
  if(pedido.acao==="secoes")return {secoes:disponiveis};
  const secao=disponiveis.find(s=>s.id===pedido.secao);if(!secao)throw new FalhaPonte("Seção não disponível para esta conta.",403);
  const pagina=pedido.pagina??0;if(!Number.isSafeInteger(pagina)||pagina<0||pagina>100000)throw new FalhaPonte("Página inválida.");
  if(secao.id==='mov_Logistica_Campo_Livre')return camposLivresOperacionais(pool,h.IdLogistica_House,pagina);
  const todas=esquema.filter(c=>c.Tabela===secao.id);
  const colunas=todas.filter(c=>!segredo.test(c.Coluna)&&!colunaBloqueada(c.Coluna,ctx.recorte)&&!['image','binary','varbinary','timestamp','rowversion','geography','geometry','hierarchyid','sql_variant'].includes(c.Tipo));
  if(!colunas.length)throw new FalhaPonte("Esta seção não possui campos de consulta disponíveis.",422);
  const vinculo=["IdLogistica_House","IdLogistica_Master","IdProjeto_Atividade"].find(c=>todas.some(t=>t.Coluna===c));
  const identificador=Number(h[vinculo]);
  if(!Number.isSafeInteger(identificador)||identificador<=0)return {titulo:secao.titulo,colunas:[],linhas:[],total:0,pagina,temMais:false};
  // Nomes são escolhidos exclusivamente do manifesto e esquema do servidor.
  const tabela=`[dbo].${quote(secao.id)}`, where=`${quote(vinculo)}=@vinculo`;
  const ordem=todas.filter(c=>c.PK).map(c=>quote(c.Coluna)).join(',')||quote(vinculo);
  const campos=colunas.map(c=>['text','ntext','xml'].includes(c.Tipo)?`CAST(${quote(c.Coluna)} AS nvarchar(max)) AS ${quote(c.Coluna)}`:quote(c.Coluna)).join(',');
  const req=()=>pool.request().input("vinculo",sql.Int,identificador);
  const total=await req().query(`SELECT COUNT_BIG(*) AS Total FROM ${tabela} WHERE ${where}`);
  const linhas=await req().input("offset",sql.Int,pagina*50).query(`SELECT ${campos} FROM ${tabela} WHERE ${where} ORDER BY ${ordem} OFFSET @offset ROWS FETCH NEXT 50 ROWS ONLY`);
  const quantidade=Number(total.recordset[0].Total);
  const nomes=await nomesOperacionais(pool,colunas.filter(c=>!c.PK),linhas.recordset);
  return {titulo:secao.titulo,colunas:colunas.map(c=>({id:c.Coluna,rotulo:c.Coluna.replace(/^Id(?=[A-Z_])/,'Código ').replaceAll('_',' '),tipo:c.Tipo})),nomes,linhas:linhas.recordset,total:quantidade,pagina,temMais:(pagina+1)*50<quantidade,conteudosBinarios:todas.filter(c=>['image','binary','varbinary'].includes(c.Tipo)).length};
}
