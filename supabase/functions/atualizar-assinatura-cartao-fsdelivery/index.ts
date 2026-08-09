import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret ausente: ${name}`);
  return value;
}

function envFirst(names: string[]) {
  for (const name of names) {
    const value = String(Deno.env.get(name) || "").trim();
    if (value) return value;
  }
  throw new Error("Credenciais Efí indisponíveis para o ambiente da assinatura.");
}

function billingConfig(value: unknown) {
  const production = String(value || Deno.env.get("EFI_ENV") || "homologacao").toLowerCase().startsWith("prod");
  return production
    ? {
      ambiente: "producao",
      baseUrl: "https://cobrancas.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_PRODUCAO"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_PRODUCAO"]),
    }
    : {
      ambiente: "homologacao",
      baseUrl: "https://cobrancas-h.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_HOMOLOGACAO"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_HOMOLOGACAO"]),
    };
}

async function efiAccessToken(config: ReturnType<typeof billingConfig>) {
  const authorization = btoa(`${config.clientId}:${config.clientSecret}`);
  const response = await fetch(`${config.baseUrl}/v1/authorize`, {
    method: "POST",
    headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const payload = await response.json().catch(() => ({}));
  const token = payload?.access_token || payload?.data?.access_token;
  if (!response.ok || !token) {
    throw new Error(payload?.error_description || payload?.message || "Falha na autorização Efí");
  }
  return String(token);
}

async function efiRequest(config: ReturnType<typeof billingConfig>, path: string, options: RequestInit = {}) {
  const accessToken = await efiAccessToken(config);
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload?.code && Number(payload.code) >= 400)) {
    const message = payload?.error_description || payload?.error || payload?.message ||
      payload?.data?.message || "Erro na API de Cobranças Efí";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  if (Number(req.headers.get("content-length") || 0) > 8192) return json({ erro: "Requisição inválida" }, 413);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ erro: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const assinaturaId = String(body?.assinatura_id || "").trim();
    const paymentToken = String(body?.payment_token || "").trim();
    const cartaoMascara = String(body?.cartao_mascara || "").trim();
    const planoId = String(body?.plano_id || "").trim();

    if (!assinaturaId) return json({ erro: "assinatura_id é obrigatório" }, 400);
    if (!paymentToken && !planoId) {
      return json({ erro: "Informe um novo cartão ou um novo plano." }, 400);
    }

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: assinatura, error: assinaturaError } = await admin
      .from("assinaturas")
      .select("id,usuario_id,status,efi_subscription_id,renovacao_automatica,meio_pagamento,plano_id,efi_ambiente")
      .eq("id", assinaturaId)
      .eq("usuario_id", userData.user.id)
      .eq("meio_pagamento", "cartao")
      .single();

    if (assinaturaError || !assinatura) {
      return json({ erro: "Assinatura não encontrada." }, 404);
    }
    if (!assinatura.renovacao_automatica || assinatura.status === "cancelada") {
      return json({
        erro: "Esta recorrência está cancelada. Crie uma nova assinatura por cartão.",
      }, 409);
    }
    if (!assinatura.efi_subscription_id) {
      return json({ erro: "Assinatura sem vínculo com a Efí." }, 409);
    }
    const config = billingConfig(assinatura.efi_ambiente);

    let plan: any = null;
    let efiPlanId: number | null = null;
    if (planoId) {
      const { data: selectedPlan, error: planError } = await admin
        .from("planos_assinatura")
        .select("id,nome,valor_centavos,intervalo_meses,ativo,meio_pagamento,efi_plan_id,efi_plan_ambiente")
        .eq("id", planoId)
        .eq("ativo", true)
        .eq("meio_pagamento", "cartao")
        .single();
      if (planError || !selectedPlan) {
        return json({ erro: "Plano de cartão inválido ou indisponível." }, 400);
      }
      plan = selectedPlan;
      efiPlanId = plan.efi_plan_id && plan.efi_plan_ambiente === config.ambiente
        ? Number(plan.efi_plan_id)
        : null;

      if (!efiPlanId) {
        const createdPlan = await efiRequest(config, "/v1/plan", {
          method: "POST",
          body: JSON.stringify({
            name: plan.nome,
            interval: Math.max(Number(plan.intervalo_meses) || 1, 1),
            repeats: null,
          }),
        });
        efiPlanId = Number(createdPlan?.data?.plan_id);
        if (!Number.isFinite(efiPlanId) || Number(efiPlanId) <= 0) {
          throw new Error("A Efí não retornou um identificador válido para o plano.");
        }
        const { error: savePlanError } = await admin
          .from("planos_assinatura")
          .update({ efi_plan_id: efiPlanId, efi_plan_ambiente: config.ambiente, updated_at: new Date().toISOString() })
          .eq("id", plan.id);
        if (savePlanError) throw new Error(savePlanError.message);
      }
    }

    const efiPayload: Record<string, unknown> = {};
    if (paymentToken) efiPayload.payment_token = paymentToken;
    if (plan && efiPlanId) {
      efiPayload.plan_id = efiPlanId;
      efiPayload.items = [{ name: plan.nome, value: Number(plan.valor_centavos), amount: 1 }];
    }

    const updated = await efiRequest(config, `/v1/subscription/${assinatura.efi_subscription_id}`, {
      method: "PUT",
      body: JSON.stringify(efiPayload),
    });

    const localUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (paymentToken && cartaoMascara) localUpdate.cartao_mascara = cartaoMascara;
    if (plan) {
      localUpdate.plano_id = plan.id;
      localUpdate.preco_contratado_centavos = Number(plan.valor_centavos);
      localUpdate.periodicidade_meses = Math.max(Number(plan.intervalo_meses) || 1, 1);
    }

    const { error: updateError } = await admin
      .from("assinaturas")
      .update(localUpdate)
      .eq("id", assinatura.id)
      .eq("usuario_id", userData.user.id);
    if (updateError) {
      throw new Error(`Alteração confirmada na Efí, mas falhou localmente: ${updateError.message}`);
    }

    return json({
      sucesso: true,
      assinatura_id: assinatura.id,
      cartao_atualizado: Boolean(paymentToken),
      plano_atualizado: Boolean(plan),
      cartao_mascara: paymentToken && cartaoMascara ? cartaoMascara : undefined,
      plano: plan
        ? {
          id: plan.id,
          nome: plan.nome,
          valor_centavos: plan.valor_centavos,
          intervalo_meses: plan.intervalo_meses,
        }
        : undefined,
      efi: updated?.data
        ? { status: updated.data.status, next_execution: updated.data.next_execution }
        : undefined,
    });
  } catch (error) {
    console.error("atualizar-assinatura-cartao-fsdelivery", error);
    return json({ erro: error instanceof Error ? error.message : "Erro interno" }, 500);
  }
});
