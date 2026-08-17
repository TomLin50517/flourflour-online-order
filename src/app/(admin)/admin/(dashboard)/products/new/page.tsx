import { listCategoriesAdmin } from "@/server/catalog/admin-categories";
import { listOptionGroupsAdmin } from "@/server/catalog/admin-option-groups";
import { ProductForm } from "../ProductForm";

export default async function NewProductPage() {
  const [categories, optionGroups] = await Promise.all([
    listCategoriesAdmin(),
    listOptionGroupsAdmin(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">新增商品</h1>
      <ProductForm
        mode="create"
        categories={categories.map((c) => ({
          id: c.id,
          name: c.translations.find((t) => t.locale === "ZH_TW")?.name ?? c.slug,
        }))}
        optionGroups={optionGroups.map((g) => ({ id: g.id, code: g.code }))}
      />
    </div>
  );
}
