import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { idParamsSchema, updateCategorySchema } from "@/schemas/admin";
import { deleteCategory, updateCategory } from "@/server/catalog/admin-categories";
import { requireAdmin } from "@/server/admin/guard";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/v1/admin/categories/[id]">,
) {
  try {
    const session = await requireAdmin();
    const { id } = idParamsSchema.parse(await context.params);
    const body = updateCategorySchema.parse(await request.json());
    const category = await updateCategory(id, body, session.user.id);
    return NextResponse.json(category);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/v1/admin/categories/[id]">,
) {
  try {
    const session = await requireAdmin();
    const { id } = idParamsSchema.parse(await context.params);
    await deleteCategory(id, session.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
