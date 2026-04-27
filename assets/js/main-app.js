function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const API_ORIGIN = normalizeApiBase(window.AK_API_BASE);
const PUBLIC_API_BASE = API_ORIGIN ? `${API_ORIGIN}/api/public` : "/api/public";
const PROFILE_STORAGE_KEY = "ak_learner_profile";
const VOICE_STORAGE_KEY = "ak_voice_enabled";

let publicData = {
  subjects: [],
  questions: {},
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

function apiGet(url) {
  return fetch(url).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Request failed.");
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
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Request failed.");
    }
    return payload;
  });
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
    const signedIn = Boolean(getFirebaseUser());
    logoutBtn.innerHTML = signedIn ? '<i class="fas fa-sign-out-alt"></i> Logout' : '<i class="fas fa-user"></i> Sign In';
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
  if (getFirebaseUser()) return true;
  openAuthModal("signin", action);
  return false;
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
  const canvas = document.getElementById("particleCanvas");
  const ctx = canvas.getContext("2d");
  const particles = [];

  resizeCanvas();
  for (let i = 0; i < 80; i += 1) {
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
      const count = (publicData.questions[subject.key] || []).length;
      return `
        <div class="quiz-card" onclick="startQuiz('${subject.key}')">
          <div class="quiz-card-inner">
            <div class="quiz-card-front">
              <i class="fas ${subject.icon}" style="color:${subject.color}"></i>
              <h3>${escapeHtml(subject.name)}</h3>
              <p>${count} Questions</p>
            </div>
            <div class="quiz-card-back">
              <i class="fas fa-play-circle" style="font-size:2rem"></i>
              <h3>Start Quiz</h3>
              <button>Begin</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
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

function setupCategories() {
  const container = document.getElementById("categoryFilters");
  if (!container) return;

  const categoryList = [...new Set(publicData.products.map((product) => product.category))];
  container.innerHTML = [
    '<button class="category-btn active" data-cat="all">All Products</button>',
    ...categoryList.map((category) => `<button class="category-btn" data-cat="${category}">${escapeHtml(category)}</button>`)
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

  if (voiceEnabled && currentQuiz?.questions?.[currentQuiz.currentIndex]) {
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

  const questions = publicData.questions[subjectKey] || [];
  if (!questions.length) {
    showMessage("No questions are available for this subject yet.");
    return;
  }

  currentQuiz = {
    subject: subjectKey,
    subjectName: publicData.subjects.find((subject) => subject.key === subjectKey)?.name || subjectKey,
    questions: [...questions],
    currentIndex: 0,
    score: 0,
    answers: [],
    timeLeft: publicData.settings.defaultTimer || 30,
    waitingForNext: false
  };

  showPage("quiz");
  loadQuestion();
  startTimer();
}

function startQuiz(subjectKey) {
  if (!requireAuth(() => startQuizInternal(subjectKey))) return;
  startQuizInternal(subjectKey);
}

function loadQuestion() {
  if (!currentQuiz) return;

  const question = currentQuiz.questions[currentQuiz.currentIndex];
  document.getElementById("quizSubjectTitle").innerText = `${currentQuiz.subjectName} Quiz`;
  document.getElementById("questionCounter").innerText = `Q${currentQuiz.currentIndex + 1}/${currentQuiz.questions.length}`;
  document.getElementById("questionText").innerHTML = escapeHtml(question.question);
  document.getElementById("timerDisplay").innerText = `00:${String(currentQuiz.timeLeft).padStart(2, "0")}`;
  document.getElementById("timerBar").style.width = "100%";

  const optionsContainer = document.getElementById("optionsContainer");
  optionsContainer.innerHTML = question.options
    .map(
      (option, index) => `
        <div class="option" data-opt-index="${index}" onclick="checkAnswer(${index})">
          <div class="option-letter">${String.fromCharCode(65 + index)}</div>
          <div class="option-text">${escapeHtml(option)}</div>
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
    finishQuiz();
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
    feedbackMessage.innerHTML = `Incorrect. The correct answer is: ${escapeHtml(question.options[question.correct])}`;
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
      feedbackMessage.innerHTML = `Time is up. The correct answer is: ${escapeHtml(question.options[question.correct])}`;

      window.setTimeout(moveToNextQuestion, 1500);
    }
  }, 1000);
}

async function finishQuiz() {
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
  if (!requireAuth(() => buyProductInternal(id))) return;
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

async function loadPublicData() {
  publicData = await apiGet(`${PUBLIC_API_BASE}/bootstrap`);
  renderQuizCards("quizCardsGrid");
  renderQuizCards("quizzesGrid");
  renderProducts();
  setupCategories();
  renderLeaderboard();
  renderStats();
  applySettingsToUi();
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
  document.getElementById("retryQuizBtn").addEventListener("click", () => startQuiz(currentQuiz?.subject));
  document.getElementById("homeFromResultsBtn").addEventListener("click", () => showPage("home"));
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    const api = getFirebaseApi();
    if (getFirebaseUser()) {
      try {
        await api?.signOut?.();
      } catch (error) {
        showMessage(error.message);
      }
      updateProfileUi();
      return;
    }
    openAuthModal("signin");
  });
  document.getElementById("scrollTopBtn").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("newsletterForm").addEventListener("submit", handleNewsletterSubmit);
  document.getElementById("voiceToggleBtn").addEventListener("click", toggleVoice);

  const authUi = getAuthElements();
  authUi.closeBtn?.addEventListener("click", closeAuthModal);
  authUi.backdrop?.addEventListener("click", (event) => {
    if (event.target === authUi.backdrop) closeAuthModal();
  });
  authUi.switchBtn?.addEventListener("click", () => {
    setAuthMode(authMode === "signup" ? "signin" : "signup");
  });
  authUi.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthError("");
    const api = getFirebaseApi();
    if (!api) {
      setAuthError("Firebase is not ready. Please refresh and try again.");
      return;
    }

    const name = authUi.name?.value.trim() || "";
    const email = authUi.email?.value.trim() || "";
    const password = authUi.password?.value || "";

    if (!email || !password) {
      setAuthError("Email and password are required.");
      return;
    }

    try {
      if (authMode === "signup") {
        if (!name) {
          setAuthError("Please enter your full name.");
          return;
        }
        await api.signUp({ name, email, password });
      } else {
        await api.signIn({ email, password });
      }

      closeAuthModal();
      updateProfileUi();
      const action = pendingAuthAction;
      pendingAuthAction = null;
      if (typeof action === "function") {
        action();
      }
    } catch (error) {
      setAuthError(error.message || "Authentication failed.");
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
setAuthMode("signin");
let authListenerAttached = false;
function attachAuthListenerIfReady() {
  if (authListenerAttached) return;
  const api = getFirebaseApi();
  if (!api?.onAuthStateChanged) return;
  authListenerAttached = true;
  api.onAuthStateChanged(() => {
    updateProfileUi();
    if (getFirebaseUser() && pendingAuthAction) {
      const action = pendingAuthAction;
      pendingAuthAction = null;
      action();
    }
  });
}

attachAuthListenerIfReady();
const authWaitInterval = window.setInterval(() => {
  attachAuthListenerIfReady();
  if (authListenerAttached) {
    window.clearInterval(authWaitInterval);
  }
}, 200);
loadPublicData().catch((error) => {
  showMessage(`Failed to load website data: ${error.message}`);
});
