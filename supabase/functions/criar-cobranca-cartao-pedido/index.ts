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
  throw new Error("Credenciais Efí indisponíveis para o ambiente selecionado.");
};
const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const requireText = (value: unknown, label: string) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} é obrigatório.`);
  return text;
};
const normalizeEnvironment = (value: unknown) =>
  String(value || "homologacao").toLowerCase().startsWith("prod") ? "producao" : "homologacao";
const mapStatus = (status: string) => {
  switch (String(status || "").toLowerCase()) {
    case "new":
    case "waiting":
      return "aguardando";
    case "identified":
      return "em_analise";
    case "approved":
      return "autorizado";
    case "paid":
    case "settled":
      return "pago";
    case "unpaid":
      return "recusado";
    case "canceled":
    case "expired":
      return "cancelado";
    case "refunded":
      return "estornado";
    case "contested":
      return "chargeback";
    default:
      return null;
  }
};

type BillingConfig = {
  ambiente: "homologacao" | "producao";
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

function billingConfig(value: unknown): BillingConfig {
  const ambiente = normalizeEnvironment(value) as BillingConfig["ambiente"];
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

async function efiAccessToken(config: BillingConfig) {
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
  if (!response.ok || !token) {
    throw new Error(payload?.error_description || payload?.error || payload?.message || "Falha na autorização Efí");
  }
  return String(token);
}

async function efiRequest(config: BillingConfig, path: string, options: RequestInit = {}) {
  const token = await efiAccessToken(config);
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload?.code && Number(payload.code) >= 400)) {
    const message = payload?.error_description || payload?.error || payload?.message ||
      payload?.data?.message || "Erro na API Efí";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return payload;
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error_description", "error", "details", "hint"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "Falha não identificada ao processar o pagamento.";
}

function publicPaymentError(message: string) {
  const normalized = message.toLowerCase();
  if (/cpf|telefone|e-mail|cart[aã]o|pagador|payment.?token|n[aã]o autoriz|recusad|saldo|seguran[cç]a/.test(normalized)) {
    return message.slice(0, 240);
  }
  return "Não foi possível processar o pagamento agora. Tente novamente em instantes.";
}

function normalizeCustomer(customer: any) {
  const cpf = digits(customer?.cpf);
  const phone = digits(customer?.phone_number);
  if (cpf.length !== 11) throw new Error("CPF do pagador inválido.");
  if (phone.length < 10 || phone.length > 11) throw new Error("Telefone do pagador inválido.");
  const email = requireText(customer?.email, "E-mail do pagador");
  if (!email.includes("@")) throw new Error("E-mail do pagador inválido.");
  return { name: requireText(customer?.name, "Nome do pagador"), cpf, email, phone_number: phone };
}

function notificationUrl(ambiente: string) {
  const fallback = `${env("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/webhook-efi-pedidos`;
  const url = new URL(String(Deno.env.get("EFI_PEDIDOS_NOTIFICATION_URL") || fallback));
  url.searchParams.set("ambiente", ambiente);
  return url.toString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  if (Number(req.headers.get("content-length") || 0) > 32768) {
    return json({ sucesso: false, erro: "Requisição inválida." }, 413);
  }

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let attemptId: string | null = null;
  let providerStatus: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const pedidoId = Number(body?.pedido_id || 0);
    const slug = String(body?.slug || "").trim().toLowerCase();
    const checkoutToken = String(body?.checkout_token || "").trim();
    const paymentToken = requireText(body?.payment_token, "Token de pagamento");
    const requestKey = String(body?.idempotency_key || "").trim();
    const cardMask = String(body?.cartao_mascara || "").trim() || null;
    if (!/^[0-9a-f-]{36}$/i.test(checkoutToken)) return json({ sucesso: false, erro: "Token do pedido inválido" }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(requestKey)) return json({ sucesso: false, erro: "Chave de idempotência inválida" }, 400);
    if (slug && !/^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/.test(slug)) {
      return json({ sucesso: false, erro: "Loja inválida" }, 400);
    }

    let estabelecimentoId: string | null = null;
    if (slug) {
      const { data: store, error: storeError } = await admin
        .from("estabelecimentos")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (storeError) throw storeError;
      if (!store) return json({ sucesso: false, erro: "Loja não encontrada" }, 404);
      estabelecimentoId = store.id;
    }

    let orderQuery = admin
      .from("pedidos")
      .select("id,codigo,estabelecimento_id,total,status,pagamento_status,efi_charge_id,checkout_token,origem,forma_pagamento")
      .eq("checkout_token", checkoutToken);
    if (Number.isSafeInteger(pedidoId) && pedidoId > 0) orderQuery = orderQuery.eq("id", pedidoId);
    if (estabelecimentoId) orderQuery = orderQuery.eq("estabelecimento_id", estabelecimentoId);
    const { data: order, error: orderError } = await orderQuery.maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json({ sucesso: false, erro: "Pedido não encontrado" }, 404);
    if (order.origem !== "publico") return json({ sucesso: false, erro: "Pagamento disponível somente para pedidos públicos" }, 409);
    if (order.forma_pagamento !== "Cartão on-line") return json({ sucesso: false, erro: "Pedido não foi criado para cartão on-line" }, 409);
    if (["finalizado", "entregue"].includes(String(order.status))) {
      return json({ sucesso: false, erro: "Pedido não aceita nova cobrança" }, 409);
    }
    if (order.status === "cancelado" && !["recusado", "cancelado"].includes(String(order.pagamento_status))) {
      return json({ sucesso: false, erro: "Pedido cancelado não aceita nova cobrança" }, 409);
    }

    const { data: integration, error: integrationError } = await admin
      .from("integracoes_pagamento_estabelecimento")
      .select("payee_code,conta_validada,cartao_online_ativo,split_ativo,percentual_comissao_bps,modo_tarifa,ambiente,status")
      .eq("estabelecimento_id", order.estabelecimento_id)
      .maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration || !integration.conta_validada || integration.status !== "ativo" ||
      !integration.cartao_online_ativo || !integration.split_ativo || !integration.payee_code) {
      return json({ sucesso: false, erro: "Cartão on-line indisponível para este estabelecimento" }, 409);
    }
    const provider = billingConfig(integration.ambiente);

    const valueCents = Math.round(Number(order.total) * 100);
    if (!Number.isInteger(valueCents) || valueCents <= 0) throw new Error("Valor do pedido inválido.");
    const restaurantPercentage = 10000 - Number(integration.percentual_comissao_bps || 0);
    if (restaurantPercentage <= 0 || restaurantPercentage > 10000) throw new Error("Divisão da venda inválida.");
    const customer = normalizeCustomer(body?.customer || {});

    let createdAttempt = false;
    let { data: attempt, error: attemptError } = await admin
      .from("cobrancas_pedido_cartao")
      .select("id,pedido_id,efi_charge_id,status,valor_centavos,ambiente,updated_at")
      .eq("request_key", requestKey)
      .maybeSingle();
    if (attemptError) throw attemptError;
    if (attempt && Number(attempt.pedido_id) !== Number(order.id)) {
      return json({ sucesso: false, erro: "Chave de pagamento já utilizada" }, 409);
    }
    if (attempt && normalizeEnvironment(attempt.ambiente) !== provider.ambiente) {
      return json({ sucesso: false, erro: "Ambiente da tentativa de pagamento mudou. Inicie uma nova tentativa." }, 409);
    }

    if (!attempt) {
      const inserted = await admin.from("cobrancas_pedido_cartao").insert({
        pedido_id: order.id,
        estabelecimento_id: order.estabelecimento_id,
        request_key: requestKey,
        ambiente: provider.ambiente,
        status: "criando",
        valor_centavos: valueCents,
        parcelas: 1,
        cartao_mascara: cardMask,
      }).select("id,pedido_id,efi_charge_id,status,valor_centavos,ambiente,updated_at").single();
      if (inserted.error?.code === "23505") {
        const retry = await admin.from("cobrancas_pedido_cartao")
          .select("id,pedido_id,efi_charge_id,status,valor_centavos,ambiente,updated_at")
          .eq("request_key", requestKey)
          .single();
        if (retry.error) throw retry.error;
        attempt = retry.data;
      } else if (inserted.error) {
        throw inserted.error;
      } else {
        attempt = inserted.data;
        createdAttempt = true;
      }
    }
    if (!attempt || Number(attempt.pedido_id) !== Number(order.id)) throw new Error("Tentativa de pagamento inválida.");
    attemptId = attempt.id;
    providerStatus = String(attempt.status || "criando").toLowerCase();

    if (!attempt.efi_charge_id && !createdAttempt) {
      const updatedAt = new Date(attempt.updated_at).getTime();
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt < 90_000) {
        return json({ sucesso: false, repetivel: true, erro: "Pagamento em processamento. Aguarde alguns segundos e tente novamente." });
      }
      const claimAt = new Date().toISOString();
      const { data: claimed, error: claimError } = await admin.from("cobrancas_pedido_cartao").update({
        status: "criando",
        updated_at: claimAt,
      }).eq("id", attempt.id)
        .eq("updated_at", attempt.updated_at)
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) {
        return json({ sucesso: false, repetivel: true, erro: "Pagamento em processamento. Aguarde alguns segundos e tente novamente." });
      }
      attempt.updated_at = claimAt;
      providerStatus = "criando";
    }

    const terminalMapped = mapStatus(providerStatus);
    const retryable = ["criando", "erro", "new", "pagando"].includes(providerStatus);
    if (providerStatus === "pagando") {
      const updatedAt = new Date(attempt.updated_at).getTime();
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt < 90_000) {
        return json({ sucesso: false, repetivel: true, erro: "Pagamento em processamento. Aguarde alguns segundos e tente novamente." });
      }
    }
    if (attempt.efi_charge_id && !retryable) {
      const eventId = `sync:${provider.ambiente}:${attempt.efi_charge_id}:${providerStatus}`;
      const { error: applyError } = await admin.rpc("fsdelivery_aplicar_evento_pagamento_pedido", {
        p_evento_id: eventId,
        p_charge_id: attempt.efi_charge_id,
        p_status_efi: providerStatus,
        p_payload: { origem: "reutilizacao_idempotente" },
        p_ambiente: provider.ambiente,
      });
      if (applyError) throw applyError;
      if (!terminalMapped) {
        return json({ sucesso: false, repetivel: true, erro: "A Efí retornou um estado ainda não reconhecido. Aguarde a reconciliação automática." });
      }
      if (["recusado", "cancelado", "estornado", "chargeback"].includes(terminalMapped)) {
        return json({ sucesso: false, erro: "Pagamento não autorizado. Use outro cartão.", cobranca: {
          pedido_id: order.id, charge_id: attempt.efi_charge_id, status: providerStatus,
          pagamento_status: terminalMapped, valor_centavos: attempt.valor_centavos, ambiente: provider.ambiente,
        } });
      }
      return json({ sucesso: true, reutilizada: true, cobranca: {
        pedido_id: order.id, charge_id: attempt.efi_charge_id, status: providerStatus,
        pagamento_status: terminalMapped, valor_centavos: attempt.valor_centavos, ambiente: provider.ambiente,
      } });
    }

    let chargeId = Number(attempt.efi_charge_id || 0);
    if (!Number.isSafeInteger(chargeId) || chargeId <= 0) {
      const customId = `fsdelivery_pedido_${String(order.id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
      const created = await efiRequest(provider, "/v1/charge", {
        method: "POST",
        body: JSON.stringify({
          items: [{
            name: `Pedido ${order.codigo || order.id}`,
            value: valueCents,
            amount: 1,
            marketplace: {
              mode: Number(integration.modo_tarifa) || 2,
              repasses: [{ payee_code: integration.payee_code, percentage: restaurantPercentage }],
            },
          }],
          metadata: { custom_id: customId, notification_url: notificationUrl(provider.ambiente) },
        }),
      });
      chargeId = Number(created?.data?.charge_id);
      providerStatus = String(created?.data?.status || "new").toLowerCase();
      if (!Number.isSafeInteger(chargeId) || chargeId <= 0) throw new Error("A Efí não retornou uma cobrança válida.");
      const chargeRegisteredAt = new Date().toISOString();
      const { error: chargeError } = await admin.from("cobrancas_pedido_cartao").update({
        efi_charge_id: chargeId,
        status: providerStatus,
        payload_criacao: created,
        erro: null,
        updated_at: chargeRegisteredAt,
      }).eq("id", attemptId);
      if (chargeError) throw chargeError;
      attempt.efi_charge_id = chargeId;
      attempt.status = providerStatus;
      attempt.updated_at = chargeRegisteredAt;
      const orderPatch: Record<string, unknown> = {
        efi_charge_id: chargeId,
        pagamento_provedor: "efi",
        pagamento_status: "aguardando",
        atualizado_em: chargeRegisteredAt,
      };
      if (order.status === "cancelado") orderPatch.status = "aguardando_aprovacao";
      const { error: orderUpdateError } = await admin.from("pedidos").update(orderPatch).eq("id", order.id);
      if (orderUpdateError) throw orderUpdateError;
    }

    const claimAt = new Date().toISOString();
    let paymentClaimQuery = admin.from("cobrancas_pedido_cartao").update({
      status: "pagando",
      updated_at: claimAt,
    }).eq("id", attemptId);
    if (providerStatus === "pagando") {
      paymentClaimQuery = paymentClaimQuery
        .eq("status", "pagando")
        .lt("updated_at", new Date(Date.now() - 90_000).toISOString());
    } else {
      paymentClaimQuery = paymentClaimQuery.eq("status", providerStatus);
    }
    const { data: paymentClaim, error: paymentClaimError } = await paymentClaimQuery
      .select("id")
      .maybeSingle();
    if (paymentClaimError) throw paymentClaimError;
    if (!paymentClaim) {
      return json({ sucesso: false, repetivel: true, erro: "Pagamento em processamento. Aguarde alguns segundos e tente novamente." });
    }
    providerStatus = "pagando";

    let paid: any;
    try {
      paid = await efiRequest(provider, `/v1/charge/${chargeId}/pay`, {
        method: "POST",
        body: JSON.stringify({ payment: { credit_card: { customer, installments: 1, payment_token: paymentToken } } }),
      });
    } catch (paymentError) {
      try {
        const remote = await efiRequest(provider, `/v1/charge/${chargeId}`);
        const remoteStatus = String(remote?.data?.status || remote?.data?.charge?.status || "").toLowerCase();
        if (remoteStatus && remoteStatus !== "new") paid = remote;
      } catch {
        // A tentativa permanece repetível quando a consulta de reconciliação também falha.
      }
      if (!paid) throw paymentError;
    }
    providerStatus = String(paid?.data?.status || paid?.data?.charge?.status || "waiting").toLowerCase();
    const mapped = mapStatus(providerStatus);
    const { error: applyError } = await admin.rpc("fsdelivery_aplicar_evento_pagamento_pedido", {
      p_evento_id: `sync:${provider.ambiente}:${chargeId}:${providerStatus}`,
      p_charge_id: chargeId,
      p_status_efi: providerStatus,
      p_payload: paid,
      p_ambiente: provider.ambiente,
    });
    if (applyError) throw applyError;
    const { error: cardMetadataError } = await admin.from("cobrancas_pedido_cartao").update({
      cartao_mascara: cardMask,
    }).eq("id", attemptId);
    if (cardMetadataError) console.warn("Falha ao registrar máscara do cartão", cardMetadataError);

    const charge = {
      pedido_id: order.id,
      charge_id: chargeId,
      status: providerStatus,
      pagamento_status: mapped,
      valor_centavos: valueCents,
      parcelas: 1,
      ambiente: provider.ambiente,
    };
    if (!mapped) {
      return json({ sucesso: false, repetivel: true, erro: "A Efí retornou um estado ainda não reconhecido. Aguarde a reconciliação automática.", cobranca: charge });
    }
    if (providerStatus === "new") {
      return json({ sucesso: false, repetivel: true, erro: "Pagamento não confirmado. Tente novamente.", cobranca: charge });
    }
    if (["recusado", "cancelado", "estornado", "chargeback"].includes(mapped)) {
      return json({ sucesso: false, erro: "Pagamento não autorizado. Revise o cartão ou use outro.", cobranca: charge });
    }
    return json({ sucesso: true, cobranca: charge });
  } catch (error) {
    const message = describeError(error);
    console.error("criar-cobranca-cartao-pedido", error);
    if (attemptId) {
      try {
        await admin.from("cobrancas_pedido_cartao").update({
          status: "erro",
          erro: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq("id", attemptId)
          .in("status", ["criando", "new", "pagando", "erro"]);
      } catch {
        // O erro original deve ser preservado na resposta.
      }
    }
    return json({ sucesso: false, repetivel: true, erro: publicPaymentError(message) });
  }
});
