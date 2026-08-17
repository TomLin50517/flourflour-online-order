import { getProductAdmin } from "@/server/catalog/admin-products";
import { listCategoriesAdmin } from "@/server/catalog/admin-categories";
import { listOptionGroupsAdmin } from "@/server/catalog/admin-option-groups";
import { ProductForm } from "../ProductForm";

export default async function EditProductPage(
  props: PageProps<"/admin/products/[id]">,
) {
  const { id } = await props.params;
  const [product, categories, optionGroups] = await Promise.all([
    getProductAdmin(id),
    listCategoriesAdmin(),
    listOptionGroupsAdmin(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">編輯商品</h1>
      <ProductForm
        mode="edit"
        productId={product.id}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.translations.find((t) => t.locale === "ZH_TW")?.name ?? c.slug,
        }))}
        optionGroups={optionGroups.map((g) => ({ id: g.id, code: g.code }))}
        initial={{
          slug: product.slug,
          sku: product.sku ?? "",
          categoryId: product.categoryId ?? "",
          basePrice: product.basePrice,
          translations: product.translations,
          images: product.images.map((img) => ({
            url: img.url,
            width: img.width,
            height: img.height,
            isPrimary: img.isPrimary,
          })),
          optionGroupIds: product.optionGroups.map((g) => g.groupId),
        }}
      />
    </div>
  );
}
