import { prisma } from "@/lib/db";

const COOKIE_KEY = "ml_session_cookie";

export type MlSession = {
  cookie: string | null;
  source: "db" | "env" | null;
  updatedAt: Date | null;
  preview: string | null;
};

/**
 * Normaliza o valor colado pelo usuário: aceita o cabeçalho "Cookie: a=b; c=d",
 * quebras de linha e aspas em volta.
 */
export function normalizeCookie(input: string): string {
  return input
    .replace(/^\s*cookie\s*:/i, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

/**
 * Gera uma prévia segura do cookie (nomes das chaves + hash final), sem
 * expor os valores — usado para a UI confirmar que a sessão foi salva.
 */
export function maskCookie(cookie: string): string {
  const names = cookie
    .split(";")
    .map((part) => part.split("=")[0]?.trim())
    .filter(Boolean);
  const tail = cookie.slice(-8);
  return `${names.join(", ")} ·•••${tail}`;
}

function envCookie(): string | null {
  const value = process.env.ML_SESSION_COOKIE?.trim();
  return value ? normalizeCookie(value) : null;
}

/**
 * Retorna a sessão do Mercado Livre usada pelo scraper. Prioriza o cookie
 * salvo no banco (configurável pela UI) e cai para `ML_SESSION_COOKIE`.
 */
export async function getMlSession(): Promise<MlSession> {
  const row = await prisma.setting.findUnique({ where: { key: COOKIE_KEY } });
  const dbValue = row?.value?.trim();
  if (dbValue) {
    return {
      cookie: dbValue,
      source: "db",
      updatedAt: row?.updatedAt ?? null,
      preview: maskCookie(dbValue),
    };
  }

  const fallback = envCookie();
  if (fallback) {
    return { cookie: fallback, source: "env", updatedAt: null, preview: maskCookie(fallback) };
  }

  return { cookie: null, source: null, updatedAt: null, preview: null };
}

export async function getMlSessionCookie(): Promise<string | null> {
  return (await getMlSession()).cookie;
}

export async function setMlSessionCookie(input: string): Promise<void> {
  const value = normalizeCookie(input);
  if (!value) throw new Error("Cookie de sessão vazio.");
  await prisma.setting.upsert({
    where: { key: COOKIE_KEY },
    create: { key: COOKIE_KEY, value },
    update: { value },
  });
}

export async function clearMlSessionCookie(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: COOKIE_KEY } });
}
