// Petitorio (paso 1: firma), encuesta (paso 2) y pantalla final.
// Los textos y la URL del backend están en config.js.
// Ningún dato personal se guarda en el navegador, se muestra en la consola ni va en una URL.

(() => {
  const C = window.PETITORIO ?? {};
  const $ = (id) => document.getElementById(id);
  const cargada = Date.now();
  const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const resaltarPendientes = (s) => escapar(s).replace(/\[[^\]]+\]/g, (m) => `<mark class="pendiente">${m}</mark>`);

  // ---------------------------------------------------------------- textos

  $("volanta").textContent = C.volanta ?? "";
  $("volanta").hidden = !C.volanta;
  $("titulo").textContent = C.titulo ?? "";
  $("parrafos").innerHTML = (C.parrafos ?? []).map((p) => `<p>${resaltarPendientes(p)}</p>`).join("");

  // ---------------------------------------------------------------- backend

  const BACKEND = String(C.backend ?? "").trim();
  const LOCAL = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // sin backend y en tu compu (o con prueba: true en config.js, para una vista previa): se simula todo
  const PRUEBA = !BACKEND && (LOCAL || C.prueba === true);
  $("modo-prueba").hidden = !PRUEBA;

  /** Va como text/plain para que el navegador no haga la consulta CORS previa (Apps Script no la contesta). */
  async function llamar(accion, cuerpo) {
    if (PRUEBA) return simulado(accion, cuerpo);
    if (!BACKEND) throw new Error("sin-backend");
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), 25000);
    try {
      const r = await fetch(cuerpo ? BACKEND : `${BACKEND}?accion=${accion}`, {
        method: cuerpo ? "POST" : "GET",
        headers: cuerpo ? { "Content-Type": "text/plain;charset=utf-8" } : undefined,
        body: cuerpo ? JSON.stringify({ accion, ...cuerpo }) : undefined,
        redirect: "follow",
        signal: corte.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(reloj);
    }
  }

  // Si Google tarda o está "ocupado" (mucha gente enviando a la vez), reintenta solo 2 veces más.
  // Es seguro: una firma con el mismo DNI no se duplica y la encuesta actualiza su fila.
  async function enviar(accion, cuerpo) {
    for (let intento = 1; ; intento++) {
      try {
        const r = await llamar(accion, cuerpo);
        if (r?.error !== "ocupado" || intento === 3) return { ...r, reintentos: intento - 1 };
      } catch (err) {
        if (intento === 3) throw err;
      }
      await new Promise((listo) => setTimeout(listo, 1500 * intento));
    }
  }

  // Simulación local: imita las respuestas de backend/Codigo.gs. Solo guarda un hash de cada DNI
  // en sessionStorage, para poder probar "este DNI ya firmó".
  const firmasPrueba = [];
  async function simulado(accion, cuerpo) {
    await new Promise((ok) => setTimeout(ok, 600));
    let firmas = firmasPrueba;
    try {
      firmas = JSON.parse(sessionStorage.getItem("petitorio-prueba") ?? "[]");
    } catch {}
    if (accion === "contador") return { ok: true, firmas: firmas.length };
    const h = String([...cuerpo.dni].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
    if (accion === "firma") {
      if (firmas.includes(h)) return { ok: true, estado: "repetida", firmas: firmas.length };
      firmas.push(h);
      try {
        sessionStorage.setItem("petitorio-prueba", JSON.stringify(firmas));
      } catch {}
      return { ok: true, estado: "nueva", firmas: firmas.length };
    }
    return firmas.includes(h) ? { ok: true } : { ok: false, error: "sin-firma" };
  }

  // ---------------------------------------------------------------- contador (solo el número)
  // Se prende con mostrarContador: true en config.js.

  const CONTADOR = C.mostrarContador === true;
  function mostrarContador(n) {
    if (!CONTADOR || !Number.isFinite(n) || n < 0) return;
    $("contador-antes").textContent = n === 1 ? "Ya firmó" : "Ya firmaron";
    $("contador-numero").textContent = n.toLocaleString("es-AR");
    $("contador-despues").textContent = n === 1 ? "estudiante" : "estudiantes";
    $("contador").hidden = n === 0;
  }
  if (CONTADOR)
    llamar("contador")
      .then((r) => r?.ok && mostrarContador(Number(r.firmas)))
      .catch(() => {});

  // ---------------------------------------------------------------- validaciones (las mismas que en backend/Codigo.gs)

  const limpiarTexto = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const limpiarDni = (s) => String(s ?? "").replace(/[.\s-]/g, "");
  const dniValido = (s) => /^\d{7,9}$/.test(s);

  /** Celular argentino → +549 + 10 dígitos (código de área + número). null si no se puede. */
  function normalizarTelefono(s) {
    let d = String(s ?? "").replace(/\D/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("54")) d = d.slice(2);
    if (d.startsWith("9") && d.length === 11) d = d.slice(1);
    if (d.startsWith("0")) d = d.slice(1);
    if (d.length === 12) {
      // el 15 después del código de área: 11 15 2345 6789, 351 15 234 5678, 2944 15 23 4567
      for (const largo of [2, 3, 4]) {
        if (d.slice(largo, largo + 2) === "15" && (largo !== 2 || d.startsWith("11"))) {
          d = d.slice(0, largo) + d.slice(largo + 2);
          break;
        }
      }
    }
    // los códigos de área de Argentina empiezan con 11, 2 o 3
    return /^(11\d{8}|[23]\d{9})$/.test(d) ? `+549${d}` : null;
  }
  const mailValido = (s) => s.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(s);

  const CARRERAS = [
    "Arquitectura",
    "Diseño Gráfico",
    "Diseño Industrial",
    "Diseño de Indumentaria",
    "Diseño Textil",
    "Diseño de Imagen y Sonido",
    "Lic. en Planificación y Diseño del Paisaje",
  ];
  $("carreras").innerHTML = CARRERAS.map((c) => `<label class="opcion"><input type="radio" name="carrera" value="${c}" /><span>${c}</span></label>`).join("");

  const MATERIAS = ["ICSE", "IPC", "Matemática", "Semiología", "Filosofía", "Proyectual 1", "Proyectual 2", "Dibujo", "Otra"];
  const SOLO_FIRMA = "Ninguna (solo firma)"; // así queda en la planilla
  $("materias").innerHTML =
    MATERIAS.map((m) => `<label class="opcion"><input type="checkbox" name="materia" value="${m}" /><span>${m}</span></label>`).join("") +
    `<label class="opcion opcion-ancha"><input type="checkbox" name="materia" value="${SOLO_FIRMA}" /><span>No quiero cursar nada, solo ayudar con mi firma</span></label>`;

  // ---------------------------------------------------------------- ayudas de formulario

  function marcar(campo, idError, mensaje) {
    $(idError).textContent = mensaje ?? "";
    $(idError).hidden = !mensaje;
    campo.setAttribute("aria-invalid", mensaje ? "true" : "false");
    return !mensaje;
  }
  function limpiarAlEditar(form) {
    form.addEventListener("input", (e) => {
      const campo = e.target.closest("fieldset.campo") ?? e.target;
      if (campo.getAttribute("aria-invalid") !== "true") return;
      (campo.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter((id) => id.endsWith("-error"))
        .forEach((id) => marcar(campo, id, ""));
    });
  }
  function enfocarPrimerError(form) {
    const el = form.querySelector('[aria-invalid="true"]');
    (el?.matches("fieldset") ? el.querySelector("input") : el)?.focus();
  }
  function ocupado(boton, si, texto) {
    boton.disabled = si;
    boton.setAttribute("aria-busy", String(si));
    boton.textContent = si ? "Enviando…" : texto;
  }
  function errorGeneral(id, mensaje) {
    $(id).textContent = mensaje;
    $(id).hidden = !mensaje;
  }
  // límite simple: no más de 5 envíos por minuto desde esta pestaña
  const envios = [];
  function demasiadosEnvios() {
    const ahora = Date.now();
    while (envios.length && ahora - envios[0] > 60000) envios.shift();
    if (envios.length >= 5) return true;
    envios.push(ahora);
    return false;
  }
  function irA(paso) {
    for (const id of ["paso-firma", "paso-encuesta", "paso-final"]) $(id).hidden = id !== paso;
    const titulo = $(`${paso}-titulo`);
    titulo.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    titulo.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- paso 1: firma

  let dniFirmado = null; // solo en memoria, para vincular la encuesta con la firma
  const formFirma = $("form-firma");
  limpiarAlEditar(formFirma);

  formFirma.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = limpiarTexto(formFirma.nombre.value);
    const apellido = limpiarTexto(formFirma.apellido.value);
    const dniCrudo = formFirma.dni.value.trim();
    const dni = limpiarDni(dniCrudo);
    const ok = [
      marcar(formFirma.nombre, "nombre-error", nombre ? "" : "Escribí tu nombre."),
      marcar(formFirma.apellido, "apellido-error", apellido ? "" : "Escribí tu apellido."),
      marcar(
        formFirma.dni,
        "dni-error",
        !dniCrudo ? "Escribí tu DNI." : !/^\d+$/.test(dni) ? "El DNI va solo con números (los puntos se pueden dejar)." : !dniValido(dni) ? "El DNI tiene que tener entre 7 y 9 números." : "",
      ),
    ].every(Boolean);
    errorGeneral("firma-error", "");
    if (!ok) return enfocarPrimerError(formFirma);
    if (demasiadosEnvios()) return errorGeneral("firma-error", "Esperá un minuto antes de volver a intentar.");

    const boton = formFirma.querySelector(".boton");
    ocupado(boton, true, "Firmar");
    try {
      const r = await enviar("firma", { nombre, apellido, dni, sitio: formFirma.sitio.value, ms: Date.now() - cargada });
      if (!r?.ok) {
        if (r?.error === "dni") return marcar(formFirma.dni, "dni-error", "El DNI tiene que tener entre 7 y 9 números.") || formFirma.dni.focus();
        if (r?.error === "limite" || r?.error === "ocupado") return errorGeneral("firma-error", "Hay muchas firmas entrando a la vez. Esperá un minuto y probá de nuevo.");
        throw new Error("respuesta");
      }
      dniFirmado = dni;
      if (Number.isFinite(r.firmas)) mostrarContador(r.firmas);
      $("ya-firmo").hidden = r.estado !== "repetida" || r.reintentos > 0;
      formFirma.reset();
      irA("paso-encuesta");
    } catch {
      errorGeneral("firma-error", "No pudimos guardar tu firma, probá de nuevo.");
    } finally {
      ocupado(boton, false, "Firmar");
    }
  });

  // ---------------------------------------------------------------- paso 2: encuesta

  const formEncuesta = $("form-encuesta");
  limpiarAlEditar(formEncuesta);
  const fsCarrera = $("carreras").closest("fieldset");
  const fsMateria = $("materias").closest("fieldset");
  const fsTermina = formEncuesta.querySelector('[name="terminaCBC"]').closest("fieldset");

  formEncuesta.addEventListener("reset", () => {
    $("campo-otra").hidden = true;
    $("pregunta-termina").hidden = false;
  });
  const casillasMateria = [...formEncuesta.querySelectorAll('input[name="materia"]')];
  const materiasElegidas = () => casillasMateria.filter((c) => c.checked).map((c) => c.value);

  formEncuesta.addEventListener("change", (e) => {
    if (e.target.name !== "materia") return;
    // "solo firma" no se combina con materias: elegir una desmarca la otra
    if (e.target.checked) {
      for (const c of casillasMateria) if ((c.value === SOLO_FIRMA) !== (e.target.value === SOLO_FIRMA)) c.checked = false;
    }
    const elegidas = materiasElegidas();
    const otra = elegidas.includes("Otra");
    $("campo-otra").hidden = !otra;
    $("pregunta-termina").hidden = elegidas.includes(SOLO_FIRMA);
    if (otra && e.target.value === "Otra" && e.target.checked) $("materia-otra").focus();
    if (!otra) marcar($("materia-otra"), "materia-otra-error", "");
  });

  formEncuesta.addEventListener("submit", async (e) => {
    e.preventDefault();
    const carrera = formEncuesta.carrera.value;
    const materias = materiasElegidas();
    const conOtra = materias.includes("Otra");
    const materiaOtra = limpiarTexto($("materia-otra").value);
    const terminaCBC = formEncuesta.terminaCBC.value;
    const telCrudo = formEncuesta.telefono.value.trim();
    const telefono = normalizarTelefono(telCrudo);
    const mail = formEncuesta.mail.value.trim();
    const soloFirma = materias.includes(SOLO_FIRMA); // no cursa: no se le pregunta si termina el CBC
    const ok = [
      marcar(fsCarrera, "carrera-error", carrera ? "" : "Elegí tu carrera."),
      marcar(fsMateria, "materia-error", materias.length ? "" : "Elegí al menos una materia, o la última opción."),
      marcar($("materia-otra"), "materia-otra-error", conOtra && !materiaOtra ? "Contanos qué materia." : ""),
      marcar(fsTermina, "termina-error", soloFirma || terminaCBC ? "" : "Elegí una opción."),
      marcar(
        formEncuesta.telefono,
        "telefono-error",
        !telCrudo ? "Escribí tu teléfono." : !telefono ? "Revisá el número: tiene que ser un celular con código de área, por ejemplo 11 2345 6789." : "",
      ),
      marcar(formEncuesta.mail, "mail-error", !mail ? "Escribí tu mail." : !mailValido(mail) ? "Revisá el mail: tiene que ser como nombre@ejemplo.com." : ""),
    ].every(Boolean);
    errorGeneral("encuesta-error", "");
    if (!ok) return enfocarPrimerError(formEncuesta);
    if (!dniFirmado) return irA("paso-firma");
    if (demasiadosEnvios()) return errorGeneral("encuesta-error", "Esperá un minuto antes de volver a intentar.");

    const boton = formEncuesta.querySelector(".boton");
    ocupado(boton, true, "Enviar");
    try {
      const r = await enviar("encuesta", {
        dni: dniFirmado,
        carrera,
        materias,
        materia: materias[0], // para la versión anterior del script, que recibía una sola
        materiaOtra: conOtra ? materiaOtra : "",
        terminaCBC: soloFirma ? "" : terminaCBC,
        telefono,
        mail,
        sitio: formEncuesta.sitio.value,
        ms: Date.now() - cargada,
      });
      if (!r?.ok) {
        if (r?.error === "limite" || r?.error === "ocupado") return errorGeneral("encuesta-error", "Hay muchas respuestas entrando a la vez. Esperá un minuto y probá de nuevo.");
        if (r?.campo === "carrera") return marcar(fsCarrera, "carrera-error", "Elegí tu carrera.") || fsCarrera.querySelector("input").focus();
        if (r?.campo === "telefono") return marcar(formEncuesta.telefono, "telefono-error", "Revisá el número de teléfono.") || formEncuesta.telefono.focus();
        if (r?.campo === "mail") return marcar(formEncuesta.mail, "mail-error", "Revisá el mail.") || formEncuesta.mail.focus();
        throw new Error("respuesta");
      }
      dniFirmado = null;
      formEncuesta.reset();
      irA("paso-final");
    } catch {
      errorGeneral("encuesta-error", "No pudimos guardar tus respuestas, probá de nuevo.");
    } finally {
      ocupado(boton, false, "Enviar");
    }
  });

  // ---------------------------------------------------------------- compartir

  const link = location.href.split(/[?#]/)[0];
  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const area = Object.assign(document.createElement("textarea"), { value: texto });
      area.style.cssText = "position:fixed;opacity:0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  }
  $("compartir").addEventListener("click", async () => {
    const aviso = $("compartir-aviso");
    aviso.textContent = "";
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: document.title, text: C.textoCompartir ?? "", url: link });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    await copiar(link);
    aviso.textContent = "Link copiado";
    setTimeout(() => (aviso.textContent = ""), 4000);
  });
})();
