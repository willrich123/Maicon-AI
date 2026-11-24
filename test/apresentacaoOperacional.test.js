import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
const fonte=readFileSync(new URL('../src/apresentacaoOperacional.ts',import.meta.url),'utf8');
const {code}=await transform(fonte,{loader:'ts',format:'esm'});
const {valorOperacional,grupoOperacional,rotuloOperacional,exibirValorOperacional,mesclarNomesOperacionais}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('dados operacionais usam datas locais, booleanos e números legíveis',()=>{assert.equal(valorOperacional(false,'Flag'),'Não');assert.equal(valorOperacional(true,'Flag'),'Sim');assert.equal(valorOperacional('0','bit'),'Não');assert.equal(valorOperacional(1234.56,'decimal'),'1.234,56');assert.match(valorOperacional('2026-11-18T10:52:16.000Z','DataHora'),/18\/11\/2026/);assert.doesNotMatch(valorOperacional('2026-11-18T00:00:00.000Z','Data'),/T|Z|00:00/);});
test('campos são agrupados por significado e identificadores são separados',()=>{assert.equal(grupoOperacional('IdLogistica_House',true),'Informações técnicas');assert.equal(grupoOperacional('IdCliente',false),'Envolvidos');assert.equal(grupoOperacional('Peso_Bruto'),'Carga e transporte');assert.equal(grupoOperacional('Instrucoes_Cliente'),'Instruções e observações');assert.equal(rotuloOperacional('Data_Abertura_Processo','Data Abertura Processo'),'Abertura do processo');});
test('células não apresentam IDs nem inventam descrições para códigos desconhecidos',()=>{
 assert.equal(exibirValorOperacional(7,{id:'IdCliente',tipo:'int'},{7:'Cliente A'}),'Cliente A');
 assert.equal(exibirValorOperacional(8,{id:'IdCliente',tipo:'int'},{7:'Cliente A'}),'Nome não disponível');
 assert.equal(exibirValorOperacional(99,{id:'Tipo_Servico',tipo:'int'}),'Descrição não disponível');
 assert.equal(exibirValorOperacional(3,{id:'Tipo_Carga',tipo:'int'}),'FCL');
 assert.equal(exibirValorOperacional(120,{id:'Quantidade_Volumes',tipo:'int'}),'120');
});
test('Ver mais preserva os nomes dos registros já exibidos',()=>{
 assert.deepEqual(mesclarNomesOperacionais({IdCliente:{1:'Primeiro'}},{IdCliente:{2:'Segundo'}}),{IdCliente:{1:'Primeiro',2:'Segundo'}});
});
