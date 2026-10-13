import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/src/generated/prisma/client";

function createPrisma() {
  const connectionString = process.env.LOCAL_DATABASE_URL;
  if (!connectionString) throw new Error("Falta la conexion local del servidor");
  const target = new URL(connectionString);
  if (! ["postgres:", "postgresql:"].includes(target.protocol) ||
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    target.port !== "54322" || target.pathname !== "/postgres" ||
    [...target.searchParams.keys()].some(key => key !== "schema") ||
    (target.searchParams.has("schema") && target.searchParams.get("schema") !== "public")) {
    throw new Error("Prisma requiere PostgreSQL exclusivamente local");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5 }) });
}

const globalForPrisma = globalThis as unknown as { prismaLocal?: PrismaClient };
export const prisma = globalForPrisma.prismaLocal ?? createPrisma();
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaLocal = prisma;
