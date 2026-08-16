import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { LocaleCode } from "../src/generated/prisma/enums";
import { BCRYPT_COST } from "../src/lib/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type Translations = Record<LocaleCode, string>;

function t(zhTw: string, en: string, ja: string, ko: string): Translations {
  return { ZH_TW: zhTw, EN: en, JA: ja, KO: ko };
}

function translationRows(translations: Translations) {
  return Object.entries(translations).map(([locale, name]) => ({
    locale: locale as LocaleCode,
    name,
  }));
}

const categories = [
  {
    slug: "croissant",
    sortOrder: 0,
    name: t("經典可頌", "Classic Croissants", "定番クロワッサン", "클래식 크루아상"),
  },
  {
    slug: "danish",
    sortOrder: 1,
    name: t("丹麥棒", "Danish Sticks", "デニッシュスティック", "데니시 스틱"),
  },
  {
    slug: "gift",
    sortOrder: 2,
    name: t("特色禮盒", "Signature Gift Boxes", "ギフトボックス", "시그니처 기프트 박스"),
  },
] as const;

const products = [
  {
    slug: "plain-croissant",
    category: "croissant",
    basePrice: 80,
    image: { file: "plain-croissant.jpg", width: 205, height: 194 },
    name: t("原味可頌", "Plain Croissant", "プレーン・クロワッサン", "플레인 크루아상"),
    description: t(
      "奶香，是旅程的開始",
      "Where every good thing begins — with butter.",
      "すべての幸せは、バターの香りから。",
      "모든 좋은 것은 버터 향에서 시작됩니다.",
    ),
    optionGroups: ["addon"],
  },
  {
    slug: "lemon-croissant",
    category: "croissant",
    basePrice: 135,
    image: { file: "lemon-croissant.jpg", width: 287, height: 284 },
    name: t("檸檬可頌", "Lemon Croissant", "レモン・クロワッサン", "레몬 크루아상"),
    description: t(
      "晨光般的清新酸香",
      "A bright, citrus freshness, like morning light.",
      "朝の光のような、爽やかな酸味。",
      "아침 햇살 같은 상큼한 산미.",
    ),
    optionGroups: ["addon"],
  },
  {
    slug: "chocolate-croissant",
    category: "croissant",
    basePrice: 135,
    image: { file: "chocolate-croissant.jpg", width: 224, height: 298 },
    name: t("巧克力可頌", "Chocolate Croissant", "ショコラ・クロワッサン", "초콜릿 크루아상"),
    description: t(
      "深邃可可，靜靜綻放",
      "Richness — the gentlest of answers.",
      "濃厚さは、いちばん優しい答え。",
      "진함은 가장 부드러운 답입니다.",
    ),
    optionGroups: ["addon"],
  },
  {
    slug: "honey-longan-croissant",
    category: "croissant",
    basePrice: 135,
    image: { file: "honey-longan-croissant.jpg", width: 218, height: 291 },
    name: t("蜜香龍眼可頌", "Honey Longan Croissant", "蜜香龍眼クロワッサン", "룽옌 꿀 크루아상"),
    description: t(
      "蜜香流轉，餘韻悠長",
      "Longan honey, lingering long on the palate.",
      "蜜の香りが流れ、余韻は長く。",
      "꿀 향이 흐르고, 여운은 길게.",
    ),
    optionGroups: ["addon"],
  },
  {
    slug: "matcha-croissant",
    category: "croissant",
    basePrice: 135,
    image: { file: "matcha-croissant.jpg", width: 229, height: 305 },
    name: t("抹茶可頌", "Matcha Croissant", "抹茶クロワッサン", "말차 크루아상"),
    description: t(
      "一抹茶韻，靜心回甘",
      "Savour it quietly — a note of matcha.",
      "静かに味わう、一抹の茶の香り。",
      "조용히 음미하는 한 줄기 찻향.",
    ),
    optionGroups: ["addon"],
  },
  {
    slug: "black-sesame-croissant",
    category: "croissant",
    basePrice: 150,
    image: { file: "black-sesame-croissant.jpg", width: 284, height: 243 },
    name: t("黑芝麻可頌", "Black Sesame Croissant", "黒ごまクロワッサン", "흑임자 크루아상"),
    description: t(
      "芝麻醇厚，溫柔留香",
      "Deep, mellow sesame that lingers gently.",
      "香ばしいごまの、やわらかな余韻。",
      "진하고 부드러운 참깨의 여운.",
    ),
    optionGroups: ["addon"],
  },
  {
    slug: "longan-tea-danish",
    category: "danish",
    basePrice: 550,
    image: { file: "longan-tea-danish.jpg", width: 1111, height: 1473 },
    name: t("茶香龍眼丹麥棒", "Longan Tea Danish Stick", "龍眼茶デニッシュスティック", "룽옌차 데니시 스틱"),
    description: t(
      "茶香伴風景，甜在旅程",
      "Tea and river view, sweetness for the journey.",
      "茶の香りと風景、旅の甘さ。",
      "차향과 풍경, 여정 속 달콤함.",
    ),
    optionGroups: ["addon"],
  },
  {
    slug: "youtiao-danish",
    category: "danish",
    basePrice: 600,
    image: { file: "youtiao-danish.jpg", width: 782, height: 978 },
    name: t("丹麥油條棒", "Youtiao Danish Stick", "油條デニッシュスティック", "유탸오 데니시 스틱"),
    description: t(
      "熟悉記憶，優雅重逢",
      "A familiar memory, elegantly met again.",
      "懐かしい記憶と、優雅な再会。",
      "익숙한 기억과의 우아한 재회.",
    ),
    optionGroups: ["addon"],
  },
  {
    slug: "sunset-yolk-cookies",
    category: "gift",
    basePrice: 550,
    image: { file: "sunset-yolk-cookies.jpg", width: 1114, height: 1469 },
    name: t("夕陽金沙夾心餅", "Sunset Salted-Yolk Cookies", "夕陽 塩漬け卵黄サンドクッキー", "석양 소금 노른자 샌드 쿠키"),
    description: t(
      "金沙暖香入餅，收藏一抹夕照",
      "A warm golden filling, wrapped in a keepsake of sunset.",
      "金沙の温かな香りをサンドし、夕映えの余韻をひとつ。",
      "석양의 따스한 노른자 향을 쿠키에 담아, 그 여운을 간직하다.",
    ),
    optionGroups: ["boxSize"],
  },
  {
    slug: "pineapple-cake",
    category: "gift",
    basePrice: 680,
    image: { file: "pineapple-cake.jpg", width: 800, height: 800 },
    name: t("台灣鳳梨酥", "Taiwanese Pineapple Cake", "台湾パイナップルケーキ", "대만 펑리수"),
    description: t(
      "將台灣風味細細珍藏",
      "Taiwan's flavour, tenderly kept.",
      "台湾の風味を、そっと大切に。",
      "대만의 풍미를 곱게 간직하다.",
    ),
    optionGroups: ["boxSize"],
  },
] as const;

const optionGroups = [
  {
    code: "boxSize",
    selectType: "SINGLE" as const,
    minSelect: 1,
    maxSelect: 1,
    name: t("盒裝入數", "Box Size", "箱のサイズ", "박스 수량"),
    items: [
      { code: "size4", priceDelta: 0, isDefault: true, sortOrder: 0, name: t("4入", "4 pcs", "4個入り", "4개입") },
      { code: "size6", priceDelta: 150, isDefault: false, sortOrder: 1, name: t("6入", "6 pcs", "6個入り", "6개입") },
      { code: "size8", priceDelta: 280, isDefault: false, sortOrder: 2, name: t("8入", "8 pcs", "8個入り", "8개입") },
    ],
  },
  {
    code: "addon",
    selectType: "MULTIPLE" as const,
    minSelect: 0,
    maxSelect: 2,
    name: t("加購", "Add-on", "追加購入", "추가 구매"),
    items: [
      { code: "giftBag", priceDelta: 30, isDefault: false, sortOrder: 0, name: t("質感提袋", "Gift Bag", "ギフトバッグ", "기프트 백") },
      { code: "icePack", priceDelta: 25, isDefault: false, sortOrder: 1, name: t("保冷袋", "Ice Pack", "保冷バッグ", "보냉백") },
    ],
  },
] as const;

async function main() {
  const store = await prisma.store.upsert({
    where: { id: "store-main" },
    update: {},
    create: {
      id: "store-main",
      name: "FlourFlour",
    },
  });

  // Reset catalog data for idempotent re-seeding; Store itself is preserved.
  await prisma.product.deleteMany({ where: { storeId: store.id } });
  await prisma.optionGroup.deleteMany({ where: { storeId: store.id } });
  await prisma.category.deleteMany({ where: { storeId: store.id } });

  const categoryIdBySlug = new Map<string, string>();
  for (const category of categories) {
    const created = await prisma.category.create({
      data: {
        storeId: store.id,
        slug: category.slug,
        sortOrder: category.sortOrder,
        translations: { create: translationRows(category.name) },
      },
    });
    categoryIdBySlug.set(category.slug, created.id);
  }

  const optionGroupIdByCode = new Map<string, string>();
  for (const group of optionGroups) {
    const created = await prisma.optionGroup.create({
      data: {
        storeId: store.id,
        code: group.code,
        selectType: group.selectType,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        translations: { create: translationRows(group.name) },
        items: {
          create: group.items.map((item) => ({
            code: item.code,
            priceDelta: item.priceDelta,
            isDefault: item.isDefault,
            sortOrder: item.sortOrder,
            translations: { create: translationRows(item.name) },
          })),
        },
      },
    });
    optionGroupIdByCode.set(group.code, created.id);
  }

  for (const [index, product] of products.entries()) {
    const categoryId = categoryIdBySlug.get(product.category);
    if (!categoryId) throw new Error(`Unknown category: ${product.category}`);

    await prisma.product.create({
      data: {
        storeId: store.id,
        categoryId,
        slug: product.slug,
        basePrice: product.basePrice,
        sortOrder: index,
        translations: {
          create: Object.entries(product.name).map(([locale, name]) => ({
            locale: locale as LocaleCode,
            name,
            description: product.description[locale as LocaleCode],
          })),
        },
        images: {
          create: [
            {
              url: `/images/products/${product.image.file}`,
              width: product.image.width,
              height: product.image.height,
              isPrimary: true,
              altText: product.name.ZH_TW,
            },
          ],
        },
        optionGroups: {
          create: product.optionGroups.map((code, groupSortOrder) => {
            const groupId = optionGroupIdByCode.get(code);
            if (!groupId) throw new Error(`Unknown option group: ${code}`);
            const group = optionGroups.find((g) => g.code === code)!;
            return {
              groupId,
              sortOrder: groupSortOrder,
              isRequired: group.minSelect > 0,
            };
          }),
        },
      },
    });
  }

  console.log(`Seeded store "${store.name}" with ${categories.length} categories, ${optionGroups.length} option groups, ${products.length} products.`);

  const adminEmail = process.env.ADMIN_SEED_EMAIL ?? "admin@flourflour.test";
  const adminPassword = process.env.ADMIN_SEED_PASSWORD ?? "admin1234";
  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
  await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: { passwordHash },
    create: {
      email: adminEmail,
      passwordHash,
      displayName: "Admin",
      role: "ADMIN",
    },
  });
  console.log(`Seeded admin user "${adminEmail}" (dev password: "${adminPassword}", change before real use).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
