import "server-only";
import { prisma } from "@/lib/prisma";
import { exigirOrganizacion } from "@/lib/auth/server";
import { crearServicioInventario } from "./service";
export const inventario = crearServicioInventario(prisma, exigirOrganizacion);
