function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const API_ORIGIN = normalizeApiBase(window.AK_API_BASE);
const API_BASE = API_ORIGIN ? `${API_ORIGIN}/api` : "/api";
const ADMIN_TOKEN_KEY = "ak_admin_token";

let authToken = sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
let subjects = [];
let quizDatabase = {};
let productsList = [];
let categories = [];
let settings = { maintenanceMode: false, voiceReading: true, defaultTimer: 30 };
let fetchedProductData = null;
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
  }).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      const message = typeof payload === "string" ? payload : payload.message || "Request failed.";
      throw new Error(message);
    }

    return payload;
  });
}

function showAlert(message, type = "success") {
  const alertDiv = document.getElementById("alertMessage");
  if (!alertDiv) return;

  alertDiv.className = `alert alert-${type} show`;
  alertDiv.innerHTML = `<i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"}"></i> ${escapeHtml(message)}`;
  setTimeout(() => alertDiv.classList.remove("show"), 3000);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (match) => {
    if (match === "&") return "&amp;";
    if (match === "<") return "&lt;";
    if (match === ">") return "&gt;";
    return "&quot;";
  });
}

function getSelectedSubject() {
  return document.getElementById("subjectSelect")?.value || subjects[0]?.key || "";
}

function updateStats(payload) {
  document.getElementById("totalUsers").innerText = payload.stats.totalUsers.toLocaleString();
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
  const questionList = quizDatabase[subject] || [];
  const container = document.getElementById("questionList");
  if (!container) return;

  if (!questionList.length) {
    container.innerHTML = '<div style="text-align:center; padding:1rem; color: var(--text-gray);">No questions yet</div>';
    return;
  }

  container.innerHTML = questionList
    .map(
      (question) => `
        <div class="question-item">
          <div class="question-text">
            <strong>${escapeHtml(question.question)}</strong>
            <div class="question-meta">
              ${question.options.map(escapeHtml).join(" | ")} | Correct: ${escapeHtml(question.options[question.correct] || "")}
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

  select.innerHTML = categories
    .map((category) => `<option value="${category}">${escapeHtml(category)}</option>`)
    .join("");

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
      body: JSON.stringify({ subject, question, options, correct })
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
  const text = document.getElementById("bulkQuestionsText").value.trim();
  const parsedQuestions = parseBulkQuestionsFromFormat(text);

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

  try {
    const text = await file.text();
    let parsedQuestions = [];

    if (file.name.toLowerCase().endsWith(".json")) {
      const raw = JSON.parse(text);
      parsedQuestions = Array.isArray(raw) ? raw : raw.questions || [];
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
          explanation: ""
        }));
    } else {
      throw new Error("Only CSV and JSON files are supported.");
    }

    const payload = await apiFetch(`${API_BASE}/admin/questions/bulk`, {
      method: "POST",
      body: JSON.stringify({ subject, questions: parsedQuestions })
    });
    status.innerHTML = `<span style="color: var(--success);">${escapeHtml(payload.message)}</span>`;
    await loadAdminData(subject);
    showAlert(payload.message, "success");
  } catch (error) {
    status.innerHTML = `<span style="color: var(--danger);">${escapeHtml(error.message)}</span>`;
    showAlert(error.message, "danger");
  }
}

async function fetchProductPreviewFromUrl() {
  const url = document.getElementById("productUrl").value.trim();
  if (!url) {
    showAlert("Please enter a product URL.", "danger");
    return;
  }

  const button = document.getElementById("fetchProductBtn");
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';

  try {
    fetchedProductData = await apiFetch(`${API_BASE}/admin/product-preview`, {
      method: "POST",
      body: JSON.stringify({ url })
    });
    document.getElementById("previewTitle").innerText = fetchedProductData.title || "-";
    document.getElementById("previewDesc").innerText = fetchedProductData.description || "-";
    document.getElementById("previewPrice").innerText = fetchedProductData.price || "-";
    document.getElementById("previewPlatform").innerText = fetchedProductData.platform || "-";
    document.getElementById("fetchPreview").classList.add("show");
    showAlert("Product preview loaded.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
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

async function confirmFetchedProduct() {
  if (!fetchedProductData) return;

  try {
    await submitProduct({
      title: fetchedProductData.title,
      description: fetchedProductData.description,
      price: fetchedProductData.price,
      rating: fetchedProductData.rating || 4,
      category: categories[0] || "gadgets",
      platform: fetchedProductData.platform,
      url: fetchedProductData.url,
      image: fetchedProductData.image || ""
    });
    document.getElementById("fetchPreview").classList.remove("show");
    fetchedProductData = null;
    await loadAdminData();
    showAlert("Product added successfully.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
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
  document.getElementById("submitPasswordBtn").addEventListener("click", handleLogin);
  document.getElementById("cancelPasswordBtn").addEventListener("click", () => {
    window.location.href = "index.html";
  });
  document.getElementById("adminPasswordInput").addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      handleLogin();
    }
  });

  document.getElementById("addSubjectBtn").addEventListener("click", addSubject);
  document.getElementById("addCategoryBtn").addEventListener("click", addCategory);
  document.getElementById("subjectSelect").addEventListener("change", refreshQuestionList);
  document.getElementById("addQuestionBtn").addEventListener("click", submitQuestion);
  document.getElementById("previewBulkBtn").addEventListener("click", previewBulkQuestions);
  document.getElementById("addBulkBtn").addEventListener("click", addBulkQuestions);
  document.getElementById("clearBulkBtn").addEventListener("click", clearBulkQuestions);
  document.getElementById("selectBulkFileBtn").addEventListener("click", () => {
    document.getElementById("bulkFileInput").click();
  });
  document.getElementById("bulkFileInput").addEventListener("change", (event) => {
    handleBulkFileUpload(event.target.files?.[0]);
    event.target.value = "";
  });
  document.getElementById("fetchProductBtn").addEventListener("click", fetchProductPreviewFromUrl);
  document.getElementById("confirmAddProductBtn").addEventListener("click", confirmFetchedProduct);
  document.getElementById("cancelPreviewBtn").addEventListener("click", () => {
    fetchedProductData = null;
    document.getElementById("fetchPreview").classList.remove("show");
  });
  document.getElementById("addProductBtn").addEventListener("click", submitManualProduct);
  document.getElementById("confirmDeleteBtn").addEventListener("click", executeDelete);
  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
  document.getElementById("exportQuestionsBtn").addEventListener("click", () => {
    exportData("questions", "ak_questions_export");
  });
  document.getElementById("exportProductsBtn").addEventListener("click", () => {
    exportData("products", "ak_products_export");
  });
  document.getElementById("resetDataBtn").addEventListener("click", resetData);
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
