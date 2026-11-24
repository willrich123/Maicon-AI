import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {interpretarStorageHeadcargo,baixarStorageHeadcargo} from '../server/porte/storageArquivos.js';
import {arquivosProcesso,descompactarArquivo,nomeSeguroArquivo,tipoConteudoArquivo} from '../server/porte/arquivos.js';
const guid='A1234567-1234-1234-1234-123456789ABC';
const config={base:'https://api.headsoft.com.br/geral/blob-stream',token:'segredo-teste'};
test('configuração considera somente Interface_Menu e valida o serviço',()=>{
 const xml='<Config><Grupo Nome="Outro"><Item Nome="Token_Autenticacao" Valor="errado"/></Grupo><Grupo Nome="Interface_Menu"><Item Nome="Token_Autenticacao" Valor="teste&amp;valor"/></Grupo></Config>';
 assert.equal(interpretarStorageHeadcargo(deflateSync(Buffer.from(xml))).token,'teste&valor');
 assert.equal(interpretarStorageHeadcargo(Buffer.from('<Config/>')),null);
 assert.throws(()=>interpretarStorageHeadcargo(Buffer.from(xml.replace('Nome="Token_Autenticacao" Valor="teste&amp;valor"','Nome="Endereco_Api" Valor="https://outro.invalid"/><Item Nome="Token_Autenticacao" Valor="teste"'))),/não corresponde/);
});
test('download normaliza GUID e não repassa autenticação para a URL assinada',async()=>{
 const chamadas=[];
 const b=await baixarStorageHeadcargo(config,guid,{fetchImpl:async(url,opts)=>{chamadas.push({url:String(url),opts});return chamadas.length===1?new Response(null,{status:302,headers:{location:'https://headcargo.blob.core.windows.net/anexo/teste?sig=temporaria'}}):new Response('%PDF-1.7\nconteudo');}});
 assert.equal(tipoConteudoArquivo(b),'application/pdf');assert.match(chamadas[0].url,/a1234567-1234-1234-1234-123456789abc$/);
 assert.equal(chamadas[0].opts.headers.Authorization,'Bearer segredo-teste');assert.equal(chamadas[1].opts.headers,undefined);assert.equal(chamadas[1].opts.redirect,'manual');
});
test('recusa redirecionamento externo e arquivos acima do limite',async()=>{
 let chamadas=0;await assert.rejects(baixarStorageHeadcargo(config,guid,{fetchImpl:async()=>{chamadas++;return new Response(null,{status:302,headers:{location:'https://outro.invalid/anexo'}});}}),/não autorizado/);assert.equal(chamadas,1);
 await assert.rejects(baixarStorageHeadcargo(config,guid,{limite:3,fetchImpl:async()=>new Response('1234')}),/excede/);
 await assert.rejects(baixarStorageHeadcargo(config,guid,{fetchImpl:async()=>new Response(null,{status:404})}),/não encontrou/);
});
test('conteúdo legado é descompactado e HTML nunca recebe tipo de visualização',()=>{
 const pdf=Buffer.from('%PDF-1.7\nTeste');assert.deepEqual(descompactarArquivo(deflateSync(pdf)),pdf);
 assert.equal(tipoConteudoArquivo(Buffer.from('<html>teste</html>')),'application/octet-stream');
 assert.equal(nomeSeguroArquivo('C:\\documentos\\anexo\r\n.pdf'),'anexo__.pdf');
});
test('arquivo de outro processo é recusado antes de ler o conteúdo ou armazenamento',async()=>{
 const consultas=[];const pool={request(){const parametros={};return {input(k,_t,v){parametros[k]=v;return this;},async query(q){consultas.push({q,parametros});return {recordset:q.includes('FROM mov_Logistica_House H')?[{IdProjeto_Atividade:33}]:[]};}};}};
 await assert.rejects(arquivosProcesso(pool,{numero:'IM0043-26',acao:'conteudo',arquivo:479190},{admin:true}),/não encontrado neste processo/);
 assert.equal(consultas.length,2);assert.equal(consultas[1].parametros.projeto,33);assert.equal(consultas[1].parametros.arquivo,479190);assert.match(consultas[1].q,/P.IdProjeto_Atividade=@projeto AND A.IdArquivo=@arquivo/);
});
