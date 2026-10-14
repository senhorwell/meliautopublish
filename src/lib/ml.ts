import { prisma } from "@/lib/db";
import type { ExtractedItem } from "@/lib/types";

export const ML_API = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolivre.com.br/authorization";

export type MlAccountLike = {
  id: string;
  mlUserId: string;
  nickname: string | null;
  accessToken: string;
  siteId: string;
};

export class MlApiError extends Error {
  status: number;
  details: unknown;
  url?: string;

  constructor(status: number, details: unknown, url?: string) {
    super(MlApiError.messageFrom(details, status, url));
    this.name = "MlApiError";
    this.status = status;
    this.details = details;
    this.url = url;
  }

  static messageFrom(details: unknown, status: number, url?: string): string {
    const context = url ? ` [HTTP ${status} · ${url}]` : ` [HTTP ${status}]`;
    if (details && typeof details === "object") {
      const d = details as Record<string, unknown>;
      const cause = Array.isArray(d.cause)
        ? (d.cause as Record<string, unknown>[])
            .map((c) => c.message ?? c.code ?? JSON.stringify(c))
            .join(", ")
        : undefined;
      const base = [d.message, d.error, d.code].find(
        (v) => typeof v === "string",
      );
      if (base) return cause ? `${base} (${cause})${context}` : `${base}${context}`;
      if (cause) return `${cause}${context}`;
    }
    return `Erro na API do Mercado Livre${context}.`;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não configurada. Copie .env.example para .env e preencha.`,
    );
  }
  return value;
}

export function getRedirectUri(): string {
  return (
    process.env.ML_REDIRECT_URI ||
    `${process.env.APP_URL || "http://localhost:3000"}/api/auth/callback`
  );
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: required("ML_CLIENT_ID"),
    redirect_uri: getRedirectUri(),
    state,
  });
  return `${ML_AUTH}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id?: number;
  scope?: string;
};

type MlUser = { id: number; nickname?: string; site_id?: string };

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new MlApiError(res.status, data, `${ML_API}/oauth/token`);
  return data as TokenResponse;
}

export function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  return requestToken({
    grant_type: "authorization_code",
    client_id: required("ML_CLIENT_ID"),
    client_secret: required("ML_CLIENT_SECRET"),
    code,
    redirect_uri: getRedirectUri(),
  });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return requestToken({
    grant_type: "refresh_token",
    client_id: required("ML_CLIENT_ID"),
    client_secret: required("ML_CLIENT_SECRET"),
    refresh_token: refreshToken,
  });
}

export async function mlFetch<T = unknown>(
  url: string,
  token?: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new MlApiError(res.status, data, url);
  return data as T;
}

export async function saveAccountFromToken(token: TokenResponse) {
  const me = await mlFetch<MlUser>(`${ML_API}/users/me`, token.access_token);
  const mlUserId = String(token.user_id ?? me.id);
  const expiresAt = new Date(Date.now() + Math.max(0, token.expires_in - 60) * 1000);

  return prisma.mlAccount.upsert({
    where: { mlUserId },
    create: {
      mlUserId,
      nickname: me.nickname ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      siteId: me.site_id ?? process.env.ML_SITE_ID ?? "MLB",
    },
    update: {
      nickname: me.nickname ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? undefined,
      expiresAt,
      siteId: me.site_id ?? process.env.ML_SITE_ID ?? "MLB",
    },
  });
}

export async function getStoredAccount() {
  return prisma.mlAccount.findFirst({ orderBy: { updatedAt: "desc" } });
}

/**
 * Retorna a conta conectada, renovando o access_token automaticamente
 * quando próximo de expirar.
 */
export async function getValidAccount() {
  const account = await getStoredAccount();
  if (!account) return null;

  const stillValid = account.expiresAt.getTime() > Date.now() + 5 * 60 * 1000;
  if (stillValid) return account;

  const refreshed = await refreshAccessToken(account.refreshToken);
  const expiresAt = new Date(
    Date.now() + Math.max(0, refreshed.expires_in - 60) * 1000,
  );

  return prisma.mlAccount.update({
    where: { id: account.id },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? account.refreshToken,
      expiresAt,
    },
  });
}

export async function deleteAccounts() {
  return prisma.mlAccount.deleteMany();
}

/**
 * Verifica (via recurso público) se um ID de categoria existe no Mercado Livre.
 * Em caso de falha de rede/bloqueio retorna true para não descartar um ID
 * potencialmente válido sugerido pela IA.
 */
export async function categoryExists(categoryId: string): Promise<boolean> {
  try {
    await mlFetch(`${ML_API}/categories/${categoryId}`);
    return true;
  } catch (error) {
    if (error instanceof MlApiError) return false;
    return true;
  }
}

function pickCategoryId(data: unknown): string | null {
  if (Array.isArray(data)) {
    for (const entry of data) {
      const id = pickCategoryId(entry);
      if (id) return id;
    }
    return null;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const direct = [obj.id, obj.category_id, obj.categoryId].find(
      (value) => typeof value === "string" && /^ML[A-Z]\d+$/i.test(value),
    );
    if (typeof direct === "string") return direct.toUpperCase();
    for (const value of Object.values(obj)) {
      const id = pickCategoryId(value);
      if (id) return id;
    }
  }
  return null;
}

/**
 * Consulta o preditor público de categorias do Mercado Livre a partir do
 * título do produto. Retorna null quando a API não responde ou não há
 * categoria compatível.
 */
export async function predictCategoryId(title: string): Promise<string | null> {
  const url = `${ML_API}/sites/MLB/domain_discovery/search?limit=1&q=${encodeURIComponent(title)}`;
  try {
    const data = await mlFetch<unknown>(url);
    const id = pickCategoryId(data);
    return id && /^ML[A-Z]\d+$/i.test(id) ? id.toUpperCase() : null;
  } catch {
    return null;
  }
}

export type CreateItemPayload = {
  title: string;
  categoryId: string;
  price: number;
  currencyId: string;
  availableQuantity: number;
  condition: string;
  listingTypeId: string;
  pictures: string[];
  attributes?: {
    id: string;
    value_id?: string;
    value_name?: string;
  }[];
};

type MlCreatedItem = {
  id: string;
  permalink: string;
  title: string;
  price: number;
};

function buildItemBody(payload: CreateItemPayload, withAttributes: boolean) {
  const body: Record<string, unknown> = {
    title: payload.title,
    category_id: payload.categoryId,
    price: payload.price,
    currency_id: payload.currencyId || "BRL",
    available_quantity: Math.max(1, payload.availableQuantity || 1),
    buying_mode: "buy_it_now",
    condition: payload.condition || "new",
    listing_type_id: payload.listingTypeId,
    pictures: payload.pictures.slice(0, 10).map((source) => ({ source })),
  };
  if (withAttributes && payload.attributes && payload.attributes.length > 0) {
    body.attributes = payload.attributes;
  }
  return body;
}

/**
 * Cria o anúncio. Alguns atributos herdados do anúncio original podem ser
 * inválidos para a nova categoria; se o Mercado Livre rejeitar por causa de
 * atributos, tentamos novamente sem eles.
 */
export async function createItem(
  token: string,
  payload: CreateItemPayload,
  sourceItem: ExtractedItem,
): Promise<MlCreatedItem> {
  const attributes = sourceItem.attributes
    .filter((a) => a.value_id || a.value_name)
    .map((a) =>
      a.value_id
        ? { id: a.id, value_id: a.value_id as string }
        : { id: a.id, value_name: a.value_name as string },
    );

  try {
    return await mlFetch<MlCreatedItem>(`${ML_API}/items`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildItemBody({ ...payload, attributes }, true)),
    });
  } catch (error) {
    const isAttributeIssue =
      error instanceof MlApiError &&
      error.status === 400 &&
      /attribute|atributo/i.test(JSON.stringify(error.details ?? ""));

    if (!isAttributeIssue) throw error;

    return mlFetch<MlCreatedItem>(`${ML_API}/items`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildItemBody(payload, false)),
    });
  }
}

export async function setItemDescription(
  token: string,
  itemId: string,
  plainText: string,
) {
  return mlFetch(`${ML_API}/items/${itemId}/description`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plain_text: plainText }),
  });
}
