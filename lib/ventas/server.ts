import "server-only";
import { prisma } from "@/lib/prisma";
import { exigirOrganizacion } from "@/lib/auth/server";
import { crearServicioVentas } from "./service";
export const ventas = crearServicioVentas(prisma, exigirOrganizacion);
