import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { listMissingTranslations } from "@/server/catalog/admin-products";
import { requireStaff } from "@/server/admin/guard";

export async function GET() {
  try {
    await requireStaff();
    const missing = await listMissingTranslations();
    return NextResponse.json(missing);
  } catch (error) {
    return toErrorResponse(error);
  }
}
