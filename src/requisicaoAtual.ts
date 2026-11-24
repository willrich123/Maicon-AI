export class RequisicaoAtual {
 private controle:AbortController|undefined;
 iniciar(){this.controle?.abort();const c=new AbortController();this.controle=c;return c;}
 atual(c:AbortController){return this.controle===c&&!c.signal.aborted;}
 cancelar(){this.controle?.abort();this.controle=undefined;}
}
