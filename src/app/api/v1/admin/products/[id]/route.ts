import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { idParamsSchema, updateProductSchema } from "@/schemas/admin";
import {
  deleteProduct,
  getProductAdmin,
  updateProduct,
} from "@/server/catalog/admin-products";
import { requireAdmin, requireStaff } from "@/server/admin/guard";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/v1/admin/products/[id]">,
) {
  try {
    await requireStaff();
    const { id } = idParamsSchema.parse(await context.params);
    const product = await getProductAdmin(id);
    return NextResponse.json(product);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/v1/admin/products/[id]">,
) {
  try {
    await requireAdmin();
    const { id } = idParamsSchema.parse(await context.params);
    const body = updateProductSchema.parse(await request.json());
    const product = await updateProduct(id, body);
    return NextResponse.json(product);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/v1/admin/products/[id]">,
) {
  try {
    await requireAdmin();
    const { id } = idParamsSchema.parse(await context.params);
    await deleteProduct(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
