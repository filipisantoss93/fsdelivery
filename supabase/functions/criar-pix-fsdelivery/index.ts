import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
class AppError extends Error{status:number;constructor(message:string,status=500){super(message);this.status=status}}
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Secret ausente: ${name}`);return value};
const decode64=(value:string)=>new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));
function pemParts(pem:string){const cert=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];const key=pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0];if(!cert||!key)throw new Error("Certificado PEM inválido");return{cert,key}}
const baseUrl=()=>String(Deno.env.get("EFI_ENV")||"production").toLowerCase().startsWith("prod")?"https://pix.api.efipay.com.br":"https://pix-h.api.efipay.com.br";
async function efiToken(client:Deno.HttpClient){const response=await fetch(`${baseUrl()}/oauth/token`,{method:"POST",client,headers:{Authorization:`Basic ${btoa(`${env("EFI_CLIENT_ID")}:${env("EFI_CLIENT_SECRET")}`)}`,"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials"})});const body=await response.json().catch(()=>({}));if(!response.ok||!body.access_token)throw new AppError(body?.error_description||body?.mensagem||"Falha OAuth Efí",502);return String(body.access_token)}
async function getRemoteCharge(txid:string,accessToken:string,client:Deno.HttpClient){const response=await fetch(`${baseUrl()}/v2/cob/${encodeURIComponent(txid)}`,{client,headers:{Authorization:`Bearer ${accessToken}`}});return{response,body:await response.json().catch(()=>({}))}}
async function cancelPreviousPendingCharges(admin:any,userId:string,accessToken:string,client:Deno.HttpClient){
  const {data:pending,error}=await admin.from("cobrancas_pix").select("id,txid,vence_em").eq("usuario_id",userId).eq("status","pendente").order("created_at",{ascending:false});
  if(error)throw error;
  for(const charge of pending||[]){
    const expiresAt=charge.vence_em?new Date(charge.vence_em).getTime():Number.NaN;
    if(Number.isFinite(expiresAt)&&expiresAt<=Date.now()){
      const {error:expireError}=await admin.from("cobrancas_pix").update({status:"expirada",updated_at:new Date().toISOString()}).eq("id",charge.id).eq("status","pendente");
      if(expireError)throw expireError;
      continue;
    }
    let canceled=!charge.txid;
    if(charge.txid){
      const response=await fetch(`${baseUrl()}/v2/cob/${encodeURIComponent(charge.txid)}`,{method:"PATCH",client,headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({status:"REMOVIDA_PELO_USUARIO_RECEBEDOR"})});
      if(response.ok)canceled=true;
      else{
        const remote=await getRemoteCharge(charge.txid,accessToken,client);
        const status=String(remote.body?.status||"").toUpperCase();
        if(["REMOVIDA_PELO_USUARIO_RECEBEDOR","REMOVIDA_PELO_PSP"].includes(status))canceled=true;
        else if(status==="CONCLUIDA")throw new AppError("Existe um PIX pago aguardando confirmação. Aguarde a atualização antes de gerar outra cobrança.",409);
        else throw new AppError("Não foi possível cancelar a cobrança PIX anterior. Tente novamente em instantes.",502);
      }
    }
    if(canceled){const {error:updateError}=await admin.from("cobrancas_pix").update({status:"cancelada",updated_at:new Date().toISOString()}).eq("id",charge.id).eq("status","pendente");if(updateError)throw updateError}
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({erro:"Método não permitido"},405);
  try{
    const authorization=req.headers.get("Authorization")||"";
    const userClient=createClient(env("SUPABASE_URL"),env("SUPABASE_ANON_KEY"),{global:{headers:{Authorization:authorization}}});
    const {data:authData,error:authError}=await userClient.auth.getUser();
    if(authError||!authData.user)return json({erro:"Não autenticado"},401);
    const body=await req.json().catch(()=>({}));
    const planoId=String(body?.plano_id||"").trim();
    if(!planoId)return json({erro:"plano_id obrigatório"},400);
    const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"));
    const {data:recurring,error:recurringError}=await admin.from("assinaturas").select("id").eq("usuario_id",authData.user.id).eq("meio_pagamento","cartao").eq("renovacao_automatica",true).in("status",["pendente","ativa"]).limit(1).maybeSingle();
    if(recurringError)throw recurringError;
    if(recurring)throw new AppError("Cancele primeiro a renovação automática do cartão antes de contratar um período por PIX.",409);
    const {data:plan,error:planError}=await admin.from("planos_assinatura").select("id,nome,valor_centavos,intervalo_meses,meio_pagamento").eq("id",planoId).eq("ativo",true).eq("meio_pagamento","pix").single();
    if(planError||!plan)return json({erro:"Plano PIX inválido"},400);
    const {cert,key}=pemParts(decode64(env("EFI_CERT_KEY_PEM_BASE64")));
    const client=Deno.createHttpClient({cert,key});
    try{
      const accessToken=await efiToken(client);
      await cancelPreviousPendingCharges(admin,authData.user.id,accessToken,client);
      const txid=crypto.randomUUID().replaceAll("-","").slice(0,32);
      const expirationSeconds=3600;
      const response=await fetch(`${baseUrl()}/v2/cob/${txid}`,{method:"PUT",client,headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({calendario:{expiracao:expirationSeconds},valor:{original:(Number(plan.valor_centavos)/100).toFixed(2)},chave:env("EFI_PIX_KEY"),solicitacaoPagador:`Assinatura FS Delivery - ${plan.nome}`})});
      const charge=await response.json().catch(()=>({}));
      if(!response.ok)throw new AppError(charge?.mensagem||charge?.detail||"Falha ao criar cobrança PIX",502);
      let copyPaste:string|null=null,qrCodeUrl:string|null=null;
      if(charge?.loc?.id){const qrResponse=await fetch(`${baseUrl()}/v2/loc/${charge.loc.id}/qrcode`,{client,headers:{Authorization:`Bearer ${accessToken}`}});const qrBody=await qrResponse.json().catch(()=>({}));if(qrResponse.ok){copyPaste=qrBody?.qrcode||null;qrCodeUrl=qrBody?.imagemQrcode||null}}
      const {data:inserted,error:insertError}=await admin.from("cobrancas_pix").insert({usuario_id:authData.user.id,plano_id:plan.id,txid,status:"pendente",valor_centavos:plan.valor_centavos,vence_em:new Date(Date.now()+expirationSeconds*1000).toISOString(),loc_id:charge?.loc?.id?String(charge.loc.id):null,loc_url:charge?.location||charge?.loc?.location||null,pix_copia_cola:copyPaste,qr_code_url:qrCodeUrl,payload_efi:charge}).select("id,txid,status,valor_centavos,vence_em,pix_copia_cola,qr_code_url").single();
      if(insertError)throw new AppError(`Cobrança criada na Efí, mas falhou ao salvar no FS Delivery: ${insertError.message}`,500);
      return json({sucesso:true,cobranca:inserted});
    }finally{client.close()}
  }catch(error){console.error("criar-pix-fsdelivery",error);return json({erro:error instanceof Error?error.message:"Erro interno"},error instanceof AppError?error.status:500)}
});
