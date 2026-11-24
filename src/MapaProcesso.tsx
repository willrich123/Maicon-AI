import { useState } from "react";
import { MapaCarteira, MapaConsultaProcesso } from "./MapaCarteira";

export function MapaProcesso({numero}:{numero:string}) {
  const [versao,setVersao]=useState(0);
  const [carteira,setCarteira]=useState(false);
  return <section className="mw-shipping">
    <header className="mw-shipping-header"><div><h2>Mapa da carga</h2>{!carteira&&<p>Eventos registrados para {numero}.</p>}</div>
      {!carteira&&<div className="ma-carteira-acoes">
        <button type="button" onClick={()=>setVersao(v=>v+1)}>↻ Atualizar mapa</button>
        <button type="button" onClick={()=>setCarteira(true)}>Visão da carteira</button>
      </div>}
    </header>
    {carteira?<MapaCarteira aoVoltar={()=>setCarteira(false)}/>:<MapaConsultaProcesso numero={numero} versao={versao}/>}
  </section>;
}
