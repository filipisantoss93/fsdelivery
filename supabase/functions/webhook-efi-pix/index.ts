import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

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

function tokenFromRequest(request: Request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken.trim();

  const marker = "/webhook-efi-pix/";
  const position = url.pathname.indexOf(marker);
  if (position < 0) return "";
  return url.pathname.slice(position + marker.length).split("/").filter(Boolean)[0] || "";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false }, 405);
  if (Number(request.headers.get("content-length") || 0) > 131072) {
    return json({ ok: false }, 413);
  }

  const token = tokenFromRequest(request);
  if (!token || token.length < 32 || token.length > 200) return json({ ok: false }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false }, 500);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const body = await request.json().catch(() => null);
  const pixItems = Array.isArray(body?.pix) ? body.pix.slice(0, 50) : [];
  if (!pixItems.length) return json({ ok: true, resultados: [] });

  const tokenHash = await sha256(token);
  const resultados: Array<{ txid: string; ok: boolean; duplicado?: boolean }> = [];
  for (const item of pixItems) {
    const txid = typeof item?.txid === "string" ? item.txid.trim() : "";
    if (!/^[A-Za-z0-9-]{10,80}$/.test(txid)) continue;

    const endToEndId = typeof item?.endToEndId === "string"
      ? item.endToEndId.slice(0, 120)
      : null;
    const eventHash = await sha256(`pix:${tokenHash}:${txid}:${endToEndId || ""}`);
    const { data: state, error: stateError } = await db.rpc(
      "fsdelivery_iniciar_evento_webhook_efi",
      { p_origem: "pix", p_chave_hash: eventHash },
    );
    if (stateError) {
      resultados.push({ txid, ok: false });
      continue;
    }
    if (state === "duplicado" || state === "em_processamento") {
      resultados.push({ txid, ok: true, duplicado: true });
      continue;
    }

    try {
      const { data, error } = await db.rpc("fsdelivery_baixar_pix_webhook", {
        p_token: token,
        p_txid: txid,
        p_pago_em: typeof item?.horario === "string" ? item.horario : new Date().toISOString(),
        p_e2e_id: endToEndId,
      });
      const ok = !error && data === true;
      await db.rpc("fsdelivery_finalizar_evento_webhook_efi", {
        p_origem: "pix",
        p_chave_hash: eventHash,
        p_sucesso: ok,
        p_erro: error?.message || (ok ? null : "Cobrança PIX não encontrada"),
      });
      resultados.push({ txid, ok });
    } catch (error) {
      await db.rpc("fsdelivery_finalizar_evento_webhook_efi", {
        p_origem: "pix",
        p_chave_hash: eventHash,
        p_sucesso: false,
        p_erro: error instanceof Error ? error.message : "erro",
      });
      resultados.push({ txid, ok: false });
    }
  }

  return json({ ok: true, resultados });
});
