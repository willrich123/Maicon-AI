import {useEffect, useRef, useState, type FormEvent} from 'react';

export function RascunhoComercial({origem, gerar, fechar}:{
  origem?:string; gerar:(briefing:string,sinal:AbortSignal)=>Promise<string>; fechar:()=>void;
}) {
  const [briefing,setBriefing]=useState('');
  const [texto,setTexto]=useState('');
  const [ocupado,setOcupado]=useState(false);
  const [erro,setErro]=useState('');
  const [copiado,setCopiado]=useState(false);
  const atual=useRef<AbortController|null>(null);
  useEffect(()=>()=>atual.current?.abort(),[]);
  async function montar(e:FormEvent) {
    e.preventDefault();
    if(atual.current) return;
    const ac=new AbortController();
    atual.current=ac;
    setOcupado(true);
    setErro('');
    setCopiado(false);
    try {
      const resposta=await gerar(briefing,ac.signal);
      if(!ac.signal.aborted) setTexto(resposta);
    } catch(e) {
      if(!ac.signal.aborted) setErro((e as Error).message);
    } finally {
      if(atual.current===ac) {
        atual.current=null;
        if(!ac.signal.aborted) setOcupado(false);
      }
    }
  }
  async function copiar() {
    try {await navigator.clipboard.writeText(texto);setCopiado(true);}
    catch {setErro('Não consegui copiar automaticamente. Selecione o texto do rascunho e copie.');}
  }
  return <section className="mw-process-data mc-rascunho">
    <header className="mw-detail-title"><div><h1>Montar proposta com IA</h1>
      <p>{origem ? 'Base HeadCargo · '+origem : 'Prepare uma proposta a partir do briefing comercial.'}</p></div>
      <button onClick={fechar}>← Voltar</button>
    </header>
    <form onSubmit={montar}>
      <label htmlFor="mc-briefing">Briefing{origem?' (opcional)':''}</label>
      <textarea id="mc-briefing" value={briefing} onChange={e=>setBriefing(e.target.value)} required={!origem} maxLength={6000} rows={5}
        placeholder={origem?'Inclua condições negociadas ou orientações para o texto.':'Informe cliente, modal, origem, destino, carga, valores, moedas e validade, conforme já estiverem definidos.'}/>
      <div className="mw-context-actions"><button disabled={ocupado||(!origem&&!briefing.trim())}>✦ {ocupado?'Montando rascunho…':texto?'Gerar novamente':'Gerar rascunho'}</button></div>
    </form>
    {ocupado && <p role="status">O Maicon está preparando o texto.</p>}
    {erro && <p className="mw-alert" role="alert">{erro}</p>}
    {texto && <div>
      <label htmlFor="mc-rascunho">Rascunho para revisão</label>
      <textarea id="mc-rascunho" value={texto} rows={14} onChange={e=>{setTexto(e.target.value);setCopiado(false);}}/>
      <div className="mw-context-actions"><button onClick={()=>void copiar()}>{copiado?'Copiado':'Copiar rascunho'}</button></div>
    </div>}
  </section>;
}
