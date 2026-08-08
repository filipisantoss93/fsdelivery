import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: HEADERS });

const encoder = new TextEncoder();
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
const sha256 = async (value: string) =>
  toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

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
  throw new Error("Credenciais Efí indisponíveis para o ambiente selecionado.");
}

function billingConfig(req: Request) {
  const queryEnvironment = new URL(req.url).searchParams.get("ambiente");
  const production = String(queryEnvironment || Deno.env.get("EFI_ENV") || "production")
    .toLowerCase().startsWith("prod");
  return production
    ? {
      ambiente: "producao",
      baseUrl: "https://cobrancas.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_PRODUCAO", "EFI_CLIENT_ID"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_PRODUCAO", "EFI_CLIENT_SECRET"]),
    }
    : {
      ambiente: "homologacao",
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
  if (!response.ok || !token) throw new Error("Falha na autorização Efí");
  return String(token);
}

async function notificationToken(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("notification") || url.searchParams.get("token");
  if (queryToken) return queryToken.trim();

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    return String(body?.notification || body?.token || "").trim();
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await req.text());
    return String(params.get("notification") || params.get("token") || "").trim();
  }
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    return String(form?.get("notification") || form?.get("token") || "").trim();
  }

  const text = (await req.text().catch(() => "")).trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.notification || parsed?.token || "").trim();
  } catch {
    const params = new URLSearchParams(text);
    return String(params.get("notification") || params.get("token") || text).trim();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  if (Number(req.headers.get("content-length") || 0) > 65536) {
    return json({ ok: false }, 413);
  }

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  let eventHash = "";

  try {
    const token = await notificationToken(req);
    if (!/^[0-9a-z-]{20,120}$/i.test(token)) return json({ ok: true, ignorado: true });

    const config = billingConfig(req);
    const accessToken = await efiAccessToken(config);
    const response = await fetch(
      `${config.baseUrl}/v1/notification/${encodeURIComponent(token)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
    );
    const notification = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(notification?.data)) {
      throw new Error("Notificação Efí inválida");
    }

    const events = [...notification.data]
      .slice(-100)
      .sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
    let processed = 0;
    let duplicated = 0;

    for (const event of events) {
      const type = String(event?.type || "");
      const currentStatus = String(event?.status?.current || "");
      const subscriptionId = Number(event?.identifiers?.subscription_id);
      const chargeId = Number(event?.identifiers?.charge_id);
      const providerEventId = String(
        event?.id ||
          `${type}:${subscriptionId || "sem-assinatura"}:${chargeId || "sem-cobranca"}:${currentStatus}:${event?.created_at || "sem-data"}`,
      );

      eventHash = await sha256(`cobrancas:${config.ambiente}:${token}:${providerEventId}`);
      const { data: state, error: stateError } = await admin.rpc(
        "fsdelivery_iniciar_evento_webhook_efi",
        { p_origem: "cobrancas", p_chave_hash: eventHash },
      );
      if (stateError) throw stateError;
      if (state === "duplicado" || state === "em_processamento") {
        duplicated++;
        eventHash = "";
        continue;
      }

      try {
        if (
          type === "subscription_charge" && Number.isSafeInteger(subscriptionId) &&
          Number.isSafeInteger(chargeId)
        ) {
          const { error } = await admin.rpc("fsdelivery_registrar_cobranca_cartao", {
            p_subscription_id: subscriptionId,
            p_charge_id: chargeId,
            p_status: currentStatus.slice(0, 40),
            p_valor_centavos: Math.max(0, Math.trunc(Number(event?.value || 0))),
            p_payload: event,
            p_recebido_em: event?.received_by_bank_at || null,
            p_ambiente: config.ambiente,
          });
          if (error) throw error;
          processed++;
        } else if (
          type === "subscription" && currentStatus === "canceled" &&
          Number.isSafeInteger(subscriptionId)
        ) {
          const now = new Date().toISOString();
          const { data: assinatura, error: findError } = await admin
            .from("assinaturas")
            .select("id,usuario_id,acesso_valido_ate")
            .eq("efi_subscription_id", subscriptionId)
            .eq("efi_ambiente", config.ambiente)
            .eq("meio_pagamento", "cartao")
            .maybeSingle();
          if (findError) throw findError;

          if (assinatura) {
            const { error: updateError } = await admin
              .from("assinaturas")
              .update({
                status: "cancelada",
                renovacao_automatica: false,
                cancelada_em: now,
                proxima_cobranca_em: null,
                updated_at: now,
              })
              .eq("id", assinatura.id);
            if (updateError) throw updateError;
          }
          processed++;
        } else {
          duplicated++;
        }
        await admin.rpc("fsdelivery_finalizar_evento_webhook_efi", {
          p_origem: "cobrancas",
          p_chave_hash: eventHash,
          p_sucesso: true,
          p_erro: null,
        });
        eventHash = "";
      } catch (error) {
        await admin.rpc("fsdelivery_finalizar_evento_webhook_efi", {
          p_origem: "cobrancas",
          p_chave_hash: eventHash,
          p_sucesso: false,
          p_erro: error instanceof Error ? error.message : "erro",
        });
        throw error;
      }
    }
    return json({ ok: true, processados: processed, duplicados: duplicated });
  } catch (error) {
    if (eventHash) {
      try {
        await admin.rpc("fsdelivery_finalizar_evento_webhook_efi", {
          p_origem: "cobrancas",
          p_chave_hash: eventHash,
          p_sucesso: false,
          p_erro: error instanceof Error ? error.message : "erro",
        });
      } catch {
        // O provedor fará nova tentativa; não substitua o erro original.
      }
    }
    console.error("webhook-efi-cobrancas", error);
    return json({ ok: false }, 500);
  }
});
