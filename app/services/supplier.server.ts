import prisma from "~/db.server";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";

export interface SupplierInput {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  country?: string;
  postalCode?: string;
  defaultLeadTime?: number;
  minOrderValue?: Decimal | number | string | null;
  minOrderQty?: number | null;
  notes?: string;
  isActive?: boolean;
}

export interface SupplierProductInput {
  supplierId: string;
  productVariantId: string;
  supplierSku?: string;
  unitCost?: Decimal | number | string | null;
  currency?: string;
  leadTimeDays?: number | null;
  minOrderQty?: number | null;
  isPreferred?: boolean;
}

export interface PurchaseOrderInput {
  supplierId: string;
  expectedDate?: Date | string | null;
  currency?: string;
  notes?: string;
}

export interface PurchaseOrderItemInput {
  productVariantId: string;
  supplierProductId?: string;
  orderedQty: number;
  unitCost: Decimal | number | string;
  supplierSkuSnapshot?: string;
  productTitleSnapshot: string;
  variantTitleSnapshot: string;
  skuSnapshot?: string;
}

export interface PurchaseOrderReceiveItem {
  itemId: string;
  receivedQty: number;
}

// Type for the full SupplierProduct with relations
export interface SupplierProduct {
  id: string;
  shopId: string;
  supplierId: string;
  productId: string;
  productVariantId: string;
  supplierSku: string | null;
  unitCost: Decimal | null;
  currency: string | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  isPreferred: boolean;
  createdAt: Date;
  updatedAt: Date;
  supplier?: {
    id: string;
    name: string;
    defaultLeadTime: number;
    isActive: boolean;
  };
  productVariant?: {
    id: string;
    title: string;
    sku: string | null;
    product?: {
      id: string;
      title: string;
    };
  };
}

// Type for the full PurchaseOrderItem with relations
export interface PurchaseOrderItem {
  id: string;
  shopId: string;
  purchaseOrderId: string;
  supplierProductId: string | null;
  productVariantId: string;
  supplierSkuSnapshot: string | null;
  productTitleSnapshot: string;
  variantTitleSnapshot: string;
  skuSnapshot: string | null;
  orderedQty: number;
  receivedQty: number;
  unitCost: Decimal;
  lineTotal: Decimal;
  createdAt: Date;
  updatedAt: Date;
  productVariant?: {
    id: string;
    title: string;
    sku: string | null;
    product?: {
      id: string;
      title: string;
    };
  };
  supplierProduct?: SupplierProduct | null;
}

function generatePONumber(shopId: string): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `PO-${year}${month}-${random}`;
}

function calculateLineTotal(orderedQty: number, unitCost: Decimal | number | string): Decimal {
  const qty = typeof orderedQty === "number" ? orderedQty : Number(orderedQty);
  const cost = typeof unitCost === "object" ? Number(unitCost) : Number(unitCost);
  return new Decimal(Math.round(qty * cost * 100) / 100);
}

function calculateOrderTotals(items: Array<{ orderedQty: number; unitCost: Decimal | number | string }>): {
  subtotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
} {
  const subtotal = items.reduce((sum, item) => {
    return sum.plus(calculateLineTotal(item.orderedQty, item.unitCost));
  }, new Decimal(0));

  return {
    subtotal,
    taxTotal: new Decimal(0),
    total: subtotal,
  };
}

export async function listSuppliers(shopId: string, includeInactive = false) {
  return prisma.supplier.findMany({
    where: {
      shopId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { supplierProducts: true, purchaseOrders: true },
      },
    },
  });
}

export async function getSupplier(shopId: string, supplierId: string) {
  return prisma.supplier.findUnique({
    where: { id: supplierId, shopId },
    include: {
      supplierProducts: {
        include: {
          productVariant: {
            include: {
              product: true,
            },
          },
        },
        orderBy: { isPreferred: "desc" },
      },
      purchaseOrders: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          items: {
            include: {
              productVariant: true,
            },
          },
        },
      },
      _count: {
        select: {
          supplierProducts: true,
          purchaseOrders: true,
        },
      },
    },
  });
}

export async function createSupplier(shopId: string, input: SupplierInput) {
  const existing = await prisma.supplier.findUnique({
    where: { shopId_name: { shopId, name: input.name } },
  });
  if (existing) {
    throw new Error(`Supplier with name "${input.name}" already exists`);
  }

  const email = input.email?.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email format");
  }

  return prisma.supplier.create({
    data: {
      shopId,
      name: input.name.trim(),
      contactName: input.contactName?.trim() || null,
      email,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      province: input.province?.trim() || null,
      country: input.country?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      defaultLeadTime: Math.max(0, input.defaultLeadTime ?? 14),
      minOrderValue: input.minOrderValue !== undefined && input.minOrderValue !== null
        ? new Decimal(input.minOrderValue)
        : null,
      minOrderQty: input.minOrderQty !== undefined && input.minOrderQty !== null
        ? Math.max(0, input.minOrderQty)
        : null,
      notes: input.notes?.trim() || null,
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateSupplier(shopId: string, supplierId: string, input: Partial<SupplierInput>) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId, shopId } });
  if (!supplier) {
    throw new Error("Supplier not found");
  }

  if (input.name && input.name !== supplier.name) {
    const existing = await prisma.supplier.findUnique({
      where: { shopId_name: { shopId, name: input.name } },
    });
    if (existing) {
      throw new Error(`Supplier with name "${input.name}" already exists`);
    }
  }

  const email = input.email?.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email format");
  }

  return prisma.supplier.update({
    where: { id: supplierId },
    data: {
      name: input.name?.trim() ?? supplier.name,
      contactName: input.contactName?.trim() ?? null,
      email: email ?? null,
      phone: input.phone?.trim() ?? null,
      address: input.address?.trim() ?? null,
      city: input.city?.trim() ?? null,
      province: input.province?.trim() ?? null,
      country: input.country?.trim() ?? null,
      postalCode: input.postalCode?.trim() ?? null,
      defaultLeadTime: input.defaultLeadTime !== undefined ? Math.max(0, input.defaultLeadTime) : supplier.defaultLeadTime,
      minOrderValue: input.minOrderValue !== undefined
        ? (input.minOrderValue !== null ? new Decimal(input.minOrderValue) : null)
        : supplier.minOrderValue,
      minOrderQty: input.minOrderQty !== undefined
        ? (input.minOrderQty !== null ? Math.max(0, input.minOrderQty) : null)
        : supplier.minOrderQty,
      notes: input.notes?.trim() ?? null,
      isActive: input.isActive ?? supplier.isActive,
    },
  });
}

export async function deleteSupplier(shopId: string, supplierId: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId, shopId } });
  if (!supplier) {
    throw new Error("Supplier not found");
  }

  const poCount = await prisma.purchaseOrder.count({
    where: { supplierId, shopId },
  });
  if (poCount > 0) {
    throw new Error("Cannot delete supplier with existing purchase orders. Deactivate instead.");
  }

  await prisma.supplierProduct.deleteMany({
    where: { supplierId, shopId },
  });

  await prisma.supplier.delete({ where: { id: supplierId } });
}

export async function setSupplierActive(shopId: string, supplierId: string, isActive: boolean) {
  return prisma.supplier.update({
    where: { id: supplierId, shopId },
    data: { isActive },
  });
}

export async function listSupplierProducts(shopId: string, supplierId: string) {
  return prisma.supplierProduct.findMany({
    where: { shopId, supplierId },
    include: {
      productVariant: {
        include: {
          product: true,
        },
      },
    },
    orderBy: [{ isPreferred: "desc" }, { productVariant: { product: { title: "asc" } } }],
  });
}

export async function createSupplierProduct(shopId: string, input: SupplierProductInput) {
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId, shopId } });
  if (!supplier) {
    throw new Error("Supplier not found");
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: input.productVariantId, shopId },
    include: { product: true },
  });
  if (!variant) {
    throw new Error("Product variant not found");
  }

  const existing = await prisma.supplierProduct.findUnique({
    where: { shopId_supplierId_productVariantId: { shopId, supplierId: input.supplierId, productVariantId: input.productVariantId } },
  });
  if (existing) {
    throw new Error("This variant is already mapped to this supplier");
  }

  return prisma.supplierProduct.create({
    data: {
      shopId,
      supplierId: input.supplierId,
      productId: variant.productId,
      productVariantId: input.productVariantId,
      supplierSku: input.supplierSku?.trim() || null,
      unitCost: input.unitCost !== undefined && input.unitCost !== null ? new Decimal(input.unitCost) : null,
      currency: input.currency?.toUpperCase() || "USD",
      leadTimeDays: input.leadTimeDays !== undefined && input.leadTimeDays !== null ? Math.max(0, input.leadTimeDays) : null,
      minOrderQty: input.minOrderQty !== undefined && input.minOrderQty !== null ? Math.max(0, input.minOrderQty) : null,
      isPreferred: input.isPreferred ?? false,
    },
  });
}

export async function updateSupplierProduct(shopId: string, mappingId: string, input: Partial<SupplierProductInput>) {
  const mapping = await prisma.supplierProduct.findUnique({ where: { id: mappingId, shopId } });
  if (!mapping) {
    throw new Error("Supplier product mapping not found");
  }

  return prisma.supplierProduct.update({
    where: { id: mappingId },
    data: {
      supplierSku: input.supplierSku?.trim() ?? null,
      unitCost: input.unitCost !== undefined ? (input.unitCost !== null ? new Decimal(input.unitCost) : null) : mapping.unitCost,
      currency: input.currency?.toUpperCase() ?? mapping.currency,
      leadTimeDays: input.leadTimeDays !== undefined ? (input.leadTimeDays !== null ? Math.max(0, input.leadTimeDays) : null) : mapping.leadTimeDays,
      minOrderQty: input.minOrderQty !== undefined ? (input.minOrderQty !== null ? Math.max(0, input.minOrderQty) : null) : mapping.minOrderQty,
      isPreferred: input.isPreferred ?? mapping.isPreferred,
    },
  });
}

export async function deleteSupplierProduct(shopId: string, mappingId: string) {
  await prisma.supplierProduct.delete({ where: { id: mappingId, shopId } });
}

export async function setPreferredSupplierProduct(shopId: string, mappingId: string, isPreferred: boolean) {
  return prisma.$transaction(async (tx) => {
    const mapping = await tx.supplierProduct.findUnique({ where: { id: mappingId, shopId } });
    if (!mapping) throw new Error("Mapping not found");

    if (isPreferred) {
      await tx.supplierProduct.updateMany({
        where: { shopId, productVariantId: mapping.productVariantId, isPreferred: true },
        data: { isPreferred: false },
      });
    }

    return tx.supplierProduct.update({
      where: { id: mappingId },
      data: { isPreferred },
    });
  });
}

export async function listPurchaseOrders(shopId: string, status?: string) {
  return prisma.purchaseOrder.findMany({
    where: { shopId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: true,
      items: {
        include: { productVariant: true },
      },
      _count: { select: { items: true } },
    },
  });
}

export async function getPurchaseOrder(shopId: string, poId: string) {
  return prisma.purchaseOrder.findUnique({
    where: { id: poId, shopId },
    include: {
      supplier: true,
      items: {
        include: {
          productVariant: { include: { product: true } },
          supplierProduct: { include: { supplier: true } },
        },
      },
    },
  });
}

export async function createPurchaseOrder(shopId: string, input: PurchaseOrderInput) {
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId, shopId } });
  if (!supplier) throw new Error("Supplier not found");
  if (!supplier.isActive) throw new Error("Supplier is inactive");

  const poNumber = generatePONumber(shopId);

  return prisma.purchaseOrder.create({
    data: {
      shopId,
      supplierId: input.supplierId,
      poNumber,
      status: "draft",
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
      currency: input.currency || "USD",
      notes: input.notes?.trim() || null,
      subtotal: new Decimal(0),
      taxTotal: new Decimal(0),
      total: new Decimal(0),
    },
    include: { items: true },
  });
}

export async function addPurchaseOrderItem(shopId: string, poId: string, input: PurchaseOrderItemInput) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId, shopId } });
    if (!po) throw new Error("Purchase order not found");
    if (po.status !== "draft") throw new Error("Can only add items to draft purchase orders");

    const variant = await tx.productVariant.findUnique({ where: { id: input.productVariantId, shopId } });
    if (!variant) throw new Error("Product variant not found");

    if (input.supplierProductId) {
      const sp = await tx.supplierProduct.findUnique({ where: { id: input.supplierProductId, shopId } });
      if (!sp || sp.supplierId !== po.supplierId) throw new Error("Supplier product mapping not found or mismatched supplier");
    }

    const existing = await tx.purchaseOrderItem.findFirst({
      where: { purchaseOrderId: poId, productVariantId: input.productVariantId },
    });
    if (existing) throw new Error("This variant is already on the purchase order");

    const lineTotal = calculateLineTotal(input.orderedQty, input.unitCost);

    const item = await tx.purchaseOrderItem.create({
      data: {
        shopId,
        purchaseOrderId: poId,
        supplierProductId: input.supplierProductId || null,
        productVariantId: input.productVariantId,
        supplierSkuSnapshot: input.supplierSkuSnapshot?.trim() || null,
        productTitleSnapshot: input.productTitleSnapshot,
        variantTitleSnapshot: input.variantTitleSnapshot,
        skuSnapshot: input.skuSnapshot?.trim() || null,
        orderedQty: Math.max(1, input.orderedQty),
        unitCost: new Decimal(input.unitCost),
        lineTotal,
      },
    });

    const totals = await recalculateOrderTotals(tx, poId);
    await tx.purchaseOrder.update({ where: { id: poId }, data: totals });

    return item;
  });
}

export async function updatePurchaseOrderItem(shopId: string, itemId: string, input: { orderedQty?: number; unitCost?: Decimal | number | string }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const item = await tx.purchaseOrderItem.findUnique({ where: { id: itemId, shopId }, include: { purchaseOrder: true } });
    if (!item) throw new Error("Purchase order item not found");
    if (item.purchaseOrder.status !== "draft") throw new Error("Can only edit items on draft purchase orders");

    const orderedQty = input.orderedQty ?? item.orderedQty;
    const unitCost = input.unitCost ?? item.unitCost;
    const lineTotal = calculateLineTotal(orderedQty, unitCost);

    await tx.purchaseOrderItem.update({
      where: { id: itemId },
      data: { orderedQty: Math.max(1, orderedQty), unitCost: new Decimal(unitCost), lineTotal },
    });

    const totals = await recalculateOrderTotals(tx, item.purchaseOrderId);
    await tx.purchaseOrder.update({ where: { id: item.purchaseOrderId }, data: totals });
  });
}

export async function removePurchaseOrderItem(shopId: string, itemId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const item = await tx.purchaseOrderItem.findUnique({ where: { id: itemId, shopId }, include: { purchaseOrder: true } });
    if (!item) throw new Error("Purchase order item not found");
    if (item.purchaseOrder.status !== "draft") throw new Error("Can only remove items from draft purchase orders");

    await tx.purchaseOrderItem.delete({ where: { id: itemId } });

    const totals = await recalculateOrderTotals(tx, item.purchaseOrderId);
    await tx.purchaseOrder.update({ where: { id: item.purchaseOrderId }, data: totals });
  });
}

async function recalculateOrderTotals(tx: Prisma.TransactionClient, poId: string) {
  const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: poId } });
  return calculateOrderTotals(items.map(i => ({ orderedQty: i.orderedQty, unitCost: i.unitCost })));
}

export async function updatePurchaseOrder(shopId: string, poId: string, input: { expectedDate?: Date | string | null; notes?: string | null; currency?: string }) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId, shopId } });
  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "draft") throw new Error("Can only edit draft purchase orders");

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data: {
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
      notes: input.notes?.trim() ?? null,
      currency: input.currency?.toUpperCase() ?? po.currency,
    },
  });
}

export async function submitPurchaseOrder(shopId: string, poId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId, shopId }, include: { items: true } });
    if (!po) throw new Error("Purchase order not found");
    if (po.status !== "draft") throw new Error("Only draft purchase orders can be submitted");
    if (po.items.length === 0) throw new Error("Cannot submit empty purchase order");

    const totals = await recalculateOrderTotals(tx, poId);
    return tx.purchaseOrder.update({
      where: { id: poId },
      data: { ...totals, status: "submitted", submittedAt: new Date() },
    });
  });
}

export async function cancelPurchaseOrder(shopId: string, poId: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId, shopId } });
  if (!po) throw new Error("Purchase order not found");
  if (po.status === "received") throw new Error("Cannot cancel a fully received purchase order");
  if (po.status === "cancelled") throw new Error("Purchase order already cancelled");

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: "cancelled", cancelledAt: new Date() },
  });
}

export async function receivePurchaseOrderItems(shopId: string, poId: string, items: PurchaseOrderReceiveItem[]) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId, shopId }, include: { items: true } });
    if (!po) throw new Error("Purchase order not found");
    if (po.status === "cancelled") throw new Error("Cannot receive items for cancelled purchase order");
    if (po.status === "draft") throw new Error("Submit purchase order before receiving items");

    let allReceived = true;
    let anyReceived = false;

    for (const item of items) {
      const poItem = await tx.purchaseOrderItem.findUnique({ where: { id: item.itemId, shopId } });
      if (!poItem) throw new Error(`Purchase order item ${item.itemId} not found`);
      if (item.receivedQty < 0) throw new Error("Received quantity cannot be negative");
      if (item.receivedQty > poItem.orderedQty - poItem.receivedQty) {
        throw new Error(`Received quantity exceeds remaining ordered quantity for item ${item.itemId}`);
      }

      anyReceived = true;
      if (poItem.receivedQty + item.receivedQty < poItem.orderedQty) {
        allReceived = false;
      }

      await tx.purchaseOrderItem.update({
        where: { id: item.itemId },
        data: { receivedQty: { increment: item.receivedQty } },
      });
    }

    if (!anyReceived) throw new Error("No items received");

    const newStatus = allReceived ? "received" : "partially_received";
    const receivedAt = allReceived ? new Date() : po.receivedAt;

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: newStatus, ...(allReceived ? { receivedAt } : {}) },
    });
  });
}