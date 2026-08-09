import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  return new Response(
    JSON.stringify({ erro: "Endpoint legado desativado.", substituto: "verificar-pix-fsdelivery" }),
    { status: 410, headers: HEADERS },
  );
});
