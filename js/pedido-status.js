(()=>{
  const aliases={novo:'confirmado',entregue:'finalizado',concluido:'finalizado','concluído':'finalizado',em_preparo:'preparo',saiu_para_entrega:'saiu_entrega'};
  const labels={aguardando_aprovacao:'Aguardando aprovação',confirmado:'Na fila da cozinha',preparo:'Em preparo',pronto:'Pronto',saiu_entrega:'Em rota',finalizado:'Finalizado',cancelado:'Cancelado'};
  const active=['aguardando_aprovacao','confirmado','preparo','pronto','saiu_entrega'];
  const normalize=value=>{const key=String(value||'confirmado').toLowerCase().trim().replace(/[\s-]+/g,'_');return aliases[key]||key};
  const typeLabel=value=>({mesa:'Mesa',local:'Consumo local',retirada:'Retirada',entrega:'Entrega'})[value]||value||'Pedido';
  const label=(status,type)=>{const value=normalize(status);if(value==='pronto')return type==='entrega'?'Pronto para entrega':type==='retirada'?'Pronto para retirada':'Pronto para servir';return labels[value]||value};
  const css=status=>({aguardando_aprovacao:'novo',confirmado:'novo',saiu_entrega:'pronto',finalizado:'entregue'})[normalize(status)]||normalize(status);
  const isFinal=status=>['finalizado','cancelado'].includes(normalize(status));
  const canTransition=(from,to,type)=>{const a=normalize(from),b=normalize(to);return(a==='aguardando_aprovacao'&&b==='confirmado')||(a==='confirmado'&&b==='preparo')||(a==='preparo'&&b==='pronto')||(a==='pronto'&&['mesa','local','retirada'].includes(type)&&b==='finalizado')||(a==='pronto'&&type==='entrega'&&b==='saiu_entrega')||(a==='saiu_entrega'&&type==='entrega'&&b==='finalizado')||(!isFinal(a)&&b==='cancelado')};
  window.FSOrderStatus=Object.freeze({aliases,labels,active,normalize,typeLabel,label,css,isFinal,canTransition});
})();
