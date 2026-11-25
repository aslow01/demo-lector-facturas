# Reglas de cruce y casos que no resuelve

Detalle de cómo la herramienta compara las facturas recibidas con el registro exportado del sistema de gestión. Todos los datos de la demo son ficticios.

## La regla del negocio

En el sistema real **no se puede cargar dos veces el mismo comprobante** (mismo CUIT emisor, tipo, punto de venta y número). Si una factura quedó mal cargada, primero se da de baja y recién después se vuelve a cargar. Por eso la herramienta nunca sugiere cargar encima de lo que ya está.

## Cómo se dice lo que pasó con cada comprobante

- **Ya cargada:** figura en el sistema con los mismos datos. No hay nada que hacer.
- **Mal cargada** (otro importe u otro emisor): figura, pero con datos distintos. Se muestra qué difiere y la acción es una sola: dar de baja la carga en el sistema y volver a cargarla con los datos correctos. Si usted escribió a mano alguno de los datos del cruce (CUIT, tipo, punto de venta, número o importe), el texto no manda a dar de baja nada: pide revisar primero lo escrito, porque la diferencia puede estar ahí.
- **Cargada dos veces en el sistema:** es un error del sistema (no debería permitirlo). Se muestra el importe de cada copia (hasta 5; si hay más, "y N más"), se dice cuál coincide con el comprobante y cuál sobra, y la acción es dar de baja la copia que sobra. Con exactamente dos copias iguales, el detalle dice "Las dos coinciden: dé de baja una."; con tres o más, se informa cada importe. Se ve en ámbar, con un ícono propio (base de datos), distinto del de "Duplicada en la planilla", en la fila y en "Requieren atención". Lo mismo vale si el comprobante figura repetido con el CUIT de **otro emisor**: la fila avisa de las copias y pide dar de baja todas las cargas.
- **Falta cargar:** no figura en el sistema. Se cuenta por separado como facturas, notas de débito o ambas; las **notas de crédito** que faltan se muestran aparte, con su cantidad y su importe (siempre en positivo: son un monto a favor y no se mezclan con lo que hay que cargar como facturas). En los **totales de la planilla** (sin registro) y en la columna "Importe en el total" del CSV, en cambio, las notas de crédito restan y se ven con signo menos: ahí se muestra el neto.
- **Cargadas en el sistema y no recibidas:** líneas del registro para las que ninguna factura recibida coincide.

## Reglas de cruce

- **Clave:** CUIT del emisor + tipo + punto de venta + número.
- **Importe:** se compara al centavo exacto, sin tolerancia.
- **Signo:** cuenta, salvo en las notas de crédito (tipos 3, 8, 13, 53, 203, 208, 213 y 21), donde se compara el valor absoluto porque algunos sistemas las guardan en negativo. Las notas de débito son los tipos 2, 7, 12, 52, 202, 207, 212 y 20.

| Resultado | Cuándo |
| --- | --- |
| Falta cargar | La clave no está en el registro y la fila no tiene datos dudosos. |
| Revisar antes de cargar | La clave no está en el registro y la fila tiene datos dudosos. No suma en lo que falta. |
| Ya cargada | La clave está y el importe coincide. |
| Mal cargada: otro importe | La clave está y el importe difiere; se muestran ambos y la diferencia. |
| Mal cargada: otro emisor | La clave no está, pero sí tipo + punto de venta + número + importe con otro CUIT. Suele ser una carga equivocada. |
| Cargada dos veces en el sistema | El registro repite la clave. Es un error del sistema: hay que dar de baja la copia que sobra. |
| No se puede conciliar | A la fila le falta CUIT, tipo, punto de venta o número. |

- **Duplicadas en la planilla** (misma clave): se concilian como su original y no se cuentan dos veces.
- **Cargadas dos veces en el sistema** (el registro repite una clave): se informan con el importe de cada copia, y el comprobante se compara contra todas, así que el resultado no depende del orden del archivo. Si coincide con alguna, está "ya cargada" y se dice cuál copia sobra; si no coincide con ninguna, está "mal cargada" y hay que dar de baja todas las copias y cargarlo una sola vez.
- Si varias filas pueden ser el "otro emisor" de un mismo registro, todas quedan marcadas y decide la persona: la herramienta no puede saber cuál se cargó mal. El resultado no depende del orden de la planilla.

## Qué no hace

- No carga nada en otro sistema: lee, ordena y marca dudas; la decisión es de la persona.
- No usa IA en el navegador ni consulta a ARCA ni a ningún servicio.
- No lee el texto de un PDF que no tenga QR, ni exporta a XLSX.
- No convierte entre monedas.
- No calcula plazos fiscales ni vencimientos: la antigüedad es solo la cantidad de días corridos desde la emisión.

## Casos que no resuelve

- **PDF escaneado sin QR legible:** la fila queda "Sin QR" y hay que completarla a mano. Solo se leen las primeras 3 páginas de cada PDF y hasta 15 MB por archivo.
- **QR de otro formato:** solo se acepta la dirección de ARCA (`https`, `afip.gob.ar` o `arca.gob.ar`, ruta `/fe/qr`).
- **Tipo de comprobante con otro nombre en el CSV:** se acepta el código de ARCA (`1`, `6`...) o los nombres de la tabla de tipos de la demo (por ejemplo, `Factura A`). Cualquier otro texto hace que esa línea no se pueda leer y se informe.
- **Archivos en otra codificación:** el CSV se lee como UTF-8, como UTF-16 con marca de orden de bytes (el "Texto Unicode" de Excel) o, si no es UTF-8 válido, como Windows-1252. El separador puede ser punto y coma, coma o tabulador. UTF-16 sin marca no se lee.
- **Registro sin moneda:** el CSV del sistema no trae la moneda; la comparación es solo por importe.

## Comportamiento comprobado con tests

- **Pagos parciales o en cuotas:** no hay ninguna regla para ellos; un importe distinto se muestra como "Mal cargada: otro importe", con la diferencia. Varias cuotas con el mismo número figuran como un comprobante cargado dos veces.
- **Factura cargada con otro tipo de comprobante** (por ejemplo, una B cargada como A): como el tipo es parte de la clave, no se la reconoce como la misma factura. Queda como "Falta cargar" y la línea del sistema aparece en "Cargadas en el sistema y no recibidas".
- **Punto de venta y número con o sin ceros a la izquierda:** `0001` y `1` son lo mismo, en el QR y en el CSV.
- **QR con una versión distinta de la 1:** se lee igual, pero la fila queda en "Revisar" ("Versión de QR desconocida"). Si coincide con el registro, se concilia como "Ya cargada" y la marca de lectura sigue a la vista.
- **Imágenes:** se leen PNG, JPG, WebP, GIF y BMP de hasta 50 megapíxeles; una imagen mayor se rechaza con un aviso. Si un archivo tarda más de 30 segundos en analizarse, se corta y la fila queda "Sin QR" con el motivo.
- **Importes:** hasta 12 dígitos enteros y 2 decimales; un importe con más decimales se rechaza en lugar de redondearlo. En el registro, `1.234` se lee como 1234 (el punto de miles argentino) y `1,234` se rechaza (la coma es el decimal y 3 decimales no existen en pesos): conviene corregirlo en el archivo; la línea se informa como no leída.
- **Líneas del registro que no son un comprobante real:** tipo 0, punto de venta 0 o de más de 5 dígitos, y número 0 se descartan y se informan como líneas que no se pudieron leer.
- **"Comprobantes" del registro:** son claves distintas, no líneas. Si el archivo repite alguna, el aviso lo dice ("3 comprobantes distintos en 5 líneas; 2 figuran más de una vez"). Una clave repetida que ninguna factura recibida reclama aparece solo en "Cargadas dos veces", no también en "Cargadas en el sistema y no recibidas".
- **Al vaciar la planilla:** se reinician las filas, las ediciones abiertas, la lectura en curso y el filtro (vuelve a "Todas"). Se conservan el registro cargado y los ajustes de antigüedad (umbral, orden y fecha de referencia): son suyos, no de las facturas.
- **Fecha de referencia:** el día cero se dice "hoy" solo si la referencia es hoy; con una fecha elegida o la fija del ejemplo dice "Emitida el día de la fecha de referencia".
