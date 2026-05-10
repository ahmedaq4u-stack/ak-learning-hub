const express = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const helmet = require("helmet");
const path = require("path");
const crypto = require("crypto");
const { version: APP_VERSION } = require("./package.json");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DB_DIR = path.join(ROOT_DIR, "data");
const DB_PATH = path.join(DB_DIR, "db.json");
const DEFAULT_ADMIN_PASSWORD = "ejaz4u123";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const FORCE_ADMIN_PASSWORD = String(process.env.FORCE_ADMIN_PASSWORD || "").trim().toLowerCase() === "true";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DATABASE_URL = process.env.DATABASE_URL || "";
const ALLOW_DB_FALLBACK =
  String(process.env.ALLOW_DB_FALLBACK || "").trim().toLowerCase() === "true" ||
  (!DATABASE_URL && process.env.NODE_ENV !== "production");
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

let pgPool = null;
if (DATABASE_URL) {
  const { Pool } = require("pg");
  const shouldUseSsl =
    process.env.PGSSL === "false" ? false : !/localhost|127\.0\.0\.1/i.test(DATABASE_URL);
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
  });
}

const authTokens = new Map();

const DEFAULT_SUBJECTS = [
  { key: "maths", name: "Mathematics", icon: "fa-calculator", color: "#6366F1" },
  { key: "science", name: "General Science", icon: "fa-flask", color: "#10B981" },
  { key: "physics", name: "Physics", icon: "fa-atom", color: "#EC4899" },
  { key: "chemistry", name: "Chemistry", icon: "fa-vial", color: "#F59E0B" },
  { key: "biology", name: "Biology", icon: "fa-dna", color: "#8B5CF6" },
  { key: "islamic-history", name: "Islamic History", icon: "fa-mosque", color: "#06B6D4" }
];

const DEFAULT_QUESTIONS = {
  maths: [
    { id: crypto.randomUUID(), question: "What is pi to two decimals?", options: ["3.14", "3.16", "3.12", "3.18"], correct: 0, explanation: "" },
    { id: crypto.randomUUID(), question: "15 x 8 = ?", options: ["100", "110", "120", "130"], correct: 2, explanation: "" },
    { id: crypto.randomUUID(), question: "2x + 5 = 15, x = ?", options: ["5", "7", "8", "10"], correct: 0, explanation: "" },
    { id: crypto.randomUUID(), question: "Area of a square with side 6 cm?", options: ["24 cm2", "30 cm2", "36 cm2", "42 cm2"], correct: 2, explanation: "" }
  ],
  science: [
    { id: crypto.randomUUID(), question: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Saturn"], correct: 1, explanation: "" },
    { id: crypto.randomUUID(), question: "What is the chemical symbol for Gold?", options: ["Go", "Gd", "Au", "Ag"], correct: 2, explanation: "" },
    { id: crypto.randomUUID(), question: "What is H2O commonly known as?", options: ["Oxygen", "Hydrogen", "Water", "Salt"], correct: 2, explanation: "" }
  ],
  physics: [
    { id: crypto.randomUUID(), question: "What is the unit of force?", options: ["Joule", "Newton", "Watt", "Pascal"], correct: 1, explanation: "" },
    { id: crypto.randomUUID(), question: "What is the speed of light?", options: ["3x10^8 m/s", "3x10^6 m/s", "3x10^5 m/s", "3x10^7 m/s"], correct: 0, explanation: "" }
  ],
  chemistry: [
    { id: crypto.randomUUID(), question: "What is the pH of pure water?", options: ["5", "7", "9", "8"], correct: 1, explanation: "" },
    { id: crypto.randomUUID(), question: "Which element has the symbol O?", options: ["Oxygen", "Gold", "Osmium", "Silver"], correct: 0, explanation: "" }
  ],
  biology: [
    { id: crypto.randomUUID(), question: "What is the largest organ in the human body?", options: ["Heart", "Liver", "Skin", "Brain"], correct: 2, explanation: "" },
    { id: crypto.randomUUID(), question: "Which gas do plants absorb?", options: ["Oxygen", "Carbon Dioxide", "Nitrogen", "Hydrogen"], correct: 1, explanation: "" }
  ],
  "islamic-history": [
    { id: crypto.randomUUID(), question: "Who was the first Caliph in Islam?", options: ["Umar ibn Khattab", "Abu Bakr Siddiq", "Usman ibn Affan", "Ali ibn Abi Talib"], correct: 1, explanation: "" },
    { id: crypto.randomUUID(), question: "Where is the Kaaba located?", options: ["Madinah", "Jerusalem", "Makkah", "Cairo"], correct: 2, explanation: "" }
  ]
};

const DEFAULT_CATEGORIES = [
  "gadgets",
  "books",
  "skincare",
  "fashion",
  "fitness",
  "herbal-medicines",
  "electronics",
  "home-decor",
  "kitchen"
];

const DEFAULT_PRODUCTS = [
  {
    id: crypto.randomUUID(),
    title: "Wireless Headphones",
    description: "Noise cancellation and 30 hour battery life.",
    price: "$49",
    rating: 4.5,
    category: "gadgets",
    platform: "Temu",
    url: "https://www.temu.com/",
    image: ""
  },
  {
    id: crypto.randomUUID(),
    title: "Math Workbook",
    description: "Algebra and geometry practice for daily learning.",
    price: "$24",
    rating: 4.8,
    category: "books",
    platform: "Amazon",
    url: "https://www.amazon.com/",
    image: ""
  }
];

function createDefaultDatabase() {
  return {
    adminPassword: ADMIN_PASSWORD,
    adminAllowedPhones: ["+923332786013"],
    subjects: DEFAULT_SUBJECTS,
    questions: DEFAULT_QUESTIONS,
    categories: DEFAULT_CATEGORIES,
    products: DEFAULT_PRODUCTS,
    analytics: {
      totalVisitors: 0,
      totalPageViews: 0,
      daily: {}
    },
    meta: {
      instanceId: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    },
    settings: {
      maintenanceMode: false,
      voiceReading: true,
      defaultTimer: 30
    },
    subscribers: [],
    quizAttempts: [],
    statsSeed: {
      totalUsers: 1580,
      totalQuizzesTaken: 2847
    }
  };
}

function ensureDatabaseFile() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(createDefaultDatabase(), null, 2));
  }
}

async function ensureDatabaseStore() {
  if (!pgPool) {
    ensureDatabaseFile();
    return;
  }

  try {
    await pgPool.query(
      "CREATE TABLE IF NOT EXISTS ak_kv (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT NOW())"
    );

    const existing = await pgPool.query("SELECT 1 FROM ak_kv WHERE key = $1 LIMIT 1", ["db"]);
    if (existing.rowCount === 0) {
      await pgPool.query(
        "INSERT INTO ak_kv(key, value, updated_at) VALUES ($1, $2, NOW())",
        ["db", createDefaultDatabase()]
      );
    }
  } catch (error) {
    console.error("Postgres unavailable.");
    console.error(error);
    if (ALLOW_DB_FALLBACK) {
      console.error("Falling back to local JSON database.");
      pgPool = null;
      ensureDatabaseFile();
      return;
    }
    throw new Error("DATABASE_URL is set but Postgres is not reachable. Refusing to start without database.");
  }
}

async function readDb() {
  if (!pgPool) {
    ensureDatabaseFile();
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return normalizeDb(parsed);
  }

  await ensureDatabaseStore();
  if (!pgPool) {
    ensureDatabaseFile();
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return normalizeDb(parsed);
  }
  const result = await pgPool.query("SELECT value FROM ak_kv WHERE key = $1 LIMIT 1", ["db"]);
  const stored = result.rows?.[0]?.value || {};
  return normalizeDb(stored);
}

async function writeDb(data) {
  const normalized = normalizeDb(data);

  if (!pgPool) {
    ensureDatabaseFile();
    fs.writeFileSync(DB_PATH, JSON.stringify(normalized, null, 2));
    return;
  }

  await ensureDatabaseStore();
  if (!pgPool) {
    ensureDatabaseFile();
    fs.writeFileSync(DB_PATH, JSON.stringify(normalized, null, 2));
    return;
  }
  await pgPool.query(
    "INSERT INTO ak_kv(key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
    ["db", normalized]
  );
}

function normalizeDb(db) {
  const normalized = {
    ...createDefaultDatabase(),
    ...db
  };

  if (!Array.isArray(normalized.subjects) || normalized.subjects.length === 0) {
    normalized.subjects = DEFAULT_SUBJECTS;
  }

  if (!normalized.questions || typeof normalized.questions !== "object") {
    normalized.questions = {};
  }

  for (const subject of normalized.subjects) {
    if (!Array.isArray(normalized.questions[subject.key])) {
      normalized.questions[subject.key] = [];
    }
  }

  normalized.categories = Array.isArray(normalized.categories) ? normalized.categories : [...DEFAULT_CATEGORIES];
  normalized.products = Array.isArray(normalized.products) ? normalized.products : [];
  normalized.subscribers = Array.isArray(normalized.subscribers) ? normalized.subscribers : [];
  normalized.quizAttempts = Array.isArray(normalized.quizAttempts) ? normalized.quizAttempts : [];
  normalized.contactMessages = Array.isArray(normalized.contactMessages) ? normalized.contactMessages : [];
  normalized.statsSeed = normalized.statsSeed || { totalUsers: 1580, totalQuizzesTaken: 2847 };
  normalized.settings = {
    maintenanceMode: Boolean(normalized.settings?.maintenanceMode),
    voiceReading: normalized.settings?.voiceReading !== false,
    defaultTimer: clampNumber(normalized.settings?.defaultTimer, 10, 120, 30)
  };

  const analytics = normalized.analytics && typeof normalized.analytics === "object" ? normalized.analytics : {};
  normalized.analytics = {
    totalVisitors: clampNumber(analytics.totalVisitors, 0, Number.MAX_SAFE_INTEGER, 0),
    totalPageViews: clampNumber(analytics.totalPageViews, 0, Number.MAX_SAFE_INTEGER, 0),
    daily: analytics.daily && typeof analytics.daily === "object" ? analytics.daily : {}
  };

  const meta = normalized.meta && typeof normalized.meta === "object" ? normalized.meta : {};
  normalized.meta = {
    instanceId: cleanText(meta.instanceId) || crypto.randomUUID(),
    createdAt: cleanText(meta.createdAt) || new Date().toISOString()
  };

  if (!normalized.adminPassword) {
    normalized.adminPassword = ADMIN_PASSWORD;
  }

  normalized.adminAllowedPhones = Array.isArray(normalized.adminAllowedPhones)
    ? normalized.adminAllowedPhones.map((value) => cleanText(value)).filter(Boolean)
    : ["+923332786013"];

  return normalized;
}

function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function trimAnalyticsDaily(daily, keepDays = 90) {
  const keys = Object.keys(daily || {}).sort();
  if (keys.length <= keepDays) return daily;
  const cutoffKeys = keys.slice(0, Math.max(0, keys.length - keepDays));
  for (const key of cutoffKeys) {
    delete daily[key];
  }
  return daily;
}

function recordVisit(db, visitorId) {
  const cleanVisitorId = cleanText(visitorId).slice(0, 80);
  if (!cleanVisitorId) return;

  const dayKey = getDateKey();
  const analytics = db.analytics;
  analytics.daily = analytics.daily && typeof analytics.daily === "object" ? analytics.daily : {};

  const dayRecord = analytics.daily[dayKey] && typeof analytics.daily[dayKey] === "object" ? analytics.daily[dayKey] : {};
  const seen = Array.isArray(dayRecord.visitorIds) ? dayRecord.visitorIds : [];

  const nextRecord = {
    visitors: clampNumber(dayRecord.visitors, 0, Number.MAX_SAFE_INTEGER, 0),
    pageViews: clampNumber(dayRecord.pageViews, 0, Number.MAX_SAFE_INTEGER, 0),
    visitorIds: seen
  };

  analytics.totalPageViews = clampNumber(analytics.totalPageViews, 0, Number.MAX_SAFE_INTEGER, 0) + 1;
  nextRecord.pageViews += 1;

  if (!seen.includes(cleanVisitorId)) {
    if (seen.length < 20000) {
      seen.push(cleanVisitorId);
    }
    analytics.totalVisitors = clampNumber(analytics.totalVisitors, 0, Number.MAX_SAFE_INTEGER, 0) + 1;
    nextRecord.visitors += 1;
  }

  analytics.daily[dayKey] = nextRecord;
  trimAnalyticsDaily(analytics.daily, 90);
}

function getAnalyticsSnapshot(db) {
  const dayKey = getDateKey();
  const dayRecord = db.analytics?.daily?.[dayKey] || {};
  return {
    totalVisitors: clampNumber(db.analytics?.totalVisitors, 0, Number.MAX_SAFE_INTEGER, 0),
    totalPageViews: clampNumber(db.analytics?.totalPageViews, 0, Number.MAX_SAFE_INTEGER, 0),
    visitorsToday: clampNumber(dayRecord.visitors, 0, Number.MAX_SAFE_INTEGER, 0),
    pageViewsToday: clampNumber(dayRecord.pageViews, 0, Number.MAX_SAFE_INTEGER, 0)
  };
}

async function getStorageMode() {
  if (!DATABASE_URL || !pgPool) {
    return { mode: "file", allowFallback: true };
  }
  try {
    await ensureDatabaseStore();
    if (!pgPool) {
      return { mode: "file", allowFallback: true };
    }
    return { mode: "postgres", allowFallback: ALLOW_DB_FALLBACK };
  } catch (error) {
    return { mode: "postgres-error", allowFallback: ALLOW_DB_FALLBACK, error: String(error?.message || error) };
  }
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function makeSubjectKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(value) {
  return String(value || "").trim();
}

function shouldUpdateAdminPassword(currentPassword) {
  if (!ADMIN_PASSWORD) return false;
  if (FORCE_ADMIN_PASSWORD) return true;
  const cleaned = cleanText(currentPassword);
  return !cleaned || cleaned === DEFAULT_ADMIN_PASSWORD;
}

async function applyAdminPasswordOverride() {
  try {
    const db = await readDb();
    if (shouldUpdateAdminPassword(db.adminPassword) && db.adminPassword !== ADMIN_PASSWORD) {
      db.adminPassword = ADMIN_PASSWORD;
      await writeDb(db);
      console.log("Admin password updated from environment variables.");
    }
  } catch (error) {
    console.error("Failed to apply admin password override.");
    console.error(error);
  }
}

function normalizeClassLevel(value) {
  const cleaned = cleanText(value);
  return /^(6|7|8|9|10|11|12)$/.test(cleaned) ? cleaned : "";
}

function filterQuestionsByClass(questionsBySubject, classLevel) {
  const normalizedClass = normalizeClassLevel(classLevel);
  if (!normalizedClass) return questionsBySubject;

  const filtered = {};
  for (const [subjectKey, list] of Object.entries(questionsBySubject || {})) {
    filtered[subjectKey] = Array.isArray(list)
      ? list.filter((question) => !question?.classLevel || String(question?.classLevel || "") === normalizedClass)
      : [];
  }
  return filtered;
}

function buildQuestionCountsBySubject(questionsBySubject, classLevel) {
  const normalizedClass = normalizeClassLevel(classLevel);
  const counts = {};
  for (const [subjectKey, list] of Object.entries(questionsBySubject || {})) {
    const rows = Array.isArray(list) ? list : [];
    const filtered = normalizedClass
      ? rows.filter((question) => !question?.classLevel || String(question?.classLevel || "") === normalizedClass)
      : rows;
    counts[subjectKey] = filtered.length;
  }
  return counts;
}

function toTitleFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getQuestionCount(db) {
  return Object.values(db.questions).reduce((total, list) => total + list.length, 0);
}

function getAttemptStats(db) {
  const totalAttempts = db.quizAttempts.length;
  const scoredAttempts = db.quizAttempts.filter((attempt) => Number.isFinite(attempt.percentage));
  const averageScore = scoredAttempts.length
    ? Math.round(scoredAttempts.reduce((sum, attempt) => sum + attempt.percentage, 0) / scoredAttempts.length)
    : 72;

  return {
    totalAttempts,
    averageScore
  };
}

function buildLeaderboard(db, limit = 10) {
  return [...db.quizAttempts]
    .sort((a, b) => {
      if (b.percentage !== a.percentage) {
        return b.percentage - a.percentage;
      }
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, limit)
    .map((attempt, index) => ({
      rank: index + 1,
      id: attempt.id,
      name: attempt.name,
      score: `${attempt.percentage}%`,
      percentage: attempt.percentage,
      subject: attempt.subjectName || attempt.subject,
      createdAt: attempt.createdAt
    }));
}

function buildPublicPayload(db) {
  const attemptStats = getAttemptStats(db);
  const questionCount = getQuestionCount(db);
  const analytics = getAnalyticsSnapshot(db);

  return {
    subjects: db.subjects,
    questions: db.questions,
    categories: db.categories,
    products: db.products,
    settings: db.settings,
    leaderboard: buildLeaderboard(db),
    stats: {
      totalUsers: db.statsSeed.totalUsers + db.subscribers.length,
      totalQuestions: questionCount,
      totalQuizzesTaken: db.statsSeed.totalQuizzesTaken + attemptStats.totalAttempts,
      averageScore: attemptStats.averageScore,
      totalVisitors: analytics.totalVisitors,
      visitorsToday: analytics.visitorsToday,
      totalPageViews: analytics.totalPageViews,
      pageViewsToday: analytics.pageViewsToday
    }
  };
}

function buildAdminPayload(db) {
  const publicPayload = buildPublicPayload(db);
  return {
    ...publicPayload,
    subscribers: db.subscribers,
    quizAttempts: db.quizAttempts,
    stats: {
      ...publicPayload.stats,
      totalSubjects: db.subjects.length,
      totalProducts: db.products.length
    }
  };
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const record = authTokens.get(token);
  const expiresAt = typeof record === "number" ? record : record?.expiresAt;

  if (!token || !expiresAt || expiresAt < Date.now()) {
    if (token) {
      authTokens.delete(token);
    }
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, record] of authTokens.entries()) {
    const expiresAt = typeof record === "number" ? record : record?.expiresAt;
    if (!expiresAt || expiresAt < now) {
      authTokens.delete(token);
    }
  }
}

app.use(express.json({ limit: "2mb" }));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  } else if (!ALLOWED_ORIGINS.length) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

const adminLoginRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const publicContactRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const publicVisitRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
});

app.get("/api/public/bootstrap", async (req, res) => {
  const db = await readDb();
  const payload = buildPublicPayload(db);
  const classLevel = normalizeClassLevel(req.query.class);
  const includeQuestions = String(req.query.includeQuestions || "").trim().toLowerCase();
  const shouldIncludeQuestions = includeQuestions === "1" || includeQuestions === "true" || includeQuestions === "yes";

  payload.questionCounts = buildQuestionCountsBySubject(payload.questions, classLevel);
  payload.stats.totalQuestions = Object.values(payload.questionCounts).reduce((total, count) => total + count, 0);

  if (classLevel) {
    payload.questions = filterQuestionsByClass(payload.questions, classLevel);
  }
  if (!shouldIncludeQuestions) {
    payload.questions = {};
  }
  res.json(payload);
});

app.get("/api/public/questions", async (req, res) => {
  const db = await readDb();
  const subject = cleanText(req.query.subject);
  const classLevel = normalizeClassLevel(req.query.class);

  if (!subject || !db.questions[subject]) {
    return res.status(400).json({ message: "Valid subject is required." });
  }

  const list = Array.isArray(db.questions[subject]) ? db.questions[subject] : [];
  const filtered = classLevel
    ? list.filter((question) => !question?.classLevel || String(question?.classLevel || "") === classLevel)
    : list;

  res.json({
    subject,
    classLevel: classLevel || "",
    questions: filtered
  });
});

app.get("/api/public/health", async (req, res) => {
  try {
    const storage = await getStorageMode();
    const db = await readDb();
    res.json({
      ok: true,
      version: APP_VERSION,
      storage: storage.mode,
      allowFallback: storage.allowFallback,
      instanceId: db.meta?.instanceId || "",
      createdAt: db.meta?.createdAt || "",
      totalQuestions: getQuestionCount(db)
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || "Health check failed." });
  }
});

app.post("/api/public/visit", publicVisitRateLimit, async (req, res) => {
  const db = await readDb();
  const visitorId = cleanText(req.body.visitorId);
  if (!visitorId) {
    return res.status(400).json({ message: "visitorId is required." });
  }

  recordVisit(db, visitorId);
  await writeDb(db);
  res.json({ ok: true });
});

app.post("/api/public/newsletter", async (req, res) => {
  const db = await readDb();
  const email = cleanText(req.body.email).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  if (!db.subscribers.find((item) => item.email === email)) {
    db.subscribers.push({
      id: crypto.randomUUID(),
      email,
      createdAt: new Date().toISOString()
    });
    await writeDb(db);
  }

  res.json({ message: "Subscription saved successfully." });
});

app.post("/api/public/contact", publicContactRateLimit, async (req, res) => {
  const db = await readDb();
  const name = cleanText(req.body.name);
  const email = cleanText(req.body.email).toLowerCase();
  const message = cleanText(req.body.message);

  if (!message || message.length < 5) {
    return res.status(400).json({ message: "Please write a message (at least 5 characters)." });
  }

  if (message.length > 2000) {
    return res.status(400).json({ message: "Message is too long." });
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  db.contactMessages.push({
    id: crypto.randomUUID(),
    name: name ? name.slice(0, 80) : "",
    email: email ? email.slice(0, 120) : "",
    message,
    createdAt: new Date().toISOString()
  });

  await writeDb(db);
  res.json({ message: "Thanks. Your message has been received." });
});

app.post("/api/public/quiz-results", async (req, res) => {
  const db = await readDb();
  const name = cleanText(req.body.name) || "Guest Learner";
  const subject = cleanText(req.body.subject);
  const total = clampNumber(req.body.total, 1, 500, 1);
  const score = clampNumber(req.body.score, 0, total, 0);
  const subjectName = db.subjects.find((item) => item.key === subject)?.name || subject;

  if (!subject) {
    return res.status(400).json({ message: "Subject is required." });
  }

  db.quizAttempts.push({
    id: crypto.randomUUID(),
    name,
    subject,
    subjectName,
    score,
    total,
    percentage: Math.round((score / total) * 100),
    createdAt: new Date().toISOString()
  });

  await writeDb(db);

  res.json({
    message: "Quiz result saved.",
    leaderboard: buildLeaderboard(db),
    stats: buildPublicPayload(db).stats
  });
});

app.post("/api/admin/login", adminLoginRateLimit, async (req, res) => {
  cleanupExpiredTokens();
  const db = await readDb();
  const password = cleanText(req.body.password);

  if (password !== db.adminPassword) {
    return res.status(401).json({ message: "Incorrect password." });
  }

  const token = createToken();
  authTokens.set(token, Date.now() + TOKEN_TTL_MS);

  res.json({ token });
});

app.get("/api/admin/bootstrap", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.json(buildAdminPayload(db));
});

app.post("/api/admin/subjects", authMiddleware, async (req, res) => {
  const db = await readDb();
  const name = cleanText(req.body.name);
  const key = makeSubjectKey(name);

  if (!name || !key) {
    return res.status(400).json({ message: "Subject name is required." });
  }

  if (db.subjects.find((subject) => subject.key === key)) {
    return res.status(400).json({ message: "Subject already exists." });
  }

  const colors = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#8B5CF6", "#06B6D4", "#F97316", "#D946EF"];
  db.subjects.push({
    key,
    name,
    icon: "fa-book",
    color: colors[db.subjects.length % colors.length]
  });
  db.questions[key] = [];

  await writeDb(db);
  res.json({ message: "Subject added successfully." });
});

app.delete("/api/admin/subjects/:key", authMiddleware, async (req, res) => {
  const db = await readDb();
  const key = req.params.key;
  const subject = db.subjects.find((item) => item.key === key);

  if (!subject) {
    return res.status(404).json({ message: "Subject not found." });
  }

  db.subjects = db.subjects.filter((item) => item.key !== key);
  delete db.questions[key];

  await writeDb(db);
  res.json({ message: "Subject removed successfully." });
});

app.post("/api/admin/questions", authMiddleware, async (req, res) => {
  const db = await readDb();
  const subject = cleanText(req.body.subject);
  const classLevel = normalizeClassLevel(req.body.classLevel);
  const question = cleanText(req.body.question);
  const explanation = cleanText(req.body.explanation);
  const options = Array.isArray(req.body.options)
    ? req.body.options.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const correct = clampNumber(req.body.correct, 0, 3, 0);

  if (!subject || !db.questions[subject]) {
    return res.status(400).json({ message: "Valid subject is required." });
  }

  if (!question || options.length !== 4) {
    return res.status(400).json({ message: "Question and four options are required." });
  }

  db.questions[subject].push({
    id: crypto.randomUUID(),
    question,
    options,
    correct,
    explanation,
    ...(classLevel ? { classLevel } : {})
  });

  await writeDb(db);
  res.json({ message: "Question added successfully." });
});

app.put("/api/admin/questions/:id", authMiddleware, async (req, res) => {
  const db = await readDb();
  const subject = cleanText(req.body.subject);
  const id = req.params.id;

  if (!subject || !db.questions[subject]) {
    return res.status(400).json({ message: "Valid subject is required." });
  }

  const questionIndex = db.questions[subject].findIndex((item) => item.id === id);
  if (questionIndex === -1) {
    return res.status(404).json({ message: "Question not found." });
  }

  const question = cleanText(req.body.question);
  const explanation = cleanText(req.body.explanation);
  const classLevel = normalizeClassLevel(req.body.classLevel);
  const options = Array.isArray(req.body.options)
    ? req.body.options.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const correct = clampNumber(req.body.correct, 0, 3, 0);

  if (!question || options.length !== 4) {
    return res.status(400).json({ message: "Question and four options are required." });
  }

  const updatedQuestion = {
    ...db.questions[subject][questionIndex],
    question,
    options,
    correct,
    explanation
  };
  if (classLevel) {
    updatedQuestion.classLevel = classLevel;
  } else {
    delete updatedQuestion.classLevel;
  }
  db.questions[subject][questionIndex] = updatedQuestion;

  await writeDb(db);
  res.json({ message: "Question updated successfully." });
});

app.delete("/api/admin/questions/:id", authMiddleware, async (req, res) => {
  const db = await readDb();
  const subject = cleanText(req.query.subject);
  const id = req.params.id;

  if (!subject || !db.questions[subject]) {
    return res.status(400).json({ message: "Valid subject is required." });
  }

  db.questions[subject] = db.questions[subject].filter((item) => item.id !== id);
  await writeDb(db);
  res.json({ message: "Question deleted successfully." });
});

app.delete("/api/admin/questions", authMiddleware, async (req, res) => {
  const db = await readDb();
  const subject = cleanText(req.query.subject);
  const classLevel = normalizeClassLevel(req.query.classLevel);

  if (!subject || !db.questions[subject]) {
    return res.status(400).json({ message: "Valid subject is required." });
  }

  const beforeCount = db.questions[subject].length;
  if (classLevel) {
    db.questions[subject] = db.questions[subject].filter((item) => String(item.classLevel || "") !== classLevel);
  } else {
    db.questions[subject] = [];
  }
  const removed = Math.max(beforeCount - db.questions[subject].length, 0);
  await writeDb(db);
  res.json({
    message: classLevel
      ? `Removed ${removed} questions for Class ${classLevel}.`
      : `Removed ${removed} questions successfully.`,
    removed
  });
});

app.post("/api/admin/questions/bulk", authMiddleware, async (req, res) => {
  const db = await readDb();
  const subject = cleanText(req.body.subject);
  const incomingQuestions = Array.isArray(req.body.questions) ? req.body.questions : [];

  if (!subject || !db.questions[subject]) {
    return res.status(400).json({ message: "Valid subject is required." });
  }

  let added = 0;
  for (const item of incomingQuestions) {
    const question = cleanText(item.question);
    const explanation = cleanText(item.explanation);
    const classLevel = normalizeClassLevel(item.classLevel);
    const options = Array.isArray(item.options) ? item.options.map((option) => cleanText(option)).filter(Boolean) : [];
    const correct = clampNumber(item.correct, 0, 3, 0);

    if (question && options.length === 4) {
      db.questions[subject].push({
        id: crypto.randomUUID(),
        question,
        options,
        correct,
        explanation,
        ...(classLevel ? { classLevel } : {})
      });
      added += 1;
    }
  }

  await writeDb(db);
  res.json({ message: `Added ${added} questions successfully.`, added });
});

app.post("/api/admin/categories", authMiddleware, async (req, res) => {
  const db = await readDb();
  const category = makeSubjectKey(req.body.name);

  if (!category) {
    return res.status(400).json({ message: "Category name is required." });
  }

  if (db.categories.includes(category)) {
    return res.status(400).json({ message: "Category already exists." });
  }

  db.categories.push(category);
  await writeDb(db);
  res.json({ message: "Category added successfully." });
});

app.delete("/api/admin/categories/:name", authMiddleware, async (req, res) => {
  const db = await readDb();
  const category = req.params.name;

  db.categories = db.categories.filter((item) => item !== category);
  await writeDb(db);
  res.json({ message: "Category removed successfully." });
});

app.post("/api/admin/products", authMiddleware, async (req, res) => {
  const db = await readDb();
  const title = cleanText(req.body.title);
  const description = cleanText(req.body.description);
  const price = cleanText(req.body.price);
  const rating = clampNumber(req.body.rating, 0, 5, 4.5);
  const category = cleanText(req.body.category);
  const platform = cleanText(req.body.platform) || "Website";
  const url = cleanText(req.body.url);
  const image = cleanText(req.body.image);

  if (!title || !description || !price) {
    return res.status(400).json({ message: "Title, description and price are required." });
  }

  db.products.push({
    id: crypto.randomUUID(),
    title,
    description,
    price,
    rating,
    category: category || db.categories[0] || "general",
    platform,
    url,
    image
  });

  await writeDb(db);
  res.json({ message: "Product added successfully." });
});

app.put("/api/admin/products/:id", authMiddleware, async (req, res) => {
  const db = await readDb();
  const productIndex = db.products.findIndex((item) => item.id === req.params.id);

  if (productIndex === -1) {
    return res.status(404).json({ message: "Product not found." });
  }

  const title = cleanText(req.body.title);
  const description = cleanText(req.body.description);
  const price = cleanText(req.body.price);
  const rating = clampNumber(req.body.rating, 0, 5, 4.5);
  const category = cleanText(req.body.category);
  const platform = cleanText(req.body.platform) || "Website";
  const url = cleanText(req.body.url);
  const image = cleanText(req.body.image);

  if (!title || !description || !price) {
    return res.status(400).json({ message: "Title, description and price are required." });
  }

  db.products[productIndex] = {
    ...db.products[productIndex],
    title,
    description,
    price,
    rating,
    category: category || db.products[productIndex].category,
    platform,
    url,
    image
  };

  await writeDb(db);
  res.json({ message: "Product updated successfully." });
});

app.delete("/api/admin/products/:id", authMiddleware, async (req, res) => {
  const db = await readDb();
  db.products = db.products.filter((item) => item.id !== req.params.id);
  await writeDb(db);
  res.json({ message: "Product deleted successfully." });
});

app.post("/api/admin/settings", authMiddleware, async (req, res) => {
  const db = await readDb();
  db.settings = {
    maintenanceMode: Boolean(req.body.maintenanceMode),
    voiceReading: req.body.voiceReading !== false,
    defaultTimer: clampNumber(req.body.defaultTimer, 10, 120, 30)
  };
  await writeDb(db);
  res.json({ message: "Settings saved successfully." });
});

app.post("/api/admin/reset", authMiddleware, async (req, res) => {
  const currentDb = await readDb();
  const resetDb = createDefaultDatabase();
  resetDb.adminPassword = currentDb.adminPassword || ADMIN_PASSWORD;
  await writeDb(resetDb);
  res.json({ message: "Demo data reset successfully." });
});

app.get("/api/admin/export/questions", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="ak_questions_export_${Date.now()}.json"`);
  res.send(JSON.stringify({ subjects: db.subjects, questions: db.questions }, null, 2));
});

app.get("/api/admin/export/products", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="ak_products_export_${Date.now()}.json"`);
  res.send(JSON.stringify({ categories: db.categories, products: db.products }, null, 2));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "INDEX.HTML"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "INDEX.HTML"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "ADMIN.HTML"));
});

app.use(express.static(ROOT_DIR));

async function start() {
  await ensureDatabaseStore();
  await applyAdminPasswordOverride();
  app.listen(PORT, () => {
    console.log(`AK Learning Hub server running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
