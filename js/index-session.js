(async()=>{
  'use strict';
  try{
    const {data:{session}}=await window.supabaseClient.auth.getSession();
    if(session)location.replace('app.html');
  }catch(error){
    console.error('Falha ao verificar sessão ativa na landing page',error);
  }
})();
