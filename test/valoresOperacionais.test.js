import test from 'node:test';import assert from 'node:assert/strict';
import {nomesOperacionais,valorCampoLivre} from '../server/porte/valores.js';
test('opções fixas são resolvidas na configuração do próprio campo, preservando zero e falso',()=>{
 assert.equal(valorCampoLivre({Tipo_Valor:4,Valor_Tipo_Fixo:0,Itens:'0=Não iniciado\n2=Enviado'}),'Não iniciado');
 assert.equal(valorCampoLivre({Tipo_Valor:4,Valor_Tipo_Fixo:2,Itens:'2=Outra opção'}),'Outra opção');
 assert.equal(valorCampoLivre({Tipo_Valor:4,Valor_Tipo_Fixo:9,Itens:'2=Enviado'}),'Descrição da opção não disponível');
 assert.equal(valorCampoLivre({Tipo_Valor:3,Valor_Boleano:false}),false);
 assert.equal(valorCampoLivre({Tipo_Valor:5,Valor_Inteiro:0}),0);
});
test('cadastros resolvem apenas os IDs da página autorizada e validam o esquema',async()=>{
 const consultas=[];
 const pool={request(){const params={};return {input(k,t,v){params[k]=v;return this;},async query(q){consultas.push({q,params});if(q.includes('sys.tables'))return {recordset:[{Tabela:'cad_Pessoa',Coluna:'IdPessoa'},{Tabela:'cad_Pessoa',Coluna:'Nome'},{Tabela:'cad_Incoterm',Coluna:'IdIncoterm'},{Tabela:'cad_Incoterm',Coluna:'Sigla'}]};return {recordset:q.includes('[cad_Pessoa]')?[{Id:7,Nome:'Cliente'}]:[{Id:3,Nome:'FOB'}]};}};}};
 const r=await nomesOperacionais(pool,[{Coluna:'IdCliente'},{Coluna:'IdIncoterm'},{Coluna:'IdDesconhecido'}],[{IdCliente:7,IdIncoterm:3,IdDesconhecido:42}]);
 assert.deepEqual(r,{IdCliente:{7:'Cliente'},IdIncoterm:{3:'FOB'}});
 assert.deepEqual(consultas.filter(c=>!c.q.includes('sys.tables')).map(c=>c.params),[{r0:7},{r0:3}]);
 assert.ok(!consultas.some(c=>c.q.includes('[cad_Desconhecido]')));
});
