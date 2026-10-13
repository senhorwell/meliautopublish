import { randomBytes } from "node:crypto";
import { connection, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/ml";

export async function GET() {
  await connection();
  try {
    const state = randomBytes(16).toString("hex");
    const authUrl = buildAuthUrl(state);
    const response = NextResponse.redirect(authUrl);
    response.cookies.set("ml_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao iniciar autenticação.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
