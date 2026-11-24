import sql from 'mssql';

const cache=new WeakMap();
const pessoas=new Set(['IdPessoa','IdCliente','IdImportador','IdExportador','IdNotify','IdDespachante_Aduaneiro','IdVendedor','IdRepresentante','IdRepresentante_Destino','IdTransportadora_Origem','IdTransportadora_Destino','IdCompanhia_Transporte','IdAgencia_Maritima_Aerea','IdAgente_Origem','IdAgente_Destino','IdResponsavel','IdIndicacao','IdSeguradora','IdAssociacao_Internacional','IdTerminal_Atracacao','IdTerminal_Redestinacao']);
const identificador=n=>{if(!/^[A-Za-z_]\w{0,127}$/.test(n))throw new Error('Identificador inválido.');return `[${n}]`;};
export function destinoReferencia(campo){
 if(pessoas.has(campo))return {tabela:'cad_Pessoa',chave:'IdPessoa'};
 if(/^IdMoeda(?:_|$)/.test(campo))return {tabela:'cad_Moeda',chave:'IdMoeda'};
 if(['IdOrigem','IdDestino','IdPorto_Transbordo','IdPorto_Desembarque'].includes(campo))return {tabela:'cad_Origem_Destino',chave:'IdOrigem_Destino'};
 // Somente a correspondência exata com o cadastro; não escolher tabelas por semelhança.
 if(/^Id[A-Z]/.test(campo))return {tabela:`cad_${campo.slice(2)}`,chave:campo};
 return null;
}
async function esquemaReferencias(pool){
 const anterior=cache.get(pool);if(anterior&&Date.now()-anterior.quando<300000)return anterior.colunas;
 const r=await pool.request().query(`SELECT T.name AS Tabela,C.name AS Coluna FROM sys.tables T JOIN sys.schemas S ON S.schema_id=T.schema_id JOIN sys.columns C ON C.object_id=T.object_id WHERE S.name='dbo' AND T.name LIKE 'cad[_]%' AND (C.name LIKE 'Id%' OR C.name IN ('Nome','Descricao','Sigla'))`);
 cache.set(pool,{quando:Date.now(),colunas:r.recordset});return r.recordset;
}
export async function nomesOperacionais(pool,colunas,linhas){
 const referencias=colunas.map(c=>({campo:c.Coluna,...destinoReferencia(c.Coluna)})).filter(c=>c.tabela);
 if(!referencias.length||!linhas.length)return {};
 const esquema=await esquemaReferencias(pool),grupos=new Map(),nomes={};
 for(const r of referencias){
  const campos=esquema.filter(c=>c.Tabela===r.tabela).map(c=>c.Coluna);
  const rotulo=(r.tabela==='cad_Moeda'?['Sigla','Nome','Descricao']:['Nome','Descricao','Sigla']).find(n=>campos.includes(n));
  if(!campos.includes(r.chave)||!rotulo)continue;
  const chave=`${r.tabela}/${r.chave}/${rotulo}`;
  if(!grupos.has(chave))grupos.set(chave,{...r,rotulo,campos:[],ids:new Set()});
  const g=grupos.get(chave);g.campos.push(r.campo);
  for(const l of linhas){const id=Number(l[r.campo]);if(Number.isSafeInteger(id)&&id>0&&id<=2147483647)g.ids.add(id);}
 }
 for(const g of grupos.values()){
  const ids=[...g.ids];if(!ids.length)continue;
  const req=pool.request();ids.forEach((id,i)=>req.input(`r${i}`,sql.Int,id));
  const r=await req.query(`SELECT ${identificador(g.chave)} AS Id,${identificador(g.rotulo)} AS Nome FROM [dbo].${identificador(g.tabela)} WHERE ${identificador(g.chave)} IN (${ids.map((_,i)=>`@r${i}`).join(',')})`);
  const mapa=Object.fromEntries(r.recordset.filter(l=>String(l.Nome??'').trim()).map(l=>[l.Id,String(l.Nome).trim()]));
  for(const campo of g.campos)if(Object.keys(mapa).length)nomes[campo]=mapa;
 }
 return nomes;
}
export function valorCampoLivre(linha){
 switch(Number(linha.Tipo_Valor)){
  case 1:return linha.Valor_Alfanumerico;
  case 2:return linha.Valor_Texto;
  case 3:return linha.Valor_Boleano==null?null:Boolean(linha.Valor_Boleano);
  case 4:{const itens=new Map(String(linha.Itens??'').split(/\r?\n/).flatMap(s=>{const m=s.match(/^\s*(\d+)\s*=\s*(.+?)\s*$/);return m?[[m[1],m[2]]]:[];}));return linha.Valor_Tipo_Fixo==null?null:itens.get(String(linha.Valor_Tipo_Fixo))||'Descrição da opção não disponível';}
  case 5:return linha.Valor_Inteiro;
  case 6:return linha.Valor_Data;
  case 7:return linha.Valor_Real4;
  default:return 'Formato de campo não disponível';
 }
}
export async function camposLivresOperacionais(pool,house,pagina){
 const req=()=>pool.request().input('house',sql.Int,house);
 const total=await req().query('SELECT COUNT_BIG(*) AS Total FROM mov_Logistica_Campo_Livre WHERE IdLogistica_House=@house');
 const r=await req().input('offset',sql.Int,pagina*50).query(`SELECT Cfg.Descricao AS Campo,Cfg.Tipo_Valor,CAST(Cfg.Itens AS nvarchar(max)) AS Itens,
 Mcl.Valor_Alfanumerico,CAST(Mcl.Valor_Texto AS nvarchar(max)) AS Valor_Texto,Mcl.Valor_Boleano,Mcl.Valor_Tipo_Fixo,Mcl.Valor_Inteiro,Mcl.Valor_Data,Mcl.Valor_Real4
 FROM mov_Logistica_Campo_Livre Lcl JOIN mov_Campo_Livre Mcl ON Mcl.IdCampo_Livre=Lcl.IdCampo_Livre
 JOIN cad_Configuracao_Campo_Livre Cfg ON Cfg.IdConfiguracao_Campo_Livre=Mcl.IdConfiguracao_Campo_Livre
 WHERE Lcl.IdLogistica_House=@house ORDER BY Cfg.Descricao,Lcl.IdCampo_Livre OFFSET @offset ROWS FETCH NEXT 50 ROWS ONLY`);
 const quantidade=Number(total.recordset[0].Total);
 return {titulo:'Campos livres',colunas:[{id:'Campo',rotulo:'Campo',tipo:'nvarchar'},{id:'Valor',rotulo:'Valor',tipo:'nvarchar'}],linhas:r.recordset.map(l=>({Campo:l.Campo,Valor:valorCampoLivre(l)})),total:quantidade,pagina,temMais:(pagina+1)*50<quantidade};
}
