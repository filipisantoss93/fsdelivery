import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Secret ausente: ${name}`);return value};
const baseUrl="https://cobrancas-h.api.efipay.com.br";

async function authorize(){
  const clientId=env("EFI_CLIENT_ID_HOMOLOGACAO");
  const clientSecret=env("EFI_CLIENT_SECRET_HOMOLOGACAO");
  const response=await fetch(`${baseUrl}/v1/authorize`,{
    method:"POST",
    headers:{Authorization:`Basic ${btoa(`${clientId}:${clientSecret}`)}`,"Content-Type":"application/json"},
    body:JSON.stringify({grant_type:"client_credentials"})
  });
  const payload=await response.json().catch(()=>({}));
  const token=payload?.access_token||payload?.data?.access_token;
  if(!response.ok||!token){
    const raw=payload?.error_description||payload?.error||payload?.message||"Falha ao autenticar na Efí em homologação";
    throw new Error(typeof raw==="string"?raw:JSON.stringify(raw));
  }
  return String(token);
}

async function efi(token:string,path:string,options:RequestInit={}){
  const response=await fetch(`${baseUrl}${path}`,{
    ...options,
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(options.headers||{})}
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||(payload?.code&&Number(payload.code)>=400)){
    const raw=payload?.error_description||payload?.error||payload?.message||payload?.data?.message||payload?.data?.error_description||"A Efí recusou a validação do recebedor";
    throw new Error(typeof raw==="string"?raw:JSON.stringify(raw));
  }
  return payload;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({erro:"Método não permitido"},405);

  const authHeader=req.headers.get("Authorization")||"";
  const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
  let integrationId:string|null=null;
  let estabelecimentoId:string|null=null;
  let userId:string|null=null;

  try{
    if(!authHeader.startsWith("Bearer "))return json({erro:"Não autenticado"},401);
    const userClient=createClient(env("SUPABASE_URL"),env("SUPABASE_ANON_KEY"),{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await userClient.auth.getUser();
    if(userError||!userData.user)return json({erro:"Sessão inválida"},401);
    userId=userData.user.id;

    const body=await req.json().catch(()=>({}));
    estabelecimentoId=String(body?.estabelecimento_id||"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(estabelecimentoId))return json({erro:"Estabelecimento inválido"},400);

    const {data:store,error:storeError}=await admin.from("estabelecimentos").select("id,usuario_id,nome").eq("id",estabelecimentoId).maybeSingle();
    if(storeError)throw storeError;
    if(!store)return json({erro:"Estabelecimento não encontrado"},404);

    let isAdmin=false;
    try{
      const {data:adminAllowed}=await userClient.rpc("fs_admin_autorizado");
      isAdmin=adminAllowed===true;
    }catch(error){
      console.warn("validar-payee-efi admin-check",error);
    }
    if(store.usuario_id!==userId&&!isAdmin)return json({erro:"Sem permissão para validar esta integração"},403);

    const {data:integration,error:integrationError}=await admin.from("integracoes_pagamento_estabelecimento")
      .select("id,estabelecimento_id,payee_code,ambiente,status,tipo_pessoa,cartao_online_solicitado,pix_online_solicitado,split_solicitado,percentual_comissao_bps,modo_tarifa")
      .eq("estabelecimento_id",estabelecimentoId).maybeSingle();
    if(integrationError)throw integrationError;
    if(!integration)return json({erro:"Integração Efí ainda não cadastrada"},404);
    integrationId=integration.id;

    const payeeCode=String(integration.payee_code||"").trim();
    if(!/^[A-Za-z0-9_-]{8,160}$/.test(payeeCode))return json({erro:"Payee code ausente ou inválido"},400);
    if(integration.ambiente!=="homologacao")return json({erro:"A validação automática está restrita à homologação"},409);
    if(!integration.split_solicitado)return json({erro:"Solicite Split automático antes de validar o recebedor"},409);

    await admin.from("integracoes_pagamento_estabelecimento").update({
      status:"em_analise",conta_validada:false,cartao_online_ativo:false,pix_online_ativo:false,split_ativo:false,updated_at:new Date().toISOString(),erro_ultima_validacao:null
    }).eq("id",integration.id);

    const commissionBps=Math.max(0,Math.min(3000,Number(integration.percentual_comissao_bps)||0));
    const restaurantPercentage=10000-commissionBps;
    const mode=[1,2].includes(Number(integration.modo_tarifa))?Number(integration.modo_tarifa):2;
    const token=await authorize();
    const customId=`fsdelivery_validacao_payee_${String(integration.id).replace(/[^A-Za-z0-9_-]/g,"_")}_${Date.now()}`;
    const created=await efi(token,"/v1/charge",{
      method:"POST",
      body:JSON.stringify({
        items:[{
          name:"Validação recebedor FS Delivery",
          value:100,
          amount:1,
          marketplace:{mode,repasses:[{payee_code:payeeCode,percentage:restaurantPercentage}]}
        }],
        metadata:{custom_id:customId}
      })
    });

    const chargeId=Number(created?.data?.charge_id);
    if(!Number.isSafeInteger(chargeId)||chargeId<=0)throw new Error("A Efí aceitou a requisição, mas não retornou charge_id válido");

    let cancelado=false;
    let cancelError:string|null=null;
    try{
      await efi(token,`/v1/charge/${chargeId}/cancel`,{method:"PUT"});
      cancelado=true;
    }catch(error){
      cancelError=error instanceof Error?error.message:"Falha ao cancelar cobrança de validação";
      console.error("validar-payee-efi cancel",error);
    }

    const now=new Date().toISOString();
    const warning=cancelado?null:`Recebedor validado, mas a cobrança sandbox #${chargeId} não pôde ser cancelada automaticamente: ${cancelError}`;
    const {data:updated,error:updateError}=await admin.from("integracoes_pagamento_estabelecimento").update({
      conta_validada:true,
      status:"ativo",
      cartao_online_ativo:Boolean(integration.cartao_online_solicitado),
      split_ativo:true,
      pix_online_ativo:false,
      validado_em:now,
      erro_ultima_validacao:warning,
      updated_at:now
    }).eq("id",integration.id).select("id,status,conta_validada,cartao_online_ativo,pix_online_ativo,split_ativo,validado_em,erro_ultima_validacao").single();
    if(updateError)throw updateError;

    const {error:auditError}=await admin.from("validacoes_payee_efi").insert({
      integracao_id:integration.id,estabelecimento_id:estabelecimentoId,solicitado_por:userId,sucesso:true,efi_charge_id:chargeId,efi_status:String(created?.data?.status||"new"),cancelado,detalhes:{modo_tarifa:mode,percentual_recebedor:restaurantPercentage,pix_solicitado:Boolean(integration.pix_online_solicitado),cancel_error:cancelError,custom_id:customId}
    });
    if(auditError)console.warn("validar-payee-efi audit",auditError);

    return json({
      sucesso:true,
      mensagem:cancelado?"Conta Efí validada automaticamente em homologação.":"Conta Efí validada; revise o aviso sobre a cobrança sandbox de validação.",
      integracao:updated,
      validacao:{charge_id:chargeId,cancelado,pix_online:"pendente_validacao_especifica"}
    });
  }catch(error){
    const message=error instanceof Error?error.message:"Falha na validação automática";
    console.error("validar-payee-efi",error);
    if(integrationId){
      await admin.from("integracoes_pagamento_estabelecimento").update({
        conta_validada:false,status:"erro",cartao_online_ativo:false,pix_online_ativo:false,split_ativo:false,validado_em:null,erro_ultima_validacao:message,updated_at:new Date().toISOString()
      }).eq("id",integrationId);
      const {error:auditError}=await admin.from("validacoes_payee_efi").insert({integracao_id:integrationId,estabelecimento_id:estabelecimentoId,solicitado_por:userId,sucesso:false,erro:message});
      if(auditError)console.warn("validar-payee-efi audit-error",auditError);
    }
    return json({sucesso:false,erro:message});
  }
});
