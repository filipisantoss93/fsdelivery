import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type, apikey, x-client-info, authorization",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"private, max-age=30"}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Secret ausente: ${name}`);return value};
const disabled=(status="nao_configurado")=>({provedor:null,ambiente:"homologacao",status,cartao_online:false,pix_online:false,split:false,tokenizacao:null});

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({erro:"Método não permitido"},405);
  try{
    const length=Number(req.headers.get("content-length")||0);
    if(length>2048)return json({erro:"Requisição inválida"},413);
    const body=await req.json().catch(()=>({}));
    const slug=String(body?.slug||"").trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/.test(slug))return json(disabled());

    const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:store,error:storeError}=await admin.from("estabelecimentos").select("id").eq("slug",slug).maybeSingle();
    if(storeError)throw storeError;
    if(!store)return json(disabled());

    const {data,error}=await admin.from("integracoes_pagamento_estabelecimento")
      .select("provedor,conta_validada,cartao_online_ativo,pix_online_ativo,split_ativo,ambiente,status")
      .eq("estabelecimento_id",store.id).maybeSingle();
    if(error)throw error;
    const enabled=Boolean(data?.conta_validada&&data?.status==="ativo");
    if(!enabled)return json(disabled(data?.status||"nao_configurado"));

    const ambiente=data?.ambiente||"homologacao";
    const accountIdentifier=String(
      Deno.env.get("EFI_PAYEE_CODE_HOMOLOGACAO")||
      Deno.env.get("EFI_ACCOUNT_IDENTIFIER_HOMOLOGACAO")||
      Deno.env.get("EFI_PAYEE_CODE")||
      Deno.env.get("EFI_ACCOUNT_IDENTIFIER")||""
    ).trim();
    const cardEnabled=Boolean(data?.cartao_online_ativo&&ambiente==="homologacao"&&accountIdentifier);

    return json({
      provedor:data?.provedor||null,
      ambiente,
      status:data?.status||"ativo",
      cartao_online:cardEnabled,
      pix_online:Boolean(data?.pix_online_ativo),
      split:Boolean(data?.split_ativo),
      tokenizacao:cardEnabled?{account_identifier:accountIdentifier,environment:"sandbox"}:null
    });
  }catch(error){
    console.error("config-pagamento-loja",error);
    return json(disabled("indisponivel"));
  }
});