import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INACTIVE_STATUS = new Set([400, 401, 403, 404, 410]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const safeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let index = 0; index < size; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "Ambiente incompleto." }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: runtimeSecret, error: secretError } = await db
    .from("app_runtime_secrets")
    .select("operational_push_token")
    .eq("id", 1)
    .maybeSingle();
  const expectedToken = String(runtimeSecret?.operational_push_token || "");
  const suppliedToken = String(request.headers.get("x-operational-push-token") || "");
  if (secretError || expectedToken.length < 32 || !safeEqual(suppliedToken, expectedToken)) {
    return json({ error: "Não autorizado." }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const notificationId = String(body?.notification_id || "");
  if (!UUID.test(notificationId)) return json({ error: "notification_id inválido." }, 400);

  const { data: notification, error: notificationError } = await db
    .from("notificacoes_operacionais")
    .select("id,estabelecimento_id,pedido_id,destinatario,destinatario_id,titulo,mensagem")
    .eq("id", notificationId)
    .maybeSingle();
  if (notificationError || !notification) {
    return json({ error: "Notificação não encontrada." }, 404);
  }

  let query = db
    .from("push_subscriptions_operacionais")
    .select("id,endpoint,p256dh,auth")
    .eq("estabelecimento_id", notification.estabelecimento_id)
    .eq("destinatario", notification.destinatario)
    .eq("ativo", true);
  if (notification.destinatario_id) {
    query = query.eq("destinatario_id", notification.destinatario_id);
  }

  const { data: subscriptions, error: subscriptionError } = await query;
  if (subscriptionError) return json({ error: "Falha ao consultar destinatários." }, 500);

  webpush.setVapidDetails("mailto:suporte@fssolucoes.tech", vapidPublicKey, vapidPrivateKey);
  const destination = notification.destinatario === "garcom"
    ? "/cardapio.html"
    : notification.destinatario === "entregador"
    ? "/entregador.html"
    : notification.destinatario === "cozinha"
    ? "/cozinha.html"
    : "/app.html#pedidos";
  const payload = JSON.stringify({
    title: notification.titulo,
    body: notification.mensagem,
    tag: `pedido-${notification.pedido_id || notification.id}-${notification.destinatario}`,
    url: destination,
    notification_id: notification.id,
    pedido_id: notification.pedido_id,
  });

  let sent = 0;
  let removed = 0;
  const failures: string[] = [];
  await Promise.all((subscriptions || []).map(async (subscription) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        { TTL: 300, urgency: "high" },
      );
      sent += 1;
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
      if (INACTIVE_STATUS.has(statusCode)) {
        await db
          .from("push_subscriptions_operacionais")
          .update({ ativo: false, updated_at: new Date().toISOString() })
          .eq("id", subscription.id);
        removed += 1;
      } else {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }));

  return json({ ok: true, sent, removed, failures: failures.slice(0, 5) });
});
