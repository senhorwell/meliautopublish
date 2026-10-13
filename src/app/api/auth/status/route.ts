import { connection } from "next/server";
import { getStoredAccount, getValidAccount } from "@/lib/ml";

export async function GET() {
  await connection();
  try {
    const account = await getStoredAccount();
    if (!account) {
      return Response.json({ connected: false });
    }

    try {
      await getValidAccount();
    } catch {
      return Response.json({
        connected: false,
        error: "Sessão expirada. Reconecte sua conta do Mercado Livre.",
      });
    }

    return Response.json({
      connected: true,
      nickname: account.nickname,
      mlUserId: account.mlUserId,
      siteId: account.siteId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao consultar status.";
    return Response.json({ connected: false, error: message }, { status: 500 });
  }
}
