const db=window.supabaseClient;
const form=document.getElementById('role-login');
const feedback=document.getElementById('role-feedback');
const phoneInput=document.getElementById('role-phone');
const TEAM_SESSION_KEY='fsdelivery_team';

phoneInput.addEventListener('input',()=>{
 const digits=phoneInput.value.replace(/\D/g,'').slice(0,11);
 phoneInput.value=digits.length>10
  ?digits.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3')
  :digits.length>6
   ?digits.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3')
   :digits.length>2
    ?digits.replace(/(\d{2})(\d+)/,'($1) $2')
    :digits;
});

form.addEventListener('submit',async event=>{
 event.preventDefault();
 const role=form.dataset.role;
 const destination=form.dataset.destination;
 const data=new FormData(form);
 const phone=String(data.get('phone')||'').replace(/\D/g,'');
 const pin=String(data.get('pin')||'').replace(/\D/g,'');

 if(phone.length<10||phone.length>11){
  feedback.textContent='Informe um WhatsApp válido.';
  return;
 }
 if(pin.length<4||pin.length>6){
  feedback.textContent='O PIN deve ter entre 4 e 6 números.';
  return;
 }

 const button=form.querySelector('button[type="submit"]');
 button.disabled=true;
 button.textContent='Localizando restaurante...';
 feedback.textContent='';

 try{
  const {data:member,error}=await db.rpc('autenticar_equipe_por_whatsapp',{
   p_telefone:phone,
   p_pin:pin,
   p_funcao:role
  });
  if(error)throw error;
  if(!member?.estabelecimento_id||member.funcao!==role)throw new Error('Cadastro da equipe inválido.');

  sessionStorage.setItem(TEAM_SESSION_KEY,JSON.stringify({
   ...member,
   phone,
   pin,
   authenticated_at:Date.now()
  }));
  feedback.textContent=`Restaurante encontrado: ${member.restaurante}`;
  setTimeout(()=>location.replace(destination),350);
 }catch(error){
  sessionStorage.removeItem(TEAM_SESSION_KEY);
  feedback.textContent=error.message||'Não foi possível realizar o acesso.';
  button.disabled=false;
  button.textContent='Entrar';
 }
});