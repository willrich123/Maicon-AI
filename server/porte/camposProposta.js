import sql from 'mssql';
import {FalhaPonte} from '../ponte/sessoes.js';

// Liga cada campo ao formulário e ao registro dono do valor. O DFM
// identifica o controle. A edição nativa precisa ser validada no desktop.
export const camposProposta = [
  ['referencia','Proposta','Referência do cliente','Referencia_Cliente',80],
  ['coleta','Embarque / Coleta e entrega','Local de coleta','Local_Coleta',250],
  ['entrega','Embarque / Coleta e entrega','Local de entrega','Local_Entrega',250],
  ['rota','Embarque / Complemento','Rota','Rota',250],
  ['remarks','Remarks','Remarks','Remarks',4000],
  ['remarksTerrestre','Remarks','Remarks terrestre','Remarks_Terrestre',4000],
  ['remarksFreeTime','Remarks','Remarks free time','Remarks_Free_Time',4000],
  ['instrucoesOperacao','Instruções','Instruções operacionais','Instrucoes_Operacional',4000],
  ['instrucoesCliente','Instruções','Instruções ao cliente','Instrucoes_Cliente',4000],
  ['instrucoesAgente','Instruções','Instruções ao agente','Instrucoes_Agente',4000],
  ['instrucoesOperacaoCliente','Instruções','Instruções operacionais ao cliente','Instrucoes_Operacional_Cliente',4000],
  ['observacao','Dados da proposta','Observação da proposta','Observacao',4000,'proposta'],
].map(([id,aba,nome,coluna,maximo,registro='oferta'])=>({id,aba,nome,coluna,maximo,registro}));

export async function prepararCamposProposta(req, pedido, registro, recorteOferta) {
  const {IdProposta_Frete,Proposta,Versão}=registro;
  const ofertas=await req().input('id',sql.Int,IdProposta_Frete).query(`
    SELECT TOP 101 O.IdOferta_Frete AS chave,O.Numero_Oferta AS numero FROM mov_Oferta_Frete O
    WHERE O.IdProposta_Frete=@id AND ${recorteOferta} ORDER BY O.IdOferta_Frete DESC`);
  if (ofertas.recordset.length>100) throw new FalhaPonte('Selecione uma proposta com até 100 ofertas para preparar os campos.',422);
  const oferta=pedido.oferta;
  if (oferta!=null && !ofertas.recordset.some(o=>o.chave===oferta))
    throw new FalhaPonte('A oferta não pertence à versão selecionada ou está fora do seu acesso.',404);
  const colunas=camposProposta.filter(c=>c.registro==='oferta').map(c=>`CONVERT(nvarchar(max),O.[${c.coluna}]) AS [${c.id}]`).join(',');
  const dadosOferta=oferta==null?null:(await req().input('id',sql.Int,IdProposta_Frete).input('oferta',sql.Int,oferta).query(`
    SELECT ${colunas} FROM mov_Oferta_Frete O
    WHERE O.IdOferta_Frete=@oferta AND O.IdProposta_Frete=@id AND ${recorteOferta}`)).recordset[0];
  if(oferta!=null&&!dadosOferta)throw new FalhaPonte('A oferta deixou de estar disponível. Abra novamente a proposta.',404);
  return {
    proposta:Proposta,versao:Versão,ofertas:ofertas.recordset,
    campos:camposProposta.filter(c=>c.registro==='proposta'||dadosOferta).map(({coluna,...c})=>({
      ...c,atual:c.registro==='proposta'?registro['Observação']:dadosOferta[c.id],
    })),
    gravacaoValidada:false,
  };
}
