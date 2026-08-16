import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { idParamsSchema, productAvailabilitySchema } from "@/schemas/admin";
import { updateProductAvailability } from "@/server/catalog/admin-products";
import { requireStaff } from "@/server/admin/guard";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/v1/admin/products/[id]/availability">,
) {
  try {
    const session = await requireStaff();
    const { id } = idParamsSchema.parse(await context.params);
    const body = productAvailabilitySchema.parse(await request.json());
    const product = await updateProductAvailability(id, body, session.user.id);
    return NextResponse.json(product);
  } catch (error) {
    return toErrorResponse(error);
  }
}
