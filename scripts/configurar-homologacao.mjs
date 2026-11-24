import fs from 'node:fs';
import path from 'node:path';
import {DIRETORIO_HOMOLOGACAO,ambienteHeadcargo,lerDestinoDcnHeadcargo,verificarDestinoNativoHeadcargo} from '../server/ambienteHeadcargo.js';
const origemSql=path.resolve(DIRETORIO_HOMOLOGACAO,'Conline - Homologação');
const indice=process.argv.indexOf('--executavel');
if(indice>=0&&!process.argv[indice+1])throw new Error('Informe o executável após --executavel.');
const exe=path.resolve(indice>=0?process.argv[indice+1]:path.join(origemSql,'Desktop.exe'));
const raiz=path.resolve(DIRETORIO_HOMOLOGACAO);
ambienteHeadcargo({HC_AMBIENTE:'homologacao',HC_HOMOLOG_DIRETORIO:raiz,HC_EXECUTAVEL:exe});
if(!fs.existsSync(exe))throw new Error('Executável de homologação não encontrado.');
// Ler apenas o destino, nunca copiar as chaves Password/Users/SaveData do DCN.
const {banco,servidor,instancia,porta}=lerDestinoDcnHeadcargo(fs.readFileSync(path.join(origemSql,'server.dcn'),'utf8'));
const arquivo=path.resolve('.env');let texto=fs.readFileSync(arquivo,'utf8');
const anterior=texto.match(/^SQL_DATABASE\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g,'');if(anterior?.toLowerCase()===banco.toLowerCase())throw new Error('O banco indicado coincide com o destino SQL anterior. Revisão necessária.');
const novos={HC_AMBIENTE:'homologacao',HC_EXECUTAVEL:exe.replaceAll('\\','/'),HC_HOMOLOG_DIRETORIO:raiz.replaceAll('\\','/'),HC_HOMOLOG_SQL_SERVER:servidor,HC_HOMOLOG_SQL_INSTANCE:instancia,HC_HOMOLOG_SQL_PORT:porta,HC_HOMOLOG_SQL_DATABASE:banco};
verificarDestinoNativoHeadcargo({...novos,SQL_DATABASE:anterior});
for(const [k,v]of Object.entries(novos)){const linha=k+'='+v;const re=new RegExp('^'+k+'=.*$','m');texto=re.test(texto)?texto.replace(re,()=>linha):texto.replace(/\s*$/,'')+'\n'+linha+'\n';}
fs.writeFileSync(arquivo,texto);
console.log(JSON.stringify({configurado:true,ambiente:'homologacao',executavelEncontrado:true,destinoLidoDoDCN:true,senhaDoHeadCargoCopiada:false}));
