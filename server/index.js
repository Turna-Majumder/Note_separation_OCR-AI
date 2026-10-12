import "dotenv/config";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const uploadDir = path.join(dataDir, "uploads");
const databaseFile = path.join(dataDir, "database.json");
await mkdir(uploadDir, { recursive: true });

async function readDatabase() {
  try {
    return JSON.parse(await readFile(databaseFile, "utf8"));
  } catch {
    return { users: [], categories: [], notes: [] };
  }
}

async function saveDatabase(database) {
  const temporary = `${databaseFile}.tmp`;
  await writeFile(temporary, JSON.stringify(database, null, 2), "utf8");
  await rename(temporary, databaseFile);
}

const app = express();
const port = Number(process.env.PORT || 3001);
const sessionSecret = process.env.SESSION_SECRET || "local-development-secret-change-me";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype.startsWith("image/")),
});

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

function createSession(user) {
  return jwt.sign({ userId: user.id, email: user.email, name: user.name }, sessionSecret, { expiresIn: "7d" });
}

function requireUser(request, response, next) {
  try {
    request.user = jwt.verify(request.cookies.notevault_session, sessionSecret);
    next();
  } catch {
    response.status(401).json({ error: "Please log in." });
  }
}

function setSessionCookie(response, token) {
  response.cookie("notevault_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

app.post("/api/auth/register", async (request, response) => {
  const name = String(request.body.name || "").trim();
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  if (!name || !email || password.length < 6) return response.status(400).json({ error: "Enter a name, email, and password of at least 6 characters." });
  const database = await readDatabase();
  if (database.users.some((user) => user.email === email)) return response.status(409).json({ error: "An account with this email already exists." });
  const user = { id: randomUUID(), name, email, passwordHash: await bcrypt.hash(password, 12) };
  database.users.push(user);
  await saveDatabase(database);
  setSessionCookie(response, createSession(user));
  response.status(201).json({ user: { id: user.id, name, email } });
});

app.post("/api/auth/login", async (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const database = await readDatabase();
  const user = database.users.find((item) => item.email === email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return response.status(401).json({ error: "Incorrect email or password." });
  setSessionCookie(response, createSession(user));
  response.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/api/auth/logout", (_request, response) => {
  response.clearCookie("notevault_session");
  response.json({ ok: true });
});

app.get("/api/auth/me", requireUser, (request, response) => response.json({ user: request.user }));

app.get("/api/library", requireUser, async (request, response) => {
  const database = await readDatabase();
  response.json({
    categories: database.categories.filter((item) => item.userId === request.user.userId),
    notes: database.notes.filter((item) => item.userId === request.user.userId).map(({ storedName, ...note }) => note),
  });
});

app.post("/api/categories", requireUser, async (request, response) => {
  const name = String(request.body.name || "").trim().slice(0, 80);
  if (!name) return response.status(400).json({ error: "Category name is required." });
  const database = await readDatabase();
  if (database.categories.some((item) => item.userId === request.user.userId && item.name.toLowerCase() === name.toLowerCase())) return response.status(409).json({ error: "This category already exists." });
  const category = { id: randomUUID(), userId: request.user.userId, name, color: request.body.color || "violet" };
  database.categories.push(category);
  await saveDatabase(database);
  response.status(201).json(category);
});

async function classifyImage({ buffer, mimeType, ocrText, categories }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing from the .env file.");
  if (!categories.length) throw new Error("Create at least one category before uploading images.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
  const needsReview = "__NEEDS_REVIEW__";
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.5",
    store: false,
    instructions: "You classify university note screenshots. Understand the complete academic meaning of the screenshot, formulas, diagrams, and OCR text. Choose the single best category from the supplied category names. Infer category meaning from general knowledge; category descriptions are not provided. Use NEEDS_REVIEW only when no category fits.",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: `Categories: ${JSON.stringify(categories.map(({ id, name }) => ({ id, name })))}\nOCR text: ${ocrText.slice(0, 40000)}` },
        { type: "input_image", detail: "high", image_url: `data:${mimeType};base64,${buffer.toString("base64")}` },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "note_category",
        strict: true,
        schema: {
          type: "object",
          properties: {
            categoryId: { type: "string", enum: [...categories.map((item) => item.id), needsReview] },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string" },
          },
          required: ["categoryId", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
  });
  const result = JSON.parse(response.output_text);
  return {
    categoryId: result.categoryId === needsReview ? null : result.categoryId,
    confidence: result.confidence,
    reason: result.reason,
  };
}

app.post("/api/notes", requireUser, upload.single("image"), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: "Choose a valid image." });
  try {
    const database = await readDatabase();
    const categories = database.categories.filter((item) => item.userId === request.user.userId);
    const result = await classifyImage({ buffer: request.file.buffer, mimeType: request.file.mimetype, ocrText: String(request.body.ocrText || ""), categories });
    const id = randomUUID();
    const extension = path.extname(request.file.originalname).replace(/[^.a-z0-9]/gi, "") || ".jpg";
    const storedName = `${id}${extension.toLowerCase()}`;
    await writeFile(path.join(uploadDir, storedName), request.file.buffer);
    const note = {
      id,
      userId: request.user.userId,
      categoryId: result.categoryId,
      fileName: request.file.originalname.slice(0, 240),
      storedName,
      ocrText: String(request.body.ocrText || "").slice(0, 100000),
      confidence: result.confidence,
      reason: result.reason,
      createdAt: new Date().toISOString(),
    };
    database.notes.unshift(note);
    await saveDatabase(database);
    const { storedName: _storedName, ...publicNote } = note;
    response.status(201).json(publicNote);
  } catch (error) {
    console.error("Classification failed:", error);
    response.status(502).json({ error: error?.message || "OpenAI could not classify this image." });
  }
});

app.patch("/api/notes/:id", requireUser, async (request, response) => {
  const database = await readDatabase();
  const note = database.notes.find((item) => item.id === request.params.id && item.userId === request.user.userId);
  if (!note) return response.status(404).json({ error: "Image not found." });
  const categoryId = request.body.categoryId || null;
  if (categoryId && !database.categories.some((item) => item.id === categoryId && item.userId === request.user.userId)) return response.status(400).json({ error: "Invalid category." });
  note.categoryId = categoryId;
  await saveDatabase(database);
  response.json({ ok: true });
});

app.get("/api/images/:id", requireUser, async (request, response) => {
  const database = await readDatabase();
  const note = database.notes.find((item) => item.id === request.params.id && item.userId === request.user.userId);
  if (!note) return response.status(404).end();
  response.sendFile(path.join(uploadDir, note.storedName));
});

app.delete("/api/notes", requireUser, async (request, response) => {
  const categoryId = String(request.query.categoryId || "");
  const database = await readDatabase();
  if (categoryId && !database.categories.some((item) => item.id === categoryId && item.userId === request.user.userId)) {
    return response.status(404).json({ error: "Category not found." });
  }
  const selected = database.notes.filter((item) => item.userId === request.user.userId && (!categoryId || item.categoryId === categoryId));
  const selectedIds = new Set(selected.map((item) => item.id));
  database.notes = database.notes.filter((item) => !selectedIds.has(item.id));
  await saveDatabase(database);
  await Promise.all(selected.map((note) => unlink(path.join(uploadDir, note.storedName)).catch(() => {})));
  response.json({ ok: true, deleted: selected.length });
});

app.delete("/api/notes/:id", requireUser, async (request, response) => {
  const database = await readDatabase();
  const index = database.notes.findIndex((item) => item.id === request.params.id && item.userId === request.user.userId);
  if (index < 0) return response.status(404).json({ error: "Image not found." });
  const [note] = database.notes.splice(index, 1);
  await saveDatabase(database);
  await unlink(path.join(uploadDir, note.storedName)).catch(() => {});
  response.json({ ok: true });
});

const distDir = path.join(root, "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((_request, response) => response.sendFile(path.join(distDir, "index.html")));
}

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) return response.status(400).json({ error: error.message });
  response.status(500).json({ error: "Unexpected server error." });
});

app.listen(port, () => console.log(`Node API running at http://localhost:${port}`));
