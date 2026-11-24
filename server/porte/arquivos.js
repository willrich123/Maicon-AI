import sql from 'mssql';
import {processoAutorizado} from './processo.js';
import {FalhaPonte} from '../ponte/sessoes.js';
import {configuracaoStorageHeadcargo,baixarStorageHeadcargo} from './storageArquivos.js';
import {inflateSync} from 'node:zlib';
const limite=50*1024*1024;
const vinculos=`FROM mov_Projeto_Atividade_Arquivo P JOIN arq_Arquivo A ON A.IdArquivo=P.IdArquivo LEFT JOIN cad_Arquivo_Grupo G ON G.IdArquivo_Grupo=A.IdArquivo_Grupo LEFT JOIN arq_Dados_Arquivo D ON D.IdDados_Arquivo=A.IdDados_Arquivo`;
const tamanho=`CASE WHEN DATALENGTH(D.Dados)>0 THEN CONVERT(bigint,DATALENGTH(D.Dados)) WHEN DATALENGTH(A.Dados_Arquivo)>0 THEN CONVERT(bigint,DATALENGTH(A.Dados_Arquivo)) ELSE D.Tamanho END`;
export function nomeSeguroArquivo(nome){return String(nome||'anexo').replace(/^.*[\\/]/,'').replace(/[\x00-\x1f\x7f"<>:|?*]/g,'_').slice(0,180)||'anexo';}
export function tipoConteudoArquivo(b){
 if(b.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if(/^GIF8[79]a/.test(b.subarray(0,6).toString()))return 'image/gif';
 if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp';
 return 'application/octet-stream';
}
export function descompactarArquivo(b){
 if(b[0]!==0x78||![0x01,0x5e,0x9c,0xda].includes(b[1]))return b;
 try{return inflateSync(b,{maxOutputLength:limite});}catch(e){throw new FalhaPonte(e.code==='ERR_BUFFER_TOO_LARGE'?'O anexo descompactado excede o limite de 50 MB.':'O conteúdo do anexo não pôde ser descompactado.',e.code==='ERR_BUFFER_TOO_LARGE'?413:422);}
}
export async function arquivosProcesso(pool,pedido,ctx){
 const h=await processoAutorizado(pool,pedido.numero,ctx);
 const req=()=>pool.request().input('projeto',sql.Int,h.IdProjeto_Atividade);
 if(pedido.acao==='conteudo'){
  const id=Number(pedido.arquivo);if(!Number.isSafeInteger(id)||id<=0)throw new FalhaPonte('Anexo inválido.');
  const meta=await req().input('arquivo',sql.Int,id).query(`SELECT TOP 1 A.Nome,D.Storage,D.GUID,${tamanho} AS Tamanho ${vinculos} WHERE P.IdProjeto_Atividade=@projeto AND A.IdArquivo=@arquivo`);
  if(!meta.recordset.length)throw new FalhaPonte('Anexo não encontrado neste processo.',404);
  if(Number(meta.recordset[0].Tamanho)>limite)throw new FalhaPonte('Este anexo excede o limite de 50 MB para abertura no portal. Abra-o no HeadCargo.',413);
  if(meta.recordset[0].Storage){const cfg=await configuracaoStorageHeadcargo(pool);const conteudo=await baixarStorageHeadcargo(cfg,meta.recordset[0].GUID);return {conteudo,nome:nomeSeguroArquivo(meta.recordset[0].Nome),tipo:tipoConteudoArquivo(conteudo)};}
  const r=await req().input('arquivo',sql.Int,id).query(`SELECT TOP 1 CASE WHEN DATALENGTH(D.Dados)>0 THEN D.Dados ELSE CONVERT(varbinary(max),A.Dados_Arquivo) END AS Conteudo ${vinculos} WHERE P.IdProjeto_Atividade=@projeto AND A.IdArquivo=@arquivo AND ${tamanho}<=${limite}`);
  let conteudo=r.recordset[0]?.Conteudo;
  if(!Buffer.isBuffer(conteudo)||!conteudo.length)throw new FalhaPonte('O conteúdo deste anexo não está no banco consultado. Ele pode estar em um armazenamento externo do HeadCargo.',404);
  if(conteudo.length>limite)throw new FalhaPonte('Anexo maior que o limite permitido.',413);
  conteudo=descompactarArquivo(conteudo);
  return {conteudo,nome:nomeSeguroArquivo(meta.recordset[0].Nome),tipo:tipoConteudoArquivo(conteudo)};
 }
 const pagina=pedido.pagina??0;if(!Number.isSafeInteger(pagina)||pagina<0||pagina>100000)throw new FalhaPonte('Página inválida.');
 const busca=String(pedido.busca||'').trim();if(busca.length>120)throw new FalhaPonte('Pesquisa muito longa.');
 const grupo=pedido.grupo??'todos';if(grupo!=='todos'&&grupo!=='sem-grupo'&&(!Number.isSafeInteger(Number(grupo))||Number(grupo)<=0))throw new FalhaPonte('Grupo inválido.');
 const grupos=await req().query(`SELECT A.IdArquivo_Grupo AS id,COALESCE(G.Nome,'Sem grupo') AS nome,COUNT_BIG(*) AS total ${vinculos} WHERE P.IdProjeto_Atividade=@projeto GROUP BY A.IdArquivo_Grupo,G.Nome ORDER BY G.Nome`);
 const filtro=`P.IdProjeto_Atividade=@projeto AND (A.Nome LIKE @busca OR A.Descricao LIKE @busca)${grupo==='todos'?'':grupo==='sem-grupo'?' AND A.IdArquivo_Grupo IS NULL':' AND A.IdArquivo_Grupo=@grupo'}`;
 const requisicao=()=>{const r=req().input('busca',sql.VarChar(250),'%'+busca.replace(/[\[\]%_]/g,c=>`[${c}]`)+'%');if(grupo!=='todos'&&grupo!=='sem-grupo')r.input('grupo',sql.Int,Number(grupo));return r;};
 const total=await requisicao().query(`SELECT COUNT_BIG(*) AS Total ${vinculos} WHERE ${filtro}`);
  const lista=await requisicao().input('offset',sql.Int,pagina*30).query(`SELECT A.IdArquivo AS id,A.Nome AS nome,A.Descricao AS descricao,COALESCE(G.Nome,'Sem grupo') AS grupo,A.Data_Criacao AS criadoEm,A.Data_Arquivo AS dataArquivo,A.Ativo AS ativo,${tamanho} AS tamanho,CASE WHEN DATALENGTH(D.Dados)>0 OR DATALENGTH(A.Dados_Arquivo)>0 OR (D.Storage=1 AND D.GUID IS NOT NULL) THEN 1 ELSE 0 END AS disponivel ${vinculos} WHERE ${filtro} ORDER BY A.Data_Criacao DESC,A.IdArquivo DESC OFFSET @offset ROWS FETCH NEXT 30 ROWS ONLY`);
 const quantidade=Number(total.recordset[0].Total);
 return {grupos:grupos.recordset.map(g=>({...g,total:Number(g.total)})),arquivos:lista.recordset.map(a=>({...a,nome:nomeSeguroArquivo(a.nome),tamanho:a.tamanho==null?null:Number(a.tamanho),disponivel:Boolean(a.disponivel)})),total:quantidade,pagina,temMais:(pagina+1)*30<quantidade};
}
