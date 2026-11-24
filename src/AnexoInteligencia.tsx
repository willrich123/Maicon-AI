import {useEffect,useRef,useState} from "react";

export type EvidenciaDocumental = {id:number;nome:string;disponivel:boolean};

export function AnexoInteligencia({arquivo,processo,fechar}:{
  arquivo:EvidenciaDocumental; processo:string; fechar:()=>void;
}) {
  const dialogo=useRef<HTMLDialogElement>(null);
  const [previa,setPrevia]=useState<{url:string;tipo:string}>();
  const [erro,setErro]=useState("");

  useEffect(()=>{
    const dialog=dialogo.current;
    dialog?.showModal();
    return ()=>dialog?.close();
  },[]);

  useEffect(()=>{
    const controle=new AbortController();
    let url:string|undefined;
    async function carregar() {
      try {
        const query=new URLSearchParams({numero:processo,arquivo:String(arquivo.id)});
        const r=await fetch(`/api/inteligencia/anexo?${query}`,{
          signal:AbortSignal.any([controle.signal,AbortSignal.timeout(45000)]),
        });
        if(!r.ok)throw new Error((await r.json().catch(()=>null))?.erro||"Anexo indisponível.");
        const blob=await r.blob();
        if(controle.signal.aborted)return;
        url=URL.createObjectURL(blob);
        setPrevia({url,tipo:blob.type});
      } catch(e) {
        if(!controle.signal.aborted)setErro(e instanceof Error&&e.name!=="TimeoutError"?e.message:"Não foi possível carregar o anexo a tempo.");
      }
    }
    void carregar();
    return ()=>{
      controle.abort();
      if(url)URL.revokeObjectURL(url);
    };
  },[arquivo.id,processo]);

  const imagem=previa && /^image\/(png|jpeg|gif|webp)$/.test(previa.tipo);
  return <dialog ref={dialogo} className="ma-int-anexo" aria-label={`Visualização de ${arquivo.nome}`}
    onCancel={e=>{e.preventDefault();fechar();}}>
    <header>
      <strong>{arquivo.nome}</strong>
      <div>
        {previa&&<a href={previa.url} download={arquivo.nome}>Baixar</a>}
        <button type="button" autoFocus aria-label="Fechar visualização" onClick={fechar}>Fechar</button>
      </div>
    </header>
    {erro?<p role="alert">{erro}</p>:!previa?<p role="status">Carregando documento…</p>:
      previa.tipo==="application/pdf"?<iframe title={arquivo.nome} src={previa.url}/>:
      imagem?<img alt={arquivo.nome} src={previa.url}/>:
      <p>Este formato pode ser aberto após o download.</p>}
  </dialog>;
}
