import fs from 'node:fs';
import {execFile} from 'node:child_process';
import {verificarDestinoNativoHeadcargo} from '../ambienteHeadcargo.js';
export function perfilCriacao(){
 const a=verificarDestinoNativoHeadcargo();
 if(!process.env.HC_CRIACAO_PERFIL)throw new Error('O preenchimento de novos processos aguarda validação dos controles na sessão de homologação.');
 const p=JSON.parse(fs.readFileSync(process.env.HC_CRIACAO_PERFIL,'utf8').replace(/^\uFEFF/,''));
 if(p.validado!==true||p.sessaoDedicada!==true)throw new Error('Configure um perfil validado em uma sessão Windows dedicada ao bot.');
 if(String(p.executavel).replaceAll('/','\\').toLowerCase()!==a.executavel.toLowerCase())throw new Error('O perfil de criação não corresponde ao HeadCargo configurado.');
 if(!Number.isSafeInteger(p.sessaoWindows)||p.sessaoWindows<=0)throw new Error('Informe o ID da sessão Windows dedicada no perfil de criação.');
 for(const nome of ['identidade','ambiente','operacional','modalidade','inserir','clienteCodigo','clienteNome','referencia','confirmar','numero'])if(!p[nome]||!p[nome].id&&!p[nome].nome||/MAPEAR/i.test(String(p[nome].id||'')+String(p[nome].nome||'')))throw new Error('Faltam controles validados no perfil de criação.');
 if(!p.identidadeModelo?.includes('{usuario}'))throw new Error('Configure a confirmação do usuário nativo.');
 if(!p.ambienteModelo?.includes('{banco}'))throw new Error('Configure a confirmação do catálogo conectado na janela nativa.');
 for(const modalidade of ['IM','EM','IA','EA','IT','ET'])if(!p.modalidades?.[modalidade]||/MAPEAR/i.test(p.modalidades[modalidade]))throw new Error('Mapeie os nomes das modalidades do HeadCargo.');
 return p;
}
export function disponibilidadeCriacao(){try{perfilCriacao();return {disponivel:true,motivo:'Criação pela sessão dedicada do HeadCargo.'};}catch(e){return {disponivel:false,motivo:e.message};}}
export async function criarProcessoDesktop(tarefa){
 const perfil=perfilCriacao();
 const destino=verificarDestinoNativoHeadcargo();
 // Dados somente via stdin, sem senha nem execução de SQL no processo nativo.
 const script=new URL('./criarProcesso.ps1',import.meta.url);
 const {fileURLToPath}=await import('node:url');
 return new Promise((resolve,reject)=>{
  const filho=execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(script)],{windowsHide:true,timeout:90000,maxBuffer:1024*1024,env:{...process.env,HC_EXECUTAVEL:destino.executavel,HC_BANCO_NATIVO_ESPERADO:destino.banco}},(erro,stdout)=>{
   if(erro)return reject(new Error('Criação não confirmada.'));
   try{const r=JSON.parse(stdout.replace(/^\uFEFF/,'').trim());if(!r.ok)throw new Error();resolve(r);}catch{reject(new Error('Criação não confirmada.'));}
  });
  filho.stdin.on('error',()=>{});filho.stdin.end(JSON.stringify({tarefa,perfil}));
 });
}
