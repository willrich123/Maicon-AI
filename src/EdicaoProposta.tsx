import {useEffect,useState} from 'react';

export type CamposEdicao = {
  proposta:string; versao:number;
  ofertas:{chave:number;numero:string}[];
  campos:{id:string;aba:string;nome:string;maximo:number;registro:string;atual:string|null}[];
};

export function EdicaoProposta({carregar,fechar}:{
  carregar:(oferta:number|null,sinal:AbortSignal)=>Promise<CamposEdicao>;
  fechar:()=>void;
}) {
  const [oferta,setOferta]=useState<number|null>(null);
  const [dados,setDados]=useState<CamposEdicao>();
  const [alteracoes,setAlteracoes]=useState<Record<string,string>>({});
  const [erro,setErro]=useState('');
  const [ocupado,setOcupado]=useState(true);
  const [copiado,setCopiado]=useState(false);
  useEffect(()=>{
    const ac=new AbortController();
    setOcupado(true);
    setErro('');
    void carregar(oferta,ac.signal).then(d=>{
      if(!ac.signal.aborted)setDados(d);
    }).catch(e=>{if(!ac.signal.aborted)setErro(e.message);})
      .finally(()=>{if(!ac.signal.aborted)setOcupado(false);});
    return ()=>ac.abort();
  },[oferta,carregar]);
  const selecionada=dados?.ofertas.find(o=>o.chave===oferta);
  const itens=dados?.campos.filter(c=>Object.hasOwn(alteracoes,c.id)&&alteracoes[c.id]!==String(c.atual??''))||[];
  const plano=dados&&itens.length?{
    proposta:dados.proposta,versao:dados.versao,oferta:selecionada?.numero??null,
    campos:itens.map(c=>({campo:c.id,aba:c.aba,nome:c.nome,registro:c.registro,valorAtual:c.atual,novoValor:alteracoes[c.id]})),
  }:null;
  async function copiar() {
    if(!plano)return;
    try {await navigator.clipboard.writeText(JSON.stringify(plano,null,2));setCopiado(true);}
    catch {setErro('O navegador não conseguiu copiar o plano.');}
  }
  return <section className="mc-rascunho">
    <header className="mw-detail-title"><div><h1>Preparar alterações</h1><p>{dados?.proposta}{dados?.versao!=null?' · versão '+dados.versao:''}</p></div><button onClick={fechar}>← Voltar</button></header>
    <p className="mc-vazio">Confira os valores atuais e prepare a alteração. A gravação pelo bot aguarda validação no HeadCargo HOMO.</p>
    {!!dados?.ofertas.length&&<div className="mc-filtros mc-mapa-formulario">
      <label htmlFor="mc-edicao-oferta">Oferta</label>
      <select id="mc-edicao-oferta" value={oferta??''} disabled={ocupado} onChange={e=>{
        setOferta(e.target.value?Number(e.target.value):null);
        setAlteracoes((atual):Record<string,string>=>Object.hasOwn(atual,'observacao')?{observacao:atual.observacao}:{});
        setCopiado(false);
      }}><option value="">Campos da proposta</option>{dados.ofertas.map(o=><option key={o.chave} value={o.chave}>{o.numero}</option>)}</select>
    </div>}
    {ocupado&&<p role="status">Carregando os valores do HeadCargo…</p>}
    {erro&&<p className="mw-alert" role="alert">{erro}</p>}
    {!ocupado&&!erro&&dados?.campos.map(c=><div className="mc-edicao-campo" key={c.id}>
      <label htmlFor={'mc-edicao-'+c.id}>{c.nome} <span>· {c.aba}</span></label>
      <p>Atual: {c.atual||'Em branco'}</p>
      {c.maximo>250?<textarea id={'mc-edicao-'+c.id} rows={2} maxLength={c.maximo} value={alteracoes[c.id]??c.atual??''} onChange={e=>{setAlteracoes(a=>({...a,[c.id]:e.target.value}));setCopiado(false);}}/>
      :<input id={'mc-edicao-'+c.id} maxLength={c.maximo} value={alteracoes[c.id]??c.atual??''} onChange={e=>{setAlteracoes(a=>({...a,[c.id]:e.target.value}));setCopiado(false);}}/>}
    </div>)}
    <div className="mw-context-actions"><button disabled={!plano||ocupado||!!erro} onClick={()=>void copiar()}>{copiado?'Plano copiado':'Copiar plano de alterações'}{itens.length?' · '+itens.length:''}</button></div>
  </section>;
}
