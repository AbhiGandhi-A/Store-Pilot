import "dotenv/config";
import prisma from "../db.server";

async function main() {
  console.log("Checking database connection...");

  const connection = await checkDatabaseConnection();
  if (!connection.connected) {
    console.error("❌ Database connection failed:", connection.error);
    process.exit(1);
  }
  console.log("✅ Database connection successful");

  const schema = await checkDatabaseSchema();
  if (!schema.valid) {
    console.warn("⚠️  Session table not found (run migrations)");
  } else {
    console.log("✅ Session table exists");
  }

  console.log("Database check completed");
}

async function checkDatabaseConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { connected: false, error: message };
  }
}

async function checkDatabaseSchema(): Promise<{ valid: boolean; error?: string }> {
  try {
    const result = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'Session'
    `;
    return { valid: result.length > 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { valid: false, error: message };
  }
}

main()
  .catch((e) => {
    console.error("Database check failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });