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

## Control del comprobante (coherencia interna)

Cada fila leída del QR se revisa contra sí misma. **No aplica reglas fiscales**: no conoce alícuotas ni regímenes, no calcula percepciones ni retenciones y no consulta padrones. Solo avisa cuando los datos se contradicen. Cada observación es un error (los datos se contradicen) o un aviso (conviene mirarlo) y deja la fila en «Revisar» con una frase que dice qué mirar; el CSV la copia en la columna «Avisos».

- **CUIT del emisor y del receptor** (el del receptor, si se identifica con CUIT o CUIL): 11 dígitos y dígito verificador válido.
- **CAE:** si viene, 14 dígitos. Si se informó el vencimiento, no puede ser anterior a la emisión (acepta `AAAA-MM-DD`, `DD/MM/AAAA` y `AAAAMMDD`).
- **Fecha de emisión:** válida y no futura.
- **Letra:** una factura C no discrimina IVA; una A o una M a un receptor que no se identifica con CUIT es un aviso.
- **Cuadre del total:** neto + IVA + otros conceptos = total, calculado en centavos. Se perdona **un centavo** de diferencia (el IVA se redondea línea por línea); desde dos centavos es un error y el texto dice la diferencia. Lo que no se informa vale cero.
- **Duplicados:** mismo emisor, tipo, punto de venta y número. Los marca la planilla con su sello «Duplicada» (no cambian el estado de la fila) y el control no los cuenta: el resumen sobre la planilla los dice aparte («1 duplicada, marcada aparte») y no muestra el tilde verde si hay alguna.
- **«Hoy»:** la fecha futura se compara con el día de Argentina, no con el del navegador.
- **El resumen no afirma de más:** sin observaciones dice «Ningún comprobante con observaciones entre los N controlados»; las filas sin QR no se controlan y se cuentan aparte («2 sin QR, sin controlar»), también sin tilde verde.
- **El CSV** copia en «Avisos» las mismas frases que la pantalla, con la gravedad escrita («Error:» o «Aviso:»).

El QR de ARCA no trae el neto ni el IVA: el cuadre y el vencimiento del CAE solo se controlan en una fila que tenga ese desglose. El desglose sale de dos lugares: las columnas opcionales del registro (`Neto`, `IVA`, `Otros`, `Vencimiento CAE`, con varios nombres aceptados; se une a la fila por la misma clave que la conciliación: CUIT, tipo, punto de venta y número) o los cuatro campos «Desglose del comprobante» del detalle de la fila. Lo escrito a mano manda sobre el registro, y vaciar los cuatro campos vuelve al del registro. Un registro sin esas columnas se lee igual que siempre. Una celda de desglose ilegible (texto, más de 2 decimales, fecha imposible, fórmula) no invalida la línea: se ignora ese dato y se avisa la línea. Si el archivo repite la clave, vale el desglose de la primera línea. Lo que el QR no trae (por ejemplo, un CAE vacío) no se juzga.

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
- **Importes:** hasta 12 dígitos enteros y 2 decimales; un importe con más decimales se rechaza en lugar de redondearlo. En el registro, `1.234` se lee como 1234 (el punto de miles argentino); `1,500` y `10,000` (coma con tres dígitos terminados en cero) se rechazan por ambiguos; `1,234` se rechaza (la coma es el decimal y 3 decimales no existen en pesos): conviene corregirlo en el archivo; la línea se informa como no leída.
- **Líneas del registro que no son un comprobante real:** tipo 0, punto de venta 0 o de más de 5 dígitos, y número 0 se descartan y se informan como líneas que no se pudieron leer.
- **"Comprobantes" del registro:** son claves distintas, no líneas. Si el archivo repite alguna, el aviso lo dice ("3 comprobantes distintos en 5 líneas; 2 figuran más de una vez"). Una clave repetida que ninguna factura recibida reclama aparece solo en "Cargadas dos veces", no también en "Cargadas en el sistema y no recibidas".
- **Al vaciar la planilla:** se reinician las filas, las ediciones abiertas, la lectura en curso y el filtro (vuelve a "Todas"). Se conservan el registro cargado y los ajustes de antigüedad (umbral, orden y fecha de referencia): son suyos, no de las facturas.
- **Fecha de referencia:** el día cero se dice "hoy" solo si la referencia es hoy; con una fecha elegida o la fija del ejemplo dice "Emitida el día de la fecha de referencia".


## Conciliación de pagos (cuentas a pagar)

Segunda mitad del ciclo: la planilla dice qué facturas llegaron y están cargadas; el extracto de pagos dice qué se pagó. El módulo
`src/cuentas-a-pagar.ts` los cruza y responde: qué facturas se pagaron, cuáles no, y qué pagos no tienen factura. **No aplica reglas
fiscales**: no calcula percepciones, retenciones ni alícuotas, y un pago menor que la factura es un pago parcial, no «una retención».
Todo el cruce es determinístico y explicable (sin IA): cada pago trae en `porQue` la frase que dice por qué quedó donde quedó.

**Entrada.** Las facturas de la planilla (`facturasDeFilas`: quedan afuera, con su motivo, las duplicadas, las sin los datos de la clave, las
notas de crédito, las que no están en pesos y las sin importe positivo) y el CSV del extracto: `Fecha`, `Importe`, `CUIT` y/o `Referencia`
(al menos una de las dos columnas), y opcionales `Concepto`, `Cargó`, `Autorizó` y `Operación`. Un CUIT con dígito verificador inválido no se
usa para cruzar y se avisa. Las líneas ilegibles (fecha imposible, importe que no es un número, cero o negativo) se informan con su motivo y
no frenan al resto. El extracto no trae moneda: solo se concilian facturas en pesos.

**Orden del cruce.** Cada fase mira solo los pagos que las anteriores no resolvieron. Dentro de una fase los pagos van por fecha y línea, y
las facturas por fecha y número; el resultado no depende del orden de las listas.

| Fase | Regla | Qué hace |
| --- | --- | --- |
| 0 | Duplicado | El mismo número de operación **con el mismo CUIT e importe** (sin contar ceros a la izquierda: `000123` es `123`), o la misma fecha, CUIT, importe y referencia (si los dos traen operación y difiere, son dos pagos). El segundo no cuenta ni resta saldo. Un número de operación repetido con otro CUIT u otro importe **no** es un duplicado (muchos bancos repiten los números): se cruza como un pago más y lleva el aviso «número de operación repetido». |
| 1 | Referencia | El texto libre (referencia y concepto) nombra la factura: `0003-00001245`, `3-1245` o `FA 0003-00001245`. Fechas y CUIT no se toman por referencias. Se paga esa factura, completa o en parte; una referencia a varias facturas se aplica a las más antiguas primero. Una referencia que no corresponde a ninguna factura del CUIT se avisa y el pago sigue por la fase 2. Sin CUIT, alcanza la referencia si nombra una sola factura. |
| 2 | CUIT e importe | Una sola factura abierta del CUIT tiene ese saldo y ningún otro pago compite por ella. Si una factura tiene el saldo exacto y otra solo entra en la tolerancia, gana la exacta. |
| 3 | Suma | Una sola combinación de dos o más facturas abiertas del CUIT suma el importe y ningún otro pago puede ser esa misma combinación (si dos pagos compiten, los dos quedan para revisar). Hasta 12 facturas abiertas; con más, no se prueba. |
| 4 | Lo que queda | Una sola factura abierta y un pago menor: **pago parcial**. Un pago igual a lo que falta de esa única factura (la última cuota) la deja saldada. Varias abiertas sin coincidencia: **para revisar**. Ninguna factura (o todas pagadas): **sin factura**. |

**Lo dudoso no se decide.** Dos facturas del mismo CUIT con el mismo importe, dos pagos que compiten por una factura, dos combinaciones
posibles, un pago que supera el saldo de la única factura abierta, una referencia que nombra una factura ya pagada o que figura en
facturas de dos proveedores (con el pago sin CUIT): el pago queda «para revisar» con las facturas candidatas, sin imputar. Esas facturas
muestran `enRevision` (no se las puede dar por impagas sin mirar esos pagos).

**Tolerancia.** Dos centavos por defecto (`TOLERANCIA_CENTAVOS_POR_DEFECTO`, se puede cambiar): una diferencia menor se perdona, se dice en
el `porQue` y la factura figura pagada con ese saldo mínimo. Un pago de más que no pasa la tolerancia no deja nada sin imputar. Una factura cuyo
importe no supera la tolerancia (`$ 0,01` o `$ 0,02`) no entra al cruce: figuraría pagada sin ningún pago.

**Qué dice de cada factura:** `pagada`, `parcial` (con lo pagado, el saldo y las líneas que la pagaron) o `impaga`, con los días corridos
desde la emisión y la marca de antigua desde el umbral (30 días, igual que «lo que falta cargar»). Como en el resto de la demo, la
antigüedad es solo eso: no hay vencimientos ni plazos.

**Control interno.** Si el mismo usuario cargó y autorizó un pago (sin importar mayúsculas, tildes ni espacios) hay un aviso por pago. No
cambia el cruce: un pago puede estar bien emparejado y mal autorizado. Sin columnas de usuarios el control no se puede hacer y la lectura
lo dice (`tieneUsuarios`).

**Límites.** El archivo se lee con los mismos topes que el registro (2 MB, 20.000 líneas); cada texto libre se corta a 200 caracteres, pierde
los caracteres de control y los que invierten el sentido del texto, y nunca se interpreta como HTML ni como fórmula. Un importe con coma y tres
dígitos que terminan en cero (`1,500`, `10,000`) es ambiguo (¿miles estadounidenses o tres decimales?) y la línea se informa en lugar de adivinar;
una línea con más columnas que el encabezado (un `1500,50` sin comillas en un archivo separado por comas) también se informa. Las columnas repetidas
se avisan y se usa la primera. Si un pago podría ser de más de 20 facturas, no se listan (la lista no ayudaría a decidir) y el motivo lo dice. Un duplicado sin número de operación se detecta por fecha, CUIT, importe y referencia: si de
verdad son dos pagos iguales el mismo día, el aviso lo dice y pide cargar la operación.

**Qué no hace.** Pagos partidos bajo un umbral, pagos fuera de horario, varias monedas, cheques diferidos, notas de crédito contra pagos,
vencimientos ni lectura de comprobantes de pago en PDF o imagen.

**Pantalla (pestaña «Pagos»).** Cada resultado de arriba se ve así: la factura con su estado (Pagada, Pago parcial con el saldo, Impaga con
los días), el pago con su resultado (Emparejado, Sin factura, Duplicado de la línea N, Para revisar) y el `porQue` completo, y una bandeja
de excepciones (sin factura, para revisar con sus candidatas, duplicados, mismo usuario, CUIT inválido, líneas ilegibles y facturas
omitidas con su motivo). Los días y la marca de antigua usan la misma fecha de referencia y el mismo umbral que la planilla. Los CSV de
salida pasan todo texto del usuario por `celdaTexto` (neutraliza `=`, `+`, `-`, `@`, tabulación y retorno de carro).
