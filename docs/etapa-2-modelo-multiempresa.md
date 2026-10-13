# Modelo multiempresa: estado actualizado por la etapa 3

Este documento reemplaza la decision Preview de la etapa 2. El esquema contiene
10 tablas propias en public: Perfil, Organizacion, MiembroOrganizacion, Producto,
SaldoStock, Venta, DetalleVenta, MovimientoStock, DevolucionVenta y DetalleDevolucion.
Los enums son RolMiembro, EstadoVenta y TipoMovimiento. La migracion se aplico
solo en Supabase local durante la etapa 4; ver etapa-4-validacion-local.md.

## Usuarios, membresias y retencion

Perfil.id es el UUID de Supabase Auth, sin default ni credenciales. Ya no existen
UsuarioAuth, el schema auth en Prisma, externalTables ni initShadowDb. La FK
Perfil_auth_users_fkey se agrega con SQL propio hacia auth.users(id), sin crear
ni modificar auth.users. Prisma no valida ni conoce esta FK: cualquier futura
migracion debe conservarla y revisar que no la elimine al comparar los schemas.
El cliente Prisma no tendra acceso a un modelo de tablas internas de Auth.

MiembroOrganizacion vincula Perfil con Organizacion y RolMiembro por PK compuesta.
La baja se representa mediante activa=false y bajaEn; una membresia activa exige
bajaEn nulo. Reactivar la membresia conserva su PK y limpia bajaEn. Solo se guarda
la ultima baja; la auditoria completa de cambios de membresia queda pendiente.
El servidor debera verificar activa en cada operacion, no solo la presencia de la
fila. Conservar esa fila mantiene las referencias de autor de ventas y stock.

La FK Perfil/Auth y la FK membresia/Perfil usan RESTRICT, al igual que las FK del
historial comercial. No hay borrado en cascada de empleados. Borrar una cuenta de
Auth con un Perfil existente sera rechazado: definir un flujo de baja o bloqueo
y una politica de retencion/anonimizacion antes de produccion. Crear perfiles
tras el alta de Auth requiere un flujo confiable posterior, no implementado aqui.

## Integridad, stock e idempotencia

Las FK compuestas incluyen organizacionId en referencias de productos, saldos,
ventas, movimientos, devoluciones y autores. Las lineas de devolucion comparten
ventaId con la cabecera y su linea original: tampoco pueden mezclar dos ventas
de la misma empresa. Los precios de DetalleVenta son snapshots historicos.

La politica de cantidades rechaza ventas y devoluciones de cantidad cero o
negativa, precios negativos, stock minimo negativo y saldos negativos. INICIAL,
COMPRA, ANULACION_VENTA y DEVOLUCION son entradas positivas; VENTA es negativa y
AJUSTE no puede ser cero. Se excluyen numeric NaN y autocompensaciones. Los
CHECK no garantizan que el saldo sea la suma de movimientos ni el total la suma
de lineas; esas reglas requieren operaciones transaccionales y pruebas posteriores.

Una clave de idempotencia no vacia es unica por empresa para cada tipo de cabecera.
La huella es SHA-256 hexadecimal minuscula de la solicitud normalizada. Repetir
clave y huella recupera la operacion; una clave con otra huella debe producir
conflicto. Los indices unicos permiten como maximo un movimiento VENTA y uno de
ANULACION por linea, y un movimiento por linea de devolucion. No obligan a que
existan: la transaccion comercial debe crear cabeceras, lineas, movimientos y
saldos conjuntamente. Ningun endpoint o flujo comercial se implemento aqui.

## Reglas transaccionales pendientes (sin triggers en la inicial)

- Confirmar exige lineas, total igual a suma de subtotales y salidas de stock por
  cada linea. Bloquear o actualizar condicionalmente los saldos sin llevarlos a negativo.
- Devolver exige venta confirmada/parcialmente devuelta, bloqueo de la linea,
  limite acumulado de devoluciones y una compensacion del movimiento original.
- Anular un borrador no repone stock. Anular una venta confirmada sin devoluciones
  compensa sus salidas. Una venta parcialmente devuelta no se anula con reposicion
  total: resolver las unidades restantes mediante devolucion, evitando doble entrada.
- Mantener coherencia de estados y confirmadaEn; nunca borrar o editar historial
  confirmado. Decidir mas adelante si hacen falta triggers como defensa adicional.
- Escribir saldo y movimiento en la misma transaccion, actualizar actualizadoEn
  explicitamente en SQL propio, serializar reintentos y comparar huella existente.

## Autenticacion, autorizacion y permisos

Supabase Auth verifica identidad. El servidor debe validar la sesion, buscar una
membresia activa y autorizar por rol en cada peticion. No aceptar UUIDs, autor,
precios o totales del navegador sin comprobacion. Las FK no filtran consultas.

El borrador habilita RLS en las 10 tablas propias y agrega una politica restrictiva
false para anon/authenticated. Revoca todos los privilegios de tabla de PUBLIC,
anon, authenticated y service_role. La API directa queda cerrada en esta etapa:
la sesion Supabase Auth sigue funcionando porque sus tablas no se alteran. No
se agregan funciones SECURITY DEFINER, politicas de membresia ni triggers Auth.

Prisma no hereda automaticamente la identidad del JWT. postgres, propietarios
y roles BYPASSRLS pueden omitir RLS. Separar un rol de migracion y otro de ejecucion
con permisos minimos; el acceso privilegiado requiere autorizacion del servidor.
Un rol sin BYPASSRLS tambien requerira politicas adecuadas antes de poder operar.
La creacion, grants y pruebas de ese rol quedan pendientes. No asumir que cambiar
solo el rol en la conexion permite operar con estas politicas cerradas.

## Migracion y comprobaciones pendientes

El SQL consolidado esta en prisma/migrations/20261012_inicial_multiempresa.sql.draft.
Es el antecedente historico. La migracion oficial aplicada SOLO local esta en
prisma/migrations/20261012000000_inicial_multiempresa/migration.sql. Ver
etapa-3-primera-migracion.md para procedencia y etapa-4-validacion-local.md
para la validacion PostgreSQL y los limites pendientes.

Antes de aplicar: confirmar PK UUID de auth.users y roles Supabase, permisos de
REFERENCES sobre Auth y CREATE en public, ausencia de objetos propios anteriores,
y probar el script completo en PostgreSQL de desarrollo con Auth preexistente.
Tambien probar CHECK/FK, baja de empleados, bloqueo de API y acceso servidor.
Una futura base sombra necesitara Auth preexistente (por ejemplo Supabase local),
no una sombra vacia ni la URL de produccion. Mantener SQL personalizado en el
historial y revisar cada diff. La validacion de Prisma no demuestra proteccion real.
