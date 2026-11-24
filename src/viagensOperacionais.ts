export type RegistroViagem=Record<string,unknown>;
export function meioViagem(l:RegistroViagem,numero:string):'navio'|'aviao'|'caminhao'{
 const m=Number(l.Modalidade_Transporte);if(m===1)return 'aviao';if(m===2)return 'navio';if(m===3||m===4)return 'caminhao';
 return /^(IA|EA)/i.test(numero)?'aviao':/^(IT|ET)/i.test(numero)?'caminhao':'navio';
}
const dia=(v:unknown)=>{if(!v)return null;const t=Date.parse(String(v));return Number.isFinite(t)?Math.floor(t/86400000):null;};
export function estadoViagem(l:RegistroViagem,hoje=new Date()){
 if(Number(l.Situacao_Embarque)===9)return {chave:'cancelada',texto:'Cancelada'};
 if(dia(l.Data_Desembarque)!==null)return {chave:'concluida',texto:'Desembarque realizado'};
 const chegada=dia(l.Data_Previsao_Desembarque),saida=dia(l.Data_Previsao_Embarque),agora=dia(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(hoje))!;
 if(dia(l.Data_Embarque)!==null)return chegada!==null&&chegada<agora?{chave:'atencao',texto:'Chegada prevista vencida'}:{chave:'transito',texto:'Em trânsito'};
 if(saida!==null&&saida<agora)return {chave:'atencao',texto:'Saída prevista vencida'};
 return {chave:'prevista',texto:'Aguardando embarque'};
}
export function papelViagem(l:RegistroViagem,indice:number,aereo=false){
 const t=Number(l.Tipo_Viagem);if(t===1||t===2)return 'Coleta';if(t===6)return 'Entrega';if(t===7||t===8)return 'Pós-embarque';
 return indice===0?'Embarque inicial':aereo?'Escala':'Transbordo';
}
export function diferencaDatas(prevista:unknown,real:unknown){const p=dia(prevista),r=dia(real);return p===null||r===null?null:r-p;}
export function ordenarViagens(linhas:RegistroViagem[]){return [...linhas].sort((a,b)=>Number(a.Sequencia??9999)-Number(b.Sequencia??9999)||(dia(a.Data_Previsao_Embarque)??Infinity)-(dia(b.Data_Previsao_Embarque)??Infinity)||Number(a.IdLogistica_Viagem)-Number(b.IdLogistica_Viagem));}
