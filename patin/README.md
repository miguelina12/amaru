# Amaru Patín · control del patín eléctrico por Bluetooth

App web instalable (PWA) para controlar un patín eléctrico desde el móvil:

- **Velocidad máxima de 0 a 40 km/h** (deslizador, botones ±1 y atajos 6 / 15 / 25 / 30 / 40). La app nunca envía más de 40.
- **Luces del panel**: apagadas, encendidas, intermitentes y color (6 colores + selector libre).
- **Encender y apagar** el patín (apagar pide confirmación: hazlo solo parado).
- Velocímetro en vivo si el patín envía su velocidad, consola Bluetooth y **modo Demo** sin patín.

## Cómo abrirla

Necesita **HTTPS** y un navegador con Bluetooth web: **Chrome en Android, Windows, macOS o Linux**.
En iPhone Safari no tiene Bluetooth web; usa el navegador *Bluefy*.

- Publicada en GitHub Pages: `https://<usuario>.github.io/amaru/patin/`
- En local: `npm start` en la raíz y abre `http://localhost:8080/patin/` (localhost cuenta como seguro).

Pulsa **Conectar**, elige tu patín en la lista y listo. Para instalarla: menú de Chrome → *Añadir a pantalla de inicio*.

## Configurar tu modelo de patín

Cada marca usa **sus propios comandos Bluetooth**, así que hay que decirle a la app qué bytes enviar.
Abre **Ajustes del patín**:

1. **Tipo de conexión**: la mayoría de patines usan *Nordic UART (6E40…)*, *FFE0/FFE1* o *FFF0/FFF2*.
   Si te equivocas, al conectar la app te dice qué servicios tiene el patín.
2. **Comandos** en hexadecimal, con variables:
   - `{v}` velocidad en km/h (1 byte) · `{v10le}` velocidad × 10 (2 bytes, little endian)
   - `{r}{g}{b}` color de las luces
3. **Suma de control** si tu protocolo la lleva (suma de 1 byte, XOR o la de tramas `55 AA`).
4. **Guardar**. Con **Exportar / Importar** pasas el perfil a otro móvil.

### ¿Cómo averiguo los comandos?

1. En Android activa *Opciones de desarrollador → Registro de Bluetooth HCI*.
2. Usa la app oficial del patín: enciéndelo, cambia la velocidad, las luces y apágalo (anota la hora de cada cosa).
3. Saca el registro (`adb bugreport`) y ábrelo con Wireshark: verás los bytes que la app oficial escribe en cada acción.
4. Cópialos en Ajustes, sustituyendo el byte de velocidad por `{v}`. Prueba cada uno con la **Consola Bluetooth**.

> Los Xiaomi y Segway‑Ninebot con firmware reciente cifran su Bluetooth, así que no aceptan comandos
> de apps de terceros sin el emparejamiento cifrado de la app oficial.

## Seguridad

- Respeta el límite legal de tu zona (en España y en gran parte de Europa es **25 km/h** en vía pública).
- No apagues el patín en marcha. Usa la app con el patín parado.
