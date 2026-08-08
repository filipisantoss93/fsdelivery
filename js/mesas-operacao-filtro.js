(()=>{
  'use strict';
  const filter=document.getElementById('table-status-filter');
  const grid=document.getElementById('operational-tables-grid');
  if(!filter||!grid)return;
  const apply=()=>{
    const value=filter.value;
    [...grid.children].forEach(card=>{
      if(card.classList.contains('empty-state'))return;
      const text=(card.textContent||'').toLowerCase();
      const free=text.includes('livre')||text.includes('disponível');
      const matches=!value||(value==='livre'&&free)||(value==='ocupada'&&!free);
      card.hidden=!matches;
    });
  };
  filter.addEventListener('change',apply);
  new MutationObserver(apply).observe(grid,{childList:true,subtree:true});
})();
