import prisma from "~/db.server";
import { Decimal } from "@prisma/client/runtime/library";
import { analyzeInventory, type InventoryFinding } from "~/services/inventory.intelligence.server";
import { AdminGraphQL } from "~/services/shopify.admin.server";
import type { Prisma } from "@prisma/client";

export interface ReorderSuggestion {
  finding: InventoryFinding;
  supplierProduct: {
    id: string;
    supplier: {
      id: string;
      name: string;
      defaultLeadTime: number;
      isActive: boolean;
    };
    unitCost: Decimal | null;
    currency: string;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    isPreferred: boolean;
  } | null;
  suggestedOrderQty: number;
  estimatedCost: Decimal | null;
  priority: "high" | "medium" | "low";
  reason: string;
}

export async function getReorderSuggestions(
  shopId: string,
  admin: AdminGraphQL
): Promise<{
  suggestions: ReorderSuggestion[];
  summary: {
    totalSuggestions: number;
    highPriority: number;
    estimatedTotal: Decimal;
    withSupplier: number;
    withoutSupplier: number;
  };
}> {
  const analysis = await analyzeInventory(shopId, admin);

  const supplierProducts = await prisma.supplierProduct.findMany({
    where: { shopId },
    include: {
      supplier: true,
    },
    orderBy: [{ isPreferred: "desc" }, { supplier: { name: "asc" } }],
  });

  const supplierProductMap = new Map<string, typeof supplierProducts[0]>();
  for (const sp of supplierProducts) {
    supplierProductMap.set(sp.productVariantId, sp);
  }

  const relevantFindings = analysis.findings.filter((f) =>
    f.findingType === "REORDER_RECOMMENDED" ||
    f.findingType === "STOCKOUT_RISK" ||
    f.findingType === "LOW_STOCK" ||
    f.findingType === "OUT_OF_STOCK"
  );

  const suggestions: ReorderSuggestion[] = [];

  for (const finding of relevantFindings) {
    const sp = supplierProductMap.get(finding.variantId);
    let suggestedOrderQty = finding.suggestedReorderQuantity ?? 0;
    if (sp?.minOrderQty && sp.minOrderQty > suggestedOrderQty) {
      suggestedOrderQty = sp.minOrderQty;
    }

    let estimatedCost: Decimal | null = null;
    if (sp?.unitCost) {
      estimatedCost = sp.unitCost.mul(suggestedOrderQty);
    }

    let priority: "high" | "medium" | "low" = "medium";
    if (finding.findingType === "OUT_OF_STOCK" || finding.findingType === "STOCKOUT_RISK") {
      priority = "high";
    } else if (finding.findingType === "REORDER_RECOMMENDED" || finding.findingType === "LOW_STOCK") {
      priority = "medium";
    }

    let reason = "";
    if (finding.findingType === "OUT_OF_STOCK") {
      reason = "Product is completely out of stock across all locations";
    } else if (finding.findingType === "STOCKOUT_RISK") {
      reason = `Stockout risk: ${finding.daysRemaining ?? "N/A"} days remaining, lead time ${sp?.supplier?.defaultLeadTime ?? "N/A"} days`;
    } else if (finding.findingType === "REORDER_RECOMMENDED") {
      reason = `Available (${finding.availableQuantity}) between reorder point (${finding.reorderPoint}) and target stock (${finding.targetStock})`;
    } else if (finding.findingType === "LOW_STOCK") {
      reason = `Low stock: ${finding.availableQuantity} units (threshold: ${finding.evidence.find(e => e.includes("threshold"))?.split(": ")[1] ?? "N/A"})`;
    }

    suggestions.push({
      finding,
      supplierProduct: sp ? {
        id: sp.id,
        supplier: {
          id: sp.supplier.id,
          name: sp.supplier.name,
          defaultLeadTime: sp.supplier.defaultLeadTime,
          isActive: sp.supplier.isActive,
        },
        unitCost: sp.unitCost,
        currency: sp.currency ?? "USD",
        leadTimeDays: sp.leadTimeDays ?? sp.supplier.defaultLeadTime,
        minOrderQty: sp.minOrderQty,
        isPreferred: sp.isPreferred,
      } : null,
      suggestedOrderQty,
      estimatedCost,
      priority,
      reason,
    });
  }

  suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  const totalEstimated = suggestions
    .filter(s => s.estimatedCost)
    .reduce((sum, s) => sum.plus(s.estimatedCost!), new (await import("@prisma/client/runtime/library")).Decimal(0));

  return {
    suggestions,
    summary: {
      totalSuggestions: suggestions.length,
      highPriority: suggestions.filter(s => s.priority === "high").length,
      estimatedTotal: totalEstimated,
      withSupplier: suggestions.filter(s => s.supplierProduct).length,
      withoutSupplier: suggestions.filter(s => !s.supplierProduct).length,
    },
  };
}

export async function createReorderPurchaseOrder(
  shopId: string,
  suggestions: Array<{
    findingId: string;
    supplierProductId: string;
    orderedQty: number;
  }>,
  expectedDate?: Date
): Promise<Array<{
  purchaseOrderId: string;
  poNumber: string;
  itemsAdded: number;
}>> {
  const supplierGroups = new Map<string, Array<{ findingId: string; supplierProductId: string; orderedQty: number }>>();

  for (const s of suggestions) {
    const sp = await prisma.supplierProduct.findUnique({
      where: { id: s.supplierProductId },
      include: { supplier: true, productVariant: { include: { product: true } } },
    });
    if (!sp) continue;

    const key = sp.supplierId;
    if (!supplierGroups.has(key)) supplierGroups.set(key, []);
    supplierGroups.get(key)!.push(s);
  }

  const results = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const results: Array<{ purchaseOrderId: string; poNumber: string; itemsAdded: number }> = [];
    for (const [supplierId, items] of supplierGroups.entries()) {
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier || !supplier.isActive) continue;

      const poNumber = `PO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const po = await tx.purchaseOrder.create({
        data: {
          shopId,
          supplierId,
          poNumber,
          status: "draft",
          expectedDate: expectedDate ?? null,
          currency: "USD",
          subtotal: new (await import("@prisma/client/runtime/library")).Decimal(0),
          taxTotal: new (await import("@prisma/client/runtime/library")).Decimal(0),
          total: new (await import("@prisma/client/runtime/library")).Decimal(0),
        },
      });

      let itemCount = 0;
      for (const item of items) {
        const sp = await tx.supplierProduct.findUnique({
          where: { id: item.supplierProductId },
          include: { productVariant: { include: { product: true } } },
        });
        if (!sp) continue;

        const unitCost = sp.unitCost ?? new (await import("@prisma/client/runtime/library")).Decimal(0);
        const orderedQty = Math.max(item.orderedQty, sp.minOrderQty ?? 1);

        await tx.purchaseOrderItem.create({
          data: {
            shopId,
            purchaseOrderId: po.id,
            supplierProductId: sp.id,
            productVariantId: sp.productVariantId,
            supplierSkuSnapshot: sp.supplierSku,
            productTitleSnapshot: sp.productVariant.product.title,
            variantTitleSnapshot: sp.productVariant.title,
            skuSnapshot: sp.productVariant.sku,
            orderedQty,
            unitCost,
            lineTotal: unitCost.mul(orderedQty),
          },
        });
        itemCount++;
      }

      const totals = await recalculateOrderTotals(tx, po.id);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: totals,
      });

      results.push({ purchaseOrderId: po.id, poNumber, itemsAdded: itemCount });
    }
    return results;
  });

  return results;
}

export async function recalculateOrderTotals(tx: Prisma.TransactionClient, poId: string) {
  const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: poId } });
  const { Decimal } = await import("@prisma/client/runtime/library");
  const subtotal = items.reduce((sum, item) => sum.plus(item.lineTotal), new Decimal(0));
  return { subtotal, taxTotal: new Decimal(0), total: subtotal };
}
