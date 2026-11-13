# 🗺️ Control Delivery — Mapa de Madrid y Gestión de Cocinas

Visualizador cartográfico interactivo de **Códigos Postales de la Comunidad y Capital de Madrid**, con cálculo automático de distancias a cocinas operativas, detección de fronteras limítrofes y base para seguimiento de repartidores en tiempo real.

---

## 🍳 Cocinas Operativas Fijas

* **🍳 Cocina Norte:** Av. de 25 de Septiembre, 8 (CP 28027, San Blas - Salvador)
* **🍳 Cocina Fuencarral:** C/ Sangenjo, 29 (CP 28034, Fuencarral - La Paz)
* **🍳 Cocina Alcorcón:** Plaza Príncipes de España, 2 (CP 28924, Parque Lisboa)

---

## 🌟 Funcionalidades Principales

1. **Cartografía de Códigos Postales:**
   - Visualización y resaltado dinámico de los 55 códigos postales de Madrid Capital y 298 de la Comunidad de Madrid.
   - Puntos interactivos con cambio dinámico de alcance (*Capital* vs *Comunidad*).

2. **Detección de Cocina Óptima:**
   - Cálculo geodésico de distancias en tiempo real desde el código postal o dirección seleccionada hacia cada una de las 3 cocinas.
   - Trazado de ruta directa animada en el mapa hacia la cocina más cercana.

3. **Detección de Fronteras y Zonas Limítrofes:**
   - Si una dirección o código postal se ubica a menos de 250 metros del límite de otro código postal, se alumbra tenuemente la zona vecina y se emite alerta en el panel HUD.

4. **Buscador Inteligente:**
   - Búsqueda por código postal, nombre de barrio o dirección exacta con geocodificación.
   - Acceso directo a las 3 cocinas y visualización previa de la cocina más cercana en los resultados.

5. **Panel de Calles y Direcciones a Demanda:**
   - La lista de direcciones permanece oculta por defecto para no saturar la vista, permitiendo al usuario decidir cuándo desplegarla.
   - Pestaña de ranking con las 3 opciones de cocinas ordenadas por cercanía.

---

## 🚀 Despliegue en GitHub Pages

Para ver la aplicación web online directamente en el navegador:
* URL pública: **`https://qwertysalazar.github.io/control_delivery/`**

---

## 💻 Ejecución Local

Para ejecutarlo localmente en cualquier ordenador:
1. Clonar el repositorio o descargar el ZIP.
2. Hacer doble clic en `abrir_mapa.bat` o abrir directamente `index.html` en el navegador.
3. 100% libre de dependencias externas bloqueantes: utiliza librerías locales y capas base gratuitas de alta disponibilidad (Esri Canvas, IGN España).
