# Faro · guía por voz para personas ciegas

Faro es una app web instalable (PWA) que te guía por casa y por la calle usando
**la cámara, el GPS, la brújula y el contador de pasos del teléfono**. Te habla con
la mejor voz en español que tenga tu móvil y entiende órdenes dichas con naturalidad.

**Regla del proyecto: sin APIs.** No se envían imágenes, audio ni ubicación a ningún
servidor. Todo se calcula dentro del teléfono:

| Función | Cómo funciona (en el teléfono) |
|---|---|
| Voz | Síntesis de voz del sistema (`speechSynthesis`); elige la voz local de mayor calidad |
| Escucha | Reconocimiento de voz del navegador; usa el modo **en el dispositivo** cuando el navegador lo ofrece |
| Obstáculos | TensorFlow.js + COCO‑SSD (80 tipos de objeto) ejecutado en el móvil |
| Distancias | Geometría de la cámara: tamaño real del objeto + inclinación del teléfono |
| Pasos | Acelerómetro con detección de picos y calibración |
| Orientación | Brújula del teléfono (hacia dónde mira la cámara) |
| Calle | GPS, rumbo y distancia en línea recta, puntos de ruta grabados |
| Comprensión | Analizador de órdenes en español (+ modo inteligente opcional con un LLM local) |

> ⚠️ **Faro es una ayuda, no un sustituto del bastón o del perro guía.** La cámara no ve
> escalones, bordillos, agujeros, cristales ni objetos fuera de su encuadre.

## Cómo se usa

1. Abre la app y toca **"Toca para empezar"** (acepta cámara, ubicación y movimiento).
2. Sujeta el teléfono **a la altura del pecho, en vertical, con la cámara trasera hacia delante**.
   Faro te avisa si lo llevas inclinado, tapado, borroso o con poca luz (y enciende la linterna).
3. **Toca cualquier parte grande de la pantalla** y habla.

### Ejemplos de órdenes

- **Casa:** "graba ruta a la cocina" → caminas → "he llegado". Luego: "llévame a la cocina", "vuelve".
- **Calle:** "guarda este lugar como portal", "llévame al portal", "¿dónde está la parada?"
- **Cámara:** "¿qué hay delante?", "busca una silla", "¿cómo tengo la cámara?", "enciende la linterna"
- **Pasos:** "calibra mis pasos", "calibra con diez metros", "mido uno setenta", "¿cuántos pasos llevo?"
- **Orientación:** "¿dónde estoy?", "¿hacia dónde miro?", "¿cuánto falta?"
- **Ajustes:** "habla más despacio", "cambia de voz", "activa el sónar", "activa manos libres"
  (entonces empieza las frases con "Faro…"), "activa el modo inteligente", "para", "repite", "ayuda".

### Evitar choques

Mientras caminas, Faro vigila un "pasillo" de unos 90 cm delante de ti:

- **Aviso:** "Silla delante, a 3 pasos. Desvíate a la izquierda." (pitido en el lado del obstáculo)
- **Alto:** "¡Alto! Persona justo delante." con vibración fuerte, también si algo se te acerca rápido.
- **Vehículos** (coche, moto, bici, autobús): aviso desde unos 7 metros.
- **Paredes lisas:** aviso aproximado cuando la imagen central no tiene textura mientras caminas.
- **Sónar** opcional: pitidos más rápidos cuanto más cerca, sonando del lado del obstáculo.

### Calibrar los pasos

- **Por altura:** "mido 1,70" → paso ≈ 41 % de la altura.
- **Distancia conocida:** "calibra con diez metros", camina y di "he llegado".
- **GPS:** en la calle con buena señal, "calibra mis pasos" y camina 50 pasos recto.

## Instalar y probar

Necesita HTTPS (o `localhost`) para la cámara y los sensores.

```bash
npm start          # sirve la app en http://localhost:8080
npm test           # pruebas del lenguaje, la geometría y las rutas
```

Para usarla en el móvil, publícala en cualquier hosting estático con HTTPS (por ejemplo
GitHub Pages), ábrela en Chrome (Android) o Safari (iPhone) y elige **"Añadir a pantalla de inicio"**.
La primera vez se descargan el detector (unos 5 MB) y, si lo activas, el modo inteligente.
Después todo funciona **sin conexión**.

## Modo inteligente (opcional)

Di "activa el modo inteligente" para descargar un modelo de lenguaje pequeño
(Qwen2.5‑1.5B, ~1 GB) que se ejecuta **dentro del teléfono** con WebLLM y WebGPU. Sirve para
entender frases libres ("tengo hambre, ¿me llevas a la cocina?") y conversar.
Necesita un móvil reciente con WebGPU (Chrome en Android reciente).

## Límites (dicho con honestidad)

- **No es tan listo como un modelo grande en la nube.** Sin APIs, el entendimiento es un analizador de
  órdenes muy completo, más un modelo pequeño opcional. Funciona bien con órdenes del día a día y peor
  con conversación abierta.
- **Sin servicios de mapas no hay nombres de calles ni rutas por calles**: te guía en línea recta hacia
  lugares guardados o siguiendo rutas que hayas grabado tú.
- **El GPS falla en interior**: en casa se usan pasos + brújula, y la brújula puede desviarse cerca de
  metales o electrodomésticos.
- **El detector solo reconoce 80 tipos de objetos** (personas, muebles, vehículos, animales…). No reconoce
  puertas, escaleras, bordillos ni agujeros.
- **El reconocimiento de voz** solo funciona totalmente en el teléfono en navegadores que lo permiten
  (Chrome reciente). En otros, el navegador puede usar su propio servicio; puedes usar los botones o escribir.
- La primera descarga del detector necesita internet (después queda guardado).

## Estructura

```
index.html, css/, manifest.webmanifest, sw.js   interfaz y modo sin conexión
js/app.js        orquesta todo y responde a las órdenes
js/intents.js    comprensión de órdenes en español
js/voice.js      voz y escucha
js/vision.js     cámara, detector, distancias, calidad de imagen
js/safety.js     avisos anti-choque y sónar
js/navigator.js  grabación y guiado de rutas (pasos y GPS)
js/sensors.js    podómetro, brújula y GPS
js/store.js      memoria local (lugares, rutas, ajustes)
js/brain.js      modo inteligente con LLM local (opcional)
```
