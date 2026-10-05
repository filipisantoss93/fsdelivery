import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, apikey, x-client-info, authorization","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Secret ausente: ${name}`);return value};
const digits=(value:unknown)=>String(value||"").replace(/\D/g,"");
function validCpf(value:string){if(value.length!==11||/^([0-9])\1{10}$/.test(value))return false;const calc=(size:number)=>{let sum=0;for(let i=0;i<size;i++)sum+=Number(value[i])*(size+1-i);const rest=(sum*10)%11;return rest===10?0:rest};return calc(9)===Number(value[9])&&calc(10)===Number(value[10])}
const normalizeEnvironment=(value:unknown)=>String(value||"homologacao").toLowerCase().startsWith("prod")?"producao":"homologacao";
const envFirst=(names:string[])=>{for(const name of names){const value=String(Deno.env.get(name)||"").trim();if(value)return value}throw new Error("Credenciais Efí indisponíveis para o ambiente selecionado.")};
const text=(value:unknown,label:string,max=180)=>{const v=String(value||"").trim();if(!v)throw new Error(`${label} é obrigatório.`);return v.slice(0,max)};

async function efi(config:{baseUrl:string;clientId:string;clientSecret:string},path:string,options:RequestInit={}){
  const auth=await fetch(`${config.baseUrl}/v1/authorize`,{method:"POST",headers:{Authorization:`Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials"})});
  const authBody=await auth.json().catch(()=>({}));const token=authBody?.access_token||authBody?.data?.access_token;
  if(!auth.ok||!token)throw new Error("Falha de autorização na Efí.");
  const response=await fetch(`${config.baseUrl}${path}`,{...options,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(options.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||(payload?.code&&Number(payload.code)>=400))throw new Error(String(payload?.error_description||payload?.error||payload?.message||payload?.data?.message||"A Efí recusou a cobrança."));
  return payload;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({erro:"Método não permitido"},405);
  if(Number(req.headers.get("content-length")||0)>32768)return json({erro:"Requisição inválida."},413);
  const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
  let attemptId:string|null=null;
  try{
    const body=await req.json().catch(()=>({}));
    const checkoutToken=String(body?.checkout_token||"").trim(),requestKey=String(body?.idempotency_key||"").trim(),slug=String(body?.slug||"").trim().toLowerCase();
    if(!/^[0-9a-f-]{36}$/i.test(checkoutToken)||!/^[0-9a-f-]{36}$/i.test(requestKey))return json({erro:"Identificador do pedido inválido."},400);
    if(slug&&!/^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/.test(slug))return json({erro:"Loja inválida."},400);
    const {data:order,error:orderError}=await admin.from("pedidos").select("id,codigo,estabelecimento_id,total,status,pagamento_status,efi_charge_id,checkout_token,origem,forma_pagamento").eq("checkout_token",checkoutToken).maybeSingle();
    if(orderError)throw orderError;
    if(!order)return json({erro:"Pedido não encontrado."},404);
    if(order.origem!=="publico"||order.forma_pagamento!=="Pix on-line")return json({erro:"Pedido não foi criado para Pix on-line."},409);
    if(["finalizado","entregue"].includes(String(order.status)))return json({erro:"Pedido não aceita nova cobrança."},409);
    if(slug){const {data:store,error}=await admin.from("estabelecimentos").select("id").eq("slug",slug).maybeSingle();if(error)throw error;if(!store||store.id!==order.estabelecimento_id)return json({erro:"Loja inválida para este pedido."},404)}

    const {data:integration,error:integrationError}=await admin.from("integracoes_pagamento_estabelecimento").select("payee_code,conta_validada,pix_online_ativo,split_ativo,percentual_comissao_bps,modo_tarifa,ambiente,status").eq("estabelecimento_id",order.estabelecimento_id).maybeSingle();
    if(integrationError)throw integrationError;
    if(!integration||!integration.conta_validada||integration.status!=="ativo"||!integration.pix_online_ativo||!integration.split_ativo||!integration.payee_code)return json({erro:"Pix on-line indisponível para este estabelecimento."},409);
    const config=normalizeEnvironment(integration.ambiente)==="producao"
      ?{baseUrl:"https://cobrancas.api.efipay.com.br",clientId:envFirst(["EFI_CLIENT_ID_PRODUCAO"]),clientSecret:envFirst(["EFI_CLIENT_SECRET_PRODUCAO"])}
      :{baseUrl:"https://cobrancas-h.api.efipay.com.br",clientId:envFirst(["EFI_CLIENT_ID_HOMOLOGACAO"]),clientSecret:envFirst(["EFI_CLIENT_SECRET_HOMOLOGACAO"])};
    const ambiente=normalizeEnvironment(integration.ambiente),valorCentavos=Math.round(Number(order.total)*100),commissionBps=Number(integration.percentual_comissao_bps||0),restaurantPercentage=10000-commissionBps;
    if(!Number.isSafeInteger(valorCentavos)||valorCentavos<=0||commissionBps<0||commissionBps>=10000)throw new Error("Divisão ou valor da venda inválido.");

    const customer=body?.customer||{};const cpf=digits(customer.cpf),phone=digits(customer.phone_number);
    if(!validCpf(cpf))throw new Error("Informe um CPF válido para pagar com Pix on-line.");
    if(phone.length<10||phone.length>11)throw new Error("Informe um telefone válido.");
    const address=customer.address||{};const customerData={name:text(customer.name,"Nome",120),cpf,email:text(customer.email,"E-mail",180),phone_number:phone,address:{street:text(address.street,"Rua",120),number:text(address.number,"Número",30),neighborhood:text(address.neighborhood,"Bairro",80),zipcode:digits(address.zipcode),city:text(address.city,"Cidade",80),state:text(address.state,"UF",2).toUpperCase(),complement:String(address.complement||"").trim().slice(0,100)}};
    if(!customerData.email.includes("@")||customerData.address.zipcode.length!==8||!/^[A-Z]{2}$/.test(customerData.address.state))throw new Error("Confira e-mail, CEP e UF do endereço de cobrança.");

    let {data:attempt,error:attemptError}=await admin.from("cobrancas_pedido_cartao").select("id,pedido_id,efi_charge_id,status,valor_centavos,ambiente,updated_at,qrcode_pix,qrcode_pix_image,link_bolix").eq("request_key",requestKey).maybeSingle();
    if(attemptError)throw attemptError;
    let createdAttempt=false;
    if(attempt&&Number(attempt.pedido_id)!==Number(order.id))return json({erro:"Chave de pagamento já utilizada."},409);
    if(attempt&&normalizeEnvironment(attempt.ambiente)!==ambiente)return json({erro:"Ambiente da tentativa mudou. Inicie uma nova tentativa."},409);
    if(!attempt){
      const inserted=await admin.from("cobrancas_pedido_cartao").insert({pedido_id:order.id,estabelecimento_id:order.estabelecimento_id,request_key:requestKey,ambiente,status:"criando",valor_centavos:valorCentavos,parcelas:1}).select("id,pedido_id,efi_charge_id,status,valor_centavos,ambiente,updated_at,qrcode_pix,qrcode_pix_image,link_bolix").single();
      if(inserted.error?.code==="23505"){
        const retry=await admin.from("cobrancas_pedido_cartao").select("id,pedido_id,efi_charge_id,status,valor_centavos,ambiente,updated_at,qrcode_pix,qrcode_pix_image,link_bolix").eq("request_key",requestKey).single();
        if(retry.error)throw retry.error;attempt=retry.data;
      }else if(inserted.error)throw inserted.error;else{attempt=inserted.data;createdAttempt=true}
    }
    if(!attempt)throw new Error("Tentativa de pagamento inválida.");attemptId=attempt.id;
    if(attempt.efi_charge_id&&attempt.qrcode_pix)return json({sucesso:true,reutilizada:true,cobranca:{charge_id:attempt.efi_charge_id,status:attempt.status,pagamento_status:order.pagamento_status,valor_centavos:attempt.valor_centavos,pix_copia_cola:attempt.qrcode_pix,pix_qrcode_image:attempt.qrcode_pix_image,link_bolix:attempt.link_bolix}});
    if(!createdAttempt){
      const oldUpdatedAt=attempt.updated_at;
      if(Date.now()-new Date(oldUpdatedAt).getTime()<90000)return json({sucesso:false,repetivel:true,erro:"Pagamento em processamento. Aguarde alguns segundos."});
      const claimAt=new Date().toISOString();
      const {data:claimed,error:claimError}=await admin.from("cobrancas_pedido_cartao").update({status:"criando",updated_at:claimAt}).eq("id",attempt.id).eq("updated_at",oldUpdatedAt).select("id").maybeSingle();
      if(claimError)throw claimError;if(!claimed)return json({sucesso:false,repetivel:true,erro:"Pagamento em processamento. Aguarde alguns segundos."});
    }
    const notificationUrl=new URL(`${env("SUPABASE_URL").replace(/\/$/,"")}/functions/v1/webhook-efi-pedidos`);notificationUrl.searchParams.set("ambiente",ambiente);
    const expires=new Date(Date.now()+24*60*60*1000).toISOString().slice(0,10);
    const created=await efi(config,"/v1/charge/one-step",{method:"POST",body:JSON.stringify({items:[{name:`Pedido ${order.codigo||order.id}`,value:valorCentavos,amount:1,marketplace:{mode:[1,2].includes(Number(integration.modo_tarifa))?Number(integration.modo_tarifa):1,repasses:[{payee_code:integration.payee_code,percentage:restaurantPercentage}]}}],payment:{banking_billet:{customer:customerData,expire_at:expires,message:"Pague pelo QR Code Pix. O pedido será liberado automaticamente após a confirmação."}},metadata:{custom_id:`fsdelivery_pedido_${order.id}`,notification_url:notificationUrl.toString()}})});
    const data=created?.data||{},chargeId=Number(data.charge_id),copyPaste=String(data?.pix?.qrcode||data?.payment?.banking_billet?.pix?.qrcode||"");
    const qrcodeImage=String(data?.pix?.qrcode_image||data?.payment?.banking_billet?.pix?.qrcode_image||"");
    if(!Number.isSafeInteger(chargeId)||chargeId<=0||!copyPaste.startsWith("000201"))throw new Error("A Efí não retornou um QR Pix válido.");
    const status=String(data.status||"waiting").toLowerCase(),updatedAt=new Date().toISOString();
    const {error:saveError}=await admin.from("cobrancas_pedido_cartao").update({efi_charge_id:chargeId,status,qrcode_pix:copyPaste,qrcode_pix_image:qrcodeImage.startsWith("data:image/svg+xml;base64,")?qrcodeImage:null,link_bolix:String(data.link||data.billet_link||"").slice(0,500)||null,updated_at:updatedAt}).eq("id",attemptId);
    if(saveError)throw saveError;
    const {error:orderUpdateError}=await admin.from("pedidos").update({efi_charge_id:chargeId,pagamento_provedor:"efi",pagamento_status:"aguardando",atualizado_em:updatedAt}).eq("id",order.id);
    if(orderUpdateError)throw orderUpdateError;
    return json({sucesso:true,cobranca:{charge_id:chargeId,status,pagamento_status:"aguardando",valor_centavos:valorCentavos,pix_copia_cola:copyPaste,pix_qrcode_image:qrcodeImage.startsWith("data:image/svg+xml;base64,")?qrcodeImage:null,link_bolix:String(data.link||data.billet_link||"").slice(0,500)||null}});
  }catch(error){
    const message=error instanceof Error?error.message:"Falha ao gerar cobrança Pix.";console.error("criar-cobranca-pix-pedido: falha ao emitir cobrança");
    if(attemptId)await admin.from("cobrancas_pedido_cartao").update({status:"erro",erro:message.slice(0,500),updated_at:new Date().toISOString()}).eq("id",attemptId).in("status",["criando","erro"]);
    const safe=/CPF|telefone|e-mail|endereço|CEP|UF|bairro|rua|número/i.test(message)?message:"Não foi possível gerar o Pix agora. Tente novamente em instantes.";
    return json({sucesso:false,repetivel:true,erro:safe});
  }
});
