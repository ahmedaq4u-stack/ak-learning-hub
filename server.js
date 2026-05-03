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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ejaz4u123";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DATABASE_URL = process.env.DATABASE_URL || "";
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
}

async function readDb() {
  if (!pgPool) {
    ensureDatabaseFile();
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return normalizeDb(parsed);
  }

  await ensureDatabaseStore();
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

  if (!normalized.adminPassword) {
    normalized.adminPassword = ADMIN_PASSWORD;
  }

  normalized.adminAllowedPhones = Array.isArray(normalized.adminAllowedPhones)
    ? normalized.adminAllowedPhones.map((value) => cleanText(value)).filter(Boolean)
    : ["+923332786013"];

  return normalized;
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

function normalizeClassLevel(value) {
  const cleaned = cleanText(value);
  return /^(6|7|8|9|10)$/.test(cleaned) ? cleaned : "";
}

function filterQuestionsByClass(questionsBySubject, classLevel) {
  const normalizedClass = normalizeClassLevel(classLevel);
  if (!normalizedClass) return questionsBySubject;

  const filtered = {};
  for (const [subjectKey, list] of Object.entries(questionsBySubject || {})) {
    filtered[subjectKey] = Array.isArray(list)
      ? list.filter((question) => !question?.classLevel || String(question.classLevel) === normalizedClass)
      : [];
  }
  return filtered;
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
      averageScore: attemptStats.averageScore
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

function parsePlatformFromUrl(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("temu") || value.includes("temu.com") || value.includes("temu.to") || value.includes("share.temu")) return "Temu";
  if (value.includes("amazon.")) return "Amazon";
  if (value.includes("daraz")) return "Daraz";
  if (value.includes("aliexpress")) return "AliExpress";
  return "Website";
}

function fallbackProductPreview(url) {
  let title = "Online Product";
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const candidate = pathParts.reverse().find((part) => /[a-z]/i.test(part));
    if (candidate) {
      title = toTitleFromSlug(candidate.replace(/\.[a-z0-9]+$/i, ""));
    }
  } catch (error) {
    title = "Online Product";
  }

  const platform = parsePlatformFromUrl(url);
  return {
    title,
    description: `Imported product preview from ${platform}. Review the details before adding it to the store.`,
    price: "$0.00",
    platform,
    rating: 4.0,
    url
  };
}

function extractMetaContent(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function normalizePreviewPrice(rawPrice, currency) {
  const trimmed = String(rawPrice || "").trim();
  if (!trimmed) return "";
  if (/[$€£]|(usd|eur|gbp|pkr|inr|aed|sar|cad|aud)/i.test(trimmed)) return trimmed;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const curr = String(currency || "").trim().toUpperCase();
  if (curr && curr !== "USD") return `${curr} ${trimmed}`;
  return `$${trimmed}`;
}

function extractJsonLdProduct(html) {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates = [];
  let match;

  while ((match = scriptRegex.exec(html))) {
    const raw = String(match[1] || "").trim();
    if (!raw) continue;
    const parsed = safeJsonParse(raw);
    if (!parsed) continue;
    candidates.push(parsed);
  }

  const flat = [];
  const pushNode = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) pushNode(item);
      return;
    }
    if (typeof node !== "object") return;
    flat.push(node);
    if (Array.isArray(node["@graph"])) pushNode(node["@graph"]);
  };

  for (const item of candidates) pushNode(item);

  const isProduct = (node) => {
    const type = node?.["@type"];
    if (!type) return false;
    if (Array.isArray(type)) return type.some((t) => String(t).toLowerCase() === "product");
    return String(type).toLowerCase() === "product";
  };

  const product = flat.find(isProduct) || null;
  if (!product) return null;

  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const price = offers?.price ?? offers?.lowPrice ?? offers?.highPrice ?? "";
  const currency = offers?.priceCurrency ?? "";
  const image = Array.isArray(product.image) ? product.image[0] : product.image;

  return {
    title: String(product.name || "").trim(),
    description: String(product.description || "").trim(),
    image: String(image || "").trim(),
    price: normalizePreviewPrice(price, currency)
  };
}

function extractNextDataProduct(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  const parsed = safeJsonParse(match[1].trim());
  if (!parsed) return null;

  const wantedKeys = new Set([
    "name",
    "title",
    "producttitle",
    "productname",
    "description",
    "shortdescription",
    "image",
    "images",
    "mainimage",
    "primaryimage",
    "saleprice",
    "price",
    "minprice",
    "maxprice",
    "currency",
    "pricecurrency"
  ]);

  const found = { title: "", description: "", image: "", price: "", currency: "" };
  const visited = new Set();

  const walk = (node, depth) => {
    if (!node || depth > 10) return;
    if (typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    for (const [rawKey, value] of Object.entries(node)) {
      const key = String(rawKey || "").toLowerCase();
      if (wantedKeys.has(key)) {
        if (key.includes("currency") && !found.currency) found.currency = String(value || "").trim();
        if ((key === "name" || key === "title" || key.includes("product")) && !found.title) {
          found.title = String(value || "").trim();
        }
        if (key.includes("description") && !found.description) found.description = String(value || "").trim();
        if (key.includes("price") && !found.price) found.price = String(value || "").trim();
        if (key.includes("image") && !found.image) {
          if (Array.isArray(value)) found.image = String(value[0] || "").trim();
          else found.image = String(value || "").trim();
        }
      }
      walk(value, depth + 1);
    }
  };

  walk(parsed, 0);

  const normalizedPrice = normalizePreviewPrice(found.price, found.currency);
  if (!found.title && !found.image && !normalizedPrice) return null;

  return {
    title: found.title,
    description: found.description,
    image: found.image,
    price: normalizedPrice
  };
}

async function fetchProductPreview(url) {
  const fallback = fallbackProductPreview(url);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache"
      },
      redirect: "follow"
    });

    if (!response.ok) {
      return fallback;
    }

    const html = await response.text();
    const finalUrl = response.url || url;
    const platform = parsePlatformFromUrl(finalUrl);

    const nextData = extractNextDataProduct(html);
    const jsonLd = extractJsonLdProduct(html);

    const title =
      (jsonLd?.title ||
        nextData?.title ||
        extractMetaContent(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+property=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i,
        /<title>([^<]+)<\/title>/i
      ])) ||
      fallback.title;

    const description =
      (jsonLd?.description ||
        nextData?.description ||
        extractMetaContent(html, [
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+property=["']twitter:description["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
      ])) ||
      fallback.description;

    const image =
      jsonLd?.image ||
      nextData?.image ||
      extractMetaContent(html, [
        /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i
      ]);

    const priceRaw =
      jsonLd?.price ||
      nextData?.price ||
      extractMetaContent(html, [
        /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+property=["']product:price["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
        /"price"\s*:\s*"([^"]+)"/i,
        /"salePrice"\s*:\s*"([^"]+)"/i
      ]);
    const normalizedPrice = normalizePreviewPrice(priceRaw, "");

    return {
      ...fallback,
      title,
      description,
      image,
      price: normalizedPrice || fallback.price,
      platform,
      url: finalUrl
    };
  } catch (error) {
    return fallback;
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

app.get("/api/public/bootstrap", async (req, res) => {
  const db = await readDb();
  const payload = buildPublicPayload(db);
  const classLevel = normalizeClassLevel(req.query.class);
  if (classLevel) {
    payload.questions = filterQuestionsByClass(payload.questions, classLevel);
    payload.stats.totalQuestions = getQuestionCount({ ...db, questions: payload.questions });
  }
  res.json(payload);
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

app.post("/api/admin/product-preview", authMiddleware, async (req, res) => {
  const url = cleanText(req.body.url);

  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ message: "Please enter a valid product URL." });
  }

  const preview = await fetchProductPreview(url);
  res.json(preview);
});

app.post("/api/admin/products/auto-import", authMiddleware, async (req, res) => {
  const db = await readDb();
  const url = cleanText(req.body.url);
  const requestedCategory = cleanText(req.body.category);

  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ message: "Please enter a valid product URL." });
  }

  const preview = await fetchProductPreview(url);
  const title = cleanText(preview.title);
  const description = cleanText(preview.description);
  const price = cleanText(preview.price);
  const image = cleanText(preview.image);
  const platform = cleanText(preview.platform) || parsePlatformFromUrl(preview.url || url);

  const missing = [];
  if (!title) missing.push("title");
  if (!price || price === "$0.00") missing.push("price");
  if (!image) missing.push("image");

  if (missing.length) {
    return res.status(422).json({
      message: `Could not fetch ${missing.join(", ")} from this link. Try another link (full product page, not short redirect), or add manually.`,
      missing
    });
  }

  const category = requestedCategory && db.categories.includes(requestedCategory) ? requestedCategory : db.categories[0] || "general";

  db.products.push({
    id: crypto.randomUUID(),
    title,
    description: description || `Imported product from ${platform}.`,
    price,
    rating: 4.5,
    category,
    platform,
    url: preview.url || url,
    image
  });

  await writeDb(db);
  res.json({ message: "Product imported successfully." });
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
  app.listen(PORT, () => {
    console.log(`AK Learning Hub server running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
