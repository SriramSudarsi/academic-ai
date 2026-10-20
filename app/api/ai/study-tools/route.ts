import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/*
 * ============================================================
 * ACADEMIC AI — STUDY TOOLS API
 * ============================================================
 *
 * Request:  POST { subjectId, tool, count?, focus? }
 *           tool = "quiz" | "topics" | "flowchart"
 *           Header: Authorization: Bearer <supabase access token>
 *
 * 1. Authenticates the student and verifies subject ownership.
 * 2. Reads that subject's document_chunks (never processes files).
 * 3. Picks a balanced sample of material from every document.
 * 4. Asks Gemini for structured JSON built ONLY from that material.
 * 5. Validates and cleans the JSON before returning it.
 *
 * Works for every subject — nothing is subject-specific.
 * ============================================================
 */

export const runtime = "nodejs";
export const maxDuration = 60;

type Tool = "quiz" | "topics" | "flowchart";

/*
 * Model order: gemini-3.5-flash-lite has been answering reliably
 * for this project; gemini-3.5-flash is the fallback. Override
 * with GEMINI_STUDY_MODELS="model-a,model-b" if needed.
 */
const STUDY_MODELS = (
  process.env.GEMINI_STUDY_MODELS ||
  "gemini-3.5-flash-lite,gemini-3.5-flash"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

// Whole request must finish inside Vercel's 60 s limit.
const TOTAL_BUDGET_MS = 54000;
const MIN_ATTEMPT_MS = 8000;

const MAX_CONTEXT_CHARS = 36000;

const ALLOWED_QUIZ_COUNTS = [10, 15, 20, 25];

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    retryOptions: {
      attempts: 1,
    },
  },
});

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL;

const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!process.env.GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY");
}

if (!supabaseUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL"
  );
}

if (!supabaseSecretKey) {
  throw new Error(
    "Missing SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY"
  );
}

const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);

type ChunkRow = {
  id: string;
  document_id: string;
  content: string | null;
  chunk_index: number | null;
};

type MaterialChunk = ChunkRow & {
  documentName: string;
};

class StudyToolError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ============================================================
// SMALL HELPERS
// ============================================================

function asString(value: unknown, maxLength = 600): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function asStringArray(
  value: unknown,
  maxItems: number,
  maxLength = 200
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip ```json fences or leading/trailing prose.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error("Response was not valid JSON.");
  }
}

// ============================================================
// MATERIAL SELECTION
// ============================================================

/*
 * Take chunks from every document in turn so the result
 * represents the whole subject, not just the first file.
 */
function selectMaterial(
  chunks: MaterialChunk[],
  tool: Tool,
  focus: string
): MaterialChunk[] {
  const byDocument = new Map<string, MaterialChunk[]>();

  for (const chunk of chunks) {
    const list = byDocument.get(chunk.document_id) || [];
    list.push(chunk);
    byDocument.set(chunk.document_id, list);
  }

  const focusWords = normalizeWords(focus);

  const queues = [...byDocument.values()].map((list) => {
    let ordered = [...list].sort(
      (a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0)
    );

    // Quizzes get a fresh random sample each time.
    if (tool === "quiz") {
      ordered = shuffle(ordered);
    }

    // A quiz focus ("session 3", "pricing") moves matching chunks first.
    if (focusWords.length > 0) {
      const score = (chunk: MaterialChunk) => {
        const text = `${chunk.documentName} ${chunk.content || ""}`.toLowerCase();
        return focusWords.filter((word) => text.includes(word)).length;
      };

      ordered.sort((a, b) => score(b) - score(a));
    }

    return ordered;
  });

  const ordered = tool === "quiz" ? shuffle(queues) : queues;
  const selected: MaterialChunk[] = [];
  let characters = 0;
  let added = true;

  while (added && characters < MAX_CONTEXT_CHARS) {
    added = false;

    for (const queue of ordered) {
      const chunk = queue.shift();

      if (!chunk) {
        continue;
      }

      const length = (chunk.content || "").length + 120;

      if (characters + length > MAX_CONTEXT_CHARS) {
        continue;
      }

      selected.push(chunk);
      characters += length;
      added = true;
    }
  }

  // Present the material in document order for the model.
  return selected.sort((a, b) =>
    a.documentName === b.documentName
      ? (a.chunk_index ?? 0) - (b.chunk_index ?? 0)
      : a.documentName.localeCompare(b.documentName)
  );
}

function buildContext(chunks: MaterialChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `--- DOCUMENT: ${chunk.documentName} (part ${(chunk.chunk_index ?? 0) + 1}) ---\n${chunk.content || ""}`
    )
    .join("\n\n");
}

// ============================================================
// PROMPTS
// ============================================================

const SOURCE_RULES = `
SOURCE RULES — VERY IMPORTANT:
- Use ONLY the study material supplied below. It is the only source of truth.
- Do not add facts, examples, names, numbers, theories or frameworks that are not in the material.
- Preserve the terminology used in the material.
- "source" / "sources" must be document names exactly as written after "DOCUMENT:".
- Respond with JSON only. No markdown, no code fences, no commentary.
`;

function buildPrompt(
  tool: Tool,
  subjectName: string,
  context: string,
  count: number,
  focus: string
): string {
  if (tool === "quiz") {
    return `You are creating a multiple-choice practice quiz for the subject "${subjectName}".
${SOURCE_RULES}
TASK:
- Write exactly ${count} multiple-choice questions${focus ? ` focused on: "${focus}" (use other material only if the focus is not covered enough)` : " covering the whole range of the material"}.
- Mix recall, understanding and application questions. Avoid trivial or duplicate questions.
- Each question has exactly 4 options; exactly one is correct. Wrong options must be plausible.
- Do not use "All of the above" or "None of the above".
- "answerIndex" is the 0-based index of the correct option.
- "explanation" (1–2 sentences) says why the answer is correct, based on the material.

JSON FORMAT:
{"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"...","source":"document name"}]}

STUDY MATERIAL:
${context}`;
  }

  if (tool === "topics") {
    return `You are identifying the key topics a student must master for the subject "${subjectName}".
${SOURCE_RULES}
TASK:
- "overview": 2–4 sentences describing what this subject's material covers overall.
- "topics": the 6–10 most important topics, most important first.
- For each topic: a short "title", a 1–2 sentence "summary", "importance" ("high", "medium" or "low"), 2–4 short "keyPoints", and the "sources" it appears in.
- Mark as "high" the topics that are central, repeated across documents, or foundational for others.

JSON FORMAT:
{"overview":"...","topics":[{"title":"...","summary":"...","importance":"high","keyPoints":["..."],"sources":["document name"]}]}

STUDY MATERIAL:
${context}`;
  }

  return `You are creating a learning flowchart for the subject "${subjectName}" that shows how its ideas build on each other.
${SOURCE_RULES}
TASK:
- "title": a short title for the flowchart.
- "stages": 4–7 stages in a sensible learning order (foundations first, applications last).
- For each stage: a short "title", a 1–2 sentence "description", and 2–5 "concepts" (short names, 1–4 words each).
- "connections": 5–12 important links between concepts, possibly across stages. "from" and "to" must be concept names exactly as written in "concepts". "relation" is a short verb phrase (e.g. "leads to", "is measured by").

JSON FORMAT:
{"title":"...","stages":[{"title":"...","description":"...","concepts":["..."]}],"connections":[{"from":"...","to":"...","relation":"..."}]}

STUDY MATERIAL:
${context}`;
}

// ============================================================
// VALIDATION
// ============================================================

function cleanQuiz(raw: unknown, documentNames: Set<string>) {
  const questions = Array.isArray((raw as { questions?: unknown })?.questions)
    ? ((raw as { questions: unknown[] }).questions)
    : [];

  const cleaned = questions
    .map((item) => {
      const question = asString((item as { question?: unknown })?.question, 500);
      const options = asStringArray((item as { options?: unknown })?.options, 4, 250);
      const answerIndex = Number((item as { answerIndex?: unknown })?.answerIndex);

      if (
        !question ||
        options.length !== 4 ||
        new Set(options.map((o) => o.toLowerCase())).size !== 4 ||
        !Number.isInteger(answerIndex) ||
        answerIndex < 0 ||
        answerIndex > 3
      ) {
        return null;
      }

      // Shuffle options so the right answer is not always "A".
      const correct = options[answerIndex];
      const shuffled = shuffle(options);
      const source = asString((item as { source?: unknown })?.source, 200);

      return {
        question,
        options: shuffled,
        answerIndex: shuffled.indexOf(correct),
        explanation: asString((item as { explanation?: unknown })?.explanation, 600),
        source: documentNames.has(source) ? source : "",
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { questions: cleaned };
}

function cleanTopics(raw: unknown, documentNames: Set<string>) {
  const data = raw as { overview?: unknown; topics?: unknown };
  const topics = Array.isArray(data?.topics) ? data.topics : [];

  return {
    overview: asString(data?.overview, 1200),
    topics: topics
      .map((item) => {
        const topic = item as Record<string, unknown>;
        const title = asString(topic?.title, 120);

        if (!title) {
          return null;
        }

        const importance = asString(topic?.importance, 10).toLowerCase();

        return {
          title,
          summary: asString(topic?.summary, 500),
          importance: ["high", "medium", "low"].includes(importance)
            ? importance
            : "medium",
          keyPoints: asStringArray(topic?.keyPoints, 4, 220),
          sources: asStringArray(topic?.sources, 5, 200).filter((source) =>
            documentNames.has(source)
          ),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 12),
  };
}

function cleanFlowchart(raw: unknown) {
  const data = raw as { title?: unknown; stages?: unknown; connections?: unknown };
  const stages = (Array.isArray(data?.stages) ? data.stages : [])
    .map((item) => {
      const stage = item as Record<string, unknown>;
      const title = asString(stage?.title, 100);

      if (!title) {
        return null;
      }

      return {
        title,
        description: asString(stage?.description, 400),
        concepts: asStringArray(stage?.concepts, 6, 60),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 8);

  const conceptLookup = new Map<string, string>();

  for (const stage of stages) {
    for (const concept of stage.concepts) {
      conceptLookup.set(concept.toLowerCase(), concept);
    }
  }

  const connections = (Array.isArray(data?.connections) ? data.connections : [])
    .map((item) => {
      const link = item as Record<string, unknown>;
      const from = conceptLookup.get(asString(link?.from, 60).toLowerCase());
      const to = conceptLookup.get(asString(link?.to, 60).toLowerCase());

      if (!from || !to || from === to) {
        return null;
      }

      return {
        from,
        to,
        relation: asString(link?.relation, 60) || "relates to",
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 14);

  return {
    title: asString(data?.title, 120),
    stages,
    connections,
  };
}

// ============================================================
// GEMINI
// ============================================================

function isTemporaryError(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;

  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();

  return (
    [408, 429, 500, 502, 503, 504].includes(status ?? 0) ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("deadline") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("not valid json") ||
    message.includes("empty response")
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Gemini request timed out.")), ms)
    ),
  ]);
}

async function generateJson(
  prompt: string,
  maxOutputTokens: number,
  startedAt: number
): Promise<{ data: unknown; model: string }> {
  let lastError: unknown = null;

  for (const model of STUDY_MODELS) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);

    if (remaining < MIN_ATTEMPT_MS) {
      break;
    }

    try {
      console.log(`STUDY TOOLS: trying ${model} (${Math.round(remaining / 1000)}s left)`);

      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            maxOutputTokens,
            temperature: 0.4,
          },
        }),
        remaining - 1000
      );

      const text = response.text?.trim() || "";

      if (!text) {
        throw new Error("Empty response from Gemini.");
      }

      return { data: parseJson(text), model };
    } catch (error) {
      lastError = error;
      console.error(`STUDY TOOLS: ${model} failed:`, error);

      if (!isTemporaryError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("No Gemini model available.");
}

// ============================================================
// ROUTE
// ============================================================

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = await request.json().catch(() => null);

    const subjectId =
      typeof body?.subjectId === "string" ? body.subjectId.trim() : "";

    const tool = body?.tool as Tool;

    if (!subjectId) {
      throw new StudyToolError("Subject ID is required.");
    }

    if (!["quiz", "topics", "flowchart"].includes(tool)) {
      throw new StudyToolError("Unknown study tool.");
    }

    const requestedCount = Number(body?.count);
    const count = ALLOWED_QUIZ_COUNTS.includes(requestedCount)
      ? requestedCount
      : 10;

    const focus = asString(body?.focus, 120);

    // ---------- Auth ----------
    const header = request.headers.get("authorization");

    if (!header?.startsWith("Bearer ")) {
      throw new StudyToolError("You must be signed in.", 401, "UNAUTHORIZED");
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(header.substring("Bearer ".length));

    if (userError || !user) {
      throw new StudyToolError(
        "Your session has expired. Please sign in again.",
        401,
        "UNAUTHORIZED"
      );
    }

    // ---------- Subject ----------
    const { data: subject, error: subjectError } = await supabaseAdmin
      .from("subjects")
      .select("id, name")
      .eq("id", subjectId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (subjectError) {
      console.error("STUDY TOOLS: subject lookup failed:", subjectError);
      throw new StudyToolError("Unable to access this subject.", 500, "SERVER_ERROR");
    }

    if (!subject) {
      throw new StudyToolError(
        "Subject not found or you do not have access to it.",
        404,
        "NOT_FOUND"
      );
    }

    // ---------- Material ----------
    const [documentsResult, chunksResult] = await Promise.all([
      supabaseAdmin
        .from("documents")
        .select("id, file_name")
        .eq("subject_id", subjectId),
      supabaseAdmin
        .from("document_chunks")
        .select("id, document_id, content, chunk_index")
        .eq("subject_id", subjectId)
        .limit(3000),
    ]);

    if (documentsResult.error || chunksResult.error) {
      console.error(
        "STUDY TOOLS: material lookup failed:",
        documentsResult.error || chunksResult.error
      );
      throw new StudyToolError(
        "Unable to read your study material.",
        500,
        "SERVER_ERROR"
      );
    }

    const documentNames = new Map<string, string>();

    for (const document of documentsResult.data ?? []) {
      documentNames.set(document.id, document.file_name || "Untitled document");
    }

    const chunks: MaterialChunk[] = ((chunksResult.data ?? []) as ChunkRow[])
      .filter((chunk) => chunk.content?.trim())
      .map((chunk) => ({
        ...chunk,
        documentName: documentNames.get(chunk.document_id) || "Untitled document",
      }));

    console.log(
      `STUDY TOOLS: ${tool} for "${subject.name}" — ${documentNames.size} documents, ${chunks.length} chunks`
    );

    if (chunks.length === 0) {
      throw new StudyToolError(
        documentNames.size > 0
          ? "Your documents are not prepared for AI yet. Click \"Prepare for AI\" in Your documents, then try again."
          : "Upload some study material to this subject first.",
        409,
        "NO_MATERIAL"
      );
    }

    const selected = selectMaterial(chunks, tool, focus);
    const context = buildContext(selected);
    const usedDocuments = new Set(selected.map((chunk) => chunk.documentName));

    // ---------- Gemini ----------
    const prompt = buildPrompt(tool, subject.name, context, count, focus);
    const maxOutputTokens = tool === "quiz" ? 4000 + count * 300 : 8000;

    let generated: { data: unknown; model: string };

    try {
      generated = await generateJson(prompt, maxOutputTokens, startedAt);
    } catch (error) {
      console.error("STUDY TOOLS: Gemini failed:", error);
      throw new StudyToolError(
        isTemporaryError(error)
          ? "Gemini is busy right now. Please try again in a moment."
          : "Gemini could not create this right now. Please try again.",
        503,
        "GEMINI_UNAVAILABLE"
      );
    }

    const allNames = new Set(documentNames.values());

    let result: unknown;

    if (tool === "quiz") {
      const quiz = cleanQuiz(generated.data, allNames);

      if (quiz.questions.length < Math.min(5, count)) {
        throw new StudyToolError(
          "The quiz came back incomplete. Please try again.",
          502,
          "BAD_OUTPUT"
        );
      }

      quiz.questions = quiz.questions.slice(0, count);
      result = quiz;
    } else if (tool === "topics") {
      const topics = cleanTopics(generated.data, allNames);

      if (topics.topics.length === 0) {
        throw new StudyToolError(
          "No key topics came back. Please try again.",
          502,
          "BAD_OUTPUT"
        );
      }

      result = topics;
    } else {
      const flowchart = cleanFlowchart(generated.data);

      if (flowchart.stages.length < 2) {
        throw new StudyToolError(
          "The flowchart came back incomplete. Please try again.",
          502,
          "BAD_OUTPUT"
        );
      }

      result = flowchart;
    }

    console.log(
      `STUDY TOOLS: ${tool} done with ${generated.model} in ${Date.now() - startedAt}ms`
    );

    return NextResponse.json({
      tool,
      subjectName: subject.name,
      model: generated.model,
      documentsUsed: [...usedDocuments],
      result,
    });
  } catch (error: unknown) {
    if (error instanceof StudyToolError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error("STUDY TOOLS: unexpected error:", error);

    return NextResponse.json(
      {
        error: "Something went wrong. Please try again.",
        code: "UNEXPECTED_ERROR",
      },
      { status: 500 }
    );
  }
}