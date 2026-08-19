export type MenuImage = {
  url: string;
  width: number;
  height: number;
  alt: string;
};

export type MenuProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  basePrice: number;
  primaryImage: MenuImage | null;
  isSoldOut: boolean;
  hasOptions: boolean;
  containsAlcohol: boolean;
};

export type MenuCategory = {
  id: string;
  slug: string;
  name: string;
  products: MenuProduct[];
};

export type Menu = {
  store: { name: string; isOpen: boolean; currency: string };
  categories: MenuCategory[];
};

export type ProductOptionItem = {
  id: string;
  code: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
};

export type ProductOptionGroup = {
  id: string;
  name: string;
  selectType: "SINGLE" | "MULTIPLE";
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  items: ProductOptionItem[];
};

export type ProductDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  basePrice: number;
  isSoldOut: boolean;
  containsAlcohol: boolean;
  images: MenuImage[];
  optionGroups: ProductOptionGroup[];
};
