import path from 'node:path';
import { readFileSync } from 'node:fs';
export const DIRETORIO_HOMOLOGACAO=path.join(process.env.USERPROFILE || process.cwd(),'Downloads','HeadCargo - Homologação');
export function ambienteHeadcargo(env=process.env){
 const homologacao=env.HC_AMBIENTE==='homologacao';
 const raiz=path.win32.resolve(env.HC_HOMOLOG_DIRETORIO||DIRETORIO_HOMOLOGACAO);
 const executavel=path.win32.resolve(env.HC_EXECUTAVEL||(homologacao?path.win32.join(raiz,'Homologação.exe'):'C:/Program Files (x86)/HeadCargo Conline/Desktop.exe'));
 const relativo=path.win32.relative(raiz,executavel);
 if(homologacao&&(relativo.startsWith('..')||path.win32.isAbsolute(relativo)||!['homologação.exe','desktop.exe'].includes(path.win32.basename(executavel).toLowerCase())))throw new Error('Executável fora da instalação de homologação configurada.');
 return {homologacao,executavel,raiz};
}
export function destinoSqlPrincipal(env=process.env){
 return {servidor:env.SQL_SERVER,banco:env.SQL_DATABASE,usuario:env.SQL_USER,senha:env.SQL_PASSWORD,instancia:env.SQL_INSTANCE,porta:env.SQL_PORT};
}
export function destinoSqlHeadcargo(env=process.env){
 const ambiente=ambienteHeadcargo(env);
 if(!ambiente.homologacao)return destinoSqlPrincipal(env);
 const banco=String(env.HC_HOMOLOG_SQL_DATABASE||'').trim();
 if(!env.HC_HOMOLOG_SQL_SERVER||!banco||!/homolog|test|hml/i.test(banco)||banco.toLowerCase()===String(env.SQL_DATABASE||'').trim().toLowerCase())throw new Error('Configure um servidor e banco de homologação distintos da produção. Não há retorno automático para produção.');
 return {servidor:env.HC_HOMOLOG_SQL_SERVER,banco,usuario:env.HC_HOMOLOG_SQL_USER||env.SQL_USER,senha:env.HC_HOMOLOG_SQL_PASSWORD||env.SQL_PASSWORD,instancia:env.HC_HOMOLOG_SQL_INSTANCE||'',porta:env.HC_HOMOLOG_SQL_PORT||env.SQL_PORT};
}

export function lerDestinoDcnHeadcargo(texto) {
  let secao = '';
  const valores = new Map();
  for (const linha of texto.split(/\r?\n/)) {
    const cabecalho = linha.match(/^\s*\[([^\]]+)\]\s*$/);
    if (cabecalho) {
      secao = cabecalho[1].trim().toLowerCase();
      continue;
    }
    if (secao !== 'server') continue;
    const campo = linha.match(/^\s*(Data Source|Initial Catalog)\s*=\s*(.*?)\s*$/i);
    if (!campo) continue;
    const chave = campo[1].toLowerCase();
    if (valores.has(chave)) throw new Error('O server.dcn tem mais de um valor para o mesmo destino.');
    valores.set(chave, campo[2].replace(/^['"]|['"]$/g, ''));
  }
  const banco = valores.get('initial catalog');
  const fonte = valores.get('data source')?.match(/^(?:tcp:)?([^\\,]+)(?:\\([^,]+))?(?:,(\d+))?$/i);
  if (!banco || !fonte || !fonte[1].trim()) throw new Error('O server.dcn não identifica servidor e catálogo.');
  return { servidor: fonte[1].trim(), instancia: fonte[2]?.trim() || '', porta: fonte[3] || '1433', banco };
}

export function verificarDestinoNativoHeadcargo(env = process.env, lerArquivo = readFileSync) {
  const ambiente = ambienteHeadcargo(env);
  if (!ambiente.homologacao) throw new Error('Gravações pelo bot estão disponíveis apenas em homologação.');
  const esperado = destinoSqlHeadcargo(env);
  const arquivoDcn = path.win32.join(path.win32.dirname(ambiente.executavel), 'server.dcn');
  let texto;
  try {
    texto = lerArquivo(arquivoDcn, 'utf8');
  } catch {
    throw new Error('Não foi possível ler o server.dcn ao lado do executável configurado.');
  }
  const nativo = lerDestinoDcnHeadcargo(texto);
  const normalizar = valor => String(valor ?? '').trim().toLowerCase();
  if (['servidor', 'instancia', 'porta', 'banco'].some(chave =>
    normalizar(nativo[chave]) !== normalizar(esperado[chave] || (chave === 'porta' ? '1433' : '')))) {
    throw new Error('O server.dcn ao lado do executável não corresponde ao destino de homologação da API.');
  }
  return { ...ambiente, banco: esperado.banco };
}
