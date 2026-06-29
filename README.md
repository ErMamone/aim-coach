# AimCoach — armado de punta a punta

Coach de aim para Valorant. Feedback baseline-relativo desde dos fuentes:
- **Telemetria de mouse** (capturador C#, raw input del SO) — gesto, recoil, overshoot, burst.
- **Eventos de ronda de Valorant** (Overwolf GEP, game id 21640) — hits/headshots por ronda.

El feedback se acumula durante la ronda y se superficie en huecos muertos (post-muerte / fin de ronda).

## Estructura

```
native/
  MouseCapturer.cs      raw input -> servidor WebSocket ws://127.0.0.1:9595/
  MouseCapturer.csproj
engine/
  ruleEngine.js         motor de reglas (baseline-relativo)
  calibration.js        matematica de sens + derivacion de baseline
  simulate.js           prueba el motor con datos sinteticos (node simulate.js)
  calibrate_demo.js     prueba la calibracion (node calibrate_demo.js)
overlay/
  manifest.json         app Overwolf (windows: background, overlay, calibration)
  background.html       carga background.js (bundle)
  overwolf.js           background controller: WebSocket + GEP + forward al overlay  <-- se bundlea
  overlay.html          overlay in-game que muestra el feedback
  calibration-window.html  ventana de DPI/sens + 360 + drill -> baseline
```

## 1. Capturador C#

Requiere .NET 8 SDK en Windows.

```
cd native
dotnet build -c Release
dotnet run -c Release            # queda corriendo, sirviendo el WebSocket
```

Si `HttpListener` tira AccessDenied en el puerto, corré una vez como admin o reservá la URL:
```
netsh http add urlacl url=http://127.0.0.1:9595/ user=%USERNAME%
```

Verificacion rapida del stream (sin Overwolf): abrí la consola del navegador y
```
const ws = new WebSocket('ws://127.0.0.1:9595/'); ws.onmessage = e => console.log(e.data);
```
Mové el mouse: deberias ver `{t,dx,dy,a,b}` fluyendo. **Confirmá el signo de dy** moviendo
el mouse hacia abajo — si dy sale negativo, invertí la convencion en el motor.

## 2. App Overwolf

Necesita el bundle del background controller (Chromium no resuelve `require`):

```
cd overlay
npx esbuild overwolf.js --bundle --outfile=background.js --platform=browser
```

Cargá la app sin firmar en modo dev:
1. Abrí el cliente Overwolf -> Settings -> About -> Development Options -> **Load unpacked extension**.
2. Elegí la carpeta `overlay/`.
3. Agregá iconos en `overlay/icons/` (icon.png, icon_gray.png, 256x256) o sacá esas lineas del manifest.

Con Valorant abierto (modo **Windowed / Borderless**, no fullscreen exclusivo — el overlay no
inyecta en exclusivo), el background pide las features y el overlay aparece.

## 3. Calibracion

Abrí la ventana `calibration`. Cargá DPI + sens, hacé el 360 y el drill. El baseline sale en JSON.
Guardalo (en v1, el background lo lee de `localStorage['aimcoach_baseline']`, o mandáselo por
`overwolf.windows.sendMessage(bg, 'baseline', obj)`).

**Importante:** en produccion el 360 y el drill tienen que comer del MISMO WebSocket del capturador
C# (raw input), no del Pointer Lock de la ventana. El Pointer Lock pasa por el SO y puede meter
aceleracion -> calibrarias con una fuente y medirias con otra. Reemplazá la funcion `lockAnd` por
el cliente WebSocket.

## Empaquetado: un solo activador (OPK)

No existe un .exe standalone de una app Overwolf; corre dentro del cliente. Pero el OPK +
process-manager + auto-launch da el efecto "una sola cosa activa todo":

1. **Bundleá `overwolf.js`** -> `background.js` (esbuild, ver arriba).
2. **Conseguí `process_manager.dll`** del repo oficial overwolf/overwolf-plugins (carpeta `dist/`).
   Ponelo en `overlay/plugins/process_manager.dll`. **Desbloqueá el DLL**: click derecho ->
   Propiedades -> tildar "Desbloquear". Si no, Overwolf no lo carga y la app crashea.
   Verificá el nombre de clase exacto del plugin contra el sample manifest del repo.
3. **Compilá el capturador** y metelo en el OPK: `overlay/MouseCapturer.exe`.
   - Liviano (depende del runtime .NET 8 en la maquina): `dotnet publish -c Release`.
   - Sin dependencias (OPK pesado, ~60MB+): publish self-contained single-file.
4. **Armá el OPK**: ZIP de todo el contenido de `overlay/` (manifest en la raiz), compresion Normal
   (no maxima), y renombrá .zip -> .opk. Doble clic lo instala.

Con eso: el tester instala el OPK una vez. Al abrir Valorant, la app auto-lanza, arranca el
capturador sola, y el overlay aparece. Cero pasos manuales.

### EL CATCH IMPORTANTE: whitelisting

Overwolf NO deja instalar OPKs de fuera del store salvo a cuentas **whitelisteadas como
developer**. Para tus testers, las opciones son:
- Whitelistear la cuenta Overwolf de cada tester (tramite con Overwolf), o
- En cada PC, cargar la app con "Load unpacked extension" (apuntando a `overlay/`) en vez de OPK, o
- Publicar la app en el store (review de Overwolf).

O sea, "les paso un archivo y andan" no es real hasta publicar en el store. Para pocos conejillos
de india, lo mas rapido es "Load unpacked extension" en cada maquina.

### Alternativa mas simple (fase testers)

Si el whitelisting te traba, saltá el process-manager plugin: poné `MouseCapturer.exe` en el
Startup de Windows (corre siempre, en bandeja) y cargá la app Overwolf unpacked. Menos elegante,
pero evita el plugin, el desbloqueo de DLL y la resolucion de rutas.

## Pendiente / a pulir

- Calibrar los umbrales de las reglas con datos reales (tenes testers).
- Patrones de recoil dataminados por arma -> pull esperado absoluto (usa `countsToCounterDegrees`).
- Confirmar el signo de dy del capturador en tu hardware.
- El round_report NO llega en Range/custom (solo partidas) — la mecanica de mouse si funciona en Range.
