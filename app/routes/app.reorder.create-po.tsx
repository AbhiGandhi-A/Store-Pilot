import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { createReorderPurchaseOrder } from "~/services/reorder.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { domain: session.shop }, select: { id: true } });
    if (!shopRecord) return { success: false, error: "Shop not found" };

    const formData = await request.formData();
    const suggestionsJson = formData.get("suggestions") as string;
    const expectedDate = formData.get("expectedDate") as string;

    if (!suggestionsJson) return { success: false, error: "No suggestions provided" };

    const suggestions = JSON.parse(suggestionsJson);
    const result = await createReorderPurchaseOrder(shopRecord.id, suggestions, expectedDate ? new Date(expectedDate) : undefined);

    return { success: true, results: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  } finally {
    await prisma.$disconnect();
  }
};