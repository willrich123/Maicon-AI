import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Markdown} from './ChatIa';
import {executarFerramentaIa} from './ferramentasIa';
import marca from './assets/maicon-symbol-white.png';
type Chamada={id:string;type:'function';function:{name:string;arguments:string}};
type Mensagem={role:'user'|'assistant'|'tool';content:string;tool_calls?:Chamada[];tool_call_id?:string};
export function MaiconOperacional({numero,proposta,aoAtualizar,pedido}:{numero?:string;proposta?:string;aoAtualizar:()=>void;pedido?:{id:number;texto:string}}){
 const [mensagens,setMensagens]=useState<Mensagem[]>([]),[texto,setTexto]=useState(''),[ocupado,setOcupado]=useState(false),[status,setStatus]=useState(''),[erro,setErro]=useState('');
 const controle=useRef<AbortController|null>(null),historico=useRef<Mensagem[]>([]),fim=useRef<HTMLDivElement>(null);
 useEffect(()=>()=>controle.current?.abort(),[]);
 useEffect(()=>{let ativo=true;queueMicrotask(()=>{if(ativo&&pedido)void perguntar(pedido.texto);});return()=>{ativo=false;};},[pedido?.id]);
 useEffect(()=>{fim.current?.scrollIntoView({block:'nearest'});},[mensagens,status]);
 async function perguntar(pergunta:string){
  if(controle.current||!pergunta.trim())return;
  const ac=new AbortController();controle.current=ac;setOcupado(true);setErro('');setTexto('');
  const proxima:Mensagem={role:'user',content:numero?`No processo ${numero}: ${pergunta.trim()}`:proposta?`Na proposta comercial ${proposta}: ${pergunta.trim()}`:pergunta.trim()};
  let conversa=[...historico.current,proxima];setMensagens(conversa);
  try{
   for(let rodada=0;rodada<8;rodada++){
    setStatus('Consultando o Maicon…');let parcial='',resposta:Mensagem|null=null;
    const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mensagens:conversa}),signal:ac.signal});
    if(!r.ok||!r.body)throw new Error('Não foi possível conversar com o Maicon. Verifique sua sessão.');
    const leitor=r.body.getReader(),decoder=new TextDecoder();let buffer='';
    const evento=(bloco:string)=>{for(const linha of bloco.split('\n')){if(!linha.startsWith('data:'))continue;const e=JSON.parse(linha.slice(5));if(e.tipo==='erro')throw new Error(e.erro||'O Maicon não conseguiu continuar.');if(e.tipo==='status')setStatus(e.texto||'Consultando…');if(e.tipo==='texto'){parcial+=e.texto||'';setMensagens([...conversa,{role:'assistant',content:parcial}]);}if(e.tipo==='fim')resposta=e.mensagem;}};
    try{for(;;){const {done,value}=await leitor.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');const blocos=buffer.split('\n\n');buffer=blocos.pop()||'';blocos.forEach(evento);}buffer+=decoder.decode();if(buffer.trim())evento(buffer);}finally{await leitor.cancel().catch(()=>{});}
    const final=resposta as Mensagem|null;
    if(!final)throw new Error('A resposta foi interrompida. Tente novamente.');
    conversa=[...conversa,final];
    if(!final.tool_calls?.length){historico.current=conversa;setMensagens(conversa);return;}
    for(const chamada of final.tool_calls){setStatus('Buscando dados do HeadCargo…');const args=JSON.parse(chamada.function.arguments||'{}');const resultado=await executarFerramentaIa(chamada.function.name,args,ac.signal);conversa.push({role:'tool',tool_call_id:chamada.id,content:typeof resultado==='string'?resultado:JSON.stringify(resultado)});}
   }
   throw new Error('A consulta exigiu muitas etapas. Faça uma pergunta mais específica.');
  }catch(e){historico.current=conversa;if((e as Error).name!=='AbortError'){const mensagem=(e as Error).message;setErro(/thought.?signature|function.?call|INVALID_ARGUMENT|generativelanguage/i.test(mensagem)?'Não consegui continuar esta consulta. Inicie uma nova conversa para consultar o processo novamente.':mensagem);}}
  finally{controle.current=null;setOcupado(false);setStatus('');}
 }
 function enviar(e:FormEvent){e.preventDefault();void perguntar(texto);}
 const visiveis=mensagens.filter(m=>m.role!=='tool'&&(m.content||!m.tool_calls));
 return <aside className="mw-copilot" aria-label="Maicon assistente operacional"><header><img src={marca} alt=""/><div><strong>Maicon</strong><span>Seu assistente operacional</span></div><span className="mw-online">IA</span></header>
 <div className="mw-ai-context"><span>CONTEXTO ATUAL</span><strong>{numero||proposta||'Visão geral da operação'}</strong></div>
 <div className="mw-ai-messages">{!visiveis.length&&<div className="mw-ai-welcome"><span>✦</span><h2>Vamos resolver?</h2><p>{proposta?'Pergunte sobre a proposta selecionada.':numero?'Pergunte sobre este processo. Eu consulto os dados e explico os próximos passos.':'Selecione um processo ou pergunte sobre a sua operação.'}</p><div>{(proposta?['Resuma a proposta','Compare as ofertas desta proposta']:['Resuma o processo','Quais atividades estão atrasadas?','O que falta para concluir?']).map(p=><button key={p} disabled={(!numero&&!proposta)||ocupado} onClick={()=>void perguntar(p)}>{p}<span>↗</span></button>)}</div></div>}
 {visiveis.map((m,i)=><article key={i} className={'mw-ai-message mw-ai-'+m.role}>{m.role==='user'?<p>{m.content.replace(/^(?:No processo|Na proposta comercial) [^:]+: /,'')}</p>:<Markdown texto={m.content} ocupado={ocupado} aoConcluir={p=>void perguntar(p)}/>}</article>)}
 {ocupado&&<p className="mw-ai-status" role="status"><i/>{status||'Pensando…'}</p>}{erro&&<div className="mw-ai-error" role="alert"><p>{erro}</p><button onClick={()=>{historico.current=[];setMensagens([]);setErro('');}}>Nova conversa</button></div>}<div ref={fim}/></div>
 {visiveis.length>0&&!ocupado&&<button className="mw-refresh-context" onClick={aoAtualizar}>↻ Atualizar dados</button>}
 <form className="mw-ai-compose" onSubmit={enviar}><label htmlFor="mw-ai-pergunta" className="mw-sr">Mensagem para o Maicon</label><textarea id="mw-ai-pergunta" placeholder={numero?'Pergunte ao Maicon sobre este processo…':'Como posso ajudar na operação?'} value={texto} onChange={e=>setTexto(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void perguntar(texto);}}} maxLength={6000}/><div><span>Maicon conectado ao HeadCargo</span>{ocupado?<button type="button" onClick={()=>controle.current?.abort()}>Parar</button>:<button disabled={!texto.trim()} aria-label="Enviar mensagem">↑</button>}</div></form></aside>;
}
