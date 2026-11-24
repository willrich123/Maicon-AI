import {inflateSync} from 'node:zlib';
import {FalhaPonte} from '../ponte/sessoes.js';
const basePadrao='https://api.headsoft.com.br/geral/blob-stream';
const decodificar=s=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export function interpretarStorageHeadcargo(dados){
 if(!Buffer.isBuffer(dados))return null;
 const b=dados[0]===0x78?inflateSync(dados,{maxOutputLength:2*1024*1024}):dados;
 const texto=b.toString('utf8');
 const grupo=texto.match(/<Grupo\s+Nome="Interface_Menu"[^>]*>([\s\S]*?)<\/Grupo>/)?.[1];if(!grupo)return null;
 const item=nome=>decodificar(grupo.match(new RegExp('<Item\\s+Nome="'+nome+'"[^>]*\\bValor="([^"]*)"'))?.[1]||'');
 const token=item('Token_Autenticacao');if(!token)return null;
 const base=new URL(item('Endereco_Api')||basePadrao);
 if(base.protocol!=='https:'||base.hostname!=='api.headsoft.com.br'||base.port||base.username||base.password||base.search||base.hash||base.pathname.replace(/\/$/,'')!=='/geral/blob-stream')throw new FalhaPonte('O endereço do armazenamento HeadCargo não corresponde ao serviço validado.',503);
 return {base:base.toString().replace(/\/$/,''),token};
}
export async function configuracaoStorageHeadcargo(pool){
 const r=await pool.request().query("SELECT Dados FROM sys_Parametro WHERE IdSistema='Geral' AND IdParametro='Configuracoes_Sistema'");
 return interpretarStorageHeadcargo(r.recordset[0]?.Dados);
}
export async function baixarStorageHeadcargo(config,guid,{limite=50*1024*1024,fetchImpl=fetch}={}){
 if(!config||!/^\{?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}?$/i.test(String(guid)))throw new FalhaPonte('Identificador do arquivo externo inválido.',404);
 const base=new URL(config.base);if(base.origin!=='https://api.headsoft.com.br'||base.pathname.replace(/\/$/,'')!=='/geral/blob-stream')throw new FalhaPonte('Armazenamento não validado.',503);
 // O cliente nativo normaliza o GUID em minúsculas antes de chamar GetFile.
 const url=base.toString().replace(/\/$/,'')+'/blobstream/'+encodeURIComponent(String(guid).replace(/[{}]/g,'').toLowerCase());
 const signal=AbortSignal.timeout(30000);
 let r;
 try{
  r=await fetchImpl(url,{headers:{Authorization:'Bearer '+config.token},redirect:'manual',signal});
  if([301,302,303,307,308].includes(r.status)){
   const local=r.headers.get('location');await r.body?.cancel();
   const destino=local?new URL(local,url):null;
   if(!destino||destino.protocol!=='https:'||destino.hostname!=='headcargo.blob.core.windows.net'||destino.port&&destino.port!=='443'||destino.username||destino.password)throw new FalhaPonte('O serviço retornou um destino de arquivo não autorizado.',502);
   // A URL assinada é recebida da Headsoft. O token HeadCargo nunca segue para o Azure.
   r=await fetchImpl(destino,{redirect:'manual',signal});
  }
 }catch(e){if(e instanceof FalhaPonte)throw e;throw new FalhaPonte('Não foi possível conectar ao armazenamento do HeadCargo. Tente novamente.',502);}
 if(!r.ok)throw new FalhaPonte(r.status===401||r.status===403?'O serviço de arquivos do HeadCargo recusou a autenticação. Verifique sua configuração de armazenamento.':r.status===404?'O serviço de armazenamento não encontrou este anexo.':'O serviço de arquivos do HeadCargo não respondeu ao download.',r.status===404?404:502);
 if(Number(r.headers.get('content-length'))>limite){await r.body?.cancel();throw new FalhaPonte('O anexo excede o limite de 50 MB.',413);}
 const partes=[];let bytes=0;
 try{for await(const parte of r.body){bytes+=parte.length;if(bytes>limite)throw new FalhaPonte('O anexo excede o limite de 50 MB.',413);partes.push(Buffer.from(parte));}}catch(e){if(e instanceof FalhaPonte)throw e;throw new FalhaPonte('O download do anexo foi interrompido. Tente novamente.',502);}
 if(!bytes)throw new FalhaPonte('O armazenamento retornou um arquivo vazio.',404);
 return Buffer.concat(partes);
}
