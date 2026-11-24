import sql from 'mssql';
import {FalhaPonte} from '../ponte/sessoes.js';
import {CriacaoProcessos} from './novoProcesso.js';
import {criarProcessoDesktop,disponibilidadeCriacao} from './criarProcessoDesktop.js';
import {ambienteHeadcargo} from '../ambienteHeadcargo.js';
import {abrirSqlite} from '../sqlite.js';
import {executarNoDesktop} from '../filaDesktop.js';

export function criarOperacaoNovoProcesso({conectar,permissaoDe}){
 let motor;
 const consulta=async executar=>{const pool=await conectar();try{return await executar(pool);}finally{await pool.close().catch(()=>{});}};
 const servico=()=>motor??=new CriacaoProcessos({db:abrirSqlite('criacao-processos-homologacao.sqlite'),disponibilidade:disponibilidadeCriacao,serializar:executarNoDesktop,executar:criarProcessoDesktop,
  preparar:async d=>consulta(async pool=>{
   const r=await pool.request().input('id',sql.Int,d.clienteId).query('SELECT P.Nome,P.Codigo FROM cad_Pessoa P JOIN cad_Cliente C ON C.IdPessoa=P.IdPessoa WHERE P.IdPessoa=@id');
   if(r.recordset.length!==1||!r.recordset[0].Codigo)throw new FalhaPonte('Cliente não identificado de forma única no HeadCargo.');
   const marco=await pool.request().query('SELECT MAX(IdLogistica_House) AS Limite FROM mov_Logistica_House');
   return {nome:r.recordset[0].Nome,codigo:String(r.recordset[0].Codigo),limiteHouse:Number(marco.recordset[0].Limite||0)};
  }),
  verificar:async(t,r)=>consulta(async pool=>{
   if(typeof r.numero!=='string'||!new RegExp(`^${t.modalidade}\\d{2,6}-\\d{2}( teste)?$`).test(r.numero))return false;
   const encontrado=await pool.request().input('numero',sql.VarChar(40),r.numero).input('cliente',sql.Int,t.clienteId).input('referencia',sql.VarChar(80),t.referencia).input('limite',sql.Int,t.limiteHouse).query(`SELECT TOP 2 IdLogistica_House FROM mov_Logistica_House WHERE Numero_Processo=@numero AND IdCliente=@cliente AND Referencia_Cliente=@referencia AND IdLogistica_House>@limite`);
   return encontrado.recordset.length===1;
  })});
 return async(conta,vinculo,pedido)=>{
  if(permissaoDe(conta.email).papel!=='admin')throw new FalhaPonte('Criação de processos restrita aos administradores durante a homologação.',403);
  if(!ambienteHeadcargo().homologacao)throw new FalhaPonte('Criação disponível apenas na homologação nesta etapa.',403);
  if(pedido.acao==='configuracao')return disponibilidadeCriacao();
  if(pedido.acao==='status')return pedido.id?servico().obter(pedido.id,conta.email):{tarefa:servico().obterPorChave(pedido.chave,conta.email)};
  if(pedido.acao==='criar')return servico().criar(pedido,conta.email,vinculo.usuario);
  if(pedido.acao==='clientes'){
   if(typeof pedido.busca!=='string'||pedido.busca.trim().length<2||pedido.busca.length>100)return {clientes:[]};
   const termo=pedido.busca.trim().replace(/[\[\]%_]/g,c=>`[${c}]`);
   return consulta(async pool=>{const r=await pool.request().input('busca',sql.VarChar(220),`%${termo}%`).query('SELECT TOP 20 P.IdPessoa AS id,P.Nome AS nome FROM cad_Pessoa P JOIN cad_Cliente C ON C.IdPessoa=P.IdPessoa WHERE P.Nome LIKE @busca ORDER BY P.Nome,P.IdPessoa');return {clientes:r.recordset};});
  }
  throw new FalhaPonte('Operação inválida.');
 };
}
