import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

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
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret ausente: ${name}`);
  return value;
};
const environment = () =>
  String(Deno.env.get("EFI_ENV") || "homologacao").toLowerCase().startsWith("prod")
    ? "producao"
    : "homologacao";
const environmentSecret = (base: string, value = environment()) =>
  required(`${base}_${value === "producao" ? "PRODUCAO" : "HOMOLOGACAO"}`);
const baseUrl = (value = environment()) =>
  value === "producao" ? "https://pix.api.efipay.com.br" : "https://pix-h.api.efipay.com.br";
const decode64 = (value: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));

function pemParts(pem: string) {
  const cert = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
  const key = pem.match(
    /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/,
  )?.[0];
  if (!cert || !key) throw new Error("Certificado PEM inválido");
  return { cert, key };
}

async function efiToken(client: Deno.HttpClient, value: string) {
  const clientId = environmentSecret("EFI_CLIENT_ID", value);
  const clientSecret = environmentSecret("EFI_CLIENT_SECRET", value);
  const response = await fetch(`${baseUrl(value)}/oauth/token`, {
    method: "POST",
    client,
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload?.error_description || payload?.mensagem || "Falha OAuth Efí");
  }
  return String(payload.access_token);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  try {
    const authorization = request.headers.get("Authorization") || "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ erro: "Não autenticado" }, 401);

    const admin = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) return json({ erro: "Não autenticado" }, 401);

    const { data: adminRow, error: adminError } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!adminRow) return json({ erro: "Acesso restrito à administração da plataforma" }, 403);

    const { data: secret, error: secretError } = await admin
      .from("app_runtime_secrets")
      .select("webhook_efi_token")
      .eq("id", 1)
      .single();
    if (secretError || !secret?.webhook_efi_token) {
      throw new Error("Token interno do webhook não encontrado");
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "consultar").trim().toLowerCase();
    if (!["consultar", "registrar"].includes(action)) return json({ erro: "Ação inválida" }, 400);

    const selectedEnvironment = environment();
    const { cert, key } = pemParts(
      decode64(environmentSecret("EFI_CERT_KEY_PEM_BASE64", selectedEnvironment)),
    );
    const client = Deno.createHttpClient({ cert, key });
    try {
      const accessToken = await efiToken(client, selectedEnvironment);
      const pixKey = encodeURIComponent(environmentSecret("EFI_PIX_KEY", selectedEnvironment));
      if (action === "consultar") {
        const response = await fetch(`${baseUrl(selectedEnvironment)}/v2/webhook/${pixKey}`, {
          client,
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = await response.json().catch(() => ({}));
        return json(
          {
            sucesso: response.ok,
            status: response.status,
            configurado: Boolean(payload?.webhookUrl || payload?.webhook_url),
            ambiente: selectedEnvironment,
          },
          response.ok ? 200 : response.status,
        );
      }

      const projectUrl = required("SUPABASE_URL").replace(/\/$/, "");
      const webhookUrl = `${projectUrl}/functions/v1/webhook-efi-pix/${secret.webhook_efi_token}`;
      const response = await fetch(`${baseUrl(selectedEnvironment)}/v2/webhook/${pixKey}`, {
        method: "PUT",
        client,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-skip-mtls-checking": "true",
        },
        body: JSON.stringify({ webhookUrl }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return json(
          {
            sucesso: false,
            status: response.status,
            erro: payload?.mensagem || payload?.message || "Falha ao registrar webhook",
          },
          response.status,
        );
      }
      return json({ sucesso: true, status: response.status, configurado: true, ambiente: selectedEnvironment });
    } finally {
      client.close();
    }
  } catch (error) {
    console.error("configurar-webhook-efi", error);
    return json({ erro: error instanceof Error ? error.message : "Não foi possível configurar o webhook" }, 500);
  }
});
