const crypto = require("crypto");
const express = require("express");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");

admin.initializeApp();
const firestore = admin.firestore();
const DB_DOC_PATH = "akLearningHub/db";

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

const DEFAULT_CATEGORIES = ["gadgets", "books", "skincare", "fashion", "fitness", "herbal-medicines", "electronics", "home-decor", "kitchen"];

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

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
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

function toTitleFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parsePlatformFromUrl(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("temu.com")) return "Temu";
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

async function fetchProductPreview(url) {
  const fallback = fallbackProductPreview(url);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "user-agent": "Mozilla/5.0 AK Learning Hub Preview Fetcher"
      }
    });

    if (!response.ok) return fallback;

    const html = await response.text();
    const title =
      extractMetaContent(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i,
        /<title>([^<]+)<\/title>/i
      ]) || fallback.title;

    const description =
      extractMetaContent(html, [
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
      ]) || fallback.description;

    const image = extractMetaContent(html, [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i]);

    const price =
      extractMetaContent(html, [
        /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
        /"price"\s*:\s*"([^"]+)"/i
      ]) || fallback.price;

    return {
      ...fallback,
      title,
      description,
      image,
      price: price.startsWith("$") ? price : `$${price}`
    };
  } catch (error) {
    return fallback;
  }
}

function createDefaultDatabase() {
  return {
    adminPassword: process.env.ADMIN_PASSWORD || "ejaz4u123",
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

function normalizeDb(db) {
  const normalized = {
    ...createDefaultDatabase(),
    ...(db || {})
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
  normalized.statsSeed = normalized.statsSeed || { totalUsers: 1580, totalQuizzesTaken: 2847 };
  normalized.settings = {
    maintenanceMode: Boolean(normalized.settings?.maintenanceMode),
    voiceReading: normalized.settings?.voiceReading !== false,
    defaultTimer: clampNumber(normalized.settings?.defaultTimer, 10, 120, 30)
  };

  if (!normalized.adminPassword) {
    normalized.adminPassword = process.env.ADMIN_PASSWORD || "ejaz4u123";
  }

  return normalized;
}

async function ensureDbDoc() {
  const ref = firestore.doc(DB_DOC_PATH);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, createDefaultDatabase());
    }
  });
  return ref;
}

async function readDb() {
  const ref = await ensureDbDoc();
  const snap = await ref.get();
  return normalizeDb(snap.data() || {});
}

async function writeDb(nextDb) {
  const ref = await ensureDbDoc();
  const normalized = normalizeDb(nextDb);
  await ref.set(normalized, { merge: false });
  return normalized;
}

async function updateDb(mutator) {
  const ref = await ensureDbDoc();
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeDb(snap.data() || {});
    const updated = normalizeDb(await mutator(current));
    tx.set(ref, updated, { merge: false });
    return updated;
  });
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
      if (b.percentage !== a.percentage) return b.percentage - a.percentage;
      if (b.score !== a.score) return b.score - a.score;
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

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlJson(payload) {
  return base64url(JSON.stringify(payload));
}

function signToken(payload) {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_PASSWORD || "ak-learning-hub";
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const body = base64urlJson(payload);
  const data = `${header}.${body}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${data}.${signature}`;
}

function verifyToken(token) {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_PASSWORD || "ak-learning-hub";
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const data = `${header}.${body}`;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  if (!payload?.exp || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  const allowed = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!allowed.length) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(corsMiddleware);

app.get("/api/public/bootstrap", async (req, res) => {
  const db = await readDb();
  res.json(buildPublicPayload(db));
});

app.post("/api/public/newsletter", async (req, res) => {
  const email = cleanText(req.body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  await updateDb(async (db) => {
    if (!db.subscribers.find((item) => item.email === email)) {
      db.subscribers.push({
        id: crypto.randomUUID(),
        email,
        createdAt: new Date().toISOString()
      });
    }
    return db;
  });

  res.json({ message: "Subscription saved successfully." });
});

app.post("/api/public/quiz-results", async (req, res) => {
  const name = cleanText(req.body.name) || "Learner";
  const subject = cleanText(req.body.subject);
  const total = clampNumber(req.body.total, 1, 500, 1);
  const score = clampNumber(req.body.score, 0, total, 0);
  const userId = cleanText(req.body.userId);

  if (!subject) {
    return res.status(400).json({ message: "Subject is required." });
  }

  const db = await updateDb(async (dbState) => {
    const subjectName = dbState.subjects.find((item) => item.key === subject)?.name || subject;
    dbState.quizAttempts.push({
      id: crypto.randomUUID(),
      userId: userId || "",
      name,
      subject,
      subjectName,
      score,
      total,
      percentage: Math.round((score / total) * 100),
      createdAt: new Date().toISOString()
    });
    return dbState;
  });

  res.json({
    message: "Quiz result saved.",
    leaderboard: buildLeaderboard(db),
    stats: buildPublicPayload(db).stats
  });
});

app.post("/api/admin/login", async (req, res) => {
  const db = await readDb();
  const password = cleanText(req.body.password);
  if (password !== db.adminPassword) {
    return res.status(401).json({ message: "Incorrect password." });
  }

  const expiresInMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const token = signToken({
    sub: "admin",
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + expiresInMs) / 1000)
  });
  res.json({ token });
});

app.get("/api/admin/bootstrap", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.json(buildAdminPayload(db));
});

app.post("/api/admin/subjects", authMiddleware, async (req, res) => {
  const name = cleanText(req.body.name);
  const key = makeSubjectKey(name);
  if (!name || !key) {
    return res.status(400).json({ message: "Subject name is required." });
  }

  const updated = await updateDb(async (db) => {
    if (db.subjects.find((subject) => subject.key === key)) {
      throw new Error("Subject already exists.");
    }

    const colors = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#8B5CF6", "#06B6D4", "#F97316", "#D946EF"];
    db.subjects.push({
      key,
      name,
      icon: "fa-book",
      color: colors[db.subjects.length % colors.length]
    });
    db.questions[key] = [];
    return db;
  }).catch((error) => {
    res.status(400).json({ message: error.message || "Failed to add subject." });
    return null;
  });

  if (!updated) return;
  res.json({ message: "Subject added successfully." });
});

app.delete("/api/admin/subjects/:key", authMiddleware, async (req, res) => {
  const key = req.params.key;
  const updated = await updateDb(async (db) => {
    const subject = db.subjects.find((item) => item.key === key);
    if (!subject) {
      throw new Error("Subject not found.");
    }
    db.subjects = db.subjects.filter((item) => item.key !== key);
    delete db.questions[key];
    return db;
  }).catch((error) => {
    res.status(404).json({ message: error.message || "Failed to remove subject." });
    return null;
  });

  if (!updated) return;
  res.json({ message: "Subject removed successfully." });
});

app.post("/api/admin/questions", authMiddleware, async (req, res) => {
  const subject = cleanText(req.body.subject);
  const question = cleanText(req.body.question);
  const explanation = cleanText(req.body.explanation);
  const options = Array.isArray(req.body.options) ? req.body.options.map((item) => cleanText(item)).filter(Boolean) : [];
  const correct = clampNumber(req.body.correct, 0, 3, 0);

  if (!subject) return res.status(400).json({ message: "Valid subject is required." });
  if (!question || options.length !== 4) return res.status(400).json({ message: "Question and four options are required." });

  const updated = await updateDb(async (db) => {
    if (!db.questions[subject]) {
      throw new Error("Valid subject is required.");
    }
    db.questions[subject].push({
      id: crypto.randomUUID(),
      question,
      options,
      correct,
      explanation
    });
    return db;
  }).catch((error) => {
    res.status(400).json({ message: error.message || "Failed to add question." });
    return null;
  });

  if (!updated) return;
  res.json({ message: "Question added successfully." });
});

app.put("/api/admin/questions/:id", authMiddleware, async (req, res) => {
  const subject = cleanText(req.body.subject);
  const id = req.params.id;
  const question = cleanText(req.body.question);
  const explanation = cleanText(req.body.explanation);
  const options = Array.isArray(req.body.options) ? req.body.options.map((item) => cleanText(item)).filter(Boolean) : [];
  const correct = clampNumber(req.body.correct, 0, 3, 0);

  if (!subject) return res.status(400).json({ message: "Valid subject is required." });
  if (!question || options.length !== 4) return res.status(400).json({ message: "Question and four options are required." });

  const updated = await updateDb(async (db) => {
    if (!db.questions[subject]) {
      throw new Error("Valid subject is required.");
    }
    const index = db.questions[subject].findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("Question not found.");
    }
    db.questions[subject][index] = {
      ...db.questions[subject][index],
      question,
      options,
      correct,
      explanation
    };
    return db;
  }).catch((error) => {
    res.status(404).json({ message: error.message || "Failed to update question." });
    return null;
  });

  if (!updated) return;
  res.json({ message: "Question updated successfully." });
});

app.delete("/api/admin/questions/:id", authMiddleware, async (req, res) => {
  const subject = cleanText(req.query.subject);
  const id = req.params.id;
  if (!subject) return res.status(400).json({ message: "Valid subject is required." });

  const updated = await updateDb(async (db) => {
    if (!db.questions[subject]) {
      throw new Error("Valid subject is required.");
    }
    db.questions[subject] = db.questions[subject].filter((item) => item.id !== id);
    return db;
  }).catch((error) => {
    res.status(400).json({ message: error.message || "Failed to delete question." });
    return null;
  });

  if (!updated) return;
  res.json({ message: "Question deleted successfully." });
});

app.post("/api/admin/questions/bulk", authMiddleware, async (req, res) => {
  const subject = cleanText(req.body.subject);
  const incomingQuestions = Array.isArray(req.body.questions) ? req.body.questions : [];
  if (!subject) return res.status(400).json({ message: "Valid subject is required." });

  let added = 0;
  const updated = await updateDb(async (db) => {
    if (!db.questions[subject]) {
      throw new Error("Valid subject is required.");
    }

    for (const item of incomingQuestions) {
      const qText = cleanText(item.question);
      const explanation = cleanText(item.explanation);
      const options = Array.isArray(item.options) ? item.options.map((option) => cleanText(option)).filter(Boolean) : [];
      const correct = clampNumber(item.correct, 0, 3, 0);
      if (qText && options.length === 4) {
        db.questions[subject].push({
          id: crypto.randomUUID(),
          question: qText,
          options,
          correct,
          explanation
        });
        added += 1;
      }
    }
    return db;
  }).catch((error) => {
    res.status(400).json({ message: error.message || "Failed to bulk add questions." });
    return null;
  });

  if (!updated) return;
  res.json({ message: `Added ${added} questions successfully.`, added });
});

app.post("/api/admin/categories", authMiddleware, async (req, res) => {
  const category = makeSubjectKey(req.body.name);
  if (!category) return res.status(400).json({ message: "Category name is required." });

  const updated = await updateDb(async (db) => {
    if (db.categories.includes(category)) {
      throw new Error("Category already exists.");
    }
    db.categories.push(category);
    return db;
  }).catch((error) => {
    res.status(400).json({ message: error.message || "Failed to add category." });
    return null;
  });

  if (!updated) return;
  res.json({ message: "Category added successfully." });
});

app.delete("/api/admin/categories/:name", authMiddleware, async (req, res) => {
  const category = req.params.name;
  await updateDb(async (db) => {
    db.categories = db.categories.filter((item) => item !== category);
    return db;
  });
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

app.post("/api/admin/products", authMiddleware, async (req, res) => {
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

  await updateDb(async (db) => {
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
    return db;
  });

  res.json({ message: "Product added successfully." });
});

app.put("/api/admin/products/:id", authMiddleware, async (req, res) => {
  const id = req.params.id;
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

  const updated = await updateDb(async (db) => {
    const index = db.products.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("Product not found.");
    }
    db.products[index] = {
      ...db.products[index],
      title,
      description,
      price,
      rating,
      category: category || db.products[index].category,
      platform,
      url,
      image
    };
    return db;
  }).catch((error) => {
    res.status(404).json({ message: error.message || "Failed to update product." });
    return null;
  });

  if (!updated) return;
  res.json({ message: "Product updated successfully." });
});

app.delete("/api/admin/products/:id", authMiddleware, async (req, res) => {
  const id = req.params.id;
  await updateDb(async (db) => {
    db.products = db.products.filter((item) => item.id !== id);
    return db;
  });
  res.json({ message: "Product deleted successfully." });
});

app.post("/api/admin/settings", authMiddleware, async (req, res) => {
  await updateDb(async (db) => {
    db.settings = {
      maintenanceMode: Boolean(req.body.maintenanceMode),
      voiceReading: req.body.voiceReading !== false,
      defaultTimer: clampNumber(req.body.defaultTimer, 10, 120, 30)
    };
    return db;
  });
  res.json({ message: "Settings saved successfully." });
});

app.post("/api/admin/reset", authMiddleware, async (req, res) => {
  const current = await readDb();
  const resetDb = createDefaultDatabase();
  resetDb.adminPassword = current.adminPassword || resetDb.adminPassword;
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

exports.api = onRequest(
  { region: process.env.FUNCTION_REGION || "us-central1", secrets: ["ADMIN_PASSWORD", "ADMIN_JWT_SECRET"] },
  app
);
