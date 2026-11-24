import {createHash,randomUUID} from 'node:crypto';
import {FalhaPonte} from '../ponte/sessoes.js';

export function validarNovoProcesso(p){
 if(!['IM','EM','IA','EA','IT','ET'].includes(p?.modalidade))throw new FalhaPonte('Escolha a modalidade do processo.');
 if(!Number.isSafeInteger(p.clienteId)||p.clienteId<=0)throw new FalhaPonte('Selecione um cliente do HeadCargo.');
 if(typeof p.referencia!=='string'||!p.referencia.trim()||p.referencia.trim().length>80||/[\x00-\x1f]/.test(p.referencia))throw new FalhaPonte('Informe uma referência de até 80 caracteres.');
 if(typeof p.chave!=='string'||!/^[-\w]{16,80}$/.test(p.chave))throw new FalhaPonte('Identificador de solicitação inválido.');
 return {modalidade:p.modalidade,clienteId:p.clienteId,referencia:p.referencia.trim()};
}
export class CriacaoProcessos {
 constructor({db,preparar,executar,verificar,disponibilidade,serializar}){
  Object.assign(this,{db,preparar,executar,verificar,disponibilidade,serializar});
  db.exec('CREATE TABLE IF NOT EXISTS criacoes (id TEXT PRIMARY KEY, conta TEXT NOT NULL, chave TEXT NOT NULL, hash TEXT NOT NULL, dados TEXT NOT NULL, UNIQUE(conta,chave))');
  for(const r of db.prepare('SELECT * FROM criacoes').all()){const t=JSON.parse(r.dados);if(['fila','executando'].includes(t.estado)){t.estado='revisao';t.mensagem='O serviço reiniciou. Confira no HeadCargo antes de tentar criar novamente.';this.salvar(t);}}
 }
 salvar(t){this.db.prepare('UPDATE criacoes SET dados=? WHERE id=? AND conta=?').run(JSON.stringify(t),t.id,t.conta);}
 publico(t){const {conta,usuario,clienteCodigo,limiteHouse,...r}=t;return r;}
 obter(id,conta){const r=this.db.prepare('SELECT dados FROM criacoes WHERE id=? AND conta=?').get(String(id||''),conta);if(!r)throw new FalhaPonte('Solicitação não encontrada.',404);return this.publico(JSON.parse(r.dados));}
 obterPorChave(chave,conta){const r=this.db.prepare('SELECT dados FROM criacoes WHERE chave=? AND conta=?').get(String(chave||''),conta);return r?this.publico(JSON.parse(r.dados)):null;}
 async criar(p,conta,usuario){
  const dados=validarNovoProcesso(p),hash=createHash('sha256').update(JSON.stringify(dados)).digest('hex');
  const existente=this.db.prepare('SELECT * FROM criacoes WHERE conta=? AND chave=?').get(conta,p.chave);
  if(existente){if(existente.hash!==hash)throw new FalhaPonte('Esta solicitação já foi usada com outros dados.',409);return this.publico(JSON.parse(existente.dados));}
  const capacidade=this.disponibilidade();if(!capacidade.disponivel)throw new FalhaPonte(capacidade.motivo,503);
  const cliente=await this.preparar(dados);
  const t={id:randomUUID(),conta,usuario,...dados,cliente:cliente.nome,clienteCodigo:cliente.codigo,limiteHouse:cliente.limiteHouse,estado:'fila',mensagem:'Aguardando a sessão do HeadCargo.',criadoEm:new Date().toISOString()};
  // Revalidar após o await: dois cliques simultâneos não geram duas tarefas.
  const repetida=this.db.prepare('SELECT * FROM criacoes WHERE conta=? AND chave=?').get(conta,p.chave);
  if(repetida){if(repetida.hash!==hash)throw new FalhaPonte('Solicitação em conflito.',409);return this.publico(JSON.parse(repetida.dados));}
  this.db.prepare('INSERT INTO criacoes VALUES (?,?,?,?,?)').run(t.id,conta,p.chave,hash,JSON.stringify(t));
  void this.serializar(async()=>{
   try{
    t.estado='executando';t.mensagem='Preenchendo o formulário original do HeadCargo.';this.salvar(t);
    const resultado=await this.executar(t);
    if(!resultado?.numero||!await this.verificar(t,resultado))throw new Error('sem_confirmacao');
    t.estado='concluida';t.numero=resultado.numero;t.mensagem='Processo criado e conferido no HeadCargo.';
   }catch{t.estado='revisao';t.mensagem='A criação não foi confirmada. Confira o HeadCargo antes de tentar novamente; a tarefa não será repetida automaticamente.';}
   this.salvar(t);
  }).catch(()=>{t.estado='revisao';t.mensagem='Não foi possível obter a sessão do HeadCargo. Confira antes de tentar novamente.';this.salvar(t);});
  return this.publico(t);
 }
}
