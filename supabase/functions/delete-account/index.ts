import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
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
  throw new Error("Credenciais Efí indisponíveis para o ambiente da assinatura.");
};

function billingConfig(value: unknown) {
  const production = String(value || Deno.env.get("EFI_ENV") || "homologacao")
    .toLowerCase().startsWith("prod");
  return production
    ? {
      baseUrl: "https://cobrancas.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_PRODUCAO"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_PRODUCAO"]),
    }
    : {
      baseUrl: "https://cobrancas-h.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_HOMOLOGACAO"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_HOMOLOGACAO"]),
    };
}

async function efiAccessToken(config: ReturnType<typeof billingConfig>) {
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
  if (!response.ok || !token) throw new Error("Não foi possível autorizar o cancelamento da assinatura.");
  return String(token);
}

async function cancelRemoteSubscription(subscriptionId: number, environment: unknown) {
  const config = billingConfig(environment);
  const token = await efiAccessToken(config);
  const response = await fetch(`${config.baseUrl}/v1/subscription/${subscriptionId}/cancel`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload?.code && Number(payload.code) >= 400)) {
    throw new Error("A Efí não confirmou o cancelamento da assinatura.");
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (Number(request.headers.get("content-length") || 0) > 2048) {
    return json({ error: "Requisição inválida." }, 413);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Não autorizado." }, 401);

  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return json({ error: "Confirmação explícita obrigatória." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Ambiente incompleto." }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Sessão inválida." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: subscriptions, error: subscriptionsError } = await admin
      .from("assinaturas")
      .select("id,status,efi_subscription_id,efi_ambiente,renovacao_automatica,ultima_cobranca_status")
      .eq("usuario_id", user.id)
      .eq("meio_pagamento", "cartao")
      .eq("renovacao_automatica", true)
      .in("status", ["pendente", "ativa"]);
    if (subscriptionsError) throw subscriptionsError;

    const processingWithoutProvider = (subscriptions || []).find((item) =>
      !item.efi_subscription_id && item.status === "pendente"
    );
    if (processingWithoutProvider) {
      return json({
        error: "Existe uma assinatura em processamento. Aguarde a conclusão antes de excluir a conta.",
      }, 409);
    }

    let canceledSubscriptions = 0;
    for (const subscription of subscriptions || []) {
      const providerId = Number(subscription.efi_subscription_id || 0);
      if (!Number.isSafeInteger(providerId) || providerId <= 0) continue;

      await cancelRemoteSubscription(providerId, subscription.efi_ambiente);
      const now = new Date().toISOString();
      const { error: updateError } = await admin
        .from("assinaturas")
        .update({
          status: "cancelada",
          renovacao_automatica: false,
          cancelada_em: now,
          cancelamento_solicitado_em: now,
          proxima_cobranca_em: null,
          updated_at: now,
        })
        .eq("id", subscription.id)
        .eq("usuario_id", user.id);
      if (updateError) {
        return json({
          error: "A renovação foi cancelada, mas não foi possível concluir a exclusão da conta. Tente novamente.",
        }, 500);
      }
      canceledSubscriptions += 1;
    }

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      return json({
        error: "Não foi possível excluir a conta. Assinaturas recorrentes já canceladas permanecerão canceladas.",
      }, 400);
    }

    return json({ success: true, canceled_subscriptions: canceledSubscriptions });
  } catch (error) {
    console.error("delete-account", error);
    return json({
      error: "Não foi possível confirmar o cancelamento das cobranças recorrentes. A conta não foi excluída.",
    }, 502);
  }
});
