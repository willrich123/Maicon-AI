import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CriacaoProcessos,validarNovoProcesso} from '../server/porte/novoProcesso.js';
const dados={modalidade:'IM',clienteId:10,referencia:'Teste web',chave:'solicitacao-teste-0001'};
function ambiente({executar=async()=>({numero:'IM0001-26'}),verificar=async()=>true}={}){
 const db=new DatabaseSync(':memory:');let execucoes=0;const tarefas=[];
 const config={db,disponibilidade:()=>({disponivel:true}),preparar:async()=>({nome:'Cliente',codigo:'001',limiteHouse:100}),executar:async t=>{execucoes++;return executar(t);},verificar,serializar:fn=>{const r=Promise.resolve().then(fn);tarefas.push(r);return r;}};
 return {db,config,motor:new CriacaoProcessos(config),tarefas,execucoes:()=>execucoes};
}
test('criação valida os dados antes de reservar a sessão nativa',()=>{assert.throws(()=>validarNovoProcesso({...dados,modalidade:'SQL'}),/modalidade/);assert.throws(()=>validarNovoProcesso({...dados,clienteId:'10'}),/cliente/);assert.throws(()=>validarNovoProcesso({...dados,referencia:''}),/referência/);});
test('duplo envio usa a mesma tarefa e sucesso exige conferência posterior',async()=>{const a=ambiente();const [t,r]=await Promise.all([a.motor.criar(dados,'a@teste','usuario'),a.motor.criar(dados,'a@teste','usuario')]);assert.equal(t.id,r.id);await Promise.all(a.tarefas);assert.equal(a.execucoes(),1);assert.equal(a.motor.obter(t.id,'a@teste').estado,'concluida');assert.throws(()=>a.motor.obter(t.id,'outra@teste'),/não encontrada/);assert.equal(t.usuario,undefined);assert.equal(t.limiteHouse,undefined);await assert.rejects(a.motor.criar({...dados,referencia:'Outra'},'a@teste','usuario'),/outros dados/);});
test('resultado incerto não é repetido automaticamente, inclusive após reinício',async()=>{const a=ambiente({verificar:async()=>false});const t=await a.motor.criar(dados,'a@teste','usuario');await Promise.all(a.tarefas);assert.equal(a.motor.obter(t.id,'a@teste').estado,'revisao');const novo=new CriacaoProcessos(a.config);await novo.criar(dados,'a@teste','usuario');assert.equal(a.execucoes(),1);});
test('perfil indisponível não gera uma criação nem chama o executável',async()=>{const a=ambiente();a.motor.disponibilidade=()=>({disponivel:false,motivo:'Controles não validados'});await assert.rejects(a.motor.criar(dados,'a@teste','usuario'),/não validados/);assert.equal(a.execucoes(),0);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM criacoes').get().n,0);});
