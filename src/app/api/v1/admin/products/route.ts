import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { createProductSchema } from "@/schemas/admin";
import { createProduct, listProductsAdmin } from "@/server/catalog/admin-products";
import { requireAdmin, requireStaff } from "@/server/admin/guard";

export async function GET(request: NextRequest) {
  try {
    await requireStaff();
    const { searchParams } = request.nextUrl;
    const result = await listProductsAdmin({
      page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
      pageSize: searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
      keyword: searchParams.get("keyword") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      isActive: searchParams.has("isActive") ? searchParams.get("isActive") === "true" : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = createProductSchema.parse(await request.json());
    const product = await createProduct(body, session.user.id);
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
