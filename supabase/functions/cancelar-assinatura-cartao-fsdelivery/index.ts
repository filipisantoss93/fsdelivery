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
  const production = String(value || Deno.env.get("EFI_ENV") || "production").toLowerCase().startsWith("prod");
  return production
    ? {
      baseUrl: "https://cobrancas.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_PRODUCAO", "EFI_CLIENT_ID"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_PRODUCAO", "EFI_CLIENT_SECRET"]),
    }
    : {
      baseUrl: "https://cobrancas-h.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_HOMOLOGACAO", "EFI_CLIENT_ID"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_HOMOLOGACAO", "EFI_CLIENT_SECRET"]),
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  if (Number(req.headers.get("content-length") || 0) > 4096) return json({ erro: "Requisição inválida" }, 413);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ erro: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const assinaturaId = String(body?.assinatura_id || "").trim();
    const removerCartao = Boolean(body?.remover_cartao);
    if (!assinaturaId) return json({ erro: "assinatura_id é obrigatório" }, 400);

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: assinatura, error: assinaturaError } = await admin
      .from("assinaturas")
      .select("id,usuario_id,status,efi_subscription_id,renovacao_automatica,acesso_valido_ate,meio_pagamento,cartao_mascara,efi_ambiente")
      .eq("id", assinaturaId)
      .eq("usuario_id", userData.user.id)
      .eq("meio_pagamento", "cartao")
      .single();

    if (assinaturaError || !assinatura) {
      return json({ erro: "Assinatura não encontrada." }, 404);
    }

    const now = new Date().toISOString();
    if (!assinatura.renovacao_automatica || assinatura.status === "cancelada") {
      if (removerCartao && assinatura.cartao_mascara) {
        const { error: clearError } = await admin
          .from("assinaturas")
          .update({ cartao_mascara: null, updated_at: now })
          .eq("id", assinatura.id)
          .eq("usuario_id", userData.user.id);
        if (clearError) throw new Error(clearError.message);
      }
      return json({
        sucesso: true,
        ja_cancelada: true,
        cartao_removido: removerCartao,
        acesso_valido_ate: assinatura.acesso_valido_ate,
      });
    }

    if (!assinatura.efi_subscription_id) {
      return json({ erro: "Assinatura sem vínculo com a Efí." }, 409);
    }

    const config = billingConfig(assinatura.efi_ambiente);
    const accessToken = await efiAccessToken(config);
    const response = await fetch(
      `${config.baseUrl}/v1/subscription/${assinatura.efi_subscription_id}/cancel`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload?.code && Number(payload.code) >= 400)) {
      throw new Error(
        payload?.error_description || payload?.message || payload?.data?.message ||
          "A Efí não confirmou o cancelamento.",
      );
    }

    const { error: updateError } = await admin
      .from("assinaturas")
      .update({
        status: "cancelada",
        renovacao_automatica: false,
        cancelada_em: now,
        cancelamento_solicitado_em: now,
        proxima_cobranca_em: null,
        cartao_mascara: removerCartao ? null : assinatura.cartao_mascara,
        updated_at: now,
      })
      .eq("id", assinatura.id)
      .eq("usuario_id", userData.user.id);
    if (updateError) {
      throw new Error(`Cancelamento confirmado na Efí, mas falhou localmente: ${updateError.message}`);
    }

    return json({
      sucesso: true,
      cartao_removido: removerCartao,
      acesso_valido_ate: assinatura.acesso_valido_ate,
      mensagem: assinatura.acesso_valido_ate
        ? "Renovação automática cancelada. O acesso permanece até o fim do período pago."
        : "Renovação automática cancelada.",
    });
  } catch (error) {
    console.error("cancelar-assinatura-cartao-fsdelivery", error);
    return json({ erro: error instanceof Error ? error.message : "Erro interno" }, 500);
  }
});
