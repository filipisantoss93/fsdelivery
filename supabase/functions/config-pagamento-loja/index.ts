import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, apikey, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Secret ausente: ${name}`);return value};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({erro:"Método não permitido"},405);
  try{
    const body=await req.json().catch(()=>({}));
    const slug=String(body?.slug||"").trim();
    if(!slug||slug.length>120)return json({erro:"Loja inválida"},400);

    const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"));
    const {data:store,error:storeError}=await admin.from("estabelecimentos").select("id").eq("slug",slug).maybeSingle();
    if(storeError)throw storeError;
    if(!store)return json({erro:"Loja não encontrada"},404);

    const {data,error}=await admin.from("integracoes_pagamento_estabelecimento")
      .select("provedor,conta_validada,cartao_online_ativo,pix_online_ativo,split_ativo,ambiente,status")
      .eq("estabelecimento_id",store.id).maybeSingle();
    if(error)throw error;

    const habilitada=Boolean(data?.conta_validada&&data?.status==="ativo");
    return json({
      provedor:habilitada?data?.provedor:null,
      ambiente:data?.ambiente||"homologacao",
      status:data?.status||"nao_configurado",
      cartao_online:habilitada&&Boolean(data?.cartao_online_ativo),
      pix_online:habilitada&&Boolean(data?.pix_online_ativo),
      split:habilitada&&Boolean(data?.split_ativo)
    });
  }catch(error){
    console.error("config-pagamento-loja",error);
    return json({erro:"Não foi possível consultar os meios de pagamento"},500);
  }
});
