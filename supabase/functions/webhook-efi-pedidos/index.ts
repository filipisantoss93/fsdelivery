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
const normalizeEnvironment = (value: unknown) =>
  String(value || "homologacao").toLowerCase().startsWith("prod") ? "producao" : "homologacao";

function billingConfig(req: Request) {
  const ambiente = normalizeEnvironment(new URL(req.url).searchParams.get("ambiente"));
  if (ambiente === "producao") {
    return {
      ambiente,
      baseUrl: "https://cobrancas.api.efipay.com.br",
      clientId: envFirst(["EFI_CLIENT_ID_PRODUCAO"]),
      clientSecret: envFirst(["EFI_CLIENT_SECRET_PRODUCAO"]),
    };
  }
  return {
    ambiente,
    baseUrl: "https://cobrancas-h.api.efipay.com.br",
    clientId: envFirst(["EFI_CLIENT_ID_HOMOLOGACAO"]),
    clientSecret: envFirst(["EFI_CLIENT_SECRET_HOMOLOGACAO"]),
  };
}

async function notificationToken(req: Request) {
  const contentType = req.headers.get("content-type") || "";
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
  const raw = (await req.text().catch(() => "")).trim();
  if (!raw) return "";
  try {
    const body = JSON.parse(raw);
    return String(body?.notification || body?.token || "").trim();
  } catch {
    const params = new URLSearchParams(raw);
    return String(params.get("notification") || params.get("token") || raw).trim();
  }
}

async function accessToken(config: ReturnType<typeof billingConfig>) {
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
  if (!response.ok || !token) throw new Error("Falha na autorização Efí");
  return String(token);
}

async function getNotification(config: ReturnType<typeof billingConfig>, token: string) {
  const authorization = await accessToken(config);
  const response = await fetch(`${config.baseUrl}/v1/notification/${encodeURIComponent(token)}`, {
    headers: { Authorization: `Bearer ${authorization}`, "Content-Type": "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload?.data)) throw new Error("Notificação Efí inválida");
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  if (Number(req.headers.get("content-length") || 0) > 65536) return json({ ok: false }, 413);

  try {
    const token = await notificationToken(req);
    if (!/^[0-9a-z-]{20,120}$/i.test(token)) return json({ ok: true, ignorado: true });
    const config = billingConfig(req);
    const payload = await getNotification(config, token);
    const events = [...payload.data]
      .slice(-100)
      .sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let processed = 0;
    let ignored = 0;

    for (const event of events) {
      const chargeId = Number(event?.identifiers?.charge_id);
      const status = String(event?.status?.current || event?.status || "").trim().toLowerCase();
      if (!Number.isSafeInteger(chargeId) || chargeId <= 0 || !status) {
        ignored++;
        continue;
      }
      const providerEventId = String(event?.id || `${status}:${event?.created_at || "sem-data"}`);
      const eventId = `notification:${config.ambiente}:${token}:${providerEventId}`;
      const { data, error } = await admin.rpc("fsdelivery_aplicar_evento_pagamento_pedido", {
        p_evento_id: eventId,
        p_charge_id: chargeId,
        p_status_efi: status,
        p_payload: event,
        p_ambiente: config.ambiente,
      });
      if (error) throw error;
      if (data?.ignorado) ignored++;
      else processed++;
    }
    return json({ ok: true, processados: processed, ignorados: ignored });
  } catch (error) {
    console.error("webhook-efi-pedidos", error);
    return json({ ok: false }, 500);
  }
});
