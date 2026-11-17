# Editor 3D — proyecto nuevo

Editor móvil 3D creado desde cero con HTML, CSS, JavaScript, Three.js y Capacitor. La compilación Android se ejecuta mediante GitHub Actions.

## Funciones incluidas
- Visor 3D táctil con órbita, zoom y cuadrícula.
- Añadir cubos y esferas; seleccionar y editar nombre, color, posición, rotación y escala.
- Gizmos de mover, rotar y escalar.
- Importación de escenas JSON y modelos GLB/GLTF.
- Guardado de escenas JSON y exportación a GLB.
- APK Android reproducible desde el workflow `android.yml`.

## Compilación local
Requiere Node.js y Android SDK/Java para compilar el APK.

```sh
npm install
npm run build
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

El workflow de GitHub compila el APK y lo adjunta a la ejecución como artefacto. El repositorio usa un workflow manual, sin builds automáticos por cada cambio.

## Iconos
Los iconos SVG en `public/icons/` proceden de [Lucide](https://lucide.dev/) v0.468.0 y se distribuyen bajo licencia ISC. Se empaquetan localmente para que también aparezcan sin conexión en Android.
