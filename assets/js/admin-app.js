function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const API_BASE_OVERRIDE_KEY = "ak_api_base_override";
function resetApiOverrideIfRequested() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("resetApi") !== "1") return;
    localStorage.removeItem(API_BASE_OVERRIDE_KEY);
    params.delete("resetApi");
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    history.replaceState(null, "", next);
  } catch (error) {}
}

resetApiOverrideIfRequested();

let API_ORIGIN = normalizeApiBase(localStorage.getItem(API_BASE_OVERRIDE_KEY) || window.AK_API_BASE);
let API_BASE = API_ORIGIN ? `${API_ORIGIN}/api` : "/api";
const ADMIN_TOKEN_KEY = "ak_admin_token";

let authToken = sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
let subjects = [];
let quizDatabase = {};
let productsList = [];
let categories = [];
let settings = { maintenanceMode: false, voiceReading: true, defaultTimer: 30 };
let editingQuestionId = null;
let editingProductId = null;
let pendingDelete = { type: null, id: null, subject: null };

function apiFetch(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  return fetch(url, {
    ...options,
    headers
  })
    .catch((error) => {
      if (!window.__ak_backend_prompted) {
        window.__ak_backend_prompted = true;
        const current = API_ORIGIN || "";
        const entered = window.prompt(
          "Backend is not reachable. Paste your Railway backend domain (example: https://xxxx.up.railway.app).",
          current
        );
        const normalized = normalizeApiBase(entered);
        if (normalized) {
          localStorage.setItem(API_BASE_OVERRIDE_KEY, normalized);
          window.location.reload();
          return new Promise(() => {});
        }
      }

      const backend = API_ORIGIN || "your backend domain";
      throw new Error(`Backend not reachable. Check Railway backend is running and backend URL is correct (${backend}).`);
    })
    .then(async (response) => {
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();

      if (!response.ok) {
        if (!window.__ak_backend_prompted) {
          const looksLikeHtml = typeof payload === "string" && /<html|<!doctype/i.test(payload);
          if (looksLikeHtml || response.status === 404) {
            window.__ak_backend_prompted = true;
            const current = API_ORIGIN || "";
            const entered = window.prompt(
              "Backend URL looks wrong. Paste your Railway backend domain (example: https://xxxx.up.railway.app).",
              current
            );
            const normalized = normalizeApiBase(entered);
            if (normalized) {
              localStorage.setItem(API_BASE_OVERRIDE_KEY, normalized);
              window.location.reload();
              return new Promise(() => {});
            }
          }
        }

        const message = typeof payload === "string" ? payload : payload.message || "Request failed.";
        const error = new Error(message);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      return payload;
    });
}

function showAlert(message, type = "success", autoHide = true) {
  const alertDiv = document.getElementById("alertMessage");
  if (!alertDiv) return;

  alertDiv.className = `alert alert-${type} show`;
  alertDiv.innerHTML = `<i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"}"></i> ${escapeHtml(message)}`;
  if (autoHide) {
    setTimeout(() => alertDiv.classList.remove("show"), 3000);
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (match) => {
    if (match === "&") return "&amp;";
    if (match === "<") return "&lt;";
    if (match === ">") return "&gt;";
    return "&quot;";
  });
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeClassLevel(value) {
  const trimmed = String(value || "").trim();
  return /^(6|7|8|9|10|11|12)$/.test(trimmed) ? trimmed : "";
}

function getSelectedSubject() {
  return document.getElementById("subjectSelect")?.value || subjects[0]?.key || "";
}

function getSelectedClassLevel() {
  const value = String(document.getElementById("classSelectAdmin")?.value || "").trim();
  return /^(6|7|8|9|10|11|12)$/.test(value) ? value : "";
}

function updateStats(payload) {
  document.getElementById("totalUsers").innerText = payload.stats.totalUsers.toLocaleString();
  const visitorsToday = document.getElementById("visitorsToday");
  if (visitorsToday) {
    visitorsToday.innerText = (payload.stats.visitorsToday || 0).toLocaleString();
  }
  const totalVisitors = document.getElementById("totalVisitors");
  if (totalVisitors) {
    totalVisitors.innerText = (payload.stats.totalVisitors || 0).toLocaleString();
  }
  document.getElementById("totalSubjects").innerText = payload.stats.totalSubjects;
  document.getElementById("totalQuestions").innerText = payload.stats.totalQuestions;
  document.getElementById("totalProducts").innerText = payload.stats.totalProducts;
  document.getElementById("totalQuizzes").innerText = payload.stats.totalQuizzesTaken.toLocaleString();
}

function refreshSubjectList() {
  const container = document.getElementById("subjectList");
  if (!container) return;

  if (!subjects.length) {
    container.innerHTML = '<p style="color: var(--text-gray);">No subjects yet.</p>';
    return;
  }

  container.innerHTML = subjects
    .map(
      (subject) => `
        <span class="subject-tag" style="background: linear-gradient(135deg, ${subject.color}, ${subject.color}dd);">
          <i class="fas ${subject.icon}"></i> ${escapeHtml(subject.name)}
          <i class="fas fa-times-circle remove-subject" onclick="removeSubject('${subject.key}')"></i>
        </span>
      `
    )
    .join("");
}

function refreshSubjectDropdown(selectedKey) {
  const select = document.getElementById("subjectSelect");
  if (!select) return;

  select.innerHTML = subjects
    .map((subject) => `<option value="${subject.key}">${escapeHtml(subject.name)}</option>`)
    .join("");

  if (selectedKey && subjects.find((subject) => subject.key === selectedKey)) {
    select.value = selectedKey;
  }
}

function refreshQuestionList() {
  const subject = getSelectedSubject();
  const selectedClassLevel = getSelectedClassLevel();
  const questionList = (quizDatabase[subject] || []).filter((question) => {
    if (!selectedClassLevel) return true;
    return String(question.classLevel || "") === selectedClassLevel;
  });
  const container = document.getElementById("questionList");
  if (!container) return;

  if (!questionList.length) {
    container.innerHTML = `<div style="text-align:center; padding:1rem; color: var(--text-gray);">${
      selectedClassLevel ? `No questions for Class ${escapeHtml(selectedClassLevel)} yet` : "No questions yet"
    }</div>`;
    return;
  }

  container.innerHTML = questionList
    .map(
      (question) => `
        <div class="question-item">
          <div class="question-text">
            <strong>${escapeHtml(question.question)}</strong>
            <div class="question-meta">
              ${question.options.map(escapeHtml).join(" | ")} | Correct: ${escapeHtml(question.options[question.correct] || "")}${question.classLevel ? ` | Class: ${escapeHtml(question.classLevel)}` : ""}
            </div>
          </div>
          <div class="question-actions">
            <button class="action-btn edit-btn" onclick="editQuestion('${question.id}', '${subject}')"><i class="fas fa-edit"></i></button>
            <button class="action-btn delete-btn" onclick="confirmDelete('question', '${question.id}', '${subject}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      `
    )
    .join("");
}

function refreshCategoryList() {
  const container = document.getElementById("categoryList");
  if (!container) return;

  if (!categories.length) {
    container.innerHTML = '<p style="color: var(--text-gray);">No categories yet.</p>';
    return;
  }

  container.innerHTML = categories
    .map(
      (category) => `
        <span class="subject-tag">
          ${escapeHtml(category)}
          <i class="fas fa-times-circle remove-subject" onclick="removeCategory('${category}')"></i>
        </span>
      `
    )
    .join("");
}

function refreshCategoryDropdown(selectedCategory) {
  const select = document.getElementById("productCategory");
  if (!select) return;

  select.innerHTML = (categories || []).map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");

  if (selectedCategory && categories.includes(selectedCategory)) {
    select.value = selectedCategory;
  }
}

function refreshProductTable() {
  const tbody = document.getElementById("productList");
  if (!tbody) return;

  if (!productsList.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-gray);">No products</td></tr>';
    return;
  }

  tbody.innerHTML = productsList
    .map(
      (product) => `
        <tr>
          <td>
            <strong>${escapeHtml(product.title)}</strong><br>
            <small style="color: var(--text-gray);">${escapeHtml(product.description)}</small>
          </td>
          <td>${escapeHtml(product.price)}</td>
          <td>${escapeHtml(product.category)}</td>
          <td>
            <button class="action-btn edit-btn" onclick="editProduct('${product.id}')"><i class="fas fa-edit"></i></button>
            <button class="action-btn delete-btn" onclick="confirmDelete('product', '${product.id}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `
    )
    .join("");
}

function loadSettingsForm() {
  document.getElementById("maintenanceMode").checked = !!settings.maintenanceMode;
  document.getElementById("voiceReading").checked = settings.voiceReading !== false;
  document.getElementById("defaultTimer").value = settings.defaultTimer || 30;
}

function resetQuestionForm() {
  editingQuestionId = null;
  document.getElementById("newQuestion").value = "";
  document.getElementById("newOptions").value = "";
  document.getElementById("correctIndex").value = "0";
  document.getElementById("addQuestionBtn").innerHTML = '<i class="fas fa-plus"></i> Add Single Question';
}

function resetProductForm() {
  editingProductId = null;
  document.getElementById("productTitle").value = "";
  document.getElementById("productDesc").value = "";
  document.getElementById("productPrice").value = "";
  document.getElementById("productRating").value = "4.5";
  document.getElementById("productUrl").value = "";
  document.getElementById("addProductBtn").innerHTML = '<i class="fas fa-plus-circle"></i> Add Product Manually';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseBulkQuestionsFromFormat(text) {
  const lines = String(text || "").split(/\r?\n/);
  const questions = [];
  let currentQuestion = "";
  let currentOptions = [];
  let currentExplanation = "";

  function pushCurrentQuestion() {
    if (!currentQuestion || currentOptions.length !== 4) {
      currentQuestion = "";
      currentOptions = [];
      currentExplanation = "";
      return;
    }

    let correctIndex = -1;
    const cleanedOptions = currentOptions.map((option, index) => {
      if (option.includes("✓")) {
        correctIndex = index;
      }
      return option.replace("✓", "").trim();
    });

    if (correctIndex !== -1) {
      questions.push({
        question: currentQuestion,
        options: cleanedOptions,
        correct: correctIndex,
        explanation: currentExplanation
      });
    }

    currentQuestion = "";
    currentOptions = [];
    currentExplanation = "";
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pushCurrentQuestion();
      continue;
    }

    const questionMatch = line.match(/^Q\d+[:.]\s*(.+)$/i);
    if (questionMatch) {
      pushCurrentQuestion();
      currentQuestion = questionMatch[1].trim();
      continue;
    }

    const optionMatch = line.match(/^([A-D])[).]\s*(.+)$/i);
    if (optionMatch) {
      currentOptions.push(optionMatch[2].trim());
      continue;
    }

    if (line.toLowerCase().startsWith("explanation:")) {
      currentExplanation = line.slice(12).trim();
    }
  }

  pushCurrentQuestion();
  return questions;
}

async function loadAdminData(preferredSubject) {
  const payload = await apiFetch(`${API_BASE}/admin/bootstrap`);
  subjects = payload.subjects || [];
  quizDatabase = payload.questions || {};
  productsList = payload.products || [];
  categories = payload.categories || [];
  settings = payload.settings || settings;

  updateStats(payload);
  refreshSubjectList();
  refreshSubjectDropdown(preferredSubject || getSelectedSubject());
  refreshQuestionList();
  refreshCategoryList();
  refreshCategoryDropdown();
  refreshProductTable();
  loadSettingsForm();
}

async function handleLogin() {
  const password = document.getElementById("adminPasswordInput").value.trim();
  if (!password) {
    showAlert("Please enter the admin password.", "danger");
    return;
  }

  try {
    const payload = await apiFetch(`${API_BASE}/admin/login`, {
      method: "POST",
      body: JSON.stringify({ password })
    });

    authToken = payload.token;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, authToken);
    document.getElementById("passwordModal").style.display = "none";
    document.getElementById("adminContent").style.display = "block";
    await loadAdminData();
    showAlert("Admin login successful.", "success");
  } catch (error) {
    document.getElementById("adminPasswordInput").value = "";
    showAlert(error.message, "danger");
  }
}

async function tryRestoreSession() {
  if (!authToken) return;

  try {
    document.getElementById("passwordModal").style.display = "none";
    document.getElementById("adminContent").style.display = "block";
    await loadAdminData();
  } catch (error) {
    authToken = "";
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    document.getElementById("passwordModal").style.display = "flex";
    document.getElementById("adminContent").style.display = "none";
  }
}

async function addSubject() {
  const name = document.getElementById("newSubjectName").value.trim();
  if (!name) {
    showAlert("Please enter a subject name.", "danger");
    return;
  }

  try {
    await apiFetch(`${API_BASE}/admin/subjects`, {
      method: "POST",
      body: JSON.stringify({ name })
    });
    document.getElementById("newSubjectName").value = "";
    await loadAdminData();
    showAlert(`Subject "${name}" added successfully.`, "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function removeSubject(key) {
  const subject = subjects.find((item) => item.key === key);
  if (!subject) return;

  if (!window.confirm(`Remove "${subject.name}" and all of its questions?`)) {
    return;
  }

  try {
    await apiFetch(`${API_BASE}/admin/subjects/${encodeURIComponent(key)}`, {
      method: "DELETE"
    });
    await loadAdminData();
    showAlert(`Subject "${subject.name}" removed.`, "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function addCategory() {
  const name = document.getElementById("newCategoryName").value.trim();
  if (!name) {
    showAlert("Please enter a category name.", "danger");
    return;
  }

  try {
    await apiFetch(`${API_BASE}/admin/categories`, {
      method: "POST",
      body: JSON.stringify({ name })
    });
    document.getElementById("newCategoryName").value = "";
    await loadAdminData();
    showAlert(`Category "${name}" added.`, "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function removeCategory(name) {
  if (!window.confirm(`Remove category "${name}"?`)) {
    return;
  }

  try {
    await apiFetch(`${API_BASE}/admin/categories/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });
    await loadAdminData();
    showAlert(`Category "${name}" removed.`, "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function submitQuestion() {
  const subject = getSelectedSubject();
  const classLevel = getSelectedClassLevel();
  const question = document.getElementById("newQuestion").value.trim();
  const options = document
    .getElementById("newOptions")
    .value.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const correct = Number(document.getElementById("correctIndex").value);

  if (!question) {
    showAlert("Please enter a question.", "danger");
    return;
  }

  if (options.length !== 4) {
    showAlert("Please enter exactly four comma-separated options.", "danger");
    return;
  }

  try {
    const url = editingQuestionId
      ? `${API_BASE}/admin/questions/${encodeURIComponent(editingQuestionId)}`
      : `${API_BASE}/admin/questions`;
    const method = editingQuestionId ? "PUT" : "POST";

    await apiFetch(url, {
      method,
      body: JSON.stringify({ subject, classLevel, question, options, correct })
    });

    await loadAdminData(subject);
    resetQuestionForm();
    showAlert(editingQuestionId ? "Question updated." : "Question added.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

function editQuestion(id, subject) {
  const question = (quizDatabase[subject] || []).find((item) => item.id === id);
  if (!question) return;

  editingQuestionId = id;
  document.getElementById("subjectSelect").value = subject;
  const classSelect = document.getElementById("classSelectAdmin");
  if (classSelect) {
    classSelect.value = question.classLevel ? String(question.classLevel) : "";
  }
  document.getElementById("newQuestion").value = question.question;
  document.getElementById("newOptions").value = question.options.join(", ");
  document.getElementById("correctIndex").value = String(question.correct);
  document.getElementById("addQuestionBtn").innerHTML = '<i class="fas fa-save"></i> Update Question';
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteQuestion(id, subject) {
  try {
    await apiFetch(`${API_BASE}/admin/questions/${encodeURIComponent(id)}?subject=${encodeURIComponent(subject)}`, {
      method: "DELETE"
    });
    await loadAdminData(subject);
    showAlert("Question deleted.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function clearQuestionsForSubject() {
  const subject = getSelectedSubject();
  const classLevel = getSelectedClassLevel();
  if (!subject) return;

  const subjectName = subjects.find((item) => item.key === subject)?.name || subject;
  const label = classLevel ? `Class ${classLevel}` : "All Classes";
  const confirmation = window.prompt(
    `Type DELETE to remove all questions for "${subjectName}" (${label}). This cannot be undone.`
  );
  if (confirmation !== "DELETE") {
    return;
  }

  try {
    const query = new URLSearchParams({ subject });
    if (classLevel) query.set("classLevel", classLevel);
    const payload = await apiFetch(`${API_BASE}/admin/questions?${query.toString()}`, {
      method: "DELETE"
    });
    await loadAdminData(subject);
    showAlert(payload.message || "Questions cleared.", "success");
  } catch (error) {
    if (error?.status === 404) {
      await clearQuestionsViaIndividualDeletes(subject, classLevel);
      return;
    }
    showAlert(error.message, "danger");
  }
}

async function clearQuestionsViaIndividualDeletes(subject, classLevel) {
  const pool = (quizDatabase[subject] || []).filter((question) => {
    if (!classLevel) return true;
    return String(question.classLevel || "") === String(classLevel);
  });

  if (!pool.length) {
    showAlert("No questions found to delete.", "danger");
    return;
  }

  let removed = 0;
  const batchSize = 10;
  showAlert(`Deleting questions... 0/${pool.length}`, "success", false);

  for (let index = 0; index < pool.length; index += batchSize) {
    const batch = pool.slice(index, index + batchSize);
    await Promise.all(
      batch.map((item) =>
        apiFetch(`${API_BASE}/admin/questions/${encodeURIComponent(item.id)}?subject=${encodeURIComponent(subject)}`, {
          method: "DELETE"
        })
      )
    );
    removed += batch.length;
    showAlert(`Deleting questions... ${removed}/${pool.length}`, "success", false);
  }

  await loadAdminData(subject);
  showAlert(`Removed ${removed} questions successfully.`, "success");
}

async function previewBulkQuestions() {
  const text = document.getElementById("bulkQuestionsText").value.trim();
  const previewArea = document.getElementById("bulkPreviewArea");
  const previewList = document.getElementById("previewList");
  const previewCount = document.getElementById("previewCount");

  if (!text) {
    showAlert("Please paste some questions first.", "danger");
    return;
  }

  const parsedQuestions = parseBulkQuestionsFromFormat(text);
  if (!parsedQuestions.length) {
    previewArea.style.display = "none";
    showAlert("No valid questions found in the pasted content.", "danger");
    return;
  }

  previewCount.innerText = parsedQuestions.length;
  previewList.innerHTML = parsedQuestions
    .map(
      (item, index) => `
        <div style="padding: 5px 0; border-bottom: 1px solid #E5E7EB;">
          <strong>${index + 1}.</strong> ${escapeHtml(item.question.slice(0, 80))}
        </div>
      `
    )
    .join("");
  previewArea.style.display = "block";
  showAlert(`Found ${parsedQuestions.length} valid questions.`, "success");
}

async function addBulkQuestions() {
  const subject = getSelectedSubject();
  const classLevel = getSelectedClassLevel();
  const text = document.getElementById("bulkQuestionsText").value.trim();
  const parsedQuestions = parseBulkQuestionsFromFormat(text).map((item) => ({ ...item, classLevel }));

  if (!parsedQuestions.length) {
    showAlert("No valid questions found.", "danger");
    return;
  }

  try {
    const payload = await apiFetch(`${API_BASE}/admin/questions/bulk`, {
      method: "POST",
      body: JSON.stringify({ subject, questions: parsedQuestions })
    });
    document.getElementById("bulkQuestionsText").value = "";
    document.getElementById("bulkPreviewArea").style.display = "none";
    await loadAdminData(subject);
    showAlert(payload.message || "Questions added successfully.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

function clearBulkQuestions() {
  document.getElementById("bulkQuestionsText").value = "";
  document.getElementById("bulkPreviewArea").style.display = "none";
}

async function handleBulkFileUpload(file) {
  if (!file) return;

  const status = document.getElementById("bulkUploadStatus");
  const subject = getSelectedSubject();
  const classLevel = getSelectedClassLevel();

  try {
    const text = await file.text();
    let parsedQuestions = [];

    if (file.name.toLowerCase().endsWith(".json")) {
      const raw = JSON.parse(text);
      if (Array.isArray(raw)) {
        parsedQuestions = raw;
      } else if (Array.isArray(raw?.questions)) {
        parsedQuestions = raw.questions;
      } else if (raw?.questions && typeof raw.questions === "object") {
        const fromSelectedSubject = raw.questions?.[subject];
        if (Array.isArray(fromSelectedSubject)) {
          parsedQuestions = fromSelectedSubject;
        } else {
          const all = Object.values(raw.questions).flatMap((value) => (Array.isArray(value) ? value : []));
          parsedQuestions = all;
        }
      } else if (Array.isArray(raw?.[subject])) {
        parsedQuestions = raw[subject];
      } else {
        parsedQuestions = [];
      }
    } else if (file.name.toLowerCase().endsWith(".csv")) {
      parsedQuestions = text
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split(","))
        .filter((cols) => cols.length >= 7)
        .map((cols) => ({
          question: cols[1].trim(),
          options: [cols[2].trim(), cols[3].trim(), cols[4].trim(), cols[5].trim()],
          correct: Number(cols[6].trim()),
          explanation: "",
          classLevel
        }));
    } else {
      throw new Error("Only CSV and JSON files are supported.");
    }

    const normalizedQuestions = normalizeBulkQuestions(parsedQuestions, classLevel);
    if (!normalizedQuestions.length) {
      throw new Error(
        "No valid questions found. Ensure each question has: question text, 4 options, and correct (0-3 or A-D)."
      );
    }

    const chunkSize = 100;
    let addedTotal = 0;
    showAlert(`Uploading questions... 0/${normalizedQuestions.length}`, "success", false);
    status.innerHTML = `<span style="color: var(--success);">Uploading questions... 0/${normalizedQuestions.length}</span>`;

    for (let index = 0; index < normalizedQuestions.length; index += chunkSize) {
      const chunk = normalizedQuestions.slice(index, index + chunkSize);
      const payload = await apiFetch(`${API_BASE}/admin/questions/bulk`, {
        method: "POST",
        body: JSON.stringify({ subject, questions: chunk })
      });
      addedTotal += Number(payload?.added || 0);
      const processed = Math.min(index + chunk.length, normalizedQuestions.length);
      showAlert(`Uploading questions... ${processed}/${normalizedQuestions.length}`, "success", false);
      status.innerHTML = `<span style="color: var(--success);">Uploading questions... ${processed}/${normalizedQuestions.length}</span>`;
    }

    await loadAdminData(subject);
    showAlert(`Added ${addedTotal} questions successfully.`, "success");
    status.innerHTML = `<span style="color: var(--success);">Added ${addedTotal} questions successfully.</span>`;
  } catch (error) {
    status.innerHTML = `<span style="color: var(--danger);">${escapeHtml(error.message)}</span>`;
    showAlert(error.message, "danger");
  }
}

function normalizeBulkQuestions(input, fallbackClassLevel) {
  const rows = Array.isArray(input) ? input : [];
  const normalized = [];

  for (const item of rows) {
    const questionText = cleanText(
      getAnyValue(item, ["question", "Question", "questionText", "QuestionText", "text", "Text", "q", "title", "prompt"])
    );
    if (!questionText) continue;

    const extracted = extractOptionsAndCorrect(item);
    const options = extracted.options;

    if (options.length !== 4) continue;

    const explanation = cleanText(getAnyValue(item, ["explanation", "Explanation", "detail", "reason", "solution", "hint"]) || "");

    const correct =
      typeof extracted.correct === "number" && Number.isFinite(extracted.correct)
        ? extracted.correct
        : normalizeCorrectIndex(item, options);
    if (correct < 0 || correct > 3) continue;

    const classLevel = normalizeClassLevel(getAnyValue(item, ["classLevel", "class", "grade", "level"]) || fallbackClassLevel);

    normalized.push({
      question: questionText,
      options,
      correct,
      explanation,
      ...(classLevel ? { classLevel } : {})
    });
  }

  return normalized;
}

function normalizeCorrectIndex(item, options) {
  const raw =
    item?.correct ??
    item?.answer ??
    item?.correctIndex ??
    item?.correctAnswer ??
    item?.correct_option ??
    item?.correctOption ??
    item?.answerKey ??
    item?.ans ??
    item?.Answer ??
    item?.Correct ??
    item?.CorrectAnswer;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const truncated = Math.trunc(raw);
    if (truncated >= 1 && truncated <= 4) return truncated - 1;
    return Math.max(0, Math.min(3, truncated));
  }

  const value = String(raw ?? "").trim();
  if (!value) return -1;

  if (/^[0-3]$/.test(value)) return Number(value);
  if (/^[1-4]$/.test(value)) return Number(value) - 1;

  const letterMatch = value.toUpperCase().match(/[A-D]/);
  const letter = letterMatch ? letterMatch[0] : "";
  if (letter === "A") return 0;
  if (letter === "B") return 1;
  if (letter === "C") return 2;
  if (letter === "D") return 3;

  const normalizedValue = value.toLowerCase();
  const matchIndex = options.findIndex((option) => option.toLowerCase() === normalizedValue);
  return matchIndex;
}

function getAnyValue(item, keys) {
  if (!item || typeof item !== "object") return "";
  for (const key of keys) {
    if (key in item) return item[key];
  }
  const lower = Object.create(null);
  for (const realKey of Object.keys(item)) {
    lower[String(realKey).toLowerCase()] = realKey;
  }
  for (const key of keys) {
    const realKey = lower[String(key).toLowerCase()];
    if (realKey) return item[realKey];
  }
  return "";
}

function extractOptionsAndCorrect(item) {
  let correct = null;

  const direct = item?.options ?? item?.answers ?? item?.Choices ?? item?.choices;
  if (Array.isArray(direct)) {
    const cleaned = direct
      .map((value) => {
        if (value && typeof value === "object") {
          if (value.correct === true || value.isCorrect === true) {
            correct = correct ?? 0;
          }
          return cleanText(value.text ?? value.value ?? value.option ?? value.answer ?? value.label ?? "");
        }
        return cleanText(value);
      })
      .filter(Boolean);

    if (cleaned.length >= 4) {
      if (correct !== null) {
        const idx = direct.findIndex((value) => value && typeof value === "object" && (value.correct === true || value.isCorrect === true));
        if (idx >= 0 && idx <= 3) correct = idx;
      }
      return { options: cleaned.slice(0, 4), correct };
    }
  }

  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const keysUpper = Object.keys(direct).map((k) => String(k).toUpperCase());
    const hasLetters = ["A", "B", "C", "D"].every((k) => keysUpper.includes(k));
    if (hasLetters) {
      const options = ["A", "B", "C", "D"].map((k) => {
        const realKey = Object.keys(direct).find((rk) => String(rk).toUpperCase() === k);
        return cleanText(direct[realKey]);
      });
      return { options, correct };
    }
  }

  const optionMap = { A: "", B: "", C: "", D: "" };
  const numeric = [];
  if (item && typeof item === "object") {
    for (const [rawKey, rawValue] of Object.entries(item)) {
      const key = String(rawKey).trim();
      const value = cleanText(rawValue);
      if (!value) continue;

      const upper = key.toUpperCase();
      if (upper === "A" || upper === "B" || upper === "C" || upper === "D") {
        optionMap[upper] = optionMap[upper] || value;
        continue;
      }

      const letterMatch = upper.match(/OPTION[\s_]*([A-D])$/) || upper.match(/^OPTION([A-D])$/) || upper.match(/^([A-D])_OPTION$/);
      if (letterMatch) {
        const letter = letterMatch[1];
        optionMap[letter] = optionMap[letter] || value;
        continue;
      }

      const numMatch = upper.match(/^OPTION[\s_]*(\d)$/) || upper.match(/^OPTION(\d)$/);
      if (numMatch) {
        const idx = Number(numMatch[1]) - 1;
        if (idx >= 0 && idx <= 3) numeric[idx] = numeric[idx] || value;
      }
    }
  }

  const letterOptions = ["A", "B", "C", "D"].map((k) => optionMap[k]).filter(Boolean);
  if (letterOptions.length === 4) return { options: ["A", "B", "C", "D"].map((k) => optionMap[k]), correct };
  if (numeric.filter(Boolean).length === 4) return { options: numeric.slice(0, 4), correct };

  const optionsText = cleanText(getAnyValue(item, ["optionsText", "Options", "options", "answersText"]));
  if (optionsText) {
    const parsed = parseOptionsFromText(optionsText);
    if (parsed.length === 4) return { options: parsed, correct };
  }

  return { options: [], correct };
}

function parseOptionsFromText(text) {
  const lines = String(text || "")
    .split(/\r?\n|[;|]/)
    .map((line) => line.trim())
    .filter(Boolean);

  const map = { A: "", B: "", C: "", D: "" };
  for (const line of lines) {
    const match = line.match(/^([A-D])[).:\-]\s*(.+)$/i);
    if (match) {
      map[match[1].toUpperCase()] = cleanText(match[2]);
    }
  }
  const options = ["A", "B", "C", "D"].map((k) => map[k]).filter(Boolean);
  return options.length === 4 ? ["A", "B", "C", "D"].map((k) => map[k]) : [];
}

async function submitProduct(payload) {
  const url = editingProductId
    ? `${API_BASE}/admin/products/${encodeURIComponent(editingProductId)}`
    : `${API_BASE}/admin/products`;
  const method = editingProductId ? "PUT" : "POST";

  await apiFetch(url, {
    method,
    body: JSON.stringify(payload)
  });
}

async function submitManualProduct() {
  const payload = {
    title: document.getElementById("productTitle").value.trim(),
    description: document.getElementById("productDesc").value.trim(),
    price: document.getElementById("productPrice").value.trim(),
    rating: Number(document.getElementById("productRating").value || 4.5),
    category: document.getElementById("productCategory").value,
    platform: document.getElementById("productPlatform").value,
    url: document.getElementById("productUrl").value.trim(),
    image: ""
  };

  try {
    await submitProduct(payload);
    await loadAdminData();
    resetProductForm();
    showAlert(editingProductId ? "Product updated." : "Product added.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

function editProduct(id) {
  const product = productsList.find((item) => item.id === id);
  if (!product) return;

  editingProductId = id;
  document.getElementById("productTitle").value = product.title;
  document.getElementById("productDesc").value = product.description;
  document.getElementById("productPrice").value = product.price;
  document.getElementById("productCategory").value = product.category;
  document.getElementById("productPlatform").value = product.platform;
  document.getElementById("productRating").value = String(product.rating);
  document.getElementById("productUrl").value = product.url || "";
  document.getElementById("addProductBtn").innerHTML = '<i class="fas fa-save"></i> Update Product';
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteProduct(id) {
  try {
    await apiFetch(`${API_BASE}/admin/products/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    await loadAdminData();
    showAlert("Product deleted.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

function confirmDelete(type, id, subject = null) {
  pendingDelete = { type, id, subject };
  document.getElementById("deleteModal").classList.add("active");
}

function closeDeleteModal() {
  pendingDelete = { type: null, id: null, subject: null };
  document.getElementById("deleteModal").classList.remove("active");
}

async function executeDelete() {
  if (pendingDelete.type === "question") {
    await deleteQuestion(pendingDelete.id, pendingDelete.subject);
  }

  if (pendingDelete.type === "product") {
    await deleteProduct(pendingDelete.id);
  }

  closeDeleteModal();
}

async function saveSettings() {
  try {
    await apiFetch(`${API_BASE}/admin/settings`, {
      method: "POST",
      body: JSON.stringify({
        maintenanceMode: document.getElementById("maintenanceMode").checked,
        voiceReading: document.getElementById("voiceReading").checked,
        defaultTimer: Number(document.getElementById("defaultTimer").value)
      })
    });
    await loadAdminData(getSelectedSubject());
    showAlert("Settings saved.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function exportData(endpoint, filenamePrefix) {
  try {
    const response = await fetch(`${API_BASE}/admin/export/${endpoint}`, {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error("Export failed.");
    }

    const blob = await response.blob();
    downloadBlob(blob, `${filenamePrefix}_${Date.now()}.json`);
    showAlert("Export completed.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function resetData() {
  if (!window.confirm("Reset all stored data back to demo content?")) {
    return;
  }

  try {
    await apiFetch(`${API_BASE}/admin/reset`, {
      method: "POST"
    });
    resetQuestionForm();
    resetProductForm();
    await loadAdminData();
    showAlert("Demo data restored.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

function addAnimatedParticles() {
  for (let i = 0; i < 50; i += 1) {
    const particle = document.createElement("div");
    particle.className = "particle";
    particle.style.width = `${Math.random() * 8 + 2}px`;
    particle.style.height = particle.style.width;
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.animationDelay = `${Math.random() * 15}s`;
    particle.style.animationDuration = `${10 + Math.random() * 10}s`;
    document.body.appendChild(particle);
  }
}

function bindEvents() {
  const on = (id, eventName, handler) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener(eventName, handler);
  };

  on("submitPasswordBtn", "click", handleLogin);
  on("cancelPasswordBtn", "click", () => {
    window.location.href = "index.html";
  });
  on("adminPasswordInput", "keypress", (event) => {
    if (event.key === "Enter") {
      handleLogin();
    }
  });

  on("addSubjectBtn", "click", addSubject);
  on("addCategoryBtn", "click", addCategory);
  on("subjectSelect", "change", refreshQuestionList);
  on("classSelectAdmin", "change", refreshQuestionList);
  on("clearQuestionsBtn", "click", clearQuestionsForSubject);
  on("addQuestionBtn", "click", submitQuestion);
  on("previewBulkBtn", "click", previewBulkQuestions);
  on("addBulkBtn", "click", addBulkQuestions);
  on("clearBulkBtn", "click", clearBulkQuestions);
  on("selectBulkFileBtn", "click", () => {
    document.getElementById("bulkFileInput")?.click();
  });
  on("bulkFileInput", "change", (event) => {
    handleBulkFileUpload(event.target.files?.[0]);
    event.target.value = "";
  });
  on("addProductBtn", "click", submitManualProduct);
  on("confirmDeleteBtn", "click", executeDelete);
  on("saveSettingsBtn", "click", saveSettings);
  on("exportQuestionsBtn", "click", () => {
    exportData("questions", "ak_questions_export");
  });
  on("exportProductsBtn", "click", () => {
    exportData("products", "ak_products_export");
  });
  on("resetDataBtn", "click", resetData);
}

window.editQuestion = editQuestion;
window.editProduct = editProduct;
window.confirmDelete = confirmDelete;
window.closeDeleteModal = closeDeleteModal;
window.removeSubject = removeSubject;
window.removeCategory = removeCategory;

addAnimatedParticles();
bindEvents();
tryRestoreSession();
