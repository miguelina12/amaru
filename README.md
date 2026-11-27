# Faro · guía por voz para personas ciegas

Faro es una app web instalable (PWA) que te guía por casa y por la calle usando
**la cámara, el GPS, la brújula y el contador de pasos del teléfono**. Te habla con
la mejor voz en español que tenga tu móvil y entiende órdenes dichas con naturalidad.

**Regla del proyecto: sin APIs de pago ni claves.** Casi todo se calcula dentro del teléfono. La única
excepción es el [servidor de Faro](#servidor-de-faro-por-internet) (se puede apagar en Ajustes): las frases que
el teléfono no entiende y las fotos que pidas mirar con detalle pasan por un ordenador de quien mantiene la app.
Nunca se envía audio ni la posición GPS.

| Función | Cómo funciona (en el teléfono) |
|---|---|
| Voz | Síntesis de voz del sistema (`speechSynthesis`); elige la voz local de mayor calidad |
| Escucha | Reconocimiento de voz del navegador; usa el modo **en el dispositivo** cuando el navegador lo ofrece |
| Obstáculos | Dos detectores en el móvil (ONNX Runtime): uno general con **253 objetos y animales** (casa, baño, cocina, calle, vehículos, ~80 animales; ver `js/vocab.js`) y un **especialista de casa entrenado con 2.285 fotos reales** (puertas, ventanas, armarios, camas…) |
| Distancias | Geometría de la cámara: tamaño real del objeto + inclinación del teléfono |
| Pasos | Acelerómetro con detección de picos y calibración |
| Orientación | Brújula del teléfono (hacia dónde mira la cámara) |
| Calle | GPS + mapa de calles de OpenStreetMap descargado **una vez** y guardado en el teléfono: rutas a pie, nombres de calles, números de portal, pasos de peatones y lugares |
| Comprensión | Analizador de órdenes en español (+ modo inteligente opcional con un LLM local) |

> ⚠️ **Faro es una ayuda, no un sustituto del bastón o del perro guía.** La cámara no ve
> escalones, bordillos, agujeros, cristales ni objetos fuera de su encuadre.

## Cómo se usa

1. Abre la app y toca **"Toca para empezar"** (acepta cámara, ubicación y movimiento).
2. Sujeta el teléfono **a la altura del pecho, en vertical, con la cámara trasera hacia delante**.
   Faro te avisa si lo llevas inclinado, tapado, borroso o con poca luz (y enciende la linterna).
3. **Toca el botón amarillo grande** y habla. Abajo tienes Repetir, ¿Dónde estoy?, ¿Qué hay delante? y Parar; el resto está en **Ajustes**.

### Ejemplos de órdenes

- **Casa:** "graba ruta a la cocina" → caminas → "he llegado". Luego: "llévame a la cocina", "vuelve".
- **Calle:** di una vez "descarga el mapa". Luego "llévame a la calle Mayor 5", "llévame a la farmacia más cercana",
  "¿dónde estoy?" (te dice la calle y el número), "¿cuánto falta?". También "guarda este lugar como portal".
- **Cámara:** "¿qué hay delante?", "busca una silla", "¿cómo tengo la cámara?", "enciende la linterna"
- **Pasos:** "calibra mis pasos", "calibra con diez metros", "mido uno setenta", "¿cuántos pasos llevo?"
- **Orientación:** "¿dónde estoy?", "¿hacia dónde miro?", "¿cuánto falta?"
- **Ajustes:** "habla más despacio", "cambia de voz", "activa el sónar", "activa manos libres"
  (entonces empieza las frases con "Faro…"), "activa el modo inteligente", "para", "repite", "ayuda".

### Evitar choques

Mientras caminas, Faro vigila un "pasillo" de unos 90 cm delante de ti:

- **Aviso:** "Silla delante, a 3 pasos. Desvíate a la izquierda." (pitido en el lado del obstáculo)
- **Alto:** "¡Alto! Persona justo delante." con vibración fuerte, también si algo se te acerca rápido.
- **Cuándo avisa:** a unos **2 metros** (3 pasos) si está en tu camino; escaleras a 3 m y vehículos a 4 m.
  Lo que está más lejos o a un lado no se avisa.
- **Sentido común:** si duda entre dos cosas parecidas lo dice ("un perro o un gato"); los animales salvajes
  solo se anuncian si está muy seguro; descarta tamaños y formas imposibles y cosas fuera de lugar.
- **Escaleras:** "Cuidado: escaleras delante, a 5 pasos" y "¡Alto!" si estás muy cerca.
- **Puertas, paso de peatones, semáforos:** se anuncian una vez, sin alarma.
- **Sin repeticiones:** un objeto solo cuenta si aparece en varias imágenes seguidas, cada obstáculo
  se anuncia una sola vez mientras siga ahí, y parado no te avisa salvo que algo venga hacia ti.
- **Paredes lisas:** aviso aproximado y poco frecuente cuando la imagen central no tiene textura.
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
La primera vez se descargan el detector (unos 20 MB) y, si lo activas, el modo inteligente.
Después todo funciona **sin conexión**.

## Modo inteligente (opcional)

Di "activa el modo inteligente" (o tócalo en Ajustes) para descargar un modelo de lenguaje que se ejecuta
**dentro del teléfono** con WebLLM y WebGPU: Qwen3‑4B (~2,5 GB) en móviles con 6 GB de memoria o más, y
Qwen3‑1.7B (~1 GB) en el resto. Entiende frases libres ("tengo hambre, ¿me llevas a la cocina?"), recuerda
lo último que hablasteis y conversa. Si Faro no te entiende, te ofrece activarlo.
Necesita un móvil reciente con WebGPU (Chrome en Android reciente).

## Servidor de Faro (por internet)

Sin claves ni cuentas: un ordenador de quien mantiene Faro ejecuta un modelo abierto con visión
(**Gemma 3 4B** en [Ollama](https://ollama.com)) y lo publica con un túnel de Cloudflare.

- **Cuándo se usa:** solo cuando las reglas del teléfono no entienden una frase, y para "mira bien",
  "léeme el cartel" o "de qué color es". Las órdenes normales no salen del teléfono.
- **Qué se envía:** la frase (texto, nunca audio), los nombres de tus lugares y rutas, lo que ve la cámara,
  la calle y la hora; con "mira bien", una foto JPEG. Nunca la posición GPS. El servidor no guarda nada:
  solo cuenta peticiones en memoria para el límite de uso.
- **Si no responde** (sin internet, ordenador apagado, ocupado o límite alcanzado), Faro lo dice y sigue con
  lo que hay en el teléfono. Durante un minuto no lo vuelve a intentar, para no hacerte esperar.
- **Apagarlo:** botón "Servidor de Faro" en Ajustes, o di "desactiva el servidor".
- **Velocidad:** corre en un portátil sin GPU. Entender una frase tarda unos 10–20 s y describir una foto
  alrededor de un minuto, y atiende a una persona cada vez.

### Montar el servidor (para quien mantiene Faro)

Necesita Windows con [Ollama](https://ollama.com), Node 18+ y `cloudflared`.

```powershell
ollama pull gemma3:4b
powershell -ExecutionPolicy Bypass -File server\arrancar.ps1
```

`arrancar.ps1` arranca `server/faro-server.mjs` (solo en `127.0.0.1:8787`), abre un túnel rápido de
Cloudflare (`https://….trycloudflare.com`), escribe esa dirección en `server.json` y la sube a la rama, de
donde la lee la app. Ollama nunca se expone: el servidor solo acepta `POST /v1/interpret` y `POST /v1/look`
desde el origen de la app, con un **límite por persona** (por IP: 8 frases/min y 300/día; 2 fotos/min y
60/día) y una cola corta (si está llena responde "ocupado").

## Límites (dicho con honestidad)

- **No es tan listo como un modelo grande en la nube.** El entendimiento es un analizador de
  órdenes muy completo, más un modelo pequeño opcional (en el teléfono o en el servidor de Faro). Funciona bien con órdenes del día a día y peor
  con conversación abierta.
- **El mapa de calles se descarga una vez** de OpenStreetMap (servicio Overpass): es la única conexión externa,
  y envía la zona aproximada (2 km) que se descarga. Después las rutas se calculan sin internet. La calidad
  depende de lo completo que esté OpenStreetMap en tu barrio; el GPS en ciudad puede desviarse 5–15 m, así
  que la guía no sustituye a escuchar el tráfico al cruzar.
- **El GPS falla en interior**: en casa se usan pasos + brújula, y la brújula puede desviarse cerca de
  metales o electrodomésticos.
- **Ningún detector reconoce el 100 %.** Faro conoce 253 cosas, pero puede fallar con poca luz, objetos tapados,
  de lado o muy pequeños (ver "Precisión medida").
  En móviles sin WebGPU analiza unas 1–2 imágenes por segundo.
- **El reconocimiento de voz** solo funciona totalmente en el teléfono en navegadores que lo permiten
  (Chrome reciente). En otros, el navegador puede usar su propio servicio; puedes usar los botones o escribir.
- La primera descarga del detector necesita internet (después queda guardado).

## Precisión medida

Medido con 404 fotos de casas reales que los detectores **no vieron al entrenar** (HomeObjects-3K, validación),
con los dos detectores juntos como funcionan en la app. "Encontrados" = de cada 100 objetos que había en las fotos,
cuántos detectó en **una sola foto** (caminando, Faro ve muchas fotos seguidas del mismo objeto):

| Objeto | Encontrados | Antes (solo detector general) |
|---|---|---|
| Puerta | **51 %** | 32 % (20 % en la versión anterior) |
| Ventana | 61 % | 2 % |
| Armario | 61 % | 28 % |
| Cama | 86 % | 77 % |
| Sofá | 84 % | 71 % |
| Silla | 78 % | 73 % |
| Mesa | 79 % | 68 % |
| Televisor | 80 % | — |
| Lámpara | 60 % | — |

- Ninguna puerta se confundió con una persona.
- De cada 2 "puertas" que anuncia, más o menos 1 no está marcada como puerta en las fotos (a veces es
  un armario o un hueco). Por eso las puertas se anuncian sin alarma.
- Semáforos, animales, sanitarios (váter, bidé) y puertas correderas están en el vocabulario,
  pero no hay fotos de prueba etiquetadas para medirlos; no damos un porcentaje inventado.

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
js/map.js        mapa de calles sin conexión: rutas, direcciones, guía giro a giro
js/plausibility.js  sentido común: descarta detecciones imposibles
js/brain.js      modo inteligente con LLM local (opcional)
```
