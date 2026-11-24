import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import "./estilos/mapa-embarque.css";

type Coordenadas = [number,number];
type Local = {nome:string;codigo:string;coords:Coordenadas | null};
type Trecho = {
  id:number; sequencia:number|null; origem:Local; destino:Local; modal?:number; transportadora?:string; viagem?:string;
  embarque?:string; desembarque?:string; saidaPrevista?:string; chegadaPrevista?:string; cancelado:boolean; ignorado:boolean;
  rota?:{tipo:"maritima"|"aerea"|"ligacao";pontos:Coordenadas[];km?:number;passagens?:string[]}|null;
};
type Evento = {id:number;tipo:"embarque"|"desembarque";local:Local;data:string};
type EventoTracking = {id:number;descricao?:string;data:string;local?:string;fonte:string;coords:Coordenadas|null};
type Revisao = {id:number;idTrecho:number;campo:"saidaPrevista"|"chegadaPrevista";de:string|null;para:string|null;data:string|null;dias:number|null};
type AisNavio = {trecho:number;nome:string|null;imo:string|null;
  estado:"recebida"|"antiga"|"aguardando"|"conectando"|"reconectando"|"semImo"|"desativado"|"ambiguo";
  posicao:{mmsi:string;coords:Coordenadas;data:string;horarioRecepcao:boolean;nomeAis?:string}|null};
export type MapaEmbarqueDados = {
  processo:string; trechos:Trecho[]; limitado:boolean; emTransito:boolean;
  ultimo:Evento | null; eventos?:Evento[]; eventosTracking?:EventoTracking[]; posicao?:EventoTracking|null;
  historico?:Revisao[]; historicoLimitado?:boolean;
  ais?:AisNavio|null;
};
export type MarcadorCarteira = {processo:string;local:Local|null;estado:keyof typeof estadosCarteira;
  cliente?:string;transportadora?:string;modal:number;eta?:string;data?:string;tipo?:string;
  referencia?:"evento"|"origem"|"destino"|null;localEvento?:string};
export const estadosCarteira = {atrasado:"Prazo vencido",semAtualizacao:"Sem atualização há 7 dias",transito:"Em trânsito",previsto:"Próxima etapa prevista",desembarcado:"Desembarcado"};
export const referenciasCarteira={evento:"Último evento registrado",origem:"Origem cadastrada",destino:"Destino cadastrado"};
const coresCarteira = {atrasado:["#c14528","#ff916d"],semAtualizacao:["#896114","#ffd072"],transito:["#276baa","#88c8ff"],previsto:["#59657b","#aec4e3"],desembarcado:["#0b6c55","#8aecbb"]};
type Visao = {lat:number;lon:number;zoom:number};
type Anel = [number,number][];
type Pais = {n:string;x:number;y:number;r:number;b:[number,number,number,number];p:Anel[][]};
type BaseMapa = {terra:Anel[];paises:Array<Omit<Pais,"p">&{path:Path2D}>};
const mundo = {lat:12,lon:0,zoom:1};
const lonCentrada = (lon:number) => ((lon + 540) % 360) - 180;
const latLimitada = (lat:number) => Math.min(80,Math.max(-67,lat));
export const dataBrasil = (data?:string|null) => data
  ? new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(new Date(data)) : "—";
const dataHora = new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",dateStyle:"short",timeStyle:"short"});
const diasDeDiferenca = (data?:string,prevista?:string) => data&&prevista
  ? (Date.parse(data.slice(0,10))-Date.parse(prevista.slice(0,10)))/86400000 : null;
const rotas = {maritima:"Rota marítima estimada",aerea:"Traçado aéreo estimado",ligacao:"Ligação esquemática"};
const passagensMaritimas:Record<string,string>={suez:"Canal de Suez",panama:"Canal do Panamá",malacca:"Estreito de Malaca",
  sunda:"Estreito de Sunda",babelmandeb:"Bab el-Mandeb",gibraltar:"Estreito de Gibraltar",hormuz:"Estreito de Ormuz",
  dover:"Estreito de Dover",bosporus:"Bósforo",dardanelles:"Dardanelos",kiel:"Canal de Kiel",corinth:"Canal de Corinto",
  lombock:"Estreito de Lombok",lombok:"Estreito de Lombok"};
export const nomeModal = (modal?:number) => ({1:"Aéreo",2:"Marítimo",3:"Rodoviário",4:"Terrestre"}[modal??0]??"—");
const oceanos = [
  {nome:"OCEANO ATLÂNTICO",lat:12,lon:-37},{nome:"OCEANO PACÍFICO",lat:7,lon:-139},
  {nome:"OCEANO ÍNDICO",lat:-28,lon:84},{nome:"OCEANO PACÍFICO",lat:-28,lon:158},
];
let geografia:Promise<BaseMapa>|undefined;

async function carregarJson<T>(nome:string):Promise<T>{
  const r=await fetch(`${import.meta.env.BASE_URL}${nome}`);
  if(!r.ok)throw new Error("Mapa indisponível");
  return r.json();
}

function carregarBase(){
  geografia ??= carregarJson<Pais[]>("mapa-paises.json").then(paises=>({
    terra:[],
    paises:paises.map(({p,...pais})=>{
      const path=new Path2D();
      for(const poligono of p)for(const anel of poligono){
        anel.forEach(([x,y],i)=>i ? path.lineTo(x,y) : path.moveTo(x,y));
        path.closePath();
      }
      return {...pais,path};
    }),
  })).catch(async ()=>({paises:[],terra:await carregarJson<Anel[]>("mapa-terra.json")}));
  return geografia;
}

function enquadrar(pontos:Coordenadas[]):Visao {
  if (!pontos.length) return mundo;
  if (pontos.length === 1) return {lat:pontos[0][0],lon:pontos[0][1],zoom:5};
  const lat = pontos.map(p=>p[0]);
  const long = [...new Set(pontos.map(p=>(p[1]+360)%360))].sort((a,b)=>a-b);
  let lacuna = 0;
  let inicio = long[0];
  long.forEach((v,i)=>{
    const proximo = long[i+1] ?? long[0]+360;
    if (proximo-v > lacuna) { lacuna=proximo-v; inicio=proximo; }
  });
  const largura = 360-lacuna;
  const altura = Math.max(...lat)-Math.min(...lat);
  return {lat:(Math.max(...lat)+Math.min(...lat))/2,lon:lonCentrada(inicio+largura/2),
    zoom:Math.min(8,Math.max(1,Math.min(290/Math.max(1,largura),110/Math.max(1,altura))))};
}

function estadoTrecho(t:Trecho,realizados:Set<string>) {
  if (t.cancelado) return "Cancelado";
  if (t.ignorado) return "Fora do tracking";
  if (realizados.has(t.id+":desembarque")) return "Desembarque registrado";
  if (realizados.has(t.id+":embarque")) return "Embarque registrado";
  return "Previsto";
}

const mapaVazio:MapaEmbarqueDados={processo:"",trechos:[],limitado:false,emTransito:false,ultimo:null};

type GrupoCarteira={x:number;y:number;itens:MarcadorCarteira[]};

function agruparPontos(carteira:MarcadorCarteira[],visao:Visao,{largura,altura}:{largura:number;altura:number}) {
  const grupos:GrupoCarteira[]=[];
  if(!largura||!altura)return grupos;
  const escala=Math.min(largura/360,altura/150)*visao.zoom;
  for(const item of carteira){
    if(!item.local?.coords)continue;
    const [lat,lon]=item.local.coords;
    const x=largura/2+lonCentrada(lon-visao.lon)*escala;
    const y=altura/2-(lat-visao.lat)*escala;
    if(x<0||x>largura||y<0||y>altura)continue;
    const vizinho=grupos.find(g=>(x-g.x)**2+(y-g.y)**2<36**2);
    if(vizinho)vizinho.itens.push(item);
    else grupos.push({x,y,itens:[item]});
  }
  return grupos;
}

function PontosCarteira({grupos,largura,altura,claro,aoSelecionar}:{
  grupos:GrupoCarteira[];largura:number;altura:number;claro:boolean;aoSelecionar?:(grupo:MarcadorCarteira[])=>void;
}){
  const [mouse,setMouse]=useState<string>();
  const [foco,setFoco]=useState<string>();
  const id=useId();
  const ativo=mouse??foco;
  const grupo=grupos.find(g=>g.itens[0].processo===ativo);
  const primeiro=grupo?.itens[0];
  const locais=grupo?[...new Set(grupo.itens.map(i=>i.local?.nome).filter(Boolean))]:[];
  const estados=new Map<MarcadorCarteira["estado"],number>();
  grupo?.itens.forEach(i=>estados.set(i.estado,(estados.get(i.estado)??0)+1));
  return <>
    {grupos.map(g=>{
      const item=g.itens[0];
      const unico=g.itens.length===1;
      return <button type="button" className="ma-carteira-ponto" key={item.processo}
        style={{left:g.x,top:g.y,background:coresCarteira[item.estado][claro?0:1]}}
        aria-label={unico?`${item.processo} · ${item.local?.nome}`:`${g.itens.length} processos · ${item.local?.nome} e proximidades`}
        aria-describedby={ativo===item.processo?id:undefined}
        onPointerEnter={()=>setMouse(item.processo)} onPointerLeave={()=>setMouse(undefined)}
        onFocus={()=>setFoco(item.processo)} onBlur={()=>setFoco(undefined)}
        onKeyDown={e=>{if(e.key==="Escape"){setMouse(undefined);setFoco(undefined);}}}
        onClick={()=>aoSelecionar?.(g.itens)}>
        {!unico&&g.itens.length.toLocaleString("pt-BR")}
      </button>;
    })}
    {grupo&&primeiro&&<div id={id} role="tooltip" className="ma-carteira-tooltip"
      style={{left:Math.min(Math.max(8,grupo.x+18),Math.max(8,largura-260)),
        top:Math.min(Math.max(8,grupo.y-16),altura-12),transform:grupo.y>altura/2?"translateY(-100%)":undefined}}>
      <strong>{grupo.itens.length===1?primeiro.processo:`${grupo.itens.length.toLocaleString("pt-BR")} processos`}</strong>
      <span>{locais.slice(0,3).join(" · ")}{locais.length>3?` · +${locais.length-3} locais`:""}</span>
      {grupo.itens.length===1?<>
        {primeiro.cliente&&<span>{primeiro.cliente}</span>}
        <span>{estadosCarteira[primeiro.estado]}{primeiro.transportadora?` · ${primeiro.transportadora}`:""}</span>
        {primeiro.referencia&&<span>{referenciasCarteira[primeiro.referencia]}
          {primeiro.referencia==="evento"&&primeiro.data?` · ${dataBrasil(primeiro.data)}`:""}</span>}
        {primeiro.eta&&<span>Chegada prevista · {dataBrasil(primeiro.eta)}</span>}
      </>:<>
        {[...estados].map(([estado,total])=><span key={estado}>{total} · {estadosCarteira[estado]}</span>)}
        <small>Clique para listar os processos deste ponto.</small>
      </>}
    </div>}
  </>;
}

export function MapaEmbarque({dados=mapaVazio,carteira,aoSelecionarPonto}:{dados?:MapaEmbarqueDados;carteira?:MarcadorCarteira[];
  aoSelecionarPonto?:(grupo:MarcadorCarteira[])=>void}) {
  const {trechos,ultimo,emTransito,posicao} = dados;
  const [ais,setAis]=useState(dados.ais);
  const [visivel,setVisivel]=useState(false);
  const posicaoNavio=ais?.posicao;
  const pontos = trechos.filter(t=>!t.cancelado&&!t.ignorado).flatMap(t=>[t.origem.coords,t.destino.coords])
    .filter((p):p is Coordenadas=>p!==null);
  const inicial = () => {
    const marcadores=[...pontos,...(posicao?.coords?[posicao.coords]:[]),...(posicaoNavio?[posicaoNavio.coords]:[]),
      ...(carteira??[]).flatMap(m=>m.local?.coords?[m.local.coords]:[])];
    const rotas=trechos.flatMap(t=>t.rota?.pontos??[]);
    return enquadrar(marcadores.concat(rotas));
  };
  const [visao,setVisao] = useState<Visao>(inicial);
  const [selecionado,setSelecionado] = useState(ultimo?.id ?? trechos[0]?.id);
  const [base,setBase] = useState<BaseMapa>();
  const [mapaIndisponivel,setMapaIndisponivel] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dimensoes,setDimensoes] = useState({largura:0,altura:0});
  const grupos=useMemo(()=>carteira?agruparPontos(carteira,visao,dimensoes):[],[carteira,visao,dimensoes]);
  const [claro,setClaro] = useState(()=>document.documentElement.classList.contains("tema-claro"));
  const arraste=useRef<{id:number;x:number;y:number;view:Visao;moveu:boolean}|undefined>(undefined);
  const [arrastando,setArrastando]=useState(false);
  const [eventoSelecionado,setEventoSelecionado]=useState<string>();
  const incompletos = trechos.filter(t=>!t.origem.coords||!t.destino.coords).length;
  const trechoAtual=trechos.find(t=>t.id===selecionado);
  const eventosConfirmados=dados.eventos??(ultimo?[ultimo]:[]);
  const realizados=new Set(eventosConfirmados.map(e=>e.id+":"+e.tipo));
  const saiu=Boolean(trechoAtual&&realizados.has(trechoAtual.id+":embarque"));
  const chegou=Boolean(trechoAtual&&realizados.has(trechoAtual.id+":desembarque"));
  const hoje=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format();
  const atrasoChegada=diasDeDiferenca(chegou?trechoAtual?.desembarque:hoje,trechoAtual?.chegadaPrevista);
  const eventos=[
    ...eventosConfirmados.map(e=>({chave:e.id+":"+e.tipo,trecho:e.id,nome:e.tipo==="embarque"?"Embarque":"Desembarque",local:e.local,estado:"Registrado no HeadCargo",data:e.data})),
    ...trechos.filter(t=>!t.cancelado&&!t.ignorado).flatMap(t=>[
      {chave:t.id+":etd",trecho:t.id,nome:"Embarque",local:t.origem,estado:"Previsto",data:t.saidaPrevista,confirmado:realizados.has(t.id+":embarque")},
      {chave:t.id+":eta",trecho:t.id,nome:"Desembarque",local:t.destino,estado:"Previsto",data:t.chegadaPrevista,confirmado:realizados.has(t.id+":desembarque")},
    ].filter(e=>e.data&&!e.confirmado)),
    ...(dados.eventosTracking??[]).map(e=>({chave:"tracking:"+e.id,trecho:undefined,nome:e.descricao||"Evento de rastreamento",
      local:{nome:e.local||"Local não informado",codigo:"",coords:e.coords},estado:e.fonte,data:e.data})),
  ].sort((a,b)=>Date.parse(a.data??"")-Date.parse(b.data??""));
  const focoEvento=eventos.find(e=>e.chave===eventoSelecionado)?.local.coords;

  useEffect(()=>{
    let ativo=true;
    carregarBase().then(d=>{if(ativo)setBase(d);}).catch(()=>{if(ativo)setMapaIndisponivel(true);});
    return ()=>{ativo=false;};
  },[]);

  useEffect(()=>{
    if(!dados.ais||!canvas.current)return;
    const observador=new IntersectionObserver(([entrada])=>setVisivel(entrada.isIntersecting));
    observador.observe(canvas.current.closest(".ma-mapa")??canvas.current);
    return ()=>observador.disconnect();
  },[dados.ais]);

  useEffect(()=>{
    if(!visivel||!dados.ais||!dados.ais.imo||dados.ais.estado==="desativado")return;
    const ac=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    async function atualizar(){
      if(document.hidden){timer=setTimeout(atualizar,30_000);return;}
      let repetir=true;
      try {
        const r=await fetch("/api/inteligencia",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({acao:"mapa_ais",numero:dados.processo}),
          signal:AbortSignal.any([ac.signal,AbortSignal.timeout(18_000)])});
        const resposta=await r.json();
        if(!r.ok){
          repetir=repetir&&(r.status>=500||r.status===408||r.status===429);
          throw new Error(resposta.erro||"Não foi possível atualizar o AIS.");
        }
        if(ac.signal.aborted)return;
        setAis(resposta);
        if(resposta?.imo&&resposta.estado!=="desativado")timer=setTimeout(atualizar,30_000);
      } catch {
        if(ac.signal.aborted)return;
        if(repetir)timer=setTimeout(atualizar,30_000);
      }
    }
    timer=setTimeout(atualizar,20_000);
    return ()=>{ac.abort();clearTimeout(timer);};
  },[dados.ais,dados.processo,visivel]);

  useEffect(()=>{
    if (!canvas.current) return;
    const tamanho = new ResizeObserver(([entrada])=>{
      setDimensoes({largura:entrada.contentRect.width,altura:entrada.contentRect.height});
    });
    tamanho.observe(canvas.current);
    const tema=new MutationObserver(()=>setClaro(document.documentElement.classList.contains("tema-claro")));
    tema.observe(document.documentElement,{attributes:true,attributeFilter:["class"]});
    return ()=>{tamanho.disconnect();tema.disconnect();};
  },[]);

  useEffect(()=>{
    const superficie = canvas.current;
    const ctx=superficie?.getContext("2d");
    const {largura,altura}=dimensoes;
    if (!superficie||!ctx||!largura||!altura) return;
    const dpr=window.devicePixelRatio || 1;
    superficie.width=Math.round(largura*dpr);
    superficie.height=Math.round(altura*dpr);
    ctx.scale(dpr,dpr);
    const escala=Math.min(largura/360,altura/150)*visao.zoom;
    const y=(lat:number)=>altura/2-(lat-visao.lat)*escala;
    const x=(lon:number)=>largura/2+(lon-visao.lon)*escala;
    ctx.fillStyle=claro?"#d9eaf4":"#102435";
    ctx.fillRect(0,0,largura,altura);
    ctx.strokeStyle=claro?"#bfd5e4":"#28445a";
    ctx.lineWidth=1;
    const grade=visao.zoom>=5?5:visao.zoom>=2.5?10:20;
    for(let lat=-60;lat<=80;lat+=grade){
      ctx.beginPath();ctx.moveTo(0,y(lat));ctx.lineTo(largura,y(lat));ctx.stroke();
    }
    for(let lon=-540;lon<=540;lon+=grade){
      const linha=x(lon);
      if(linha<0||linha>largura)continue;
      ctx.beginPath();ctx.moveTo(linha,0);ctx.lineTo(linha,altura);ctx.stroke();
    }
    ctx.fillStyle=claro?"#e9eee7":"#233b42";
    ctx.strokeStyle=claro?"#8d9f99":"#5d7477";
    for(const ring of base?.terra || []){
      for(const deslocamento of [-360,0,360]){
        ctx.beginPath();
        ring.forEach(([lon,lat],i)=>{if(i)ctx.lineTo(x(lon+deslocamento),y(lat));else ctx.moveTo(x(lon+deslocamento),y(lat));});
        ctx.closePath();ctx.fill();ctx.stroke();
      }
    }
    if(base?.paises.length) {
      ctx.save();
      for(const deslocamento of [-360,0,360]){
        ctx.setTransform(dpr*escala,0,0,-dpr*escala,dpr*x(deslocamento),dpr*y(0));
        ctx.lineWidth=0.7/escala;
        for(const pais of base.paises){
          const [o,s,l,n]=pais.b;
          if(x(l+deslocamento)<0||x(o+deslocamento)>largura||y(s)<0||y(n)>altura)continue;
          ctx.fill(pais.path,"evenodd");ctx.stroke(pais.path);
        }
      }
      ctx.restore();
    }
    const rotulos:Array<{left:number;right:number;y:number}>=[];
    const alvos=new Set<string>();
    const escrever = (rotulo:string,lon:number,lat:number,cor:string,prioritario=false) => {
      if(alvos.has(rotulo))return;
      ctx.font=prioritario?"600 12px Inter, system-ui":"500 10px Inter, system-ui";
      const meio=x(visao.lon+lonCentrada(lon-visao.lon));
      const alturaTexto=y(lat)-(prioritario?12:0);
      const w=ctx.measureText(rotulo).width;
      const a=Math.max(w/2+8,Math.min(largura-w/2-8,meio));
      if(meio<0||meio>largura||alturaTexto<12||alturaTexto>altura-5)return;
      const esquerda=a-w/2-4,direita=a+w/2+4;
      if(rotulos.some(r=>Math.abs(r.y-alturaTexto)<14&&r.left<direita&&r.right>esquerda))return;
      rotulos.push({left:esquerda,right:direita,y:alturaTexto});
      alvos.add(rotulo);
      ctx.textBaseline="middle";
      ctx.textAlign="center";
      ctx.fillStyle=cor;
      if(prioritario){
        ctx.strokeStyle=claro?"#f7fafc":"#102435";
        ctx.lineWidth=4;
        ctx.strokeText(rotulo,a,alturaTexto);
      }
      ctx.fillText(rotulo,a,alturaTexto);
    };
    for (const trecho of trechos) {
      if (trecho.cancelado || trecho.ignorado) continue;
      const a=trecho.origem.coords,b=trecho.destino.coords;
      const cor=trecho.id===selecionado?(claro?"#a23521":"#ffae83"):(claro?"#236083":"#89c7e8");
      ctx.strokeStyle=cor;
      ctx.fillStyle=cor;
      ctx.lineWidth=trecho.id===selecionado?2.6:1.5;
      const tracejado=realizados.has(trecho.id+":desembarque")?[]:[7,6];
      const rota=trecho.rota?.pontos??(a&&b?[a,b]:[]);
      for(const deslocamento of [-360,0,360]){
        ctx.setLineDash(tracejado);
        if(rota.length>1){
          let lon=visao.lon+lonCentrada(rota[0][1]-visao.lon);
          ctx.beginPath();ctx.moveTo(x(lon+deslocamento),y(rota[0][0]));
          for(const [lat,proxima] of rota.slice(1)){
            lon+=lonCentrada(proxima-lon);
            ctx.lineTo(x(lon+deslocamento),y(lat));
          }
          ctx.stroke();
        }
        if(trecho.rota?.tipo==="maritima"&&rota.length>1){
          ctx.setLineDash([2,4]);
          for(const [porto,rede] of [[a,rota[0]],[b,rota.at(-1)]]){
            if(!porto||!rede)continue;
            ctx.beginPath();
            ctx.moveTo(x(porto[1]+deslocamento),y(porto[0]));
            ctx.lineTo(x(porto[1]+lonCentrada(rede[1]-porto[1])+deslocamento),y(rede[0]));
            ctx.stroke();
          }
        }
        for(const p of [a,b]){
          if(!p)continue;
          ctx.beginPath();ctx.arc(x(p[1]+deslocamento),y(p[0]),trecho.id===selecionado?5:3.5,0,Math.PI*2);ctx.fill();
        }
      }
      ctx.setLineDash([]);
    }
    if(ultimo?.local.coords){
      const [lat,lon]=ultimo.local.coords;
      ctx.fillStyle=claro?"#0b6c55":"#8aecbb";
      ctx.strokeStyle=claro?"#fff":"#14232f";
      ctx.lineWidth=2;
      for(const deslocamento of [-360,0,360]){
        ctx.beginPath();ctx.arc(x(lon+deslocamento),y(lat),8,0,Math.PI*2);ctx.fill();ctx.stroke();
      }
      escrever(ultimo.local.nome,lon,lat,claro?"#064b40":"#cbffe5",true);
    }
    if(posicao?.coords){
      const [lat,lon]=posicao.coords;
      ctx.fillStyle=claro?"#5144ae":"#c5afff";
      for(const deslocamento of [-360,0,360]){
        const px=x(lon+deslocamento),py=y(lat);
        ctx.beginPath();ctx.moveTo(px,py-9);ctx.lineTo(px+9,py);ctx.lineTo(px,py+9);ctx.lineTo(px-9,py);ctx.closePath();ctx.fill();
      }
      if(posicao.local)escrever(posicao.local,lon,lat,claro?"#382679":"#edddff",true);
    }
    if(posicaoNavio){
      const [lat,lon]=posicaoNavio.coords;
      const cor=claro?"#07558d":"#61ccff";
      ctx.fillStyle=cor;
      ctx.strokeStyle=claro?"#fff":"#14232f";
      ctx.lineWidth=1.8;
      ctx.globalAlpha=ais?.estado==="antiga" ? 0.62 : 1;
      for(const deslocamento of [-360,0,360]){
        const px=x(lon+deslocamento),py=y(lat);
        ctx.beginPath();ctx.arc(px,py,10,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle=claro?"#fff":"#14232f";
        ctx.beginPath();ctx.moveTo(px-5,py-2);ctx.lineTo(px+5,py-2);ctx.lineTo(px+2,py+4);
        ctx.lineTo(px-2,py+4);ctx.closePath();ctx.fill();
        ctx.fillStyle=cor;
      }
      ctx.globalAlpha=1;
      escrever(posicaoNavio.nomeAis||ais?.nome||"Navio · AIS",lon,lat,claro?"#084c78":"#c6eeff",true);
    }
    if(focoEvento){
      ctx.strokeStyle=claro?"#39339b":"#e0d4ff";
      ctx.lineWidth=2;
      for(const deslocamento of [-360,0,360]){
        ctx.beginPath();ctx.arc(x(focoEvento[1]+deslocamento),y(focoEvento[0]),12,0,Math.PI*2);ctx.stroke();
      }
    }
    for(const ponto of [trechoAtual?.origem,trechoAtual?.destino]){
      if(ponto?.coords)escrever(ponto.nome,ponto.coords[1],ponto.coords[0],claro?"#692919":"#ffe9d9",true);
    }
    const rank=Math.min(6,2+Math.floor(Math.log2(visao.zoom)));
    for(const pais of base?.paises || []){
      if(pais.r<=rank)escrever(pais.n,pais.x,pais.y,claro?"#344d4c":"#beced0");
    }
    for(const oceano of oceanos)escrever(oceano.nome,oceano.lon,oceano.lat,claro?"#416e88":"#94b6cf");
    const kmPorPixel=111*Math.cos(visao.lat*Math.PI/180)/escala;
    const larguraEscala=Math.min(110,largura/4);
    const ordem=10**Math.floor(Math.log10(kmPorPixel*larguraEscala));
    const km=[5,2,1].map(n=>n*ordem).find(n=>n/kmPorPixel<=larguraEscala)??ordem;
    ctx.fillStyle=claro?"#30434d":"#dce7ee";
    ctx.fillRect(14,altura-13,km/kmPorPixel,2);
    ctx.textAlign="left";ctx.font="11px Inter, system-ui";ctx.textBaseline="bottom";
    ctx.fillText(`${km.toLocaleString("pt-BR")} km`,14,altura-18);
  },[dimensoes,base,visao,trechos,ultimo,claro,selecionado,trechoAtual,posicao,eventosConfirmados,focoEvento,ais,posicaoNavio]);

  function mover(e:PointerEvent<HTMLCanvasElement>){
    const gesto=arraste.current;
    if(!gesto||gesto.id!==e.pointerId)return;
    const dx=e.clientX-gesto.x,dy=e.clientY-gesto.y;
    if(!gesto.moveu&&Math.hypot(dx,dy)<4)return;
    gesto.moveu=true;
    const escala=Math.min(dimensoes.largura/360,dimensoes.altura/150)*gesto.view.zoom;
    if(escala)setVisao({...gesto.view,lon:lonCentrada(gesto.view.lon-dx/escala),lat:latLimitada(gesto.view.lat+dy/escala)});
  }

  function finalizarGesto(e:PointerEvent<HTMLCanvasElement>){
    const gesto=arraste.current;
    if(!gesto||gesto.id!==e.pointerId)return;
    arraste.current=undefined;
    setArrastando(false);
    if(carteira||gesto.moveu||e.type==="pointercancel")return;
    const r=e.currentTarget.getBoundingClientRect();
    const escala=Math.min(dimensoes.largura/360,dimensoes.altura/150)*visao.zoom;
    const px=e.clientX-r.left-r.width/2,py=e.clientY-r.top-r.height/2;
    function distanciaDoPonto(ponto:Coordenadas){
      return Math.hypot(px-lonCentrada(ponto[1]-visao.lon)*escala,py+(ponto[0]-visao.lat)*escala);
    }
    let escolhido:Trecho|undefined;
    let distancia=17;
    for(const t of trechos){
      if(t.cancelado||t.ignorado)continue;
      for(const ponto of [t.origem.coords,t.destino.coords]){
        if(!ponto)continue;
        const d=distanciaDoPonto(ponto);
        if(d<distancia){distancia=d;escolhido=t;}
      }
    }
    if(escolhido)setSelecionado(escolhido.id);
  }

  function zoom(fator:number){
    setVisao(v=>({...v,zoom:Math.min(24,Math.max(1,v.zoom*fator))}));
  }

  function focar(t:Trecho) {
    setEventoSelecionado(undefined);
    setSelecionado(t.id);
    const locais = [t.origem.coords,t.destino.coords].filter((p):p is Coordenadas=>p!==null);
    if (locais.length) setVisao(enquadrar(locais.concat(t.rota?.pontos??[])));
  }

  return <section className="ma-mapa" aria-label={carteira?"Mapa da carteira":`Mapa do processo ${dados.processo}`}>
    <div className="ma-mapa-quadro">
      <canvas ref={canvas} className={arrastando?"ma-arrastando":undefined} tabIndex={0}
        aria-label={`${carteira?"Mapa dos últimos eventos da carteira":"Mapa dos trechos registrados"}. Use as setas para mover e mais ou menos para ajustar o zoom.`}
        onPointerDown={e=>{
          if(e.button!==0)return;
          arraste.current={id:e.pointerId,x:e.clientX,y:e.clientY,view:visao,moveu:false};
          e.currentTarget.setPointerCapture(e.pointerId);
          setArrastando(true);
        }}
        onPointerMove={mover} onPointerUp={finalizarGesto} onPointerCancel={finalizarGesto}
        onDoubleClick={()=>zoom(1.5)} onKeyDown={e=>{
          if(e.key==="+"||e.key==="="){e.preventDefault();zoom(1.4);return;}
          if(e.key==="-"){e.preventDefault();zoom(1/1.4);return;}
          if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))return;
          e.preventDefault();
          setVisao(v=>{
            const passo=22/v.zoom;
            return {...v,lon:lonCentrada(v.lon+(e.key==="ArrowLeft"?-passo:e.key==="ArrowRight"?passo:0)),
              lat:latLimitada(v.lat+(e.key==="ArrowDown"?-passo:e.key==="ArrowUp"?passo:0))};
          });
        }}/>
      {carteira&&<PontosCarteira grupos={grupos} {...dimensoes} claro={claro} aoSelecionar={aoSelecionarPonto}/>}
      <div className="ma-mapa-controles" aria-label="Controles do mapa">
        <button type="button" aria-label="Ampliar mapa" onClick={()=>zoom(1.4)}>+</button>
        <button type="button" aria-label="Reduzir mapa" onClick={()=>zoom(1/1.4)}>−</button>
        <button type="button" onClick={()=>setVisao(inicial())}>{carteira?"Ver carteira":"Ver rota"}</button>
        {posicaoNavio&&<button type="button" onClick={()=>setVisao(enquadrar([posicaoNavio.coords]))}>Ver navio</button>}
      </div>
    </div>
    {carteira?<ul className="ma-mapa-legenda" aria-label="Legenda do mapa">
      {(Object.keys(estadosCarteira) as MarcadorCarteira["estado"][]).map(estado=><li key={estado}>
        <i className="ma-mapa-marco" style={{background:coresCarteira[estado][claro?0:1]}} aria-hidden/>{estadosCarteira[estado]}
      </li>)}
    </ul>:<>
    <ul className="ma-mapa-legenda" aria-label="Legenda do mapa">
      <li><i className="ma-mapa-marco" aria-hidden/>Último evento registrado</li>
      <li><i className="ma-mapa-realizado" aria-hidden/>Trecho desembarcado</li>
      <li><i className="ma-mapa-previsto" aria-hidden/>Trecho sem desembarque registrado</li>
      {posicao&&<li><i className="ma-mapa-tracking" aria-hidden/>Local do evento de tracking</li>}
      {posicaoNavio&&<li><i className="ma-mapa-ais-marca" aria-hidden/>Posição do navio · AIS</li>}
      {trechos.some(t=>t.rota?.tipo==="maritima")&&<li><i className="ma-mapa-conector" aria-hidden/>Ligação do porto à rede marítima</li>}
    </ul>
    <div className="ma-mapa-posicao">
      <strong>{ultimo ? `Último registro: ${ultimo.tipo} em ${ultimo.local.nome}` : "Ainda sem etapa realizada registrada"}</strong>
      {ultimo && <span>{dataBrasil(ultimo.data)}{emTransito ? " · Em trânsito segundo o último embarque" : ""}</span>}
      <p>{posicao?`Último local com coordenadas recebidas · ${posicao.local||posicao.descricao||"Evento"} · ${dataHora.format(new Date(posicao.data))} · ${posicao.fonte}`:"Sem coordenadas recebidas pelo tracking."}</p>
      {mapaIndisponivel&&<p>Base geográfica indisponível.</p>}
      {incompletos>0&&<p>{incompletos} {incompletos===1?"trecho com local":"trechos com locais"} sem coordenadas identificadas.</p>}
      {dados.limitado&&<p>Exibindo os primeiros 200 trechos do processo.</p>}
    </div>
    {trechoAtual&&<dl className="ma-mapa-detalhe">
      <div><dt>Origem</dt><dd>{trechoAtual.origem.nome}{trechoAtual.origem.codigo&&<small>{trechoAtual.origem.codigo}</small>}</dd></div>
      <div><dt>Destino</dt><dd>{trechoAtual.destino.nome}{trechoAtual.destino.codigo&&<small>{trechoAtual.destino.codigo}</small>}</dd></div>
      <div><dt>Transportadora e viagem</dt><dd>{[trechoAtual.transportadora,trechoAtual.viagem].filter(Boolean).join(" · ")||"—"}</dd></div>
      <div><dt>{nomeModal(trechoAtual.modal)}</dt><dd>{trechoAtual.rota?rotas[trechoAtual.rota.tipo]:"Sem traçado"}
        {trechoAtual.rota?.km!=null&&<small>{trechoAtual.rota.km.toLocaleString("pt-BR")} km</small>}
        {!!trechoAtual.rota?.passagens?.length&&<small>{trechoAtual.rota.passagens.map(p=>passagensMaritimas[p]??p).join(" · ")}</small>}
      </dd></div>
      <div><dt>Embarque</dt><dd>{dataBrasil(saiu?trechoAtual.embarque:trechoAtual.saidaPrevista)} <small>{saiu?"Registrado":"Previsto"}</small></dd></div>
      <div><dt>Desembarque</dt><dd>{dataBrasil(chegou?trechoAtual.desembarque:trechoAtual.chegadaPrevista)} <small>{chegou?"Registrado":"Previsto"}</small>
        {!trechoAtual.cancelado&&!trechoAtual.ignorado&&atrasoChegada!=null&&atrasoChegada>0&&
          <small className="ma-mapa-alerta">{atrasoChegada} {atrasoChegada===1?"dia":"dias"} de atraso</small>}
      </dd></div>
    </dl>}
    {trechos.length>0 ? <ol className="ma-mapa-etapas">{trechos.map((t,i)=><li key={t.id}>
      <button type="button" aria-pressed={t.id===selecionado} onClick={()=>focar(t)}>
        <strong>{t.sequencia ?? i+1}. {t.origem.nome} → {t.destino.nome}</strong>
        <span>{estadoTrecho(t,realizados)}</span>
      </button>
    </li>)}</ol> : <p>Nenhum embarque ou viagem preenchido para este processo.</p>}
    {eventos.length>0&&<details className="ma-mapa-painel" open>
      <summary>Linha do tempo <span>{eventos.length}</span></summary>
      <ol className="ma-mapa-cronologia">{eventos.map(e=><li key={e.chave}>
        <button type="button" aria-pressed={eventoSelecionado===e.chave} onClick={()=>{
          setEventoSelecionado(e.chave);
          if(e.trecho!=null)setSelecionado(e.trecho);
          if(e.local.coords)setVisao(enquadrar([e.local.coords]));
        }}>
          <time dateTime={e.data}>{dataBrasil(e.data)}</time>
          <strong>{e.nome}</strong><span>{e.local.nome} · {e.estado}</span>
        </button>
      </li>)}</ol>
    </details>}
    <details className="ma-mapa-painel">
      <summary>Histórico de previsões <span>{dados.historico?.length??0}</span></summary>
      {dados.historico?.length?<ul className="ma-mapa-revisoes">{dados.historico.slice().reverse().map(h=>{
        const trecho=trechos.find(t=>t.id===h.idTrecho);
        return <li key={h.id+":"+h.campo}>
          <strong>{h.campo==="chegadaPrevista"?"Previsão de chegada":"Previsão de saída"}</strong>
          {trecho&&<button type="button" onClick={()=>focar(trecho)}>{trecho.origem.nome} → {trecho.destino.nome}</button>}
          <span>{dataBrasil(h.de)} → {dataBrasil(h.para)}</span>
          {h.dias!=null&&<span className={h.dias>0?"ma-mapa-alerta":undefined}>{h.dias>0?"+":""}{h.dias} {Math.abs(h.dias)===1?"dia":"dias"}</span>}
          <small>{h.data?dataHora.format(new Date(h.data)):"Previsão atual cadastrada"}</small>
        </li>;
      })}</ul>:<p>Nenhuma mudança de previsão encontrada no histórico deste processo.</p>}
      {dados.historicoLimitado&&<p>Exibindo as mudanças identificadas nos 500 registros mais recentes.</p>}
    </details>
    </>}
  </section>;
}
