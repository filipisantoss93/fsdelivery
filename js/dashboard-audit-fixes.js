(()=>{
  const byIdSafe=id=>document.getElementById(id);
  const setText=(id,value)=>{const element=byIdSafe(id);if(element)element.textContent=value};
  const isToday=date=>{
    const value=date instanceof Date?date:new Date(date);
    const now=new Date();
    return value.getFullYear()===now.getFullYear()&&value.getMonth()===now.getMonth()&&value.getDate()===now.getDate();
  };

  function syncStoreStatus(){
    if(typeof store==='undefined'||!store)return;
    const label=byIdSafe('store-status-label');
    const button=byIdSafe('store-status-button');
    if(label)label.textContent=store.aberto?'Loja aberta':'Loja fechada';
    if(button){
      button.setAttribute('aria-label',store.aberto?'Loja aberta. Toque para fechar':'Loja fechada. Toque para abrir');
      button.title=store.aberto?'Fechar loja':'Abrir loja';
    }
  }

  function renderProductAlert(){
    const recent=byIdSafe('recent-orders');
    if(!recent||typeof products==='undefined')return;
    let alert=byIdSafe('dashboard-product-alert');
    const hasActive=products.some(product=>product.active);
    if(hasActive){alert?.remove();return}
    if(!alert){
      alert=document.createElement('div');
      alert.id='dashboard-product-alert';
      alert.className='empty-state';
      alert.innerHTML='<b>Nenhum produto ativo no cardápio.</b><br><a class="btn btn-secondary" href="configuracoes.html">Revisar estabelecimento</a>';
      recent.parentElement?.insertBefore(alert,recent);
    }
  }

  function applyDashboardCorrections(){
    if(typeof orders==='undefined'||typeof money!=='function')return;
    const todayOrders=orders.filter(order=>order.status!=='cancelado'&&isToday(order.createdAt));
    const revenue=todayOrders.reduce((total,order)=>total+Number(order.total||0),0);
    const preparing=todayOrders.filter(order=>order.status==='preparo').length;

    setText('metric-orders',todayOrders.length);
    setText('metric-revenue',money(revenue));
    setText('metric-ticket',money(todayOrders.length?revenue/todayOrders.length:0));
    setText('metric-preparing',preparing);
    setText('summary-preparing',preparing);

    const recent=byIdSafe('recent-orders');
    if(recent&&typeof orderCard==='function'){
      recent.innerHTML=todayOrders.slice(0,4).map(order=>orderCard(order,true)).join('')||'<div class="empty-state"><b>Nenhum pedido recebido hoje.</b><br><a class="btn btn-primary" href="garcom.html">Criar pedido</a></div>';
    }

    const newOrderButton=byIdSafe('new-order-btn');
    if(newOrderButton)newOrderButton.onclick=()=>location.href='garcom.html';

    renderProductAlert();
    syncStoreStatus();
  }

  function install(){
    if(typeof render!=='function'||typeof orders==='undefined'||typeof products==='undefined'||typeof store==='undefined'){
      setTimeout(install,100);
      return;
    }

    if(!render.__dashboardAuditWrapped){
      const originalRender=render;
      const wrappedRender=function(...args){
        const result=originalRender.apply(this,args);
        applyDashboardCorrections();
        return result;
      };
      wrappedRender.__dashboardAuditWrapped=true;
      render=wrappedRender;
    }

    if(typeof setupLabels==='function'&&!setupLabels.__dashboardAuditWrapped){
      const originalSetupLabels=setupLabels;
      const wrappedSetupLabels=function(...args){
        const result=originalSetupLabels.apply(this,args);
        syncStoreStatus();
        return result;
      };
      wrappedSetupLabels.__dashboardAuditWrapped=true;
      setupLabels=wrappedSetupLabels;
    }

    applyDashboardCorrections();
  }

  install();
})();
