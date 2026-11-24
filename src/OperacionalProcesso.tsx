import { useEffect, useRef, useState, type ReactNode } from "react";
import {rotuloOperacional,grupoOperacional,exibirValorOperacional,mesclarNomesOperacionais} from './apresentacaoOperacional';
import {EmbarqueProcesso} from './EmbarqueProcesso';
import {ArquivosProcesso} from './ArquivosProcesso';
import {MapaProcesso} from './MapaProcesso';
type Secao = { id: string; titulo: string };
type Dados = { titulo: string; colunas: { id: string; rotulo: string; tipo: string }[]; nomes?:Record<string,Record<string,string>>; linhas: Record<string,unknown>[]; total: number; pagina: number; temMais: boolean; conteudosBinarios?: number };
async function consultar<T>(rota: string, body: object): Promise<T> {
  const r=await fetch(`/api/ponte/web/operacional/${rota}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const d=await r.json().catch(()=>null);if(!r.ok||!d)throw new Error(d?.erro||"Não foi possível carregar os dados desta seção.");return d;
}
export function OperacionalProcesso({numero,children,aoPerguntar}:{numero:string;children:ReactNode;aoPerguntar?:(texto:string)=>void}) {
  const [secoes,setSecoes]=useState<Secao[]>([]),[secao,setSecao]=useState("");
  const [dados,setDados]=useState<Dados|null>(null),[erro,setErro]=useState(""),[ocupado,setOcupado]=useState(false);
  const [filtro,setFiltro]=useState(""),[vazios,setVazios]=useState(false);
  const geracao=useRef(0),trava=useRef(false);
  useEffect(()=>{let ativo=true;setSecoes([]);setSecao("");setDados(null);setErro("");geracao.current++;
    void consultar<{secoes:Secao[]}>("secoes",{numero}).then(r=>{if(ativo){setSecoes(r.secoes);const house=r.secoes.find(s=>s.id==='mov_Logistica_House');if(house)void abrir(house.id);}}).catch(e=>{if(ativo)setErro(e.message);});
    return()=>{ativo=false;geracao.current++;};
  },[numero]);
  async function abrir(id:string,mais=false) {
    if(trava.current)return;
    geracao.current++;const atual=geracao.current;trava.current=true;setOcupado(true);setErro("");setSecao(id);
    if(!mais){setDados(null);setFiltro("");setVazios(false);}
    if(!id||id==='embarque'||id==='mapa'||id==='mov_Projeto_Atividade_Arquivo'){trava.current=false;setOcupado(false);return;}
    try {const r=await consultar<Dados>("dados",{numero,secao:id,pagina:mais?(dados?.pagina??0)+1:0});if(geracao.current===atual)setDados(anterior=>mais&&anterior?{...r,nomes:mesclarNomesOperacionais(anterior.nomes,r.nomes),linhas:[...anterior.linhas,...r.linhas]}:r);}
    catch(e){if(geracao.current===atual)setErro(e instanceof Error?e.message:"Falha de conexão.");}
    finally{trava.current=false;setOcupado(false);}
  }
  const tecnico=(id:string)=>/^Id[A-Z_]/.test(id)&&!dados?.nomes?.[id];
  const colunas=dados?.colunas.filter(c=>!tecnico(c.id)&&c.id!=='Valor_Tipo_Fixo'&&(!filtro||rotuloOperacional(c.id,c.rotulo).toLowerCase().includes(filtro.toLowerCase()))&&(vazios||dados.linhas.some(l=>l[c.id]!==null&&l[c.id]!==undefined&&l[c.id]!=="")))||[];
  const celula=(l:Record<string,unknown>,c:{id:string;tipo:string})=>exibirValorOperacional(l[c.id],c,dados?.nomes?.[c.id]);
  const grupos=['Identificação e detalhes','Envolvidos','Carga e transporte','Datas e prazos','Situações e opções','Instruções e observações','Informações técnicas'].map(nome=>({nome,campos:colunas.filter(c=>grupoOperacional(c.id,tecnico(c.id))===nome)})).filter(g=>g.campos.length);
  const principais=[['embarque','Embarque e viagens'],['mapa','Mapa da carga'],['mov_Logistica_Comissao','Comissões'],['mov_Logistica_Taxa','Taxas'],['mov_Logistica_Fatura','Faturas'],['','Atividades'],['mov_Acompanhamento','Acompanhamentos'],['mov_Projeto_Atividade_Mensagem','Mensagens'],['mov_Projeto_Atividade_Arquivo','Arquivos']];
  const processo=!principais.some(([id])=>id===secao);
  const atalhos=[['mov_Logistica_House','House'],['mov_Logistica_Master','Master'],['mov_Projeto_Atividade_Contato','Contatos'],['mov_Logistica_Embalagem','Carga'],['mov_Logistica_Campo_Livre','Campos livres']];
  return <section className="hc-operacional">
    <nav className="hc-secoes" aria-label="Dados do processo"><button disabled={ocupado} aria-current={processo?'page':undefined} onClick={()=>void abrir('mov_Logistica_House')}>Processo</button>{principais.filter(([id])=>!id||id==='embarque'||id==='mapa'||secoes.some(s=>s.id===id)).map(([id,label])=><button key={id} disabled={ocupado} aria-current={secao===id?'page':undefined} onClick={()=>void abrir(id)}>{label}</button>)}</nav>
    {processo&&<div className="op-subtabs">{atalhos.filter(([id])=>secoes.some(s=>s.id===id)).map(([id,label])=><button key={id} disabled={ocupado} aria-current={secao===id?'page':undefined} onClick={()=>void abrir(id)}>{label}</button>)}<select aria-label="Mais dados do processo" disabled={ocupado} value={atalhos.some(([id])=>id===secao)?'':secao} onChange={e=>{if(e.target.value)void abrir(e.target.value);}}><option value="">Mais dados…</option>{secoes.filter(s=>!principais.some(([id])=>id===s.id)&&!atalhos.some(([id])=>id===s.id)).map(s=><option key={s.id} value={s.id}>{s.titulo}</option>)}</select></div>}
    {secao==='mov_Projeto_Atividade_Arquivo'?<ArquivosProcesso key={numero} numero={numero}/>:secao==='embarque'?<EmbarqueProcesso numero={numero} aoPerguntar={aoPerguntar}/>:secao==='mapa'?<MapaProcesso key={numero} numero={numero}/>:!secao?children:<>
      <div className="hc-dados-cab"><h3>{secoes.find(s=>s.id===secao)?.titulo}</h3><input aria-label="Pesquisar campos" placeholder="Pesquisar campo…" value={filtro} onChange={e=>setFiltro(e.target.value)}/><label><input type="checkbox" checked={vazios} onChange={e=>setVazios(e.target.checked)}/> Mostrar campos vazios</label></div>
      {dados&&dados.total>0&&!colunas.length?<p className="hc-dados-nota">Nenhuma informação descritiva disponível com os filtros atuais.</p>:dados&&(dados.total===0?<p>Nenhum registro nesta seção para este processo.</p>:dados.total===1?<div className="mw-data-groups">{grupos.map(g=><section className="mw-data-group" key={g.nome}><header><h4>{g.nome}</h4><span>{g.campos.length} campos</span></header><dl>{g.campos.map(c=><div key={c.id} className={String(dados.linhas[0]?.[c.id]||'').length>140?'mw-field-long':''}><dt>{rotuloOperacional(c.id,c.rotulo)}</dt><dd>{celula(dados.linhas[0]||{},c)}</dd></div>)}</dl></section>)}</div>:<div className="ponte-tabela"><table><thead><tr>{colunas.map(c=><th key={c.id}>{rotuloOperacional(c.id,c.rotulo)}</th>)}</tr></thead><tbody>{dados.linhas.map((l,i)=><tr key={i}>{colunas.map(c=><td key={c.id}>{celula(l,c)}</td>)}</tr>)}</tbody></table></div>)}
      {dados&&<div className="ponte-rodape"><span>Exibindo {dados.linhas.length} de {dados.total} registros</span>{dados.temMais&&<button disabled={ocupado} onClick={()=>void abrir(secao,true)}>Ver mais +50</button>}</div>}
      {!!dados?.conteudosBinarios&&<p className="hc-dados-nota">Esta seção contém arquivos binários. Os metadados estão disponíveis; a abertura dos arquivos ainda não foi integrada.</p>}
    </>}
    {ocupado&&<p className="ponte-andamento" role="status"><span/>Carregando dados do HeadCargo…</p>}
    {erro&&<div className="ponte-erro" role="alert">{erro}{secao&&<button onClick={()=>void abrir(secao)}>Tentar novamente</button>}</div>}
  </section>;
}
