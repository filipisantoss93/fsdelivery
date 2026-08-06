import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Secret ausente: ${name}`);return value};
const billingBaseUrl="https://cobrancas-h.api.efipay.com.br";

async function efiAccessToken(){
  const response=await fetch(`${billingBaseUrl}/v1/authorize`,{method:"POST",headers:{Authorization:`Basic ${btoa(`${env("EFI_CLIENT_ID_HOMOLOGACAO")}:${env("EFI_CLIENT_SECRET_HOMOLOGACAO")}`)}`,"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials"})});
  const payload=await response.json().catch(()=>({}));
  const token=payload?.access_token||payload?.data?.access_token;
  if(!response.ok||!token)throw new Error(payload?.error_description||payload?.error||payload?.message||"Falha na autorização Efí");
  return String(token);
}

async function getNotification(token:string){
  const accessToken=await efiAccessToken();
  const response=await fetch(`${billingBaseUrl}/v1/notification/${encodeURIComponent(token)}`,{headers:{Authorization:`Bearer ${accessToken}`}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload?.error_description||payload?.error||payload?.message||"Falha ao consultar notificação Efí");
  return payload;
}

const mapStatus=(status:string)=>{
  switch(status.toLowerCase()){
    case "new":case "waiting":return "aguardando";
    case "identified":case "approved":return "em_analise";
    case "paid":return "pago";
    case "unpaid":return "recusado";
    case "canceled":return "cancelado";
    case "refunded":return "estornado";
    case "contested":return "chargeback";
    default:return "em_analise";
  }
};

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false},405);
  const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"));
  try{
    const contentType=req.headers.get("content-type")||"";
    let notification="";
    if(contentType.includes("application/json")){
      const body=await req.json().catch(()=>({}));
      notification=String(body?.notification||"").trim();
    }else{
      const form=await req.formData().catch(()=>null);
      notification=String(form?.get("notification")||"").trim();
    }
    if(!/^[0-9a-z-]{20,120}$/i.test(notification))return json({ok:true});

    const payload=await getNotification(notification);
    const history=Array.isArray(payload?.data)?payload.data:[];
    const latest=history.at(-1);
    const chargeId=Number(latest?.identifiers?.charge_id);
    const status=String(latest?.status?.current||latest?.status||"").toLowerCase();
    if(!Number.isSafeInteger(chargeId)||chargeId<=0||!status)return json({ok:true});

    const {data:attempt,error:attemptError}=await admin.from("cobrancas_pedido_cartao").select("id,pedido_id,estabelecimento_id").eq("efi_charge_id",chargeId).maybeSingle();
    if(attemptError)throw attemptError;
    if(!attempt)return json({ok:true});

    const eventId=`${notification}:${status}:${String(latest?.created_at||"")}`;
    const {error:eventError}=await admin.from("pagamento_eventos").insert({provedor:"efi",evento_id:eventId,pedido_id:attempt.pedido_id,efi_charge_id:chargeId,tipo:status,payload});
    if(eventError&&eventError.code!=="23505")throw eventError;
    if(eventError?.code==="23505")return json({ok:true,duplicado:true});

    const mapped=mapStatus(status),now=new Date().toISOString();
    await admin.from("cobrancas_pedido_cartao").update({status,payload_pagamento:payload,erro:null,updated_at:now}).eq("id",attempt.id);
    await admin.from("pedidos").update({pagamento_status:mapped,pagamento_provedor:"efi",pagamento_confirmado_em:mapped==="pago"?now:null,atualizado_em:now}).eq("id",attempt.pedido_id);
    await admin.from("pagamento_eventos").update({processado_em:now,erro_processamento:null}).eq("provedor","efi").eq("evento_id",eventId);
    return json({ok:true});
  }catch(error){
    console.error("webhook-efi-pedidos",error);
    return json({ok:false},500);
  }
});
