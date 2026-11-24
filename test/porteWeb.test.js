import test from "node:test";
import assert from "node:assert/strict";
import { lerDfm } from "../server/porte/dfm.js";
import { catalogoWeb, telaWeb } from "../server/porte/catalogo.js";
import { consultarProcessoWeb, listarProcessosWeb } from "../server/porte/processo.js";

test("DFM recupera campos, Unicode e componentes sem executar módulos", () => {
  const s = v => Buffer.concat([Buffer.from([Buffer.byteLength(v,"latin1")]),Buffer.from(v,"latin1")]);
  const u = v => { const b=Buffer.from(v,"utf16le"), n=Buffer.alloc(4);n.writeUInt32LE(b.length/2);return Buffer.concat([Buffer.from([18]),n,b]); };
  const b=Buffer.concat([Buffer.from("TPF0"),s("TForm"),s("Processo"),s("Caption"),u("Processo marítimo"),Buffer.from([0]),s("TEdit"),s("Numero"),s("DataField"),Buffer.from([6]),s("Numero_Processo"),Buffer.from([0,0,0])]);
  const r=lerDfm(b); assert.equal(r.propriedades.Caption,"Processo marítimo");assert.equal(r.filhos[0].propriedades.DataField,"Numero_Processo");
  assert.throws(()=>lerDfm(b.subarray(0,b.length-2)),/truncado|Limite/);
  assert.throws(()=>lerDfm(Buffer.from("INCORRETO")),/Assinatura/);
});

test("catálogo derivado dos módulos mantém IDs únicos e não aceita caminhos arbitrários", () => {
  const c=catalogoWeb();
  if (!c.fontes) {
    assert.deepEqual(c.modulos, []);
    assert.equal(telaWeb("../../.env"), null);
    return;
  }
  assert.ok(c.modulos.length>0);assert.equal(c.falhas,0);
  const telas=c.modulos.flatMap(m=>m.telas);assert.equal(new Set(telas.map(t=>t.id)).size,telas.length);
  assert.equal(telaWeb("../../.env"),null);
  const processo=c.modulos.find(m=>m.id==="LogisticaInternacional.hsm").telas.find(t=>t.id==="85a57c8363bb5ba8cc6d");
  const t=telaWeb(processo.id); assert.equal(t.modo,"estrutura");assert.ok(t.grupos.flatMap(g=>g.campos).length>0);
  assert.ok(t.grupos.every(g=>g.campos.every(c=>!/password|senha|connection/i.test(c.id))));
  assert.ok(telas.slice(0, 30).flatMap(({id}) => telaWeb(id).acoes).length > 0);
  assert.ok(t.acoes.every(acao => acao.validacao === "estrutura"));
});

test("consulta web preserva todas as atividades e usa apenas SELECT parametrizado", async () => {
  const consultas=[]; const parametros=[];
  const pool={request(){return {input(k,t,v){parametros.push([k,v]);return this;},async query(q){consultas.push(q);return {recordset:consultas.length===1?[{IdProjeto_Atividade:19,Numero_Processo:"IM2099-25",Cliente:"Cliente"}]:Array.from({length:120},(_,i)=>({IdAtividade:i,Situacao:i%7}))};}};}};
  const r=await consultarProcessoWeb(pool,"IM2099-25",{pessoa:23});
  assert.equal(r.atividades.length,120);assert.equal(r.atividades[5].SituacaoTexto,"Não realizada");assert.equal(r.atividades[6].SituacaoTexto,"Cancelada");
  assert.match(consultas[0],/EXISTS.*SELECT 1 FROM mov_Atividade/s);assert.doesNotMatch(consultas.join(" "),/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
  assert.ok(parametros.some(([k,v])=>k==="pessoa"&&v===23));
  await assert.rejects(consultarProcessoWeb(pool,"IM2099-25 teste",{pessoa:23}),/não está disponível/);
  await assert.rejects(consultarProcessoWeb(pool,"IM2099-25",{pessoa:23,modalidade:"IA"}),/modalidade/);
  await assert.rejects(consultarProcessoWeb(pool,"IM2099-25",{}),/não está disponível/);
  await assert.rejects(consultarProcessoWeb(pool,"'; DROP TABLE X",{admin:true}),/válido/);
  assert.equal(consultas.length,2);
});

test("processo sem vínculo visível não permite consultar as atividades", async () => {
  let n=0;const pool={request:()=>({input(){return this;},async query(){n++;return {recordset:[]};}})};
  await assert.rejects(consultarProcessoWeb(pool,"IM2099-25",{pessoa:23}),/sem acesso/);assert.equal(n,1);
});

test('listagem mantém escopo, paginação e busca parametrizada',async()=>{let parametros={},texto='';const pool={request:()=>({input(k,_t,v){parametros[k]=v;return this;},async query(q){texto=q;return{recordset:Array.from({length:51},(_,i)=>({Numero:String(i)}))};}})};const r=await listarProcessosWeb(pool,{busca:'IM%_25',pagina:1},{pessoa:23,modalidade:'IM'});assert.equal(r.linhas.length,50);assert.equal(r.temMais,true);assert.equal(parametros.offset,50);assert.equal(parametros.pessoa,23);assert.equal(parametros.busca,'%IM[%][_]25%');assert.match(texto,/EXISTS/);await assert.rejects(listarProcessosWeb(pool,{},{}),/sem vínculo/);await assert.rejects(listarProcessosWeb(pool,{pagina:-1},{admin:true}),/inválido/);});

test("seis consultas simultâneas preservam os parâmetros de cada usuário", async () => {
  const pool={request(){const args={};return {input(k,_t,v){args[k]=v;return this;},async query(){
    await new Promise(r=>setTimeout(r,(Number(args.pessoa || args.projeto)%3)*2));
    return args.numero ? {recordset:[{Numero_Processo:args.numero,IdProjeto_Atividade:args.pessoa,Cliente:`Conta ${args.pessoa}`}]} : {recordset:[{IdAtividade:args.projeto,Atividade:`Atividade ${args.projeto}`,Situacao:2}]};
  }};}};
  const rs=await Promise.all(Array.from({length:6},(_,i)=>consultarProcessoWeb(pool,`IM200${i}-26`,{pessoa:i+1})));
  rs.forEach((r,i)=>{assert.equal(r.numero,`IM200${i}-26`);assert.equal(r.cliente,`Conta ${i+1}`);assert.equal(r.atividades[0].IdAtividade,i+1);});
});
