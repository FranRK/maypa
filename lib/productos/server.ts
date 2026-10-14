import "server-only";
import { prisma } from "@/lib/prisma";
import { exigirOrganizacion } from "@/lib/auth/server";
import { crearServicioProductos } from "./service";
export const productos = crearServicioProductos(prisma, exigirOrganizacion);
