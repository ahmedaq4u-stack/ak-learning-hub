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
let PUBLIC_API_BASE = API_ORIGIN ? `${API_ORIGIN}/api/public` : "/api/public";

function updateApiOrigin(nextOrigin) {
  API_ORIGIN = normalizeApiBase(nextOrigin);
  PUBLIC_API_BASE = API_ORIGIN ? `${API_ORIGIN}/api/public` : "/api/public";
}

function promptForBackendOnce() {
  if (window.__ak_backend_prompted) return false;
  window.__ak_backend_prompted = true;
  const current = API_ORIGIN || "";
  const entered = window.prompt(
    "Backend is not reachable. Paste your Railway backend domain (example: https://xxxx.up.railway.app).",
    current
  );
  const normalized = normalizeApiBase(entered);
  if (!normalized) return false;
  localStorage.setItem(API_BASE_OVERRIDE_KEY, normalized);
  updateApiOrigin(normalized);
  window.location.reload();
  return true;
}
const PROFILE_STORAGE_KEY = "ak_learner_profile";
const VOICE_STORAGE_KEY = "ak_voice_enabled";
const CLASS_STORAGE_KEY = "ak_learner_class";
const VISITOR_ID_STORAGE_KEY = "ak_visitor_id";
const VISIT_SENT_SESSION_KEY = "ak_visit_sent";
const ROUND_SIZE = 20;

let publicData = {
  subjects: [],
  questions: {},
  questionCounts: {},
  categories: [],
  products: [],
  settings: {
    maintenanceMode: false,
    voiceReading: true,
    defaultTimer: 30
  },
  leaderboard: [],
  stats: {
    totalUsers: 0,
    totalQuestions: 0,
    totalQuizzesTaken: 0,
    averageScore: 0
  }
};

let currentQuiz = null;
let quizTimer = null;
let speechSynthesisAvailable = "speechSynthesis" in window;
let voiceEnabled = localStorage.getItem(VOICE_STORAGE_KEY);
voiceEnabled = voiceEnabled === null ? true : voiceEnabled === "true";
let pendingClassSubjectKey = "";

function getStoredClass() {
  const value = String(localStorage.getItem(CLASS_STORAGE_KEY) || "").trim();
  return /^(6|7|8|9|10|11|12)$/.test(value) ? value : "";
}

function openClassModal(subjectKey) {
  pendingClassSubjectKey = String(subjectKey || "");
  const backdrop = document.getElementById("classBackdrop");
  const select = document.getElementById("classSelect");
  if (select) {
    select.value = getStoredClass() || "";
    select.focus();
  }
  if (backdrop) {
    backdrop.classList.add("active");
    backdrop.setAttribute("aria-hidden", "false");
  }
}

function closeClassModal() {
  const backdrop = document.getElementById("classBackdrop");
  if (backdrop) {
    backdrop.classList.remove("active");
    backdrop.setAttribute("aria-hidden", "true");
  }
  pendingClassSubjectKey = "";
}

function ensureClassSelected(subjectKey) {
  const selected = getStoredClass();
  if (selected) return true;
  openClassModal(subjectKey);
  return false;
}

function apiGet(url) {
  return fetch(url).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof payload === "string" ? "Request failed." : payload.message || "Request failed.";
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  });
}

function apiPost(url, body) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof payload === "string" ? "Request failed." : payload.message || "Request failed.";
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  });
}

function ensureVisitorId() {
  const existing = String(localStorage.getItem(VISITOR_ID_STORAGE_KEY) || "").trim();
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(VISITOR_ID_STORAGE_KEY, generated);
  return generated;
}

async function trackVisitOnce() {
  if (sessionStorage.getItem(VISIT_SENT_SESSION_KEY) === "true") return;
  sessionStorage.setItem(VISIT_SENT_SESSION_KEY, "true");
  try {
    await apiPost(`${PUBLIC_API_BASE}/visit`, {
      visitorId: ensureVisitorId(),
      path: window.location.pathname
    });
  } catch (error) {
    sessionStorage.removeItem(VISIT_SENT_SESSION_KEY);
  }
}

function showMessage(message) {
  window.alert(message);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (match) => {
    if (match === "&") return "&amp;";
    if (match === "<") return "&lt;";
    if (match === ">") return "&gt;";
    return "&quot;";
  });
}

function normalizeOptionForDisplay(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/^\s*([A-D]|[1-4])[\).:\-]\s*/i, "");
  text = text.replace(/[✓✔✅]/g, "");
  text = text.replace(/\s*\(\s*(correct|answer|right)\s*\)\s*$/i, "");
  text = text.replace(/\s*(?:-|\u2013|\u2014)?\s*(correct\s*answer|right\s*answer|correct)\s*$/i, "");
  text = text.replace(/\s{2,}/g, " ").trim();
  return text;
}

function getFirebaseApi() {
  return window.AK_FIREBASE || null;
}

function getFirebaseUser() {
  return getFirebaseApi()?.getUser?.() || null;
}

function getFirebaseDisplayName(user) {
  const api = getFirebaseApi();
  if (api?.getDisplayName) {
    return api.getDisplayName(user);
  }
  if (!user) return "";
  if (user.displayName) return user.displayName;
  if (user.email) return user.email.split("@")[0] || user.email;
  return "";
}

function initialsFromName(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getStoredProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function saveProfile(name) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) return null;

  const initials = trimmedName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  const profile = {
    name: trimmedName,
    initials: initials || "AK"
  };

  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  updateProfileUi();
  return profile;
}

function ensureProfile() {
  const user = getFirebaseUser();
  if (user) {
    const name = getFirebaseDisplayName(user) || "Learner";
    return { name, initials: initialsFromName(name) || "AK", uid: user.uid, email: user.email || "" };
  }

  const profile = getStoredProfile();
  if (profile?.name) return profile;
  return null;
}

function updateProfileUi() {
  const profile = ensureProfile() || { initials: "AK" };
  const avatar = document.getElementById("userAvatar");
  if (avatar) {
    avatar.innerText = profile.initials || "AK";
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Exit';
  }
}

function getAuthElements() {
  return {
    backdrop: document.getElementById("authBackdrop"),
    title: document.getElementById("authTitle"),
    closeBtn: document.getElementById("authCloseBtn"),
    form: document.getElementById("authForm"),
    name: document.getElementById("authName"),
    email: document.getElementById("authEmail"),
    password: document.getElementById("authPassword"),
    forgotPasswordBtn: document.getElementById("forgotPasswordBtn"),
    switchBtn: document.getElementById("authSwitchBtn"),
    submitBtn: document.getElementById("authSubmitBtn"),
    error: document.getElementById("authError")
  };
}

let authMode = "signin";
let pendingAuthAction = null;

function setAuthError(message) {
  const { error } = getAuthElements();
  if (!error) return;
  if (message) {
    error.textContent = message;
    error.classList.add("show");
  } else {
    error.textContent = "";
    error.classList.remove("show");
  }
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "signin";
  const { title, name, password, switchBtn, submitBtn } = getAuthElements();
  if (title) title.textContent = authMode === "signup" ? "Create Account" : "Sign In";
  if (name) name.style.display = authMode === "signup" ? "block" : "none";
  if (password) password.autocomplete = authMode === "signup" ? "new-password" : "current-password";
  if (switchBtn) switchBtn.textContent = authMode === "signup" ? "I already have an account" : "Create account";
  if (submitBtn) {
    submitBtn.innerHTML =
      authMode === "signup" ? '<i class="fas fa-user-plus"></i> Sign Up' : '<i class="fas fa-lock"></i> Sign In';
  }
  setAuthError("");
}

function openAuthModal(mode = "signin", afterLoginAction = null) {
  pendingAuthAction = typeof afterLoginAction === "function" ? afterLoginAction : pendingAuthAction;
  const { backdrop, email, password } = getAuthElements();
  setAuthMode(mode);
  if (backdrop) {
    backdrop.classList.add("active");
    backdrop.setAttribute("aria-hidden", "false");
  }
  if (email) email.focus();
  if (password) password.value = "";
}

function closeAuthModal() {
  const { backdrop } = getAuthElements();
  if (backdrop) {
    backdrop.classList.remove("active");
    backdrop.setAttribute("aria-hidden", "true");
  }
  setAuthError("");
}

function requireAuth(action) {
  return true;
}

function resizeCanvas() {
  const canvas = document.getElementById("particleCanvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

class Particle {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.size = Math.random() * 2 + 1;
    this.speedX = Math.random() * 0.5 - 0.25;
    this.speedY = Math.random() * 0.5 - 0.25;
    this.color = `rgba(67, 97, 238, ${Math.random() * 0.3})`;
  }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    if (this.x < 0) this.x = this.canvas.width;
    if (this.x > this.canvas.width) this.x = 0;
    if (this.y < 0) this.y = this.canvas.height;
    if (this.y > this.canvas.height) this.y = 0;
  }

  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function initParticles() {
  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isSmallScreen = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  const lowCoreCount = typeof navigator !== "undefined" && Number(navigator.hardwareConcurrency || 0) > 0 && navigator.hardwareConcurrency <= 2;
  if (prefersReducedMotion || isSmallScreen || lowCoreCount) return;

  const canvas = document.getElementById("particleCanvas");
  const ctx = canvas.getContext("2d");
  const particles = [];

  resizeCanvas();
  for (let i = 0; i < 50; i += 1) {
    particles.push(new Particle(canvas));
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((particle) => {
      particle.update();
      particle.draw(ctx);
    });
    requestAnimationFrame(animate);
  }

  animate();
  window.addEventListener("resize", resizeCanvas);
}

function updateHeaderOnScroll() {
  const header = document.getElementById("mainHeader");
  if (window.scrollY > 50) {
    header.classList.add("scrolled");
  } else {
    header.classList.remove("scrolled");
  }
}

function renderQuizCards(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = publicData.subjects
    .map((subject) => {
      const count =
        Number(publicData.questionCounts?.[subject.key]) ||
        (publicData.questions[subject.key] || []).length;
      return `
        <div class="quiz-card" onclick="startQuiz('${subject.key}')">
          <div class="quiz-card-inner">
            <div class="quiz-card-front">
              <div class="subject-icon-badge">
                <i class="fas ${subject.icon}" style="color:${subject.color}"></i>
              </div>
              <h3>${escapeHtml(subject.name)}</h3>
              <p>${count} Questions</p>
              <div class="subject-pill"><i class="fas fa-sparkles"></i> Explore</div>
            </div>
            <div class="quiz-card-back">
              <i class="fas fa-play-circle" style="font-size:2rem"></i>
              <h3>Start Quiz</h3>
              <p>Practice now and boost your score</p>
              <button>Begin</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderFooterSubjects() {
  const list = document.getElementById("footerSubjectsList");
  if (!list) return;

  const subjects = Array.isArray(publicData.subjects) ? publicData.subjects : [];
  if (!subjects.length) {
    list.innerHTML = "<li>No subjects yet</li>";
    return;
  }

  list.innerHTML = subjects
    .slice(0, 10)
    .map((subject) => `<li><a href="#" class="footer-subject-link" data-subject="${escapeHtml(subject.key)}">${escapeHtml(subject.name)}</a></li>`)
    .join("");

  list.querySelectorAll(".footer-subject-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPage("quizzes");
    });
  });
}

function renderProducts(category = "all") {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  const filteredProducts =
    category === "all" ? publicData.products : publicData.products.filter((product) => product.category === category);

  if (!filteredProducts.length) {
    grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center;">No products available in this category.</p>';
    return;
  }

  grid.innerHTML = filteredProducts
    .map(
      (product) => `
        <div class="product-card">
          <div class="product-image">
            ${
              product.image
                ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" style="width:100%; height:100%; object-fit:cover;">`
                : '<i class="fas fa-box-open"></i>'
            }
          </div>
          <div class="product-info">
            <div class="product-title">${escapeHtml(product.title)}</div>
            <p>${escapeHtml(product.description)}</p>
            <div class="product-price">${escapeHtml(product.price)}</div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span><i class="fas fa-star" style="color:#FFB703;"></i> ${escapeHtml(product.rating)}</span>
              <button class="btn-primary" onclick="buyProduct('${product.id}')" style="padding:5px 15px; font-size:0.8rem;">Buy Now</button>
            </div>
          </div>
        </div>
      `
    )
    .join("");
}

function formatCategoryLabel(category) {
  return String(category || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function setupCategories() {
  const container = document.getElementById("categoryFilters");
  if (!container) return;

  const categoryList =
    Array.isArray(publicData.categories) && publicData.categories.length
      ? publicData.categories.filter(Boolean)
      : [...new Set(publicData.products.map((product) => product.category).filter(Boolean))];
  container.innerHTML = [
    '<button class="category-btn active" data-cat="all">All Products</button>',
    ...categoryList.map(
      (category) => `<button class="category-btn" data-cat="${category}">${escapeHtml(formatCategoryLabel(category))}</button>`
    )
  ].join("");

  document.querySelectorAll(".category-btn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".category-btn").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderProducts(button.dataset.cat);
    });
  });
}

function renderLeaderboard() {
  const container = document.getElementById("leaderboardContainer");
  if (!container) return;

  if (!publicData.leaderboard.length) {
    container.innerHTML = '<div style="padding:1rem; text-align:center;">No quiz attempts yet.</div>';
    return;
  }

  container.innerHTML = `
    <div style="padding:1rem;">
      ${publicData.leaderboard
        .map(
          (leader) => `
            <div class="leaderboard-item">
              <div class="rank rank-${Math.min(leader.rank, 3)}">${leader.rank}</div>
              <div>
                <strong>${escapeHtml(leader.name)}</strong>
                <div style="font-size:0.8rem; color:var(--gray);">${escapeHtml(leader.subject)}</div>
              </div>
              <div style="margin-left:auto; font-weight:bold; color:var(--primary);">${escapeHtml(leader.score)}</div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function animateCounter(elementId, endValue, formatter = (value) => String(value)) {
  const element = document.getElementById(elementId);
  if (!element) return;

  let currentValue = 0;
  const step = Math.max(1, Math.ceil(endValue / 40));
  const interval = window.setInterval(() => {
    currentValue += step;
    if (currentValue >= endValue) {
      currentValue = endValue;
      window.clearInterval(interval);
    }
    element.innerText = formatter(currentValue);
  }, 20);
}

function renderStats() {
  animateCounter("studentCount", publicData.stats.totalUsers, (value) => value.toLocaleString());
  animateCounter("questionCount", publicData.stats.totalQuestions);
  animateCounter("quizCount", publicData.stats.totalQuizzesTaken, (value) => value.toLocaleString());
  document.getElementById("ratingCount").innerText = "4.8";
}

function applySettingsToUi() {
  const voiceButton = document.getElementById("voiceToggleBtn");
  const voiceStatus = document.getElementById("voiceStatus");

  if (publicData.settings.voiceReading === false && localStorage.getItem(VOICE_STORAGE_KEY) === null) {
    voiceEnabled = false;
  }

  if (voiceEnabled) {
    voiceButton.classList.add("active");
    voiceStatus.innerHTML = "Voice Reading: ON";
  } else {
    voiceButton.classList.remove("active");
    voiceStatus.innerHTML = "Voice Reading: OFF";
  }
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.getElementById(pageId).classList.add("active");

  if (pageId === "quizzes") {
    renderQuizCards("quizzesGrid");
  }

  if (pageId === "affiliate") {
    renderProducts();
    setupCategories();
  }

  if (pageId === "leaderboard") {
    renderLeaderboard();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function speakText(text) {
  if (!voiceEnabled || !speechSynthesisAvailable) return;
  if (String(currentQuiz?.subject || "").trim().toLowerCase() === "maths") return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem(VOICE_STORAGE_KEY, String(voiceEnabled));
  applySettingsToUi();

  if (
    voiceEnabled &&
    currentQuiz?.questions?.[currentQuiz.currentIndex] &&
    String(currentQuiz?.subject || "").trim().toLowerCase() !== "maths"
  ) {
    speakText(currentQuiz.questions[currentQuiz.currentIndex].question);
  } else if (speechSynthesisAvailable) {
    window.speechSynthesis.cancel();
  }
}

function startQuizInternal(subjectKey) {
  if (publicData.settings.maintenanceMode) {
    showMessage("Quiz mode is currently in maintenance mode. Please try again later.");
    return;
  }

  const classLevel = getStoredClass();
  if (!classLevel) {
    showMessage("Please select your class (6 to 12) to continue.");
    return;
  }

  const rawQuestions = publicData.questions[subjectKey] || [];
  const questions = rawQuestions.filter(
    (question) => !question?.classLevel || String(question.classLevel) === classLevel
  );
  if (questions.length < ROUND_SIZE) {
    showMessage(`This subject needs at least ${ROUND_SIZE} questions for Round 1.`);
    return;
  }

  const roundCount = Math.floor(questions.length / ROUND_SIZE);
  const allQuestions = questions.slice(0, roundCount * ROUND_SIZE);

  currentQuiz = {
    subject: subjectKey,
    subjectName: publicData.subjects.find((subject) => subject.key === subjectKey)?.name || subjectKey,
    allQuestions,
    roundSize: ROUND_SIZE,
    roundNumber: 1,
    roundCount,
    overallScore: 0,
    overallTotal: 0,
    pendingNextRound: false,
    questions: allQuestions.slice(0, ROUND_SIZE),
    currentIndex: 0,
    score: 0,
    answers: [],
    timeLeft: publicData.settings.defaultTimer || 30,
    waitingForNext: false
  };

  showPage("quiz");
  if (speechSynthesisAvailable && String(currentQuiz?.subject || "").trim().toLowerCase() === "maths") {
    window.speechSynthesis.cancel();
  }
  loadQuestion();
  startTimer();
}

function startQuiz(subjectKey) {
  if (!ensureClassSelected(subjectKey)) return;

  const run = async () => {
    try {
      await ensureQuestionsLoaded(subjectKey);
      renderQuizCards("quizCardsGrid");
      renderQuizCards("quizzesGrid");
      startQuizInternal(subjectKey);
    } catch (error) {
      showMessage(error.message);
    }
  };

  run();
}

async function ensureQuestionsLoaded(subjectKey) {
  const existing = publicData.questions?.[subjectKey];
  if (Array.isArray(existing) && existing.length) return existing;

  const classLevel = getStoredClass();
  if (!classLevel) return [];

  const query = new URLSearchParams({ subject: String(subjectKey || ""), class: String(classLevel || "") });
  const payload = await apiGet(`${PUBLIC_API_BASE}/questions?${query.toString()}`);
  const list = Array.isArray(payload?.questions) ? payload.questions : [];
  publicData.questions[subjectKey] = list;
  publicData.questionCounts[subjectKey] = list.length;
  return list;
}

function loadQuestion() {
  if (!currentQuiz) return;

  const question = currentQuiz.questions[currentQuiz.currentIndex];
  document.getElementById("quizSubjectTitle").innerText = `${currentQuiz.subjectName} Quiz`;
  document.getElementById("questionCounter").innerText =
    `Round ${currentQuiz.roundNumber}/${currentQuiz.roundCount} • Q${currentQuiz.currentIndex + 1}/${currentQuiz.questions.length}`;
  document.getElementById("questionText").innerHTML = escapeHtml(question.question);
  document.getElementById("timerDisplay").innerText = `00:${String(currentQuiz.timeLeft).padStart(2, "0")}`;
  document.getElementById("timerBar").style.width = "100%";

  const optionsContainer = document.getElementById("optionsContainer");
  optionsContainer.innerHTML = question.options
    .map(
      (option, index) => `
        <div class="option" data-opt-index="${index}" onclick="checkAnswer(${index})">
          <div class="option-letter">${String.fromCharCode(65 + index)}</div>
          <div class="option-text">${escapeHtml(normalizeOptionForDisplay(option))}</div>
        </div>
      `
    )
    .join("");

  const feedbackMessage = document.getElementById("feedbackMessage");
  feedbackMessage.style.display = "none";
  feedbackMessage.innerHTML = "";

  if (voiceEnabled) {
    speakText(question.question);
  }
}

function disableOptions() {
  document.querySelectorAll(".option").forEach((option) => {
    option.style.pointerEvents = "none";
    option.classList.add("disabled");
  });
}

function moveToNextQuestion() {
  if (!currentQuiz) return;

  if (currentQuiz.currentIndex + 1 < currentQuiz.questions.length) {
    currentQuiz.currentIndex += 1;
    currentQuiz.timeLeft = publicData.settings.defaultTimer || 30;
    currentQuiz.waitingForNext = false;
    loadQuestion();
    startTimer();
  } else {
    if (currentQuiz.roundNumber < currentQuiz.roundCount) {
      finishRound();
    } else {
      finishFinalQuiz();
    }
  }
}

function checkAnswer(selectedIndex) {
  if (!currentQuiz || currentQuiz.waitingForNext) return;

  const question = currentQuiz.questions[currentQuiz.currentIndex];
  const correct = selectedIndex === question.correct;
  const feedbackMessage = document.getElementById("feedbackMessage");

  document.querySelectorAll(".option").forEach((option) => option.classList.remove("selected"));
  document.querySelectorAll(".option")[selectedIndex]?.classList.add("selected");
  disableOptions();

  feedbackMessage.style.display = "block";
  feedbackMessage.className = `feedback-message ${correct ? "feedback-correct" : "feedback-incorrect"}`;

  if (correct) {
    currentQuiz.score += 1;
    feedbackMessage.innerHTML = "Correct! Well done.";
  } else {
    feedbackMessage.innerHTML = `Incorrect. The correct answer is: ${escapeHtml(normalizeOptionForDisplay(question.options[question.correct]))}`;
  }

  currentQuiz.answers.push({ selected: selectedIndex, correct });
  currentQuiz.waitingForNext = true;

  window.setTimeout(moveToNextQuestion, 1500);
}

function startTimer() {
  if (quizTimer) {
    window.clearInterval(quizTimer);
  }

  const timerDisplay = document.getElementById("timerDisplay");
  const timerBar = document.getElementById("timerBar");
  const baseTime = publicData.settings.defaultTimer || 30;

  quizTimer = window.setInterval(() => {
    if (!currentQuiz || currentQuiz.waitingForNext) return;

    currentQuiz.timeLeft -= 1;
    timerDisplay.innerText = `00:${String(Math.max(currentQuiz.timeLeft, 0)).padStart(2, "0")}`;
    timerBar.style.width = `${Math.max((currentQuiz.timeLeft / baseTime) * 100, 0)}%`;

    if (currentQuiz.timeLeft <= 0) {
      window.clearInterval(quizTimer);
      currentQuiz.waitingForNext = true;
      currentQuiz.answers.push({ selected: -1, correct: false });
      disableOptions();

      const question = currentQuiz.questions[currentQuiz.currentIndex];
      const feedbackMessage = document.getElementById("feedbackMessage");
      feedbackMessage.style.display = "block";
      feedbackMessage.className = "feedback-message feedback-incorrect";
      feedbackMessage.innerHTML = `Time is up. The correct answer is: ${escapeHtml(normalizeOptionForDisplay(question.options[question.correct]))}`;

      window.setTimeout(moveToNextQuestion, 1500);
    }
  }, 1000);
}

async function finishQuiz() {
  await finishFinalQuiz();
}

function configureResultsPrimaryButton(label) {
  const button = document.getElementById("retryQuizBtn");
  if (!button) return;
  button.textContent = label;
}

function startNextRound() {
  if (!currentQuiz) return;
  if (currentQuiz.roundNumber >= currentQuiz.roundCount) return;

  currentQuiz.roundNumber += 1;
  const start = (currentQuiz.roundNumber - 1) * currentQuiz.roundSize;
  const end = start + currentQuiz.roundSize;
  currentQuiz.questions = currentQuiz.allQuestions.slice(start, end);
  currentQuiz.currentIndex = 0;
  currentQuiz.score = 0;
  currentQuiz.answers = [];
  currentQuiz.timeLeft = publicData.settings.defaultTimer || 30;
  currentQuiz.waitingForNext = false;
  currentQuiz.pendingNextRound = false;

  showPage("quiz");
  loadQuestion();
  startTimer();
}

function finishRound() {
  if (!currentQuiz) return;
  if (quizTimer) {
    window.clearInterval(quizTimer);
  }
  if (speechSynthesisAvailable) {
    window.speechSynthesis.cancel();
  }

  const score = currentQuiz.score;
  const total = currentQuiz.questions.length;
  const percentage = Math.round((score / total) * 100);

  currentQuiz.overallScore += score;
  currentQuiz.overallTotal += total;
  currentQuiz.pendingNextRound = true;

  document.getElementById("finalScore").innerText = `${score}/${total}`;
  document.getElementById("resultMessage").innerText =
    `Round ${currentQuiz.roundNumber} completed. Score: ${percentage}%`;

  configureResultsPrimaryButton("Next Round");
  showPage("results");
}

async function finishFinalQuiz() {
  if (!currentQuiz) return;
  if (quizTimer) {
    window.clearInterval(quizTimer);
  }
  if (speechSynthesisAvailable) {
    window.speechSynthesis.cancel();
  }

  const score = currentQuiz.overallScore + currentQuiz.score;
  const total = currentQuiz.overallTotal + currentQuiz.questions.length;
  const percentage = Math.round((score / total) * 100);
  const profile = ensureProfile();

  document.getElementById("finalScore").innerText = `${score}/${total}`;
  document.getElementById("resultMessage").innerText =
    percentage >= 80
      ? "Excellent work. You are doing great."
      : percentage >= 60
        ? "Good job. Keep practicing to climb higher."
        : "Keep learning. Your next score will be better.";

  try {
    const payload = await apiPost(`${PUBLIC_API_BASE}/quiz-results`, {
      name: profile?.name || "Learner",
      userId: profile?.uid || "",
      subject: currentQuiz.subject,
      score,
      total
    });
    publicData.leaderboard = payload.leaderboard || publicData.leaderboard;
    publicData.stats = payload.stats || publicData.stats;
    renderLeaderboard();
    renderStats();
  } catch (error) {
    showMessage(error.message);
  }

  currentQuiz.pendingNextRound = false;
  configureResultsPrimaryButton("Try Again");
  showPage("results");
}

function buyProductInternal(id) {
  const product = publicData.products.find((item) => item.id === id);
  if (!product) return;

  if (product.url) {
    window.open(product.url, "_blank", "noopener,noreferrer");
  } else {
    showMessage("No product purchase link is available for this item yet.");
  }
}

function buyProduct(id) {
  buyProductInternal(id);
}

async function handleNewsletterSubmit(event) {
  event.preventDefault();
  const input = event.target.querySelector('input[type="email"]');
  const email = input?.value.trim();

  if (!email) {
    showMessage("Please enter your email address.");
    return;
  }

  try {
    const payload = await apiPost(`${PUBLIC_API_BASE}/newsletter`, { email });
    showMessage(payload.message);
    event.target.reset();
  } catch (error) {
    showMessage(error.message);
  }
}

async function handleContactSubmit(event) {
  event.preventDefault();
  const name = document.getElementById("contactName")?.value.trim() || "";
  const email = document.getElementById("contactEmail")?.value.trim() || "";
  const message = document.getElementById("contactMessage")?.value.trim() || "";

  if (!message) {
    showMessage("Please write your message first.");
    return;
  }

  try {
    const payload = await apiPost(`${PUBLIC_API_BASE}/contact`, { name, email, message });
    showMessage(payload.message || "Message sent successfully.");
    event.target.reset();
  } catch (error) {
    showMessage(error.message);
  }
}

async function handleFooterCommentSubmit(event) {
  event.preventDefault();
  const name = document.getElementById("footerCommentName")?.value.trim() || "";
  const message = document.getElementById("footerCommentMessage")?.value.trim() || "";

  if (!message) {
    showMessage("Please write your comment first.");
    return;
  }

  try {
    const payload = await apiPost(`${PUBLIC_API_BASE}/contact`, { name, email: "", message });
    showMessage(payload.message || "Comment sent successfully.");
    event.target.reset();
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadPublicData() {
  try {
    const classLevel = getStoredClass();
    const url = classLevel
      ? `${PUBLIC_API_BASE}/bootstrap?class=${encodeURIComponent(classLevel)}`
      : `${PUBLIC_API_BASE}/bootstrap`;
    publicData = await apiGet(url);
    if (!publicData.questionCounts) {
      publicData.questionCounts = {};
    }
    if (!publicData.questions) {
      publicData.questions = {};
    }
    renderQuizCards("quizCardsGrid");
    renderQuizCards("quizzesGrid");
    renderProducts();
    setupCategories();
    renderFooterSubjects();
    renderLeaderboard();
    renderStats();
    applySettingsToUi();
  } catch (error) {
    if (promptForBackendOnce()) {
      return;
    }
    throw error;
  }
}

function bindEvents() {
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPage(link.dataset.page);
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });

  document.querySelectorAll(".nav-link-footer").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPage(link.dataset.page);
    });
  });

  document.getElementById("startLearningBtn").addEventListener("click", () => showPage("quizzes"));
  document.getElementById("retryQuizBtn").addEventListener("click", () => {
    if (currentQuiz?.pendingNextRound) {
      startNextRound();
      return;
    }
    startQuiz(currentQuiz?.subject);
  });
  document.getElementById("homeFromResultsBtn").addEventListener("click", () => showPage("home"));
  document.getElementById("logoutBtn").addEventListener("click", () => showPage("home"));
  document.getElementById("scrollTopBtn").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("newsletterForm").addEventListener("submit", handleNewsletterSubmit);
  document.getElementById("contactForm")?.addEventListener("submit", handleContactSubmit);
  document.getElementById("footerCommentForm")?.addEventListener("submit", handleFooterCommentSubmit);
  document.getElementById("voiceToggleBtn").addEventListener("click", toggleVoice);

  const classBackdrop = document.getElementById("classBackdrop");
  const classCloseBtn = document.getElementById("classCloseBtn");
  const classCancelBtn = document.getElementById("classCancelBtn");
  const classForm = document.getElementById("classForm");
  const classSelect = document.getElementById("classSelect");

  const closeClass = () => closeClassModal();
  classCloseBtn?.addEventListener("click", closeClass);
  classCancelBtn?.addEventListener("click", closeClass);
  classBackdrop?.addEventListener("click", (event) => {
    if (event.target === classBackdrop) closeClass();
  });

  classForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = String(classSelect?.value || "").trim();
    if (!/^(6|7|8|9|10|11|12)$/.test(value)) {
      showMessage("Please select your class (6 to 12).");
      return;
    }
    localStorage.setItem(CLASS_STORAGE_KEY, value);
    const subjectKey = pendingClassSubjectKey;
    closeClassModal();
    if (subjectKey) {
      startQuizInternal(subjectKey);
    }
  });

  window.addEventListener("scroll", () => {
    updateHeaderOnScroll();
    const button = document.getElementById("scrollTopBtn");
    if (window.scrollY > 300) {
      button.classList.add("visible");
    } else {
      button.classList.remove("visible");
    }
  });
}

window.startQuiz = startQuiz;
window.checkAnswer = checkAnswer;
window.buyProduct = buyProduct;

initParticles();
bindEvents();
updateProfileUi();
trackVisitOnce();
loadPublicData().catch((error) => {
  showMessage(`Failed to load website data: ${error.message}`);
});
