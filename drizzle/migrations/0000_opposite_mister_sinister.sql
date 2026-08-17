CREATE TYPE "public"."AdminRole" AS ENUM('ADMIN', 'STAFF');--> statement-breakpoint
CREATE TYPE "public"."LocaleCode" AS ENUM('ZH_TW', 'EN', 'JA', 'KO');--> statement-breakpoint
CREATE TYPE "public"."OptionSelectType" AS ENUM('SINGLE', 'MULTIPLE');--> statement-breakpoint
CREATE TYPE "public"."OrderStatus" AS ENUM('PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."PaymentStatus" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TABLE "AdminUser" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"displayName" text NOT NULL,
	"role" "AdminRole" DEFAULT 'STAFF' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastLoginAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"actorId" text,
	"action" text NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text NOT NULL,
	"diff" jsonb,
	"ip" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Category" (
	"id" text PRIMARY KEY NOT NULL,
	"storeId" text NOT NULL,
	"slug" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CategoryTranslation" (
	"id" text PRIMARY KEY NOT NULL,
	"categoryId" text NOT NULL,
	"locale" "LocaleCode" NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DailyProductSales" (
	"storeId" text NOT NULL,
	"businessDate" date NOT NULL,
	"productId" text NOT NULL,
	"productNameZh" text NOT NULL,
	"quantitySold" integer DEFAULT 0 NOT NULL,
	"grossAmount" integer DEFAULT 0 NOT NULL,
	"refundedQty" integer DEFAULT 0 NOT NULL,
	"refundedAmount" integer DEFAULT 0 NOT NULL,
	"netQuantity" integer DEFAULT 0 NOT NULL,
	"netAmount" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "DailyProductSales_pkey" PRIMARY KEY("storeId","businessDate","productId")
);
--> statement-breakpoint
CREATE TABLE "OptionGroup" (
	"id" text PRIMARY KEY NOT NULL,
	"storeId" text NOT NULL,
	"code" text NOT NULL,
	"selectType" "OptionSelectType" DEFAULT 'SINGLE' NOT NULL,
	"minSelect" integer DEFAULT 1 NOT NULL,
	"maxSelect" integer DEFAULT 1 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OptionGroupTranslation" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"locale" "LocaleCode" NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OptionItem" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"code" text NOT NULL,
	"priceDelta" integer DEFAULT 0 NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OptionItemTranslation" (
	"id" text PRIMARY KEY NOT NULL,
	"itemId" text NOT NULL,
	"locale" "LocaleCode" NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Order" (
	"id" text PRIMARY KEY NOT NULL,
	"storeId" text NOT NULL,
	"orderNo" text NOT NULL,
	"accessToken" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"status" "OrderStatus" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"locale" "LocaleCode" NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"subtotalAmount" integer NOT NULL,
	"discountAmount" integer DEFAULT 0 NOT NULL,
	"totalAmount" integer NOT NULL,
	"pickupNumber" text,
	"businessDate" date,
	"pickupSeq" integer,
	"customerName" text,
	"customerPhone" text,
	"customerNote" text,
	"placedAt" timestamp (3) DEFAULT now() NOT NULL,
	"paidAt" timestamp (3),
	"readyAt" timestamp (3),
	"completedAt" timestamp (3),
	"cancelledAt" timestamp (3),
	"cancelReason" text,
	"expiresAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OrderEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"orderId" text NOT NULL,
	"fromStatus" "OrderStatus",
	"toStatus" "OrderStatus" NOT NULL,
	"actorType" text NOT NULL,
	"actorId" text,
	"note" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OrderItem" (
	"id" text PRIMARY KEY NOT NULL,
	"orderId" text NOT NULL,
	"productId" text NOT NULL,
	"quantity" integer NOT NULL,
	"nameSnapshot" jsonb NOT NULL,
	"imageUrlSnapshot" text,
	"unitBasePrice" integer NOT NULL,
	"unitOptionsPrice" integer NOT NULL,
	"unitPrice" integer NOT NULL,
	"lineTotal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OrderItemOption" (
	"id" text PRIMARY KEY NOT NULL,
	"orderItemId" text NOT NULL,
	"optionItemId" text NOT NULL,
	"groupNameSnapshot" jsonb NOT NULL,
	"itemNameSnapshot" jsonb NOT NULL,
	"priceDelta" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OrderNoCounter" (
	"storeId" text NOT NULL,
	"businessDate" date NOT NULL,
	"lastSeq" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "OrderNoCounter_pkey" PRIMARY KEY("storeId","businessDate")
);
--> statement-breakpoint
CREATE TABLE "Payment" (
	"id" text PRIMARY KEY NOT NULL,
	"orderId" text NOT NULL,
	"provider" text NOT NULL,
	"providerRef" text,
	"status" "PaymentStatus" DEFAULT 'PENDING' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"method" text,
	"cardLast4" text,
	"cardBrand" text,
	"failureCode" text,
	"failureMessage" text,
	"idempotencyKey" text NOT NULL,
	"rawRequest" jsonb,
	"rawResponse" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"paidAt" timestamp (3),
	"refundedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "PaymentEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"paymentId" text,
	"provider" text NOT NULL,
	"providerEventId" text NOT NULL,
	"eventType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signatureValid" boolean NOT NULL,
	"processedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PickupCounter" (
	"storeId" text NOT NULL,
	"businessDate" date NOT NULL,
	"lastSeq" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "PickupCounter_pkey" PRIMARY KEY("storeId","businessDate")
);
--> statement-breakpoint
CREATE TABLE "Product" (
	"id" text PRIMARY KEY NOT NULL,
	"storeId" text NOT NULL,
	"categoryId" text,
	"slug" text NOT NULL,
	"sku" text,
	"basePrice" integer NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"isSoldOut" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"deletedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "ProductImage" (
	"id" text PRIMARY KEY NOT NULL,
	"productId" text NOT NULL,
	"url" text NOT NULL,
	"altText" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isPrimary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProductOptionGroup" (
	"productId" text NOT NULL,
	"groupId" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isRequired" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ProductOptionGroup_pkey" PRIMARY KEY("productId","groupId")
);
--> statement-breakpoint
CREATE TABLE "ProductTranslation" (
	"id" text PRIMARY KEY NOT NULL,
	"productId" text NOT NULL,
	"locale" "LocaleCode" NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "Store" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Taipei' NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"businessDayCutoff" text DEFAULT '04:00' NOT NULL,
	"pickupPrefix" text DEFAULT 'A' NOT NULL,
	"pickupPadding" integer DEFAULT 3 NOT NULL,
	"pickupMax" integer DEFAULT 999 NOT NULL,
	"isOpen" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Category" ADD CONSTRAINT "Category_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CategoryTranslation" ADD CONSTRAINT "CategoryTranslation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OptionGroup" ADD CONSTRAINT "OptionGroup_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OptionGroupTranslation" ADD CONSTRAINT "OptionGroupTranslation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."OptionGroup"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OptionItem" ADD CONSTRAINT "OptionItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."OptionGroup"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OptionItemTranslation" ADD CONSTRAINT "OptionItemTranslation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."OptionItem"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrderItemOption" ADD CONSTRAINT "OrderItemOption_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."OrderItem"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."OptionGroup"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProductTranslation" ADD CONSTRAINT "ProductTranslation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser" USING btree ("email");--> statement-breakpoint
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog" USING btree ("targetType","targetId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "Category_storeId_slug_key" ON "Category" USING btree ("storeId","slug");--> statement-breakpoint
CREATE INDEX "Category_storeId_sortOrder_idx" ON "Category" USING btree ("storeId","sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "CategoryTranslation_categoryId_locale_key" ON "CategoryTranslation" USING btree ("categoryId","locale");--> statement-breakpoint
CREATE INDEX "DailyProductSales_storeId_businessDate_idx" ON "DailyProductSales" USING btree ("storeId","businessDate");--> statement-breakpoint
CREATE UNIQUE INDEX "OptionGroup_storeId_code_key" ON "OptionGroup" USING btree ("storeId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "OptionGroupTranslation_groupId_locale_key" ON "OptionGroupTranslation" USING btree ("groupId","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "OptionItem_groupId_code_key" ON "OptionItem" USING btree ("groupId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "OptionItemTranslation_itemId_locale_key" ON "OptionItemTranslation" USING btree ("itemId","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order" USING btree ("orderNo");--> statement-breakpoint
CREATE UNIQUE INDEX "Order_accessToken_key" ON "Order" USING btree ("accessToken");--> statement-breakpoint
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "Order_storeId_businessDate_pickupSeq_key" ON "Order" USING btree ("storeId","businessDate","pickupSeq");--> statement-breakpoint
CREATE INDEX "Order_storeId_status_placedAt_idx" ON "Order" USING btree ("storeId","status","placedAt");--> statement-breakpoint
CREATE INDEX "Order_storeId_businessDate_idx" ON "Order" USING btree ("storeId","businessDate");--> statement-breakpoint
CREATE INDEX "Order_status_expiresAt_idx" ON "Order" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent" USING btree ("orderId","createdAt");--> statement-breakpoint
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "OrderItemOption_orderItemId_idx" ON "OrderItemOption" USING btree ("orderItemId");--> statement-breakpoint
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "Payment_orderId_idx" ON "Payment" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "Payment_provider_providerRef_idx" ON "Payment" USING btree ("provider","providerRef");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentEvent_provider_providerEventId_key" ON "PaymentEvent" USING btree ("provider","providerEventId");--> statement-breakpoint
CREATE UNIQUE INDEX "Product_storeId_slug_key" ON "Product" USING btree ("storeId","slug");--> statement-breakpoint
CREATE INDEX "Product_storeId_categoryId_sortOrder_idx" ON "Product" USING btree ("storeId","categoryId","sortOrder");--> statement-breakpoint
CREATE INDEX "Product_storeId_isActive_deletedAt_idx" ON "Product" USING btree ("storeId","isActive","deletedAt");--> statement-breakpoint
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage" USING btree ("productId","sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "ProductTranslation_productId_locale_key" ON "ProductTranslation" USING btree ("productId","locale");