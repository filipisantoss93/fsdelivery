import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Secret ausente: ${name}`);return value};
const decode64=(value:string)=>new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));
function pemParts(pem:string){const cert=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];const key=pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0];if(!cert||!key)throw new Error("Certificado PEM inválido");return{cert,key}}
const baseUrl=()=>String(Deno.env.get("EFI_ENV")||"production").toLowerCase().startsWith("prod")?"https://pix.api.efipay.com.br":"https://pix-h.api.efipay.com.br";
async function efiToken(client:Deno.HttpClient){const response=await fetch(`${baseUrl()}/oauth/token`,{method:"POST",client,headers:{Authorization:`Basic ${btoa(`${env("EFI_CLIENT_ID")}:${env("EFI_CLIENT_SECRET")}`)}`,"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials"})});const body=await response.json().catch(()=>({}));if(!response.ok||!body.access_token)throw new Error(body?.error_description||body?.mensagem||"Falha OAuth Efí");return String(body.access_token)}
async function readCharge(txid:string,accessToken:string,client:Deno.HttpClient){const response=await fetch(`${baseUrl()}/v2/cob/${encodeURIComponent(txid)}`,{client,headers:{Authorization:`Bearer ${accessToken}`}});return{response,body:await response.json().catch(()=>({}))}}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({erro:"Método não permitido"},405);
  try{
    const authorization=req.headers.get("Authorization")||"";
    const userClient=createClient(env("SUPABASE_URL"),env("SUPABASE_ANON_KEY"),{global:{headers:{Authorization:authorization}}});
    const {data:authData,error:authError}=await userClient.auth.getUser();
    if(authError||!authData.user)return json({erro:"Não autenticado"},401);
    const body=await req.json().catch(()=>({}));
    const id=String(body?.id||"").trim();
    if(!id)return json({erro:"id obrigatório"},400);
    const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"));
    const {data:charge,error:chargeError}=await admin.from("cobrancas_pix").select("id,usuario_id,txid,status,vence_em").eq("id",id).eq("usuario_id",authData.user.id).maybeSingle();
    if(chargeError)throw chargeError;
    if(!charge)return json({erro:"Cobrança não encontrada"},404);
    if(["cancelada","expirada"].includes(charge.status))return json({sucesso:true,cobranca:{id:charge.id,status:charge.status}});
    if(charge.status!=="pendente")return json({erro:"Somente cobranças PIX pendentes podem ser canceladas"},409);
    const expiresAt=charge.vence_em?new Date(charge.vence_em).getTime():Number.NaN;
    if(Number.isFinite(expiresAt)&&expiresAt<=Date.now()){
      const {error}=await admin.from("cobrancas_pix").update({status:"expirada",updated_at:new Date().toISOString()}).eq("id",charge.id).eq("status","pendente");if(error)throw error;
      return json({sucesso:true,cobranca:{id:charge.id,status:"expirada"}});
    }
    if(!charge.txid){const {error}=await admin.from("cobrancas_pix").update({status:"cancelada",updated_at:new Date().toISOString()}).eq("id",charge.id).eq("status","pendente");if(error)throw error;return json({sucesso:true,cobranca:{id:charge.id,status:"cancelada"}})}
    const {cert,key}=pemParts(decode64(env("EFI_CERT_KEY_PEM_BASE64")));
    const client=Deno.createHttpClient({cert,key});
    try{
      const accessToken=await efiToken(client);
      const response=await fetch(`${baseUrl()}/v2/cob/${encodeURIComponent(charge.txid)}`,{method:"PATCH",client,headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({status:"REMOVIDA_PELO_USUARIO_RECEBEDOR"})});
      const responseBody=await response.json().catch(()=>({}));
      let canceled=response.ok;
      if(!canceled){
        const current=await readCharge(charge.txid,accessToken,client);
        const remoteStatus=String(current.body?.status||"").toUpperCase();
        if(["REMOVIDA_PELO_USUARIO_RECEBEDOR","REMOVIDA_PELO_PSP"].includes(remoteStatus))canceled=true;
        else if(remoteStatus==="CONCLUIDA")return json({erro:"Este PIX já foi pago e aguarda confirmação no FS Delivery"},409);
        else return json({erro:responseBody?.mensagem||responseBody?.detail||current.body?.mensagem||"Não foi possível cancelar a cobrança na Efí"},response.status>=400?response.status:502);
      }
      const {data:updated,error:updateError}=await admin.from("cobrancas_pix").update({status:"cancelada",updated_at:new Date().toISOString()}).eq("id",charge.id).eq("usuario_id",authData.user.id).eq("status","pendente").select("id,status").maybeSingle();
      if(updateError)throw updateError;
      return json({sucesso:true,cobranca:updated||{id:charge.id,status:"cancelada"}});
    }finally{client.close()}
  }catch(error){console.error("cancelar-pix-fsdelivery",error);return json({erro:error instanceof Error?error.message:"Erro interno"},500)}
});
