import "server-only";
import { prisma } from "@/lib/prisma";
import { exigirOrganizacion } from "@/lib/auth/server";
import { crearServicioDashboard } from "./service";
export const dashboard = crearServicioDashboard(prisma, exigirOrganizacion);
