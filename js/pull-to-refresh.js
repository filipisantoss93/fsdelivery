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

  const style=document.createElement('style');
  style.textContent=`
    .fs-pull-refresh{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;z-index:9999;display:flex;align-items:center;gap:8px;min-height:38px;padding:8px 13px;border:1px solid var(--line,#3b2d22);border-radius:999px;background:var(--surface,#211913);color:var(--text,#fffaf3);box-shadow:0 10px 28px rgba(0,0,0,.28);font:700 12px/1 Inter,system-ui,-apple-system,sans-serif;opacity:0;pointer-events:none;transform:translate(-50%,-54px);transition:opacity .16s ease,transform .16s ease}.fs-pull-refresh.is-visible{opacity:1}.fs-pull-refresh__icon{display:grid;place-items:center;width:18px;height:18px;font-size:17px;line-height:1;transform:rotate(0deg)}.fs-pull-refresh.is-ready .fs-pull-refresh__icon{transform:rotate(180deg)}.fs-pull-refresh.is-refreshing .fs-pull-refresh__icon{animation:fs-pull-spin .7s linear infinite}.store-body .fs-pull-refresh{border-color:var(--store-line,#e8ddd2);background:var(--store-surface,#fff);color:var(--store-text,#2a1b10)}@keyframes fs-pull-spin{to{transform:rotate(360deg)}}@media (min-width:900px) and (hover:hover){.fs-pull-refresh{display:none}}
  `;
  document.head.appendChild(style);

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
