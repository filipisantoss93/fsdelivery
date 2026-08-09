import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, x-client-info, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "private, max-age=30" },
  });
const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret ausente: ${name}`);
  return value;
};
const normalizeEnvironment = (value: unknown) =>
  String(value || "homologacao").toLowerCase().startsWith("prod") ? "producao" : "homologacao";
const accountIdentifier = (ambiente: string) => {
  const names = ambiente === "producao"
    ? ["EFI_ACCOUNT_IDENTIFIER_PRODUCAO", "EFI_PAYEE_CODE_PRODUCAO"]
    : ["EFI_ACCOUNT_IDENTIFIER_HOMOLOGACAO", "EFI_PAYEE_CODE_HOMOLOGACAO"];
  for (const name of names) {
    const value = String(Deno.env.get(name) || "").trim();
    if (value) return value;
  }
  return "";
};
const disabled = (status = "nao_configurado", ambiente = "homologacao") => ({
  provedor: null,
  ambiente,
  status,
  cartao_online: false,
  pix_online: false,
  split: false,
  tokenizacao: null,
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  try {
    if (Number(req.headers.get("content-length") || 0) > 2048) {
      return json({ erro: "Requisição inválida" }, 413);
    }
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/.test(slug)) return json(disabled());

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: store, error: storeError } = await admin
      .from("estabelecimentos")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) return json(disabled());

    const { data, error } = await admin
      .from("integracoes_pagamento_estabelecimento")
      .select("provedor,conta_validada,cartao_online_ativo,pix_online_ativo,split_ativo,ambiente,status")
      .eq("estabelecimento_id", store.id)
      .maybeSingle();
    if (error) throw error;

    const ambiente = normalizeEnvironment(data?.ambiente);
    if (!data?.conta_validada || data?.status !== "ativo") {
      return json(disabled(data?.status || "nao_configurado", ambiente));
    }

    const account = accountIdentifier(ambiente);
    const splitEnabled = Boolean(data?.split_ativo);
    const cardEnabled = Boolean(data?.cartao_online_ativo && splitEnabled && account);

    return json({
      provedor: data?.provedor || null,
      ambiente,
      status: data?.status || "ativo",
      cartao_online: cardEnabled,
      pix_online: Boolean(data?.pix_online_ativo),
      split: splitEnabled,
      tokenizacao: cardEnabled
        ? { account_identifier: account, environment: ambiente === "producao" ? "production" : "sandbox" }
        : null,
    });
  } catch (error) {
    console.error("config-pagamento-loja", error);
    return json(disabled("indisponivel"));
  }
});
