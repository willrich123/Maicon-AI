import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { historicoPrevisoes, localizarCadastro, situarEmbarque } from "../server/porte/mapaEmbarque.js";
import { filtrosDaPergunta, relatorioDaPergunta, simularPrazos } from "../server/porte/analisesOperacionais.js";
import { consultarInteligencia, textoMensagemHeadcargo } from "../server/porte/inteligenciaProcesso.js";
import { arquivosProcesso } from "../server/porte/arquivos.js";

test("checklist mantém a evidência no CSV e aponta para o conteúdo do processo autorizado", async () => {
  const pdf=Buffer.from("%PDF-1.7\nDocumento fictício");
  const pool={request(){
    const params={};
    return {
      input(k,_tipo,v){params[k]=v;return this;},
      async query(sql){
        let recordset;
        if(sql.includes("FROM mov_Logistica_House H")){
          assert.equal(params.numero,"IM0001-26");
          assert.equal(params.pessoa,12);
          recordset=[{IdProjeto_Atividade:33}];
        } else {
          assert.equal(params.projeto,33);
          if(sql.includes("GROUP BY")) recordset=[];
          else if(sql.includes("COUNT_BIG")) recordset=[{Total:3}];
          else if(sql.includes("AS disponivel")) recordset=[
            {id:19,nome:"Draft MBL.pdf",ativo:true,disponivel:1},
            {id:20,nome:"MBL cancelado.pdf",ativo:false,disponivel:1},
            {id:21,nome:"Packing list.pdf",ativo:true,disponivel:0},
          ];
          else {
            assert.equal(params.arquivo,19);
            recordset=sql.includes("AS Conteudo")?[{Conteudo:pdf}]:[{Nome:"Draft MBL.pdf",Tamanho:pdf.length}];
          }
        }
        return {recordset};
      },
    };
  }};
  const numero="IM0001-26",ctx={pessoa:12};
  const checklist=await consultarInteligencia(pool,{acao:"documentos",numero},ctx);
  const documento="Conhecimento marítimo";
  const [evidencia]=checklist.evidencias[documento];
  assert.deepEqual(checklist.evidencias[documento],[{id:19,nome:"Draft MBL.pdf",disponivel:true}]);
  assert.equal(checklist.linhas.find(l=>l.Documento===documento).Evidências,evidencia.nome);
  assert.equal(checklist.evidencias["Packing list"][0].disponivel,false);
  const arquivo=await arquivosProcesso(pool,{acao:"conteudo",numero,arquivo:evidencia.id},ctx);
  assert.equal(arquivo.tipo,"application/pdf");
  assert.deepEqual(arquivo.conteudo,pdf);
});

test("mapa localiza UN/LOCODE e IATA sem adivinhar um local ambíguo", () => {
  const santos=localizarCadastro({nome:"Santos",codigo:"BR SSZ",pais:"BR"},2);
  assert.ok(santos.coords && santos.coords[0] < -23 && santos.coords[1] < -46);
  const aeroporto=localizarCadastro({nome:"Guarulhos",sigla:"GRU",pais:"BR"},1);
  assert.ok(aeroporto.coords && aeroporto.coords[0] < -23);
  assert.equal(localizarCadastro({nome:"Santos",codigo:"BRSSZ",pais:"US"},2).coords,null);
  assert.deepEqual(localizarCadastro({nome:"Santos",pais:"BR"},2).coords,santos.coords);
  assert.equal(localizarCadastro({nome:"Centro logístico"},3).coords,null);
});

test("posição usa apenas o último evento realizado e desconsidera viagens canceladas", () => {
  const porto={nome:"Porto principal",coords:[-23,-46]};
  const agora=Date.parse("2026-11-23T10:00:00Z");
  const trechos=[
    {id:1,embarque:"2026-11-20",desembarque:"2026-11-22",origem:porto,destino:porto},
    {id:2,embarque:"2026-11-23",desembarque:"2026-11-24",origem:porto,destino:porto},
    {id:3,embarque:"2026-11-23",cancelado:true,origem:porto},
    {id:4,embarque:"2026-11-23",ignorado:true,origem:porto},
  ];
  assert.equal(situarEmbarque(trechos,agora).ultimo.id,2);
  assert.equal(situarEmbarque(trechos,agora).ultimo.tipo,"embarque");
  assert.equal(situarEmbarque(trechos,agora).emTransito,true);
  assert.deepEqual(situarEmbarque(trechos,agora).eventos.map(e=>[e.id,e.tipo]),[[2,"embarque"],[1,"desembarque"],[1,"embarque"]]);
  assert.deepEqual(situarEmbarque([{id:5,chegadaPrevista:"2026-11-22"}],agora),{ultimo:null,emTransito:false,eventos:[]});
});

test("histórico compara previsões por trecho e ignora revisões no mesmo dia", () => {
  const trechos=[{id:1,chegadaPrevista:"2026-12-01"},{id:2,chegadaPrevista:"2026-11-28"}];
  const registros=[
    {id:10,idTrecho:1,data:"2026-11-15",chegadaPrevista:"2026-11-25"},
    {id:11,idTrecho:2,data:"2026-11-16",chegadaPrevista:"2026-11-28T18:00:00Z"},
    {id:12,idTrecho:1,data:"2026-11-17",chegadaPrevista:"2026-12-03",saidaPrevista:"2026-11-20"},
  ];
  assert.deepEqual(historicoPrevisoes(trechos,registros).map(r=>[r.idTrecho,r.campo,r.data,r.dias]),[
    [1,"saidaPrevista","2026-11-17",null],[1,"chegadaPrevista","2026-11-17",8],
    [1,"saidaPrevista",null,null],[1,"chegadaPrevista",null,-2],
  ]);
});

test("simulação compara dias corridos e preserva a data do HeadCargo", () => {
  const trechos=[{chegadaPrevista:"2026-11-24T00:00:00Z"},{chegadaPrevista:"2026-11-30",ignorado:true}];
  const resultado=simularPrazos(trechos,[{Marco:"Prazo",Prazo:"2026-11-26"}],3);
  assert.equal(resultado.simulada,"2026-11-27");
  assert.equal(resultado.linhas[0]["Folga atual (dias)"],2);
  assert.equal(resultado.linhas[0]["Folga simulada (dias)"],-1);
  assert.equal(trechos[0].chegadaPrevista,"2026-11-24T00:00:00Z");
  assert.throws(()=>simularPrazos(trechos,[],0),/de 1 a 60/);
});

test("relatório interpreta atraso por cliente, trimestre e modal da pergunta", () => {
  const pergunta="Quais clientes tiveram mais atrasos marítimos no último trimestre?";
  assert.equal(relatorioDaPergunta(pergunta),"atrasos-clientes");
  assert.deepEqual(filtrosDaPergunta({pergunta},"2026-01-15"),{pergunta,modalidade:"M",de:"2025-10-01",ate:"2025-12-31"});
  assert.equal(filtrosDaPergunta({pergunta:"ranking de transportadoras nos últimos 30 dias"},"2026-11-23").de,"2026-10-25");
  assert.throws(()=>relatorioDaPergunta("Mostre qualquer tabela"),/Peça atrasos/);
});

test("busca lê texto compactado e rejeita bytes de formatos binários", () => {
  const texto="Free time: 14 dias";
  assert.equal(textoMensagemHeadcargo(deflateSync(Buffer.from(texto))),texto);
  assert.equal(textoMensagemHeadcargo(Buffer.from([0x00,0x04,0x15,0x23])),"");
});
