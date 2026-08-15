import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { idParamsSchema, updateOptionGroupSchema } from "@/schemas/admin";
import { deleteOptionGroup, updateOptionGroup } from "@/server/catalog/admin-option-groups";
import { requireAdmin } from "@/server/admin/guard";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/v1/admin/option-groups/[id]">,
) {
  try {
    await requireAdmin();
    const { id } = idParamsSchema.parse(await context.params);
    const body = updateOptionGroupSchema.parse(await request.json());
    const group = await updateOptionGroup(id, body);
    return NextResponse.json(group);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/v1/admin/option-groups/[id]">,
) {
  try {
    await requireAdmin();
    const { id } = idParamsSchema.parse(await context.params);
    await deleteOptionGroup(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
