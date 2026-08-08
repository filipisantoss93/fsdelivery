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
const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret ausente: ${name}`);
  return value;
};
const envFirst = (names: string[]) => {
  for (const name of names) {
    const value = String(Deno.env.get(name) || "").trim();
    if (value) return value;
  }
  throw new Error("Credenciais Efí indisponíveis para o ambiente selecionado.");
};
const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const requireText = (value: unknown, label: string) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} é obrigatório.`);
  return text;
};
const normalizeEnvironment = (value: unknown) =>
  String(value || "production").toLowerCase().startsWith("prod") ? "producao" : "homologacao";

type BillingConfig = {
  ambiente: "homologacao" | "producao";
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

function billingConfig(): BillingConfig {
  const ambiente = normalizeEnvironment(Deno.env.get("EFI_ENV")) as BillingConfig["ambiente"];
  if (ambiente === "producao") {
    return {
      ambiente,
      baseUrl: "https://cobrancas.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_PRODUCAO", "EFI_CLIENT_ID"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_PRODUCAO", "EFI_CLIENT_SECRET"]),
    };
  }
  return {
    ambiente,
    baseUrl: "https://cobrancas-h.api.efipay.com.br",
    clientId: envFirst(["EFI_CLIENT_ID_HOMOLOGACAO", "EFI_CLIENT_ID"]),
    clientSecret: envFirst(["EFI_CLIENT_SECRET_HOMOLOGACAO", "EFI_CLIENT_SECRET"]),
  };
}

async function accessToken(config: BillingConfig) {
  const response = await fetch(`${config.baseUrl}/v1/authorize`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const payload = await response.json().catch(() => ({}));
  const token = payload?.access_token || payload?.data?.access_token;
  if (!response.ok || !token) {
    throw new Error(payload?.error_description || payload?.error || payload?.message || "Falha na autorização Efí");
  }
  return String(token);
}

async function efiRequest(config: BillingConfig, path: string, options: RequestInit = {}) {
  const token = await accessToken(config);
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
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

function webhookUrl(ambiente: string) {
  const fallback = `${env("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/webhook-efi-cobrancas`;
  const url = new URL(String(Deno.env.get("EFI_BILLING_NOTIFICATION_URL") || fallback));
  url.searchParams.set("ambiente", ambiente);
  return url.toString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  if (Number(req.headers.get("content-length") || 0) > 32768) return json({ erro: "Requisição inválida" }, 413);

  const provider = billingConfig();
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let localSubscriptionId: string | null = null;
  let providerSubscriptionId: number | null = null;
  let providerChargeId: number | null = null;

  try {
    const authorization = req.headers.get("Authorization") || "";
    const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ erro: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const planoId = requireText(body?.plano_id, "Plano");
    const paymentToken = requireText(body?.payment_token, "Token de pagamento");
    const cardMask = String(body?.cartao_mascara || "").trim().slice(0, 40) || null;
    const customer = body?.customer || {};
    const billing = body?.billing_address || {};
    const cpf = digits(customer?.cpf);
    const phone = digits(customer?.phone_number);
    const zipcode = digits(billing?.zipcode);
    const state = String(billing?.state || "").trim().toUpperCase();
    const email = requireText(customer?.email, "E-mail");
    const birth = requireText(customer?.birth, "Data de nascimento");
    if (cpf.length !== 11) throw new Error("CPF inválido.");
    if (phone.length < 10 || phone.length > 11) throw new Error("Telefone inválido.");
    if (zipcode.length !== 8) throw new Error("CEP inválido.");
    if (!/^[A-Z]{2}$/.test(state)) throw new Error("UF inválida.");
    if (!email.includes("@")) throw new Error("E-mail inválido.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) throw new Error("Data de nascimento inválida.");
    const normalizedCustomer = {
      name: requireText(customer?.name, "Nome do titular"),
      cpf,
      email,
      birth,
      phone_number: phone,
    };
    const normalizedBilling = {
      street: requireText(billing?.street, "Rua"),
      number: requireText(billing?.number, "Número"),
      neighborhood: requireText(billing?.neighborhood, "Bairro"),
      zipcode,
      city: requireText(billing?.city, "Cidade"),
      complement: String(billing?.complement || "").trim(),
      state,
    };

    const { data: plan, error: planError } = await admin
      .from("planos_assinatura")
      .select("id,codigo,nome,valor_centavos,intervalo_meses,ativo,meio_pagamento,efi_plan_id,efi_plan_ambiente")
      .eq("id", planoId)
      .eq("ativo", true)
      .eq("meio_pagamento", "cartao")
      .single();
    if (planError || !plan) return json({ erro: "Plano de cartão inválido ou indisponível." }, 400);

    const { data: existing, error: existingError } = await admin
      .from("assinaturas")
      .select("id")
      .eq("usuario_id", userData.user.id)
      .eq("meio_pagamento", "cartao")
      .eq("renovacao_automatica", true)
      .in("status", ["pendente", "ativa"])
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return json({ erro: "Você já possui uma assinatura recorrente ativa ou em processamento." }, 409);

    const now = new Date().toISOString();
    const [{ data: establishment, error: establishmentError }, { data: priorAccess, error: priorError }] =
      await Promise.all([
        admin.from("estabelecimentos").select("id").eq("usuario_id", userData.user.id)
          .order("created_at", { ascending: true }).limit(1).maybeSingle(),
        admin.from("assinaturas").select("acesso_valido_ate").eq("usuario_id", userData.user.id)
          .gt("acesso_valido_ate", now).in("status", ["ativa", "cancelada"])
          .order("acesso_valido_ate", { ascending: false }).limit(1).maybeSingle(),
      ]);
    if (establishmentError) throw establishmentError;
    if (priorError) throw priorError;

    let efiPlanId = plan.efi_plan_id && plan.efi_plan_ambiente === provider.ambiente
      ? Number(plan.efi_plan_id)
      : null;
    if (!efiPlanId) {
      const createdPlan = await efiRequest(provider, "/v1/plan", {
        method: "POST",
        body: JSON.stringify({
          name: `${plan.nome} (${provider.ambiente})`,
          interval: Math.max(Number(plan.intervalo_meses) || 1, 1),
          repeats: null,
        }),
      });
      efiPlanId = Number(createdPlan?.data?.plan_id);
      if (!Number.isSafeInteger(efiPlanId) || efiPlanId <= 0) throw new Error("A Efí não retornou um plano válido.");
      const { error: planLinkError } = await admin.from("planos_assinatura").update({
        efi_plan_id: efiPlanId,
        efi_plan_ambiente: provider.ambiente,
        updated_at: now,
      }).eq("id", plan.id);
      if (planLinkError) throw new Error(`Plano criado na Efí, mas não vinculado: ${planLinkError.message}`);
    }

    const reservation = await admin.from("assinaturas").insert({
      usuario_id: userData.user.id,
      estabelecimento_id: establishment?.id || null,
      plano_id: plan.id,
      provedor: "efi",
      preco_contratado_centavos: Number(plan.valor_centavos),
      status: "pendente",
      ultima_cobranca_status: "criando",
      periodicidade_meses: Math.max(Number(plan.intervalo_meses) || 1, 1),
      renovacao_automatica: true,
      meio_pagamento: "cartao",
      cartao_mascara: cardMask,
      acesso_valido_ate: priorAccess?.acesso_valido_ate || null,
      efi_ambiente: provider.ambiente,
      updated_at: now,
    }).select("id").single();
    if (reservation.error?.code === "23505") {
      return json({ erro: "Já existe uma assinatura recorrente ativa ou em processamento." }, 409);
    }
    if (reservation.error || !reservation.data) throw reservation.error || new Error("Falha ao reservar assinatura.");
    localSubscriptionId = reservation.data.id;

    const created = await efiRequest(provider, `/v1/plan/${efiPlanId}/subscription/one-step`, {
      method: "POST",
      body: JSON.stringify({
        items: [{ name: plan.nome, value: Number(plan.valor_centavos), amount: 1 }],
        metadata: {
          custom_id: `fsdelivery:${userData.user.id}:${plan.id}`,
          notification_url: webhookUrl(provider.ambiente),
        },
        payment: {
          credit_card: {
            customer: normalizedCustomer,
            payment_token: paymentToken,
            billing_address: normalizedBilling,
          },
        },
      }),
    });
    providerSubscriptionId = Number(created?.data?.subscription_id);
    providerChargeId = Number(created?.data?.charge?.id);
    const chargeStatus = String(created?.data?.charge?.status || "waiting").toLowerCase();
    if (!Number.isSafeInteger(providerSubscriptionId) || !Number.isSafeInteger(providerChargeId)) {
      throw new Error("A Efí não retornou os identificadores da assinatura e da cobrança.");
    }

    const { data: subscription, error: subscriptionError } = await admin.from("assinaturas").update({
      efi_subscription_id: providerSubscriptionId,
      efi_charge_id: providerChargeId,
      ultima_cobranca_status: chargeStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", localSubscriptionId)
      .select("id,status,efi_subscription_id,efi_charge_id,renovacao_automatica,meio_pagamento")
      .single();
    if (subscriptionError || !subscription) throw subscriptionError || new Error("Falha ao registrar assinatura.");

    const { error: chargeError } = await admin.from("cobrancas_cartao").insert({
      assinatura_id: subscription.id,
      usuario_id: userData.user.id,
      plano_id: plan.id,
      efi_subscription_id: providerSubscriptionId,
      efi_charge_id: providerChargeId,
      efi_ambiente: provider.ambiente,
      status: chargeStatus,
      valor_centavos: Number(plan.valor_centavos),
      payload_efi: created,
    });
    if (chargeError && chargeError.code !== "23505") throw chargeError;

    if (["paid", "settled"].includes(chargeStatus)) {
      const { error: activationError } = await admin.rpc("fsdelivery_registrar_cobranca_cartao", {
        p_subscription_id: providerSubscriptionId,
        p_charge_id: providerChargeId,
        p_status: chargeStatus,
        p_valor_centavos: Number(plan.valor_centavos),
        p_payload: created,
        p_recebido_em: new Date().toISOString(),
        p_ambiente: provider.ambiente,
      });
      if (activationError) throw activationError;
    }

    return json({
      sucesso: true,
      assinatura: {
        id: subscription.id,
        status: ["paid", "settled"].includes(chargeStatus) ? "ativa" : subscription.status,
        renovacao_automatica: subscription.renovacao_automatica,
        meio_pagamento: subscription.meio_pagamento,
        cobranca_status: chargeStatus,
        ambiente: provider.ambiente,
      },
    });
  } catch (error) {
    console.error("criar-assinatura-cartao-fsdelivery", error);
    if (localSubscriptionId) {
      if (providerSubscriptionId) {
        try {
          await efiRequest(provider, `/v1/subscription/${providerSubscriptionId}/cancel`, { method: "PUT" });
        } catch (rollbackError) {
          console.error("Falha ao cancelar assinatura órfã na Efí", rollbackError);
        }
        await admin.from("assinaturas").update({
          status: "falhou",
          renovacao_automatica: false,
          efi_subscription_id: providerSubscriptionId,
          efi_charge_id: providerChargeId,
          ultima_cobranca_status: "erro_registro",
          updated_at: new Date().toISOString(),
        }).eq("id", localSubscriptionId);
      } else {
        await admin.from("assinaturas").delete().eq("id", localSubscriptionId);
      }
    }
    return json({ erro: error instanceof Error ? error.message : "Erro interno" });
  }
});
