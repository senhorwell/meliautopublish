import { connection, NextRequest, NextResponse } from "next/server";
import { deleteAccounts } from "@/lib/ml";

export async function GET(request: NextRequest) {
  await connection();
  await deleteAccounts();
  const base = process.env.APP_URL || new URL(request.url).origin;
  return NextResponse.redirect(`${base}/?ml=disconnected`);
}
