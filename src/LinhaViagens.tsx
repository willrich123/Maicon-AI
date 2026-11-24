import {IconeTransporte,type MeioTransporte} from './IconeTransporte';
export type EtapaVisual={id:string;indice:number;papel:string;meio:MeioTransporte;origem:string;destino:string;companhia:string;veiculo:string;partida:string;chegada:string;partidaReal:boolean;chegadaReal:boolean;estado:string;situacao:string};
export function LinhaViagens({etapas,selecionada,aoSelecionar}:{etapas:EtapaVisual[];selecionada:string;aoSelecionar:(id:string)=>void}){
 return <div className="mw-voyage-timeline" aria-label="Etapas da viagem">{etapas.map(e=><button key={e.id} className={'mw-leg mw-leg-'+e.estado} aria-pressed={e.id===selecionada} onClick={()=>aoSelecionar(e.id)}>
 <div className="mw-leg-heading"><span className="mw-leg-symbol"><IconeTransporte meio={e.meio}/></span><div><span className="mw-leg-step">ETAPA {String(e.indice+1).padStart(2,'0')}</span><strong>{e.papel}</strong></div><span className="mw-leg-selected-mark" aria-hidden>{e.id===selecionada?'↗':'→'}</span></div>
 <div className="mw-leg-places"><div><i aria-hidden/><span>ORIGEM</span><strong>{e.origem}</strong></div><div><i aria-hidden/><span>DESTINO</span><strong>{e.destino}</strong></div></div>
 <div className="mw-leg-carrier"><strong>{e.companhia}</strong><span>{e.veiculo}</span></div>
 <div className="mw-leg-date-pair"><div><span>{e.partidaReal?'Saída realizada':'Saída prevista'}</span><strong>{e.partida}</strong></div><div><span>{e.chegadaReal?'Chegada realizada':'Chegada prevista'}</span><strong>{e.chegada}</strong></div></div>
 <span className={'mw-leg-status mw-leg-status-'+e.estado}><i aria-hidden/>{e.situacao}</span>
 </button>)}</div>;
}
