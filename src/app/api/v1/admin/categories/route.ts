import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { createCategorySchema } from "@/schemas/admin";
import { createCategory, listCategoriesAdmin } from "@/server/catalog/admin-categories";
import { requireAdmin, requireStaff } from "@/server/admin/guard";

export async function GET() {
  try {
    await requireStaff();
    const categories = await listCategoriesAdmin();
    return NextResponse.json(categories);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = createCategorySchema.parse(await request.json());
    const category = await createCategory(body, session.user.id);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
