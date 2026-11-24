import marca from './assets/maicon-symbol-white.png';

export function CabecalhoWorkspace({area, ambiente, painelIA, alternarIA}:{
  area:'operacao'|'comercial'; ambiente:string; painelIA:boolean; alternarIA:()=>void;
}) {
  return <header className="mw-header">
    <a className="mw-brand" href="/headcargo"><img src={marca} alt=""/><strong>Maicon<span>Workspace</span></strong></a>
    <nav aria-label="Navegação">
      <a href="/headcargo" aria-current={area==='operacao'?'page':undefined}>Operação</a>
      <a href="/headcargo/comercial" aria-current={area==='comercial'?'page':undefined}>Comercial</a>
      <a href="/headcargo/catalogo">Biblioteca de telas</a>
    </nav>
    <div>
      <span className="mw-version">Workspace 3.0</span>
      {ambiente==='homologacao' && <span className="mw-env-homolog">Homologação</span>}
      <button className="mw-ai-toggle" aria-pressed={painelIA} onClick={alternarIA}>✦ Maicon IA</button>
      <a href="/">Chat ↗</a>
    </div>
  </header>;
}

export function RecolherWorkspace({recolhida, alternar, alvo, descricao}:{
  recolhida:boolean; alternar:()=>void; alvo:string; descricao:string;
}) {
  const rotulo=(recolhida?'Expandir ':'Recolher ')+descricao;
  return <button className="mw-sidebar-collapse" aria-label={rotulo} title={rotulo} aria-expanded={!recolhida} aria-controls={alvo} onClick={alternar}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d={recolhida?'m13 9 3 3-3 3':'m16 9-3 3 3 3'}/>
    </svg>
  </button>;
}
