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
const first = (names: string[]) => {
  for (const name of names) {
    const value = String(Deno.env.get(name) || "").trim();
    if (value) return value;
  }
  return "";
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  try {
    const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return json({ erro: "Não autenticado" }, 401);

    const production = String(Deno.env.get("EFI_ENV") || "production").toLowerCase().startsWith("prod");
    const payee = production
      ? first(["EFI_ACCOUNT_IDENTIFIER_PRODUCAO", "EFI_PAYEE_CODE_PRODUCAO", "EFI_ACCOUNT_IDENTIFIER", "EFI_PAYEE_CODE"])
      : first(["EFI_ACCOUNT_IDENTIFIER_HOMOLOGACAO", "EFI_PAYEE_CODE_HOMOLOGACAO", "EFI_ACCOUNT_IDENTIFIER", "EFI_PAYEE_CODE"]);
    if (!payee) return json({ erro: "Identificador da conta Efí não configurado" }, 503);
    return json({ payee_code: payee, environment: production ? "production" : "sandbox" });
  } catch (error) {
    return json({ erro: error instanceof Error ? error.message : "Erro interno" }, 500);
  }
});
