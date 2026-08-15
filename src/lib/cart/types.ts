// 見 SPEC.md §9.1：購物車存於 localStorage，僅存商品/選項識別，不存價格
export type CartLine = {
  productId: string;
  quantity: number;
  optionItemIds: string[];
};
