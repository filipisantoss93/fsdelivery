(()=>{
  'use strict';

  if(window.__fsConfigModalBootstrap)return;
  window.__fsConfigModalBootstrap=true;

  const isConfigPage=()=>{
    const page=(location.pathname.split('/').pop()||'').toLowerCase();
    return page==='configuracoes.html'||document.body?.classList.contains('config-body');
  };

  function openModal(id){
    const modal=document.getElementById(id);
    if(!modal||modal.tagName!=='DIALOG')return;

    document.querySelectorAll('dialog.config-modal[open]').forEach(item=>{
      if(item!==modal){
        if(typeof item.close==='function')item.close();
        else item.removeAttribute('open');
      }
    });

    try{
      if(!modal.open){
        if(typeof modal.showModal==='function')modal.showModal();
        else modal.setAttribute('open','');
      }
    }catch(error){
      console.error('Falha ao abrir modal de configuração:',error);
      modal.setAttribute('open','');
    }

    document.body.classList.add('config-modal-open');
    history.replaceState(null,'',`#${id}`);
  }

  function closeModal(modal){
    if(!modal)return;
    try{
      if(typeof modal.close==='function'&&modal.open)modal.close();
      else modal.removeAttribute('open');
    }catch(error){
      modal.removeAttribute('open');
    }
    if(!document.querySelector('dialog.config-modal[open]'))document.body.classList.remove('config-modal-open');
    history.replaceState(null,'',location.pathname+location.search);
  }

  function bind(){
    if(!isConfigPage())return;

    document.addEventListener('click',event=>{
      const trigger=event.target.closest('[data-target]');
      if(trigger){
        const target=trigger.dataset.target;
        if(target&&document.getElementById(target)?.matches('dialog.config-modal')){
          event.preventDefault();
          openModal(target);
          return;
        }
      }

      const closeButton=event.target.closest('.config-modal-close');
      if(closeButton){
        event.preventDefault();
        closeModal(closeButton.closest('dialog.config-modal'));
        return;
      }

      const dialog=event.target.closest('dialog.config-modal');
      if(dialog&&event.target===dialog)closeModal(dialog);
    });

    document.querySelectorAll('dialog.config-modal').forEach(modal=>{
      modal.addEventListener('close',()=>{
        if(!document.querySelector('dialog.config-modal[open]'))document.body.classList.remove('config-modal-open');
      });
      modal.addEventListener('cancel',event=>{
        event.preventDefault();
        closeModal(modal);
      });
    });

    const requested=location.hash.slice(1);
    if(requested&&document.getElementById(requested)?.matches('dialog.config-modal'))openModal(requested);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
