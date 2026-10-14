import { connection, NextRequest } from "next/server";
import {
  clearMlSessionCookie,
  getMlSession,
  setMlSessionCookie,
} from "@/lib/session";

export async function GET() {
  await connection();
  const session = await getMlSession();
  return Response.json({
    configured: Boolean(session.cookie),
    source: session.source,
    updatedAt: session.updatedAt,
    preview: session.preview,
  });
}

export async function POST(request: NextRequest) {
  await connection();
  let body: { cookie?: string } = {};
  try {
    body = (await request.json()) as { cookie?: string };
  } catch {
    body = {};
  }

  const cookie = typeof body.cookie === "string" ? body.cookie : "";
  if (!cookie.trim()) {
    return Response.json({ error: "Cole o cookie de sessão." }, { status: 400 });
  }
  if (!cookie.includes("=")) {
    return Response.json(
      { error: "Formato inválido. Cole o valor de um cookie do tipo \"chave=valor; ...\"." },
      { status: 400 },
    );
  }

  try {
    await setMlSessionCookie(cookie);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível salvar o cookie.";
    return Response.json({ error: message }, { status: 400 });
  }

  const session = await getMlSession();
  return Response.json({
    configured: true,
    source: session.source,
    updatedAt: session.updatedAt,
    preview: session.preview,
  });
}

export async function DELETE() {
  await connection();
  await clearMlSessionCookie();
  return Response.json({ configured: false, source: null, updatedAt: null, preview: null });
}
