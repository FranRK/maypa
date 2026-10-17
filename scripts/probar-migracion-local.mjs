import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { localTarget, localClient } from "./supabase-local.mjs";

const target = localTarget();
console.log("Destino de pruebas:", JSON.stringify(target.safe));
const client = await localClient(target);
const tables = ["Perfil", "Organizacion", "MiembroOrganizacion", "Producto", "SaldoStock",
  "Venta", "DetalleVenta", "MovimientoStock", "DevolucionVenta", "DetalleDevolucion"];
let passed = 0;
function pass(name) { passed++; console.log(`PASS ${passed}: ${name}`); }

async function rejects(name, code, sql, args = []) {
  await client.query("SAVEPOINT caso");
  let error;
  try { await client.query(sql, args); } catch (caught) { error = caught; }
  await client.query("ROLLBACK TO SAVEPOINT caso");
  await client.query("RELEASE SAVEPOINT caso");
  assert.equal(error?.code, code, `${name}: esperado SQLSTATE ${code}, obtenido ${error?.code || "sin error"}`);
  pass(`${name} (${code})`);
}

async function insert(table, values) {
  const keys = Object.keys(values);
  await client.query(`INSERT INTO public."${table}" (${keys.map(k => `"${k}"`).join(",")})
    VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(values));
}

try {
  const migration = readFileSync("prisma/migrations/20261012000000_inicial_multiempresa/migration.sql", "utf8");
  const history = (await client.query(`SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM public._prisma_migrations`)).rows;
  assert.equal(history.length, 1);
  assert.equal(history[0].migration_name, "20261012000000_inicial_multiempresa");
  assert.ok(history[0].finished_at);
  assert.equal(history[0].rolled_back_at, null);
  assert.equal(history[0].checksum, createHash("sha256").update(migration).digest("hex"));
  pass("Prisma registra una migracion finalizada y checksum correcto");

  const catalog = (await client.query(`SELECT c.relname, c.relrowsecurity FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'`)).rows;
  assert.deepEqual(catalog.map(r => r.relname).sort(), [...tables].sort());
  assert.ok(catalog.every(r => r.relrowsecurity));
  pass("Diez tablas propias con RLS habilitada");

  const constraints = (await client.query(`SELECT conname, contype, convalidated,
    confdeltype, confupdtype, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE connamespace='public'::regnamespace AND conrelid IN
      (SELECT oid FROM pg_class WHERE relname=ANY($1::text[]) AND relnamespace='public'::regnamespace)`, [tables])).rows;
  assert.equal(constraints.filter(c => c.contype === "f").length, 22);
  assert.equal(constraints.filter(c => c.contype === "c").length, 17);
  assert.ok(constraints.every(c => c.convalidated));
  assert.ok(constraints.filter(c => c.contype === "f").every(c => c.confdeltype === "r" && c.confupdtype === "r"));
  assert.match(constraints.find(c => c.conname === "Perfil_auth_users_fkey").definition, /REFERENCES auth.users\(id\)/);
  pass("22 FK RESTRICT y 17 CHECK validados, incluida Perfil/Auth");

  const indexes = (await client.query(`SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename=ANY($1::text[])`, [tables])).rows.map(r => r.indexname);
  const expectedIndexes = [...migration.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)].map(m => m[1]);
  assert.equal(indexes.length, 39); // 29 indices explicitos + 10 PK.
  assert.ok(expectedIndexes.every(name => indexes.includes(name)));
  pass("29 indices generados y diez indices de claves primarias presentes");

  const enums = (await client.query(`SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
    WHERE t.typnamespace='public'::regnamespace GROUP BY t.typname`)).rows;
  assert.equal(enums.length, 3);
  pass("Tres enums propios presentes");

  const policies = (await client.query(`SELECT c.relname, p.polpermissive, p.polcmd,
    pg_get_expr(p.polqual,p.polrelid) AS qual, pg_get_expr(p.polwithcheck,p.polrelid) AS check,
    ARRAY(SELECT rolname::text FROM pg_roles WHERE oid=ANY(p.polroles) ORDER BY rolname) AS roles
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE c.relname=ANY($1::text[]) AND c.relnamespace='public'::regnamespace`, [tables])).rows;
  assert.equal(policies.length, 10);
  assert.ok(policies.every(p => !p.polpermissive && p.polcmd === "*" && p.qual === "false" && p.check === "false"));
  assert.ok(policies.every(p => p.roles.join(",") === "anon,authenticated"));
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of tables) {
      const privileges = (await client.query(`SELECT has_table_privilege($1, $2,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed`, [role, `public."${table}"`])).rows[0];
      assert.equal(privileges.allowed, false, `${role}/${table}`);
    }
  }
  pass("Politicas restrictivas y permisos de los tres roles API denegados en diez tablas");

  for (const table of tables) {
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows[0].count, 0);
  }
  assert.equal((await client.query("SELECT count(*)::int AS count FROM auth.users")).rows[0].count, 0);
  await client.query("BEGIN");
  const [userA,userB,orgA,orgB,prodA,prodA2,prodB,saleA,saleA2,lineA,lineA2,movementA,returnA,returnLine] =
    Array.from({length:14}, () => randomUUID());
  const hash = "a".repeat(64);
  // Fixtures de Auth sin contrasenas ni sesiones: dos UUID dentro de ROLLBACK.
  await client.query("INSERT INTO auth.users(id) VALUES ($1),($2)", [userA,userB]);
  // Etapa 10: public."Perfil" suma "nombre" y "apellido" (fase 1) y los vuelve
  // obligatorios (fase 2). Este script solo puede correr sobre una base VACIA con TODAS
  // las migraciones aplicadas: al aplicar la etapa 10 hay que revisar tambien las
  // expectativas de historia (una sola migracion) y de conteo de CHECK (17).
  // Ver docs/etapa-10-perfil-nombre-detalle-historico.md.
  for (const [id,apellido] of [[userA,"Migracion A"],[userB,"Migracion B"]]) {
    await insert("Perfil", {id,nombre:"Prueba",apellido});
  }
  await insert("Organizacion", {id:orgA,nombre:"Empresa ficticia A",slug:"prueba-a"});
  await insert("Organizacion", {id:orgB,nombre:"Empresa ficticia B",slug:"prueba-b"});
  await insert("MiembroOrganizacion", {organizacionId:orgA,usuarioId:userA});
  await insert("MiembroOrganizacion", {organizacionId:orgB,usuarioId:userB});
  for (const [id,organizacionId,sku] of [[prodA,orgA,"A"],[prodA2,orgA,"A2"],[prodB,orgB,"B"]]) {
    await insert("Producto", {id,organizacionId,sku,nombre:"Ficticio",precioVenta:10});
  }
  for (const [id,key] of [[saleA,"venta-a"],[saleA2,"venta-a2"]]) {
    await insert("Venta", {id,organizacionId:orgA,creadaPor:userA,total:20,claveIdempotencia:key,huellaSolicitud:hash});
  }
  await insert("DetalleVenta", {id:lineA,organizacionId:orgA,ventaId:saleA,productoId:prodA,cantidad:2,precioUnitario:10,subtotal:20});
  await insert("DetalleVenta", {id:lineA2,organizacionId:orgA,ventaId:saleA2,productoId:prodA2,cantidad:2,precioUnitario:10,subtotal:20});
  await insert("SaldoStock", {organizacionId:orgA,productoId:prodA,cantidad:5,actualizadoEn:new Date()});
  await insert("MovimientoStock", {id:movementA,organizacionId:orgA,productoId:prodA,usuarioId:userA,tipo:"VENTA",variacion:-2,detalleVentaId:lineA});
  await insert("DevolucionVenta", {id:returnA,organizacionId:orgA,ventaId:saleA,creadaPor:userA,claveIdempotencia:"devolucion-a",huellaSolicitud:hash});
  await insert("DetalleDevolucion", {id:returnLine,organizacionId:orgA,devolucionVentaId:returnA,ventaId:saleA,detalleVentaId:lineA,productoId:prodA,cantidad:1});
  await insert("MovimientoStock", {id:randomUUID(),organizacionId:orgA,productoId:prodA,usuarioId:userA,tipo:"DEVOLUCION",variacion:1,detalleDevolucionId:returnLine,movimientoCompensadoId:movementA});
  pass("Fixtures validas: dos empresas, ventas, stock y compensacion de devolucion");

  await rejects("Perfil sin usuario Auth", "23503", 'INSERT INTO public."Perfil"(id,"nombre","apellido") VALUES ($1,\'Prueba\',\'Migracion\')', [randomUUID()]);
  await rejects("Autor de venta de otra empresa", "23503", 'UPDATE public."Venta" SET "creadaPor"=$1 WHERE id=$2', [userB,saleA]);
  await rejects("Producto de otra empresa en venta", "23503", 'UPDATE public."DetalleVenta" SET "productoId"=$1 WHERE id=$2', [prodB,lineA]);
  await rejects("Saldo con producto de otra empresa", "23503", 'UPDATE public."SaldoStock" SET "productoId"=$1 WHERE "organizacionId"=$2', [prodB,orgA]);
  await rejects("Autor de movimiento de otra empresa", "23503", 'UPDATE public."MovimientoStock" SET "usuarioId"=$1 WHERE id=$2', [userB,movementA]);
  await rejects("Movimiento con producto distinto de su linea", "23503", 'UPDATE public."MovimientoStock" SET "productoId"=$1 WHERE id=$2', [prodA2,movementA]);
  await rejects("Devolucion mezcla ventas de la misma empresa", "23503", 'UPDATE public."DetalleDevolucion" SET "ventaId"=$1,"detalleVentaId"=$2,"productoId"=$3 WHERE id=$4', [saleA2,lineA2,prodA2,returnLine]);
  for (const [name,sql,args] of [
    ["Cantidad vendida cero",'UPDATE public."DetalleVenta" SET cantidad=0,subtotal=0 WHERE id=$1',[lineA]],
    ["Precio negativo",'UPDATE public."Producto" SET "precioVenta"=-1 WHERE id=$1',[prodA]],
    ["Stock minimo negativo",'UPDATE public."Producto" SET "stockMinimo"=-1 WHERE id=$1',[prodA]],
    ["Saldo negativo",'UPDATE public."SaldoStock" SET cantidad=-1 WHERE "productoId"=$1',[prodA]],
    ["Total negativo",'UPDATE public."Venta" SET total=-1 WHERE id=$1',[saleA]],
    ["Subtotal incoherente",'UPDATE public."DetalleVenta" SET subtotal=21 WHERE id=$1',[lineA]],
    ["Devolucion cero",'UPDATE public."DetalleDevolucion" SET cantidad=0 WHERE id=$1',[returnLine]],
    ["VENTA con signo positivo",'UPDATE public."MovimientoStock" SET variacion=2 WHERE id=$1',[movementA]],
    ["VENTA sin linea",'UPDATE public."MovimientoStock" SET "detalleVentaId"=NULL WHERE id=$1',[movementA]],
    ["AJUSTE cero",'UPDATE public."MovimientoStock" SET tipo=\'AJUSTE\',variacion=0,"detalleVentaId"=NULL WHERE id=$1',[movementA]],
    ["Cantidad NaN",'UPDATE public."SaldoStock" SET cantidad=\'NaN\' WHERE "productoId"=$1',[prodA]],
    ["Baja incoherente",'UPDATE public."MiembroOrganizacion" SET activa=false WHERE "usuarioId"=$1',[userA]],
    ["Idempotencia vacia",'UPDATE public."Venta" SET "claveIdempotencia"=\' \' WHERE id=$1',[saleA]],
    ["Huella invalida",'UPDATE public."DevolucionVenta" SET "huellaSolicitud"=\'xyz\' WHERE id=$1',[returnA]],
  ]) await rejects(name,"23514",sql,args);
  await rejects("Clave de venta duplicada", "23505", 'UPDATE public."Venta" SET "claveIdempotencia"=\'venta-a\' WHERE id=$1', [saleA2]);
  await rejects("Movimiento de venta duplicado", "23505", `INSERT INTO public."MovimientoStock"
    (id,"organizacionId","productoId","usuarioId",tipo,variacion,"detalleVentaId") VALUES ($1,$2,$3,$4,'VENTA',-2,$5)`, [randomUUID(),orgA,prodA,userA,lineA]);
  await rejects("Movimiento de devolucion duplicado", "23505", `INSERT INTO public."MovimientoStock"
    (id,"organizacionId","productoId","usuarioId",tipo,variacion,"detalleDevolucionId","movimientoCompensadoId")
    VALUES ($1,$2,$3,$4,'DEVOLUCION',1,$5,$6)`, [randomUUID(),orgA,prodA,userA,returnLine,movementA]);

  await client.query('UPDATE public."MiembroOrganizacion" SET activa=false,"bajaEn"=now() WHERE "usuarioId"=$1',[userA]);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM public."Venta" v JOIN public."MiembroOrganizacion" m ON m."organizacionId"=v."organizacionId" AND m."usuarioId"=v."creadaPor" WHERE NOT m.activa')).rows[0].count,2);
  pass("Baja logica conserva las ventas y sus autores");
  await rejects("Borrado de miembro con historial", "23503", 'DELETE FROM public."MiembroOrganizacion" WHERE "usuarioId"=$1',[userA]);
  await rejects("Borrado de perfil referenciado", "23503", 'DELETE FROM public."Perfil" WHERE id=$1',[userA]);
  await rejects("Borrado Auth con perfil", "23503", 'DELETE FROM auth.users WHERE id=$1',[userA]);

  for (const role of ["anon","authenticated","service_role"]) {
    await client.query(`SET LOCAL ROLE ${role}`);
    await rejects(`SELECT API denegado a ${role}`, "42501", 'SELECT * FROM public."Organizacion"');
    await rejects(`INSERT API denegado a ${role}`, "42501", 'INSERT INTO public."Organizacion"(id,nombre,slug) VALUES ($1,\'x\',\'x\')',[randomUUID()]);
    await client.query("RESET ROLE");
  }
  // Probar RLS separada de los grants, sin dejar el permiso temporal persistido.
  await client.query('GRANT SELECT, INSERT ON public."Organizacion" TO authenticated');
  await client.query("SET LOCAL ROLE authenticated");
  assert.equal((await client.query('SELECT * FROM public."Organizacion"')).rowCount,0);
  pass("RLS oculta todas las empresas aun con SELECT temporal");
  await rejects("RLS bloquea INSERT aun con grant temporal", "42501", 'INSERT INTO public."Organizacion"(id,nombre,slug) VALUES ($1,\'x\',\'x\')',[randomUUID()]);
  await client.query("RESET ROLE");
  assert.equal((await client.query('SELECT * FROM public."Organizacion"')).rowCount,2);
  pass("Conexion postgres privilegiada ve ambas empresas: no confiar en RLS para Prisma");
  await client.query("ROLLBACK");
  for (const table of tables) assert.equal((await client.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows[0].count,0);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM auth.users")).rows[0].count,0);
  assert.equal((await client.query(`SELECT has_table_privilege('authenticated','public."Organizacion"','SELECT,INSERT') AS allowed`)).rows[0].allowed,false);
  pass("ROLLBACK completo: sin fixtures, usuarios Auth ni grants temporales restantes");
  console.log(`RESULTADO: ${passed} comprobaciones aprobadas`);
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
