import { cookies } from "next/headers";
import { connection, NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, saveAccountFromToken } from "@/lib/ml";

function appBase(request: NextRequest): string {
  return process.env.APP_URL || new URL(request.url).origin;
}

function redirect(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(`${appBase(request)}${path}`);
  response.cookies.delete("ml_oauth_state");
  return response;
}

export async function GET(request: NextRequest) {
  await connection();
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("ml_oauth_state")?.value;

  if (error) {
    return redirect(request, `/?ml=error&message=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return redirect(
      request,
      `/?ml=error&message=${encodeURIComponent("Código de autorização ausente.")}`,
    );
  }
  if (expectedState && state !== expectedState) {
    return redirect(
      request,
      `/?ml=error&message=${encodeURIComponent("Falha na verificação de segurança (state).")}`,
    );
  }

  try {
    const token = await exchangeCodeForToken(code);
    const account = await saveAccountFromToken(token);
    return redirect(
      request,
      `/?ml=connected&nickname=${encodeURIComponent(account.nickname ?? "")}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro no OAuth.";
    return redirect(
      request,
      `/?ml=error&message=${encodeURIComponent(message)}`,
    );
  }
}
