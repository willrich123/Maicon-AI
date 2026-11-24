export function rotuloOperacional(id:string,original:string){
 const basico:Record<string,string>={Numero_Processo:'Número do processo',Referencia_Cliente:'Referência do cliente',Referencia_Interna:'Referência interna',Data_Abertura_Processo:'Abertura do processo',Data_Prontidao_Carga:'Prontidão da carga',Peso_Bruto:'Peso bruto',Peso_Liquido:'Peso líquido',Peso_Cubado:'Peso cubado',Quantidade_Volumes:'Volumes',Metros_Cubicos:'Volume (m³)',Instrucoes_Cliente:'Instruções do cliente',Instrucoes_Agente:'Instruções ao agente',Instrucoes_Operacional_Cliente:'Orientações operacionais',Carga_Perigosa:'Carga perigosa'};
 return basico[id]||original.replace(/^Código /,'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
}
export function grupoOperacional(id:string,tecnico=false){
 if(tecnico)return 'Informações técnicas';
 if(/instruc|observ|remarks|shipper|consignee|notify$/i.test(id))return 'Instruções e observações';
 if(/data_|previsao|prazo|vencimento/i.test(id))return 'Datas e prazos';
 if(/^Id|cliente|importador|exportador|vendedor|agente|representante|companhia/i.test(id))return 'Envolvidos';
 if(/peso|carga|volume|container|embalag|metro|rota|trecho|porto|frete|viagem/i.test(id))return 'Carga e transporte';
 if(/situacao|tipo_|ativo|seguro|agenciamento|consolidado|desembaraco|demurrage|faturas|comissao/i.test(id))return 'Situações e opções';
 return 'Identificação e detalhes';
}
export function valorOperacional(v:unknown,tipo:string){
 if(v===null||v===undefined||v==='')return '—';
 if(typeof v==='boolean')return v?'Sim':'Não';
 if(tipo==='bit')return v===true||v===1||v==='1'?'Sim':'Não';
 if(typeof v==='string'&&(/date|time/i.test(tipo)||/^\d{4}-\d{2}-\d{2}T\d{2}:/.test(v))&&!Number.isNaN(Date.parse(v))){const temHora=!/T00:00:00/.test(v)&&tipo!=='date';return new Date(v).toLocaleString('pt-BR',{timeZone:'UTC',dateStyle:'short',...(temHora?{timeStyle:'short' as const}:{})});}
 if(typeof v==='number')return v.toLocaleString('pt-BR',{maximumFractionDigits:8});
 return String(v);
}
export function mesclarNomesOperacionais(a:Record<string,Record<string,string>>={},b:Record<string,Record<string,string>>={}){
 const resultado={...a};for(const campo of Object.keys(b))resultado[campo]={...a[campo],...b[campo]};return resultado;
}
export function exibirValorOperacional(v:unknown,campo:{id:string;tipo:string},nomes?:Record<string,string>){
 if(v===null||v===undefined||v==='')return '—';
 const nome=nomes?.[String(v)];if(nome)return nome;
 if(/^Id[A-Z_]/.test(campo.id))return 'Nome não disponível';
 // Mesmos valores já usados nos documentos e consultas operacionais do Maicon.
 const opcoes:Record<string,Record<string,string>>={Tipo_Carga:{1:'Aéreo',2:'LCL',3:'FCL'},Modalidade_Pagamento:{0:'Collect',1:'Prepaid',2:'Prepaid abroad',3:'Collect abroad',4:'Outro'}};
 const opcao=opcoes[campo.id]?.[String(v)];if(opcao)return opcao;
 if((typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&/^(Tipo_|Situacao(?:_|$)|Modalidade_|Encaminhado_Por$|Trecho$|Valor_Tipo_Fixo$)/i.test(campo.id))return 'Descrição não disponível';
 return valorOperacional(v,campo.tipo);
}
