import test from 'node:test';import assert from 'node:assert/strict';
import {ambienteHeadcargo,destinoSqlHeadcargo,destinoSqlPrincipal,verificarDestinoNativoHeadcargo} from '../server/ambienteHeadcargo.js';
const base={HC_HOMOLOG_DIRETORIO:'C:/Teste/Downloads/HeadCargo - Homologação',HC_AMBIENTE:'homologacao',HC_HOMOLOG_SQL_SERVER:'homol-servidor',HC_HOMOLOG_SQL_DATABASE:'HeadCARGO_TESTE_HOMOLOGACAO',SQL_DATABASE:'HeadCARGO_TESTE',SQL_USER:'leitura',SQL_PASSWORD:'valor-apenas-fixture'};
test('Maicon mantém o banco principal quando portal e bot usam homologação', () => {
 const env={...base,SQL_SERVER:'principal',HC_HOMOLOG_SQL_USER:'leitura-homol'};
 assert.equal(destinoSqlPrincipal(env).servidor,'principal');
 assert.equal(destinoSqlPrincipal(env).banco,env.SQL_DATABASE);
 assert.equal(destinoSqlPrincipal(env).usuario,env.SQL_USER);
 assert.equal(destinoSqlHeadcargo(env).servidor,'homol-servidor');
 assert.equal(destinoSqlHeadcargo(env).banco,env.HC_HOMOLOG_SQL_DATABASE);
 assert.equal(destinoSqlHeadcargo(env).usuario,env.HC_HOMOLOG_SQL_USER);
});
test('homologação não retorna ao banco de produção quando falta configuração',()=>{assert.throws(()=>destinoSqlHeadcargo({HC_AMBIENTE:'homologacao',SQL_DATABASE:'producao'}),/Não há retorno/);assert.throws(()=>destinoSqlHeadcargo({...base,HC_HOMOLOG_SQL_DATABASE:base.SQL_DATABASE}),/distintos/);assert.equal(destinoSqlHeadcargo(base).banco,base.HC_HOMOLOG_SQL_DATABASE);});
test('alvo de homologação não pode apontar ao executável instalado de produção',()=>{assert.throws(()=>ambienteHeadcargo({...base,HC_EXECUTAVEL:'C:/Program Files (x86)/HeadCargo Conline/Desktop.exe'}),/fora/);const a=ambienteHeadcargo({...base,HC_EXECUTAVEL:'C:/Teste/Downloads/HeadCargo - Homologação/Conline - Homologação/Desktop.exe'});assert.equal(a.homologacao,true);assert.ok(a.executavel.includes('Downloads'));});
test('aceita o executável renomeado HOMO apenas dentro da instalação autorizada',()=>{
 const a=ambienteHeadcargo({...base,HC_EXECUTAVEL:'C:/Teste/Downloads/HeadCargo - Homologação/Homologação.exe'});
 assert.match(a.executavel,/Homologação\.exe$/);
 assert.throws(()=>ambienteHeadcargo({...base,HC_EXECUTAVEL:'C:/Teste/Downloads/Outra pasta/Homologação.exe'}),/fora/);
 assert.throws(()=>ambienteHeadcargo({...base,HC_EXECUTAVEL:'C:/Teste/Downloads/HeadCargo - Homologação/Update.exe'}),/fora/);
});
test('gravação exige o destino no arquivo adjacente ao executável nativo', () => {
 const env={...base,HC_EXECUTAVEL:'C:/homo/interna/Desktop.exe',HC_HOMOLOG_DIRETORIO:'C:/homo',
  HC_HOMOLOG_SQL_INSTANCE:'teste',HC_HOMOLOG_SQL_PORT:'1437'};
 const dcn=(banco,servidor='homol-servidor')=>`[Server]\r\nData Source=tcp:${servidor}\\teste,1437\r\nInitial Catalog=${banco}`;
 const ler=arquivo=>{
   assert.equal(arquivo,'C:\\homo\\interna\\server.dcn');
   return dcn(env.HC_HOMOLOG_SQL_DATABASE);
 };
 assert.equal(verificarDestinoNativoHeadcargo(env,ler).banco,env.HC_HOMOLOG_SQL_DATABASE);
 assert.throws(()=>verificarDestinoNativoHeadcargo(env,()=>dcn('OutroBanco')),/não corresponde/);
 assert.throws(()=>verificarDestinoNativoHeadcargo(env,()=>dcn(env.HC_HOMOLOG_SQL_DATABASE,'outro-servidor')),/não corresponde/);
 assert.throws(()=>verificarDestinoNativoHeadcargo(env,()=>dcn(env.HC_HOMOLOG_SQL_DATABASE)+'\nInitial Catalog=outro'),/mais de um/);
 assert.throws(()=>verificarDestinoNativoHeadcargo({...env,HC_AMBIENTE:'producao'},ler),/apenas em homologação/);
});
