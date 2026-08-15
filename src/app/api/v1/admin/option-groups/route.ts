import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { createOptionGroupSchema } from "@/schemas/admin";
import { createOptionGroup, listOptionGroupsAdmin } from "@/server/catalog/admin-option-groups";
import { requireAdmin, requireStaff } from "@/server/admin/guard";

export async function GET() {
  try {
    await requireStaff();
    const groups = await listOptionGroupsAdmin();
    return NextResponse.json(groups);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = createOptionGroupSchema.parse(await request.json());
    const group = await createOptionGroup(body);
    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
