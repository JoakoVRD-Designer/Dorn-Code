"use strict";

const LETTERS = ["A", "B", "C", "D", "E"];
const STORAGE_KEY = "dorn:education:progress:v2";
const PAES = window.DORN_PAES_2026 || { exams: [] };

const COURSES = [
  { id: "paes-m1", title: "PAES Matemática M1", area: "PAES", status: "Funcional", level: "Media", summary: "Lecciones, práctica guiada, simulacro original y corrector oficial 2026." },
  { id: "paes-m2", title: "PAES Matemática M2", area: "PAES", status: "Corrector disponible", level: "Media-alta", summary: "Clavijero y conversión 2026 integrados. Banco didáctico propio en ampliación." },
  { id: "paes-lectora", title: "PAES Competencia Lectora", area: "PAES", status: "Corrector disponible", level: "Media", summary: "Corrección oficial 2026 y ruta de comprensión en preparación." },
  { id: "paes-ciencias", title: "PAES Ciencias", area: "PAES", status: "Corrector disponible", level: "Media-alta", summary: "Biología, Física, Química y Técnico Profesional con clavijeros 2026." },
  { id: "paes-historia", title: "PAES Historia", area: "PAES", status: "Corrector disponible", level: "Media", summary: "Corrector 2026; contenidos y habilidades en ampliación." },
  { id: "autocad", title: "AutoCAD · Fundamentos", area: "Diseño técnico", status: "Ruta base", level: "Inicial", summary: "Coordenadas, capas, referencias, bloques, cotas y flujo seguro de planos." },
  { id: "solidworks", title: "SOLIDWORKS · Fundamentos", area: "Ingeniería", status: "Ruta base", level: "Inicial", summary: "Croquis, relaciones, operaciones, ensamblajes, planos y buenas prácticas." },
  { id: "cad-workflow", title: "Flujo CAD interoperable", area: "Ingeniería", status: "Ruta base", level: "Intermedio", summary: "STEP, STL, DXF, revisión geométrica, versiones y entregables verificables." },
  { id: "visual-editing", title: "Edición visual profesional", area: "Diseño", status: "Fuente pendiente", level: "Inicial", summary: "La ruta se activará al recibir y validar el PDF de referencia solicitado." }
];

const GLOSSARY = {
  factor: "Número por el que se multiplica una cantidad.",
  ecuación: "Igualdad matemática con uno o más valores desconocidos.",
  escala: "Relación proporcional entre una representación y el tamaño real.",
  mediana: "Valor central de un conjunto ordenado.",
  equiprobable: "Resultados con la misma probabilidad de ocurrir."
};

const TOPICS = {
  numbers: {
    label: "Números y proporcionalidad",
    title: "Razones, porcentajes y cambios sucesivos",
    body: "Un porcentaje siempre se aplica sobre una base. Cuando hay dos cambios sucesivos, no se suman directamente: cada cambio modifica la base del siguiente.",
    steps: [
      "Transforma el porcentaje en factor: aumentar 15% equivale a multiplicar por 1,15.",
      "Aplica los factores en orden.",
      "Compara el resultado con la cantidad inicial y verifica la unidad."
    ],
    example: "Si $40.000 aumenta 20% y luego baja 20%, queda en $38.400: 40.000 × 1,2 × 0,8 = 38.400."
  },
  algebra: {
    label: "Álgebra y funciones",
    title: "Modelar una situación con una ecuación",
    body: "Modelar significa convertir relaciones del enunciado en expresiones. Define primero la incógnita, conserva las unidades y comprueba la solución en el problema original.",
    steps: [
      "Declara qué representa x.",
      "Traduce cada relación sin resolver todavía.",
      "Despeja x y reemplaza el valor para comprobar."
    ],
    example: "Si tres cuadernos iguales y un lápiz de $700 cuestan $5.200: 3x + 700 = 5.200, por lo tanto x = 1.500."
  },
  geometry: {
    label: "Geometría",
    title: "Escala, perímetro y área",
    body: "Una escala afecta longitudes, pero el área cambia con el cuadrado del factor. Duplicar cada lado cuadruplica el área.",
    steps: [
      "Identifica si la pregunta pide longitud, perímetro o área.",
      "Obtén el factor lineal de escala.",
      "Para áreas usa el factor al cuadrado."
    ],
    example: "Un plano 1:100 representa 1 cm como 100 cm reales. Una habitación de 4 cm × 3 cm mide 4 m × 3 m y tiene 12 m²."
  },
  data: {
    label: "Probabilidad y datos",
    title: "Interpretar promedios y probabilidades",
    body: "La media usa todos los valores, mientras la mediana depende de la posición. Una probabilidad simple es casos favorables divididos por casos posibles cuando todos son equiprobables.",
    steps: [
      "Ordena los datos antes de buscar la mediana.",
      "Revisa si valores extremos afectan la media.",
      "En probabilidad, cuenta sólo resultados realmente posibles."
    ],
    example: "En 2, 3, 3, 4, 18 la mediana es 3, pero la media es 6; el valor 18 produce la diferencia."
  }
};

const QUESTIONS = [
  { id: "n1", topic: "numbers", prompt: "Un producto de $50.000 aumenta 10% y luego recibe un descuento de 10%. ¿Cuál es su precio final?", options: ["$45.000", "$49.500", "$50.000", "$50.500", "$55.000"], answer: 1, explanation: "Se aplican factores sucesivos: 50.000 × 1,10 × 0,90 = 49.500." },
  { id: "n2", topic: "numbers", prompt: "En una mezcla, la razón entre concentrado y agua es 2:5. Si se usan 20 litros de agua, ¿cuánto concentrado se necesita?", options: ["4 L", "6 L", "8 L", "10 L", "12 L"], answer: 2, explanation: "20 L representan 5 partes, así que cada parte vale 4 L. El concentrado usa 2 partes: 8 L." },
  { id: "n3", topic: "numbers", prompt: "¿Qué fracción representa el 37,5% de una cantidad?", options: ["3/10", "3/8", "2/5", "5/8", "7/20"], answer: 1, explanation: "37,5% = 0,375 = 375/1000 = 3/8." },
  { id: "a1", topic: "algebra", prompt: "Tres números pares consecutivos suman 42. ¿Cuál es el mayor?", options: ["12", "14", "16", "18", "20"], answer: 2, explanation: "Si son x, x+2 y x+4: 3x+6=42, entonces x=12 y el mayor es 16." },
  { id: "a2", topic: "algebra", prompt: "Una tarifa se modela por C(x)=2.500+800x, donde x es la cantidad de kilómetros. ¿Qué representa 2.500?", options: ["Costo por kilómetro", "Distancia máxima", "Cargo fijo", "Descuento total", "Costo de 800 km"], answer: 2, explanation: "Es el valor de C(0), por lo que corresponde al cargo fijo antes de recorrer kilómetros." },
  { id: "a3", topic: "algebra", prompt: "Si 2(x−3)=x+5, ¿cuál es el valor de x?", options: ["5", "8", "9", "11", "13"], answer: 3, explanation: "2x−6=x+5; al restar x y sumar 6 se obtiene x=11." },
  { id: "g1", topic: "geometry", prompt: "Un rectángulo de 6 cm por 4 cm se amplía con factor 1,5. ¿Cuál es el área de la figura ampliada?", options: ["36 cm²", "42 cm²", "48 cm²", "54 cm²", "60 cm²"], answer: 3, explanation: "El área original es 24 cm² y el factor de área es 1,5²=2,25. 24×2,25=54." },
  { id: "g2", topic: "geometry", prompt: "En un plano a escala 1:200, una pared mide 3,5 cm. ¿Cuánto mide en la realidad?", options: ["1,75 m", "3,5 m", "5 m", "7 m", "70 m"], answer: 3, explanation: "3,5 cm × 200 = 700 cm = 7 m." },
  { id: "g3", topic: "geometry", prompt: "Un triángulo rectángulo tiene catetos de 6 y 8. ¿Cuánto mide la hipotenusa?", options: ["9", "10", "12", "14", "15"], answer: 1, explanation: "Por Pitágoras: √(6²+8²)=√100=10." },
  { id: "d1", topic: "data", prompt: "Las notas son 3, 4, 4, 5 y 9. ¿Cuál es la mediana?", options: ["4", "4,5", "5", "5,2", "9"], answer: 0, explanation: "Los datos ya están ordenados y el valor central, tercero de cinco, es 4." },
  { id: "d2", topic: "data", prompt: "Una bolsa contiene 3 fichas rojas, 2 azules y 5 verdes. ¿Cuál es la probabilidad de extraer una azul?", options: ["1/10", "1/5", "1/4", "2/5", "1/2"], answer: 1, explanation: "Hay 10 fichas en total y 2 son azules: 2/10=1/5." },
  { id: "d3", topic: "data", prompt: "El promedio de cuatro números es 12. Si tres de ellos son 8, 10 y 14, ¿cuál es el cuarto?", options: ["12", "14", "16", "18", "20"], answer: 2, explanation: "La suma total debe ser 4×12=48. Los tres conocidos suman 32, por lo que falta 16." }
];

let state = readState();
let practice = { questions: [], index: 0, selected: null, checked: false };
let exam = { questions: [], index: 0, answers: [], startedAt: 0 };
let voiceListening = false;

function readState() {
  try {
    return { answered: [], lessons: [], profile: null, activeCourse: "paes-m1", officialAttempts: [], ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { answered: [], lessons: [], profile: null, activeCourse: "paes-m1", officialAttempts: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  refreshSummary();
}

function setStatus(text) {
  document.querySelector("[data-status]").textContent = text;
}

function tutorReply(rawQuestion) {
  const question = String(rawQuestion || "").trim();
  const normalized = question.toLocaleLowerCase("es");
  if (!question) return { local: true, text: "Escribe o dicta una pregunta para comenzar." };
  const glossary = Object.entries(GLOSSARY).find(([term]) => normalized.includes(term));
  if (glossary) return { local: true, text: `${glossary[0][0].toUpperCase()}${glossary[0].slice(1)}: ${glossary[1]} Puedo mostrarte un ejemplo dentro de la lección activa.` };
  const topicEntry = Object.entries(TOPICS).find(([, topic]) => normalized.includes(topic.label.toLocaleLowerCase("es")) || normalized.includes(topic.title.toLocaleLowerCase("es").split(" ")[0]));
  if (topicEntry) {
    const topic = topicEntry[1];
    return { local: true, text: `${topic.title}. ${topic.body} Método: ${topic.steps.join(" ")} Ejemplo: ${topic.example}` };
  }
  if (/porcentaje|por ciento|aumento|descuento/.test(normalized)) {
    const topic = TOPICS.numbers;
    return { local: true, text: `${topic.body} ${topic.steps.join(" ")} ${topic.example}` };
  }
  if (/ecuaci[oó]n|inc[oó]gnita|[aá]lgebra/.test(normalized)) {
    const topic = TOPICS.algebra;
    return { local: true, text: `${topic.body} ${topic.steps.join(" ")} ${topic.example}` };
  }
  return { local: false, text: "Esta pregunta necesita razonamiento abierto. La enviaré a DORN AI usando únicamente una IA que hayas configurado." };
}

function showTutorResponse(text, stateName = "ready") {
  const output = document.querySelector("[data-tutor-response]");
  output.hidden = false;
  output.dataset.state = stateName;
  output.textContent = text;
  document.querySelector("[data-voice-indicator]").dataset.state = stateName;
}

async function speakTutor(text) {
  try {
    await window.dornProduct.voice.speak(text, { locale: "es-CL", rate: 0 });
    setStatus("DORN Education está leyendo la explicación.");
  } catch (error) {
    showTutorResponse(error.message || String(error), "error");
  }
}

async function askTutor() {
  const input = document.querySelector("[data-tutor-question]");
  const question = input.value.trim();
  const reply = tutorReply(question);
  showTutorResponse(reply.text, reply.local ? "ready" : "handoff");
  if (reply.local) {
    await speakTutor(reply.text);
    return;
  }
  await window.dornProduct.sendToDorn({
    content: `DORN Education solicita tutoría. Curso activo: ${activeCourse().title}. Pregunta del estudiante: ${question}. Enseña paso a paso, define cualquier palabra técnica, comprueba comprensión y luego propone un ejercicio nuevo. No copies preguntas oficiales.`
  });
  setStatus("Pregunta enviada a DORN AI para continuar la tutoría.");
}

async function toggleTutorListening() {
  const button = document.querySelector("[data-tutor-listen]");
  try {
    if (voiceListening) {
      await window.dornProduct.voice.stopRecognition();
      voiceListening = false;
      button.textContent = "Escuchar";
      showTutorResponse("Dictado detenido.", "idle");
      return;
    }
    const result = await window.dornProduct.voice.startRecognition("es-CL");
    voiceListening = true;
    button.textContent = "Detener escucha";
    showTutorResponse(`Escuchando con ${result.locale || "el motor disponible"}…`, "listening");
  } catch (error) {
    voiceListening = false;
    button.textContent = "Escuchar";
    showTutorResponse(error.message || String(error), "error");
  }
}

function showPage(id) {
  document.querySelectorAll("[data-page]").forEach((page) => page.classList.toggle("active", page.dataset.page === id));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
  if (id === "progress") renderProgress();
  if (id === "courses") renderCourses();
  if (id === "official") renderOfficialExam();
}

function activeCourse() {
  return COURSES.find((course) => course.id === state.activeCourse) || COURSES[0];
}

function adaptiveRecommendation() {
  const profile = state.profile || { confidence: "low", minutes: "30", support: "examples" };
  const correct = state.answered.filter((entry) => entry.correct).length;
  const accuracy = state.answered.length ? correct / state.answered.length : 0;
  const focus = accuracy < .6 ? "ejemplos resueltos y práctica guiada" : accuracy < .85 ? "recuperación activa y ejercicios intercalados" : "problemas de transferencia y repasos espaciados";
  return {
    focus,
    session: Number(profile.minutes || 30),
    message: state.answered.length
      ? `Tu precisión actual es ${Math.round(accuracy * 100)}%. La siguiente sesión priorizará ${focus}.`
      : `Comenzaremos con ${focus}; DORN reajustará la ruta usando tus resultados, no una etiqueta fija.`
  };
}

function renderAdaptivePlan() {
  const plan = adaptiveRecommendation();
  const course = activeCourse();
  document.querySelector("[data-course-title]").textContent = course.title;
  document.querySelector("[data-adaptive-plan]").innerHTML = `
    <span class="eyebrow">RUTA ADAPTATIVA LOCAL</span>
    <h3>${course.title}</h3>
    <p>${plan.message}</p>
    <div><strong>${plan.session} min</strong><span>por sesión</span><strong>${state.answered.length}</strong><span>respuestas observadas</span></div>`;
}

function renderCourses() {
  const query = (document.querySelector("[data-course-search]").value || "").trim().toLocaleLowerCase("es");
  const courses = COURSES.filter((course) => [course.title, course.area, course.status, course.summary].join(" ").toLocaleLowerCase("es").includes(query));
  document.querySelector("[data-course-grid]").innerHTML = courses.map((course) => `
    <article class="course-card ${course.id === state.activeCourse ? "active" : ""}">
      <div><span>${course.area}</span><em>${course.status}</em></div>
      <h3>${course.title}</h3><p>${course.summary}</p>
      <small>Nivel ${course.level}</small>
      <button data-select-course="${course.id}" ${course.status === "Fuente pendiente" ? "disabled" : ""}>${course.id === state.activeCourse ? "Ruta activa" : "Elegir ruta"}</button>
    </article>`).join("") || '<p class="empty-state">No hay cursos que coincidan con la búsqueda.</p>';
  document.querySelectorAll("[data-select-course]").forEach((button) => button.onclick = () => {
    state.activeCourse = button.dataset.selectCourse;
    saveState();
    renderCourses();
    renderAdaptivePlan();
    setStatus(`Ruta activa · ${activeCourse().title}`);
  });
}

function refreshSummary() {
  const correct = state.answered.filter((entry) => entry.correct).length;
  const mastery = state.answered.length ? Math.round(correct / state.answered.length * 100) : 0;
  document.querySelector("[data-mastery]").textContent = `${mastery}%`;
  document.querySelector("[data-bank-size]").textContent = String(QUESTIONS.length);
}

function renderLesson(topicId = document.querySelector("[data-topic]").value || "numbers") {
  const topic = TOPICS[topicId];
  state.lessons = [...new Set([...state.lessons, topicId])];
  saveState();
  document.querySelector("[data-lesson]").innerHTML = `
    <span class="eyebrow">${topic.label.toUpperCase()}</span>
    <h3>${topic.title}</h3>
    <p>${topic.body}</p>
    <ol>${topic.steps.map((step) => `<li>${step}</li>`).join("")}</ol>
    <div class="lesson-example"><strong>EJEMPLO RESUELTO</strong>${topic.example}</div>
    <p><strong>Comprobación:</strong> antes de elegir una alternativa, estima el orden de magnitud y revisa si la unidad coincide con lo pedido.</p>`;
  setStatus(`Lección abierta · ${topic.label}`);
}

function questionMarkup(question, selected, checked, number, total) {
  const glossaryTerms = Object.entries(GLOSSARY).filter(([term]) => question.prompt.toLocaleLowerCase("es").includes(term));
  return `<article class="question-card">
    <div class="question-meta"><span>PREGUNTA ${number} DE ${total}</span><span>${TOPICS[question.topic].label.toUpperCase()}</span></div>
    <h3>${question.prompt}</h3>
    <div class="answers">${question.options.map((option, index) => {
      const resultClass = checked ? index === question.answer ? "correct" : selected === index ? "incorrect" : "" : selected === index ? "selected" : "";
      const resultIcon = checked && index === question.answer ? '<i aria-label="Correcta">✓</i>' : checked && selected === index && selected !== question.answer ? '<i aria-label="Incorrecta">×</i>' : "";
      return `<button class="answer ${resultClass}" data-answer="${index}" ${checked ? "disabled" : ""}><b>${LETTERS[index]}</b><span>${option}</span>${resultIcon}</button>`;
    }).join("")}</div>
    ${checked ? `<div class="explanation"><strong>${selected === question.answer ? "Correcto. ✓" : `Tu respuesta es incorrecta. × La alternativa correcta es ${LETTERS[question.answer]}.`}</strong> <p>${question.explanation}</p>${glossaryTerms.length ? `<dl>${glossaryTerms.map(([term, meaning]) => `<div><dt>${term}</dt><dd>${meaning}</dd></div>`).join("")}</dl>` : ""}<small>La explicación aparece siempre, incluso cuando aciertas, para comprobar el razonamiento antes de continuar.</small></div>` : ""}
    <div class="question-actions"><button data-question-back ${number <= 1 ? "disabled" : ""}>Anterior</button><button class="primary" data-question-next>${checked ? number === total ? "Finalizar" : "Siguiente" : "Comprobar"}</button></div>
  </article>`;
}

function startPractice(topicId) {
  const topicQuestions = QUESTIONS.filter((question) => question.topic === topicId);
  practice = { questions: topicQuestions, index: 0, selected: null, checked: false };
  showPage("practice");
  renderPractice();
}

function renderPractice() {
  const question = practice.questions[practice.index];
  const shell = document.querySelector("[data-practice-shell]");
  document.querySelector("[data-question-count]").textContent = `${practice.questions.length} ejercicios guiados`;
  shell.innerHTML = questionMarkup(question, practice.selected, practice.checked, practice.index + 1, practice.questions.length);
  shell.querySelectorAll("[data-answer]").forEach((button) => button.onclick = () => {
    practice.selected = Number(button.dataset.answer);
    renderPractice();
  });
  shell.querySelector("[data-question-back]").onclick = () => {
    practice.index = Math.max(0, practice.index - 1);
    practice.selected = null;
    practice.checked = false;
    renderPractice();
  };
  shell.querySelector("[data-question-next]").onclick = () => {
    if (!practice.checked) {
      if (practice.selected === null) return setStatus("Elige una alternativa A–E antes de comprobar.");
      practice.checked = true;
      state.answered.push({ id: question.id, topic: question.topic, correct: practice.selected === question.answer, at: new Date().toISOString(), mode: "practice" });
      saveState();
      renderPractice();
      return;
    }
    if (practice.index < practice.questions.length - 1) {
      practice.index += 1;
      practice.selected = null;
      practice.checked = false;
      renderPractice();
    } else {
      showPage("progress");
      setStatus("Práctica terminada; revisa tu progreso.");
    }
  };
}

function startExam() {
  exam = { questions: [...QUESTIONS].sort(() => Math.random() - .5).slice(0, 8), index: 0, answers: Array(8).fill(null), startedAt: Date.now() };
  document.querySelector("[data-exam-intro]").hidden = true;
  document.querySelector("[data-exam-result]").hidden = true;
  document.querySelector("[data-exam-shell]").hidden = false;
  renderExam();
}

function renderExam() {
  const question = exam.questions[exam.index];
  const shell = document.querySelector("[data-exam-shell]");
  shell.innerHTML = questionMarkup(question, exam.answers[exam.index], false, exam.index + 1, exam.questions.length);
  shell.querySelectorAll("[data-answer]").forEach((button) => button.onclick = () => {
    exam.answers[exam.index] = Number(button.dataset.answer);
    renderExam();
  });
  shell.querySelector("[data-question-back]").onclick = () => { exam.index = Math.max(0, exam.index - 1); renderExam(); };
  const next = shell.querySelector("[data-question-next]");
  next.textContent = exam.index === exam.questions.length - 1 ? "Entregar simulacro" : "Guardar y seguir";
  next.onclick = () => {
    if (exam.answers[exam.index] === null) return setStatus("Selecciona una alternativa antes de continuar.");
    if (exam.index < exam.questions.length - 1) {
      exam.index += 1;
      renderExam();
    } else {
      finishExam();
    }
  };
  const minutes = Math.floor((Date.now() - exam.startedAt) / 60000);
  document.querySelector("[data-exam-timer]").textContent = `${minutes} min · ${exam.answers.filter((value) => value !== null).length}/${exam.questions.length} respondidas`;
}

function finishExam() {
  const correct = exam.questions.reduce((total, question, index) => total + (exam.answers[index] === question.answer ? 1 : 0), 0);
  exam.questions.forEach((question, index) => state.answered.push({ id: question.id, topic: question.topic, correct: exam.answers[index] === question.answer, at: new Date().toISOString(), mode: "exam" }));
  saveState();
  const result = document.querySelector("[data-exam-result]");
  result.hidden = false;
  document.querySelector("[data-exam-shell]").hidden = true;
  result.innerHTML = `<h3>${correct} de ${exam.questions.length} correctas</h3>
    <p>Resultado local: ${Math.round(correct / exam.questions.length * 100)}%. Revisa primero las habilidades con error y vuelve a practicar.</p>
    <ol>${exam.questions.map((question, index) => `<li><strong>${LETTERS[exam.answers[index]] || "—"} → ${LETTERS[question.answer]}</strong> · ${question.explanation}</li>`).join("")}</ol>
    <div class="hero-actions"><button class="primary" data-send-result>Analizar resultado con DORN AI</button><button data-retry>Nuevo simulacro</button></div>`;
  result.querySelector("[data-retry]").onclick = startExam;
  result.querySelector("[data-send-result]").onclick = async () => {
    await window.dornProduct.sendToDorn({
      content: `Actúa como tutor de DORN Education. En un simulacro original estilo PAES Matemática M1 obtuve ${correct} de ${exam.questions.length}. Mis resultados por habilidad fueron: ${JSON.stringify(exam.questions.map((question, index) => ({ topic: TOPICS[question.topic].label, correct: exam.answers[index] === question.answer })))}. Crea un plan breve, enséñame primero el contenido más débil y después propón ejercicios nuevos; no copies preguntas oficiales.`
    });
    setStatus("Resultado enviado a DORN AI.");
  };
}

function selectedOfficialExam() {
  const id = document.querySelector("[data-official-exam]").value;
  return PAES.exams.find((item) => item.id === id) || PAES.exams[0];
}

function renderOfficialExam() {
  const select = document.querySelector("[data-official-exam]");
  if (!select.options.length) {
    select.innerHTML = PAES.exams.map((item) => `<option value="${item.id}">${item.title} · forma ${item.form}</option>`).join("");
  }
  const examData = selectedOfficialExam();
  const meta = document.querySelector("[data-official-meta]");
  const grid = document.querySelector("[data-official-grid]");
  const result = document.querySelector("[data-official-result]");
  result.hidden = true;
  if (!examData) {
    meta.innerHTML = "<strong>Datos no disponibles</strong><p>No se cargó el paquete de clavijeros.</p>";
    grid.innerHTML = "";
    return;
  }
  meta.innerHTML = `<div><small>PRUEBA</small><strong>${examData.title}</strong></div><div><small>FORMA</small><strong>${examData.form}</strong></div><div><small>PREGUNTAS</small><strong>${examData.questionCount}</strong></div><div><small>PUNTUADAS</small><strong>${examData.scoredQuestions}</strong></div><div><small>FUENTE</small><strong>${examData.source.organization}</strong></div>`;
  grid.innerHTML = Array.from({ length: examData.questionCount }, (_, index) => {
    const number = index + 1;
    const pilot = examData.excludedQuestions.includes(number);
    const eliminated = examData.eliminatedQuestions.includes(number);
    const note = eliminated ? "Eliminada" : pilot ? "Piloto" : "";
    return `<label class="official-answer ${pilot ? "pilot" : ""} ${eliminated ? "eliminated" : ""}"><span>${number}</span><select data-official-answer="${number}" ${eliminated ? "disabled" : ""}><option value="">—</option>${LETTERS.map((letter) => `<option value="${letter}">${letter}</option>`).join("")}</select><small>${note}</small></label>`;
  }).join("");
  setStatus(`Corrector cargado · ${examData.title} · forma ${examData.form}`);
}

function calculateOfficialResult() {
  const examData = selectedOfficialExam();
  if (!examData) return;
  const answers = {};
  document.querySelectorAll("[data-official-answer]").forEach((select) => { answers[select.dataset.officialAnswer] = select.value; });
  let correct = 0;
  let wrong = 0;
  let omitted = 0;
  const details = [];
  Object.entries(examData.answerKeys).forEach(([numberText, key]) => {
    const number = Number(numberText);
    if (examData.excludedQuestions.includes(number) || examData.eliminatedQuestions.includes(number)) return;
    const answer = answers[number] || "";
    if (!answer) omitted += 1;
    else if (answer === key) correct += 1;
    else wrong += 1;
    if (answer && answer !== key) details.push(`${number}: ${answer} → ${key}`);
  });
  const score = examData.scoreTable[String(correct)] ?? "Sin tabla";
  state.officialAttempts.push({ examId: examData.id, form: examData.form, correct, wrong, omitted, score, at: new Date().toISOString() });
  saveState();
  const result = document.querySelector("[data-official-result]");
  result.hidden = false;
  result.innerHTML = `<span class="eyebrow">RESULTADO SEGÚN CLAVIJERO</span><h3>${score} puntos</h3><div class="result-metrics"><strong class="good">✓ ${correct} correctas</strong><strong class="bad">× ${wrong} incorrectas</strong><strong>${omitted} omitidas</strong></div><p>Las preguntas piloto y eliminadas no se contabilizan. El puntaje se tomó de la tabla incluida en el PDF de la forma ${examData.form}.</p>${details.length ? `<details><summary>Ver correcciones (${details.length})</summary><p>${details.join(" · ")}</p></details>` : "<p>No hay respuestas incorrectas registradas.</p>"}`;
  result.scrollIntoView({ behavior: "smooth", block: "center" });
  setStatus(`Resultado calculado · ${correct}/${examData.scoredQuestions} · ${score} puntos`);
}

function openDiagnostic() {
  const dialog = document.querySelector("[data-diagnostic]");
  dialog.hidden = false;
  const form = document.querySelector("[data-diagnostic-form]");
  if (state.profile) {
    form.elements.goal.value = state.profile.goal || "paes-m1";
    form.elements.confidence.value = state.profile.confidence || "low";
    form.elements.minutes.value = state.profile.minutes || "30";
    const support = form.querySelector(`[name="support"][value="${state.profile.support || "examples"}"]`);
    if (support) support.checked = true;
  }
}

function closeDiagnostic() {
  document.querySelector("[data-diagnostic]").hidden = true;
}

function renderProgress() {
  const board = document.querySelector("[data-progress-board]");
  board.innerHTML = Object.entries(TOPICS).map(([id, topic]) => {
    const entries = state.answered.filter((entry) => entry.topic === id);
    const correct = entries.filter((entry) => entry.correct).length;
    const percent = entries.length ? Math.round(correct / entries.length * 100) : 0;
    return `<article><strong>${topic.label}</strong><span>${entries.length} respuestas · ${percent}% correctas · ${state.lessons.includes(id) ? "lección revisada" : "lección pendiente"}</span></article>`;
  }).join("") + `<article><strong>Corrector oficial 2026</strong><span>${state.officialAttempts.length} intentos guardados localmente.</span></article><article><strong>Ruta adaptativa</strong><span>${state.profile ? `${activeCourse().title} · sesiones de ${state.profile.minutes} min` : "Diagnóstico pendiente"}</span></article>`;
}

const topicSelect = document.querySelector("[data-topic]");
topicSelect.innerHTML = Object.entries(TOPICS).map(([id, topic]) => `<option value="${id}">${topic.label}</option>`).join("");
topicSelect.onchange = () => renderLesson(topicSelect.value);
document.querySelectorAll("[data-window]").forEach((button) => button.onclick = () => window.dornProduct.windowAction(button.dataset.window));
document.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => showPage(button.dataset.view));
document.querySelector("[data-start-learning]").onclick = () => { showPage("learn"); renderLesson("numbers"); };
document.querySelector("[data-open-courses]").onclick = () => showPage("courses");
document.querySelector("[data-open-official]").onclick = () => showPage("official");
document.querySelector("[data-course-search]").oninput = renderCourses;
document.querySelector("[data-lesson-practice]").onclick = () => startPractice(topicSelect.value);
document.querySelector("[data-exam-lesson]").onclick = () => { showPage("learn"); renderLesson("numbers"); };
document.querySelector("[data-exam-start]").onclick = startExam;
document.querySelector("[data-official-exam]").onchange = renderOfficialExam;
document.querySelector("[data-official-calculate]").onclick = calculateOfficialResult;
document.querySelector("[data-official-clear]").onclick = () => {
  document.querySelectorAll("[data-official-answer]").forEach((select) => { select.value = ""; });
  document.querySelector("[data-official-result]").hidden = true;
  setStatus("Respuestas del corrector limpiadas.");
};
document.querySelector("[data-repeat-diagnostic]").onclick = openDiagnostic;
document.querySelector("[data-diagnostic-form]").onsubmit = (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.profile = {
    goal: String(data.get("goal")),
    confidence: String(data.get("confidence")),
    minutes: String(data.get("minutes")),
    support: String(data.get("support"))
  };
  state.activeCourse = state.profile.goal;
  saveState();
  closeDiagnostic();
  renderAdaptivePlan();
  renderCourses();
  setStatus("Ruta adaptativa creada y guardada localmente.");
};
document.querySelector("[data-reset-progress]").onclick = () => {
  if (!confirm("¿Restablecer el progreso guardado en este equipo?")) return;
  state = { answered: [], lessons: [], profile: null, activeCourse: "paes-m1", officialAttempts: [] };
  saveState();
  renderProgress();
  setStatus("Progreso restablecido.");
};
document.querySelector("[data-tutor-listen]").onclick = toggleTutorListening;
document.querySelector("[data-tutor-ask]").onclick = askTutor;
document.querySelector("[data-tutor-read]").onclick = () => {
  const topic = TOPICS[topicSelect.value || "numbers"];
  void speakTutor(`${topic.title}. ${topic.body} ${topic.steps.join(" ")} Ejemplo resuelto. ${topic.example}`);
};
document.querySelector("[data-tutor-transcribe]").onclick = async () => {
  try {
    const result = await window.dornProduct.voice.transcribeAudio("es-CL");
    if (!result || result.canceled) return;
    document.querySelector("[data-tutor-question]").value = result.text || "";
    showTutorResponse(`Audio transcrito con ${result.segments?.length || 0} segmento(s).`, "ready");
  } catch (error) {
    showTutorResponse(error.message || String(error), "error");
  }
};
document.querySelector("[data-tutor-diagnose]").onclick = async () => {
  try {
    const result = await window.dornProduct.voice.diagnostics();
    const text = result.ready
      ? `Voz lista: ${result.recognizers.length} reconocedor(es) y ${result.voices.length} voz(es) instalada(s).`
      : `${result.message || "Falta instalar un paquete de voz y reconocimiento en el sistema."}`;
    showTutorResponse(text, result.ready ? "ready" : "error");
  } catch (error) {
    showTutorResponse(error.message || String(error), "error");
  }
};
window.dornProduct.voice.onRecognition((event) => {
  if (!event) return;
  if (event.type === "text" && event.text) {
    const input = document.querySelector("[data-tutor-question]");
    input.value = `${input.value.trim()} ${event.text}`.trim();
    showTutorResponse(`Entendido: ${event.text}`, "listening");
  }
  if (event.type === "stopped" || event.type === "error") {
    voiceListening = false;
    document.querySelector("[data-tutor-listen]").textContent = "Escuchar";
    if (event.type === "error") showTutorResponse(event.message || "El dictado se detuvo.", "error");
  }
});

refreshSummary();
renderLesson("numbers");
renderCourses();
renderOfficialExam();
renderAdaptivePlan();
showPage("home");
if (!state.profile) openDiagnostic();
