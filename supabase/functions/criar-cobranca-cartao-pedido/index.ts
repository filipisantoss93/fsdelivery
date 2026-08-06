import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, apikey, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Secret ausente: ${name}`);return value};
const digits=(value:unknown)=>String(value||"").replace(/\D/g,"");
const requireText=(value:unknown,label:string)=>{const text=String(value||"").trim();if(!text)throw new Error(`${label} é obrigatório.`);return text};
const billingBaseUrl="https://cobrancas-h.api.efipay.com.br";

async function efiAccessToken(){
  const clientId=env("EFI_CLIENT_ID_HOMOLOGACAO");
  const clientSecret=env("EFI_CLIENT_SECRET_HOMOLOGACAO");
  const response=await fetch(`${billingBaseUrl}/v1/authorize`,{method:"POST",headers:{Authorization:`Basic ${btoa(`${clientId}:${clientSecret}`)}`,"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials"})});
  const payload=await response.json().catch(()=>({}));
  const token=payload?.access_token||payload?.data?.access_token;
  if(!response.ok||!token)throw new Error(payload?.error_description||payload?.error||payload?.message||"Falha na autorização Efí de homologação");
  return String(token);
}

async function efiRequest(path:string,options:RequestInit={}){
  const token=await efiAccessToken();
  const response=await fetch(`${billingBaseUrl}${path}`,{...options,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(options.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||(payload?.code&&Number(payload.code)>=400)){
    const message=payload?.error_description||payload?.error||payload?.message||payload?.data?.message||"Erro na API Efí";
    throw new Error(typeof message==="string"?message:JSON.stringify(message));
  }
  return payload;
}

function normalizeCustomer(customer:any){
  const cpf=digits(customer?.cpf),phone=digits(customer?.phone_number);
  if(cpf.length!==11)throw new Error("CPF do pagador inválido.");
  if(phone.length<10||phone.length>11)throw new Error("Telefone do pagador inválido.");
  return {name:requireText(customer?.name,"Nome do pagador"),cpf,email:requireText(customer?.email,"E-mail do pagador"),phone_number:phone,birth:requireText(customer?.birth,"Nascimento do pagador")};
}

function normalizeBilling(address:any){
  const zipcode=digits(address?.zipcode),state=String(address?.state||"").trim().toUpperCase();
  if(zipcode.length!==8)throw new Error("CEP de cobrança inválido.");
  if(!/^[A-Z]{2}$/.test(state))throw new Error("UF de cobrança inválida.");
  return {street:requireText(address?.street,"Rua"),number:requireText(address?.number,"Número"),neighborhood:requireText(address?.neighborhood,"Bairro"),zipcode,city:requireText(address?.city,"Cidade"),complement:String(address?.complement||"").trim(),state};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({erro:"Método não permitido"},405);
  const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"));
  let attemptId:string|null=null;
  try{
    const body=await req.json().catch(()=>({}));
    const pedidoId=Number(body?.pedido_id);
    const checkoutToken=String(body?.checkout_token||"").trim();
    const paymentToken=requireText(body?.payment_token,"Token de pagamento");
    const requestKey=String(body?.idempotency_key||"").trim();
    const installments=Math.max(1,Math.min(12,Number(body?.installments)||1));
    const cardMask=String(body?.cartao_mascara||"").trim()||null;
    if(!Number.isSafeInteger(pedidoId)||pedidoId<=0)return json({erro:"Pedido inválido"},400);
    if(!/^[0-9a-f-]{36}$/i.test(checkoutToken))return json({erro:"Token do pedido inválido"},400);
    if(!/^[0-9a-f-]{36}$/i.test(requestKey))return json({erro:"Chave de idempotência inválida"},400);

    const {data:existing}=await admin.from("cobrancas_pedido_cartao").select("id,efi_charge_id,status,valor_centavos").eq("request_key",requestKey).maybeSingle();
    if(existing)return json({sucesso:true,reutilizada:true,cobranca:{charge_id:existing.efi_charge_id,status:existing.status,valor_centavos:existing.valor_centavos}});

    const {data:order,error:orderError}=await admin.from("pedidos").select("id,codigo,estabelecimento_id,total,status,pagamento_status,checkout_token,origem").eq("id",pedidoId).eq("checkout_token",checkoutToken).maybeSingle();
    if(orderError)throw orderError;
    if(!order)return json({erro:"Pedido não encontrado"},404);
    if(order.origem!=="publico")return json({erro:"Pagamento on-line disponível somente para pedidos públicos"},409);
    if(order.pagamento_status==="pago")return json({erro:"Pedido já pago"},409);
    if(["cancelado","finalizado","entregue"].includes(String(order.status)))return json({erro:"Pedido não aceita nova cobrança"},409);

    const {data:integration,error:integrationError}=await admin.from("integracoes_pagamento_estabelecimento")
      .select("payee_code,conta_validada,cartao_online_ativo,split_ativo,percentual_comissao_bps,modo_tarifa,ambiente,status")
      .eq("estabelecimento_id",order.estabelecimento_id).maybeSingle();
    if(integrationError)throw integrationError;
    if(!integration||!integration.conta_validada||integration.status!=="ativo"||integration.ambiente!=="homologacao"||!integration.cartao_online_ativo||!integration.split_ativo||!integration.payee_code){
      return json({erro:"Cartão on-line ainda não está homologado para este estabelecimento"},409);
    }

    const valueCents=Math.round(Number(order.total)*100);
    if(!Number.isInteger(valueCents)||valueCents<=0)throw new Error("Valor do pedido inválido.");
    const restaurantPercentage=10000-Number(integration.percentual_comissao_bps||0);
    if(restaurantPercentage<=0||restaurantPercentage>10000)throw new Error("Divisão da venda inválida.");

    const customer=normalizeCustomer(body?.customer||{});
    const billingAddress=normalizeBilling(body?.billing_address||{});
    const {data:attempt,error:attemptError}=await admin.from("cobrancas_pedido_cartao").insert({pedido_id:order.id,estabelecimento_id:order.estabelecimento_id,request_key:requestKey,status:"criando",valor_centavos:valueCents,parcelas:installments,cartao_mascara:cardMask}).select("id").single();
    if(attemptError)throw attemptError;
    attemptId=attempt.id;

    const notificationUrl=String(Deno.env.get("EFI_PEDIDOS_NOTIFICATION_URL")||`${env("SUPABASE_URL").replace(/\/$/,"")}/functions/v1/webhook-efi-pedidos`);
    const created=await efiRequest("/v1/charge",{method:"POST",body:JSON.stringify({items:[{name:`Pedido ${order.codigo||order.id}`,value:valueCents,amount:1,marketplace:{mode:Number(integration.modo_tarifa)||2,repasses:[{payee_code:integration.payee_code,percentage:restaurantPercentage}]}}],metadata:{custom_id:`fsdelivery:pedido:${order.id}`,notification_url:notificationUrl}})});
    const chargeId=Number(created?.data?.charge_id),createdStatus=String(created?.data?.status||"new");
    if(!Number.isSafeInteger(chargeId)||chargeId<=0)throw new Error("A Efí não retornou um charge_id válido.");

    await admin.from("cobrancas_pedido_cartao").update({efi_charge_id:chargeId,status:createdStatus,payload_criacao:created,updated_at:new Date().toISOString()}).eq("id",attemptId);
    await admin.from("pedidos").update({efi_charge_id:chargeId,pagamento_provedor:"efi",pagamento_status:"aguardando",atualizado_em:new Date().toISOString()}).eq("id",order.id);

    const paid=await efiRequest(`/v1/charge/${chargeId}/pay`,{method:"POST",body:JSON.stringify({payment:{credit_card:{customer,installments,payment_token:paymentToken,billing_address:billingAddress}}})});
    const status=String(paid?.data?.status||paid?.data?.charge?.status||"waiting").toLowerCase();
    const mapped=status==="paid"?"pago":["identified","approved"].includes(status)?"em_analise":["unpaid","canceled"].includes(status)?"recusado":"aguardando";
    const now=new Date().toISOString();
    await admin.from("cobrancas_pedido_cartao").update({status,payload_pagamento:paid,erro:null,updated_at:now}).eq("id",attemptId);
    await admin.from("pedidos").update({pagamento_status:mapped,pagamento_confirmado_em:mapped==="pago"?now:null,atualizado_em:now}).eq("id",order.id);
    return json({sucesso:true,cobranca:{charge_id:chargeId,status,pagamento_status:mapped,valor_centavos:valueCents}});
  }catch(error){
    console.error("criar-cobranca-cartao-pedido",error);
    if(attemptId)await admin.from("cobrancas_pedido_cartao").update({status:"erro",erro:error instanceof Error?error.message:"Erro interno",updated_at:new Date().toISOString()}).eq("id",attemptId);
    return json({erro:error instanceof Error?error.message:"Erro interno"},500);
  }
});
