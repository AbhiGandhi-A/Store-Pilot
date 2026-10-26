import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { handleProductDelete } from "~/services/webhook.handlers.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session) {
    console.warn(`No session found for shop ${shop}, skipping webhook processing`);
    return new Response("No session", { status: 401 });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { domain: shop },
      select: { id: true },
    });

    if (!shopRecord) {
      console.warn(`Shop ${shop} not found in database`);
      return new Response("Shop not found", { status: 404 });
    }

    await handleProductDelete(shopRecord.id, payload as Record<string, unknown>);

    return new Response();
  } catch (error) {
    console.error(`Error processing ${topic} webhook:`, error);
    return new Response("Internal Server Error", { status: 500 });
  }
};