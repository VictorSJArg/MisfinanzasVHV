# Segunda instalación independiente

Las dos instalaciones usan el mismo repositorio, pero cada carpeta local conserva su propio `.env.local` y su propio vínculo de Vercel.

## Perfiles

Aplicación actual:

```env
NEXT_PUBLIC_APP_PROFILE=victor
NEXT_PUBLIC_APP_NAME=Mis Finanzas VHV
```

Segunda aplicación:

```env
NEXT_PUBLIC_APP_PROFILE=esposa
NEXT_PUBLIC_APP_NAME=Mis Finanzas
```

## Inicialización de estructura

El script `scripts/clone-structure.mjs` copia únicamente nombres de cuentas con saldo cero y el árbol de categorías. No copia movimientos, presupuestos, tarjetas, contactos, agenda ni alertas.

Variables temporales requeridas:

```env
STRUCTURE_SOURCE_DATABASE_URL=postgresql://...
STRUCTURE_TARGET_DATABASE_URL=postgresql://...
STRUCTURE_SOURCE_USER_EMAIL=
STRUCTURE_TARGET_USER_EMAIL=
STRUCTURE_TARGET_USER_NAME=
```

Primero ejecutar sin cambios:

```powershell
node scripts/clone-structure.mjs
```

Después de revisar el resumen:

```powershell
node scripts/clone-structure.mjs --apply
```

El script se niega a continuar si ambas conexiones apuntan a la misma base o si la base destino ya contiene información financiera.
