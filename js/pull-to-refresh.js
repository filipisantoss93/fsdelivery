(()=>{
  'use strict';

  if(window.__fsPullToRefreshInitialized)return;
  window.__fsPullToRefreshInitialized=true;

  const isTouchDevice=('ontouchstart' in window)||navigator.maxTouchPoints>0;
  if(!isTouchDevice)return;

  const THRESHOLD=72;
  const MAX_PULL=118;
  let startY=0;
  let pull=0;
  let tracking=false;
  let refreshing=false;

  const indicator=document.createElement('div');
  indicator.className='fs-pull-refresh';
  indicator.setAttribute('role','status');
  indicator.setAttribute('aria-live','polite');
  indicator.innerHTML='<span class="fs-pull-refresh__icon" aria-hidden="true">↓</span><span class="fs-pull-refresh__text">Arraste para atualizar</span>';
  document.body.appendChild(indicator);

  const text=indicator.querySelector('.fs-pull-refresh__text');
  const blockedTarget=target=>target.closest('input,textarea,select,[contenteditable="true"],.modal.open,.category-tabs,.kanban,.table');
  const pageAtTop=()=>window.scrollY<=0&&document.documentElement.scrollTop<=0;

  function reset(){
    tracking=false;
    pull=0;
    indicator.classList.remove('is-visible','is-ready');
    indicator.style.transform='translate(-50%,-54px)';
    text.textContent='Arraste para atualizar';
  }

  document.addEventListener('touchstart',event=>{
    if(refreshing||event.touches.length!==1||!pageAtTop()||blockedTarget(event.target))return;
    startY=event.touches[0].clientY;
    pull=0;
    tracking=true;
  },{passive:true});

  document.addEventListener('touchmove',event=>{
    if(!tracking||refreshing||event.touches.length!==1)return;
    const delta=event.touches[0].clientY-startY;
    if(delta<=0){reset();return;}
    if(!pageAtTop()){reset();return;}

    pull=Math.min(MAX_PULL,delta*.58);
    if(pull<8)return;

    event.preventDefault();
    const ready=pull>=THRESHOLD;
    indicator.classList.add('is-visible');
    indicator.classList.toggle('is-ready',ready);
    indicator.style.transform=`translate(-50%,${Math.min(18,pull-54)}px)`;
    text.textContent=ready?'Solte para atualizar':'Arraste para atualizar';
  },{passive:false});

  document.addEventListener('touchend',()=>{
    if(!tracking||refreshing)return;
    if(pull<THRESHOLD){reset();return;}

    refreshing=true;
    tracking=false;
    indicator.classList.remove('is-ready');
    indicator.classList.add('is-visible','is-refreshing');
    indicator.style.transform='translate(-50%,12px)';
    text.textContent='Atualizando…';
    window.setTimeout(()=>window.location.reload(),180);
  },{passive:true});

  document.addEventListener('touchcancel',reset,{passive:true});
})();
