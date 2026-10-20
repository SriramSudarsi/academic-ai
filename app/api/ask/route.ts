import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
 * =============================================================
 * GEMINI CONFIGURATION
 * =============================================================
 *
 * Current stable Gemini Flash models.
 *
 * IMPORTANT:
 * - No Gemini 2.x model is used.
 * - We do NOT read GEMINI_MODEL from .env.local.
 *   This prevents an old environment variable from silently
 *   forcing the application back onto a retired model.
 * - The fallback chain contains only current Gemini 3.x models.
 */

const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
] as const;

/*
 * Timeout for ONE Gemini request.
 *
 * We keep this below the total route duration so the application
 * has time to move to another current Gemini model if Google
 * temporarily returns 503/504.
 */
const REQUEST_TIMEOUT_MS = 18000;

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error(
    "Missing GEMINI_API_KEY"
  );
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
  httpOptions: {
    timeout: REQUEST_TIMEOUT_MS,
    retryOptions: {
      attempts: 1,
    },
  },
});

/*
 * =============================================================
 * SUPABASE CONFIGURATION
 * =============================================================
 */

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL;

const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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

/*
 * =============================================================
 * TYPES
 * =============================================================
 */

type DocumentRow = {
  id: string;
  file_name: string | null;
};

type ChunkRow = {
  id: string;
  document_id: string;
  subject_id: string;
  content: string | null;
  chunk_index: number | null;
  created_at: string | null;
};

type ScoredChunk = ChunkRow & {
  documentName: string;
  score: number;
};

/*
 * =============================================================
 * CONSTANTS
 * =============================================================
 */

const UNAVAILABLE =
  "This information is not available in the attached study material.";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "give",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "me",
  "most",
  "of",
  "on",
  "or",
  "please",
  "prepare",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your",
  "about",
  "explain",
  "help",
  "understand",
  "simple",
  "terms",
  "subject",
  "material",
  "example",
]);

/*
 * =============================================================
 * TEXT HELPERS
 * =============================================================
 */

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean);
}

function meaningfulTokens(
  text: string
): string[] {
  return [
    ...new Set(
      tokenize(text).filter(
        (token) =>
          token.length >= 2 &&
          !STOP_WORDS.has(token)
      )
    ),
  ];
}

function getQuestionNumbers(
  question: string
): string[] {
  const matches = question.match(
    /\b(?:session|sess|class|lecture|chapter|module|unit|week)\s*(\d+(?:\s*(?:and|&|-)\s*\d+)*)\b/gi
  );

  if (!matches) {
    return [];
  }

  const numbers: string[] = [];

  for (const match of matches) {
    const found =
      match.match(/\d+/g) || [];

    for (const number of found) {
      if (!numbers.includes(number)) {
        numbers.push(number);
      }
    }
  }

  return numbers;
}

function isBroadQuestion(
  question: string
): boolean {
  const normalized =
    normalizeText(question);

  return (
    normalized.includes(
      "explain this subject"
    ) ||
    normalized.includes(
      "explain the subject"
    ) ||
    normalized.includes(
      "simple terms"
    ) ||
    normalized.includes(
      "important concepts"
    ) ||
    normalized.includes(
      "key concepts"
    ) ||
    normalized.includes(
      "prepare for my exam"
    ) ||
    normalized.includes(
      "prepare me for the exam"
    ) ||
    normalized ===
      "give me an example" ||
    normalized.includes(
      "overview of"
    ) ||
    normalized.includes(
      "summarize the subject"
    ) ||
    normalized.includes(
      "summarise the subject"
    )
  );
}

/*
 * =============================================================
 * CHUNK SCORING
 * =============================================================
 */

function scoreChunk(
  question: string,
  content: string,
  documentName: string
): number {
  if (!content?.trim()) {
    return 0;
  }

  const questionTokens =
    meaningfulTokens(question);

  const normalizedContent =
    normalizeText(content);

  const normalizedDocument =
    normalizeText(documentName);

  if (questionTokens.length === 0) {
    return 0;
  }

  let score = 0;

  for (const token of questionTokens) {
    const wordPattern =
      new RegExp(
        `(^|\\s)${token.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )}(?=\\s|$)`,
        "i"
      );

    if (
      wordPattern.test(
        normalizedContent
      )
    ) {
      score +=
        token.length >= 6 ? 2 : 1;
    } else if (
      normalizedContent.includes(token)
    ) {
      score += 0.5;
    }

    if (
      normalizedDocument.includes(token)
    ) {
      score += 4;
    }
  }

  const normalizedQuestion =
    normalizeText(question);

  if (
    normalizedQuestion.length > 5 &&
    normalizedContent.includes(
      normalizedQuestion
    )
  ) {
    score += 10;
  }

  const requestedNumbers =
    getQuestionNumbers(question);

  if (requestedNumbers.length > 0) {
    for (const number of requestedNumbers) {
      const sessionPatterns = [
        `session ${number}`,
        `session-${number}`,
        `session_${number}`,
        `sess ${number}`,
        `class ${number}`,
        `lecture ${number}`,
        `chapter ${number}`,
        `module ${number}`,
        `unit ${number}`,
        `week ${number}`,
      ];

      for (const pattern of sessionPatterns) {
        if (
          normalizedContent.includes(
            pattern
          )
        ) {
          score += 8;
        }

        if (
          normalizedDocument.includes(
            pattern
          )
        ) {
          score += 14;
        }
      }

      if (
        normalizedDocument.match(
          new RegExp(
            `(?:^|[^0-9])${number}(?:[^0-9]|$)`
          )
        )
      ) {
        score += 3;
      }
    }
  }

  return score;
}

/*
 * =============================================================
 * GEMINI ERROR HANDLING
 * =============================================================
 */

function getGeminiStatus(
  error: unknown
): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error
  ) {
    const status = Number(
      (
        error as {
          status?: unknown;
        }
      ).status
    );

    return Number.isFinite(status)
      ? status
      : null;
  }

  return null;
}

function isTemporaryGeminiError(
  error: unknown
): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  const status =
    getGeminiStatus(error);

  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes(
      "high demand"
    ) ||
    message.includes(
      "temporarily unavailable"
    ) ||
    message.includes(
      "unavailable"
    ) ||
    message.includes(
      "deadline exceeded"
    ) ||
    message.includes(
      "deadline expired"
    ) ||
    message.includes(
      "timeout"
    ) ||
    message.includes(
      "timed out"
    ) ||
    message.includes(
      "rate limit"
    )
  );
}

/*
 * =============================================================
 * GEMINI GENERATION
 * =============================================================
 *
 * THERE IS ONLY ONE generateAnswer() FUNCTION IN THIS FILE.
 *
 * The previous route contained two different versions of this
 * function. That has been completely removed.
 */

async function generateWithModel(
  model: string,
  prompt: string
) {
  console.log(
    "AI ASK: trying Gemini model =",
    model
  );

  return ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      /*
       * Low thinking is sufficient for this RAG-based
       * study assistant and reduces latency.
       */
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },

      maxOutputTokens: 1200,
    },
  });
}

async function generateAnswer(
  prompt: string
) {
  let lastError: unknown = null;

  for (
    let index = 0;
    index < GEMINI_MODELS.length;
    index++
  ) {
    const model =
      GEMINI_MODELS[index];

    try {
      console.log(
        `AI ASK: Gemini attempt ${
          index + 1
        }/${GEMINI_MODELS.length}`
      );

      const response =
        await generateWithModel(
          model,
          prompt
        );

      console.log(
        "AI ASK: Gemini response received from",
        model
      );

      return response;
    } catch (error) {
      lastError = error;

      const status =
        getGeminiStatus(error);

      console.error(
        `AI ASK: Gemini model ${model} failed (status ${
          status ?? "unknown"
        }):`,
        error
      );

      /*
       * Permanent errors should NOT be hidden by trying
       * random models.
       *
       * Example:
       * - invalid request
       * - malformed configuration
       * - authentication problem
       */
      if (
        !isTemporaryGeminiError(
          error
        )
      ) {
        throw error;
      }

      /*
       * Temporary errors:
       *
       * 503 = Gemini capacity/high demand
       * 504 = request/deadline timeout
       * 429 = rate limit
       *
       * Move to another current Gemini model.
       */
      if (
        index <
        GEMINI_MODELS.length - 1
      ) {
        console.log(
          "AI ASK: temporary Gemini failure."
        );

        console.log(
          "AI ASK: moving to next current Gemini model..."
        );

        /*
         * Very short delay only.
         *
         * We intentionally do NOT wait 5–10 seconds here,
         * because another model may already have capacity.
         */
        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              750
            )
        );
      }
    }
  }

  console.error(
    "AI ASK: all current Gemini models failed:",
    lastError
  );

  throw lastError;
}

/*
 * =============================================================
 * HISTORY
 * =============================================================
 */

async function saveHistory(params: {
  userId: string;
  subjectId: string;
  question: string;
  answer: string;
}) {
  const { error } =
    await supabaseAdmin
      .from("ai_history")
      .insert({
        user_id: params.userId,
        subject_id: params.subjectId,
        question:
          params.question.trim(),
        answer: params.answer,
      });

  if (error) {
    console.error(
      "AI ASK: history save failed:",
      error
    );
  }
}

/*
 * =============================================================
 * UNAVAILABLE RESPONSE
 * =============================================================
 */

async function returnUnavailable(params: {
  userId: string;
  subjectId: string;
  question: string;
}) {
  await saveHistory({
    userId: params.userId,
    subjectId: params.subjectId,
    question: params.question,
    answer: UNAVAILABLE,
  });

  return NextResponse.json({
    answer: UNAVAILABLE,
    source: "attachments",
    grounded: false,
    chunksUsed: 0,
    documentsUsed: [],
  });
}

/*
 * =============================================================
 * POST
 * =============================================================
 */

export async function POST(
  request: Request
) {
  const startedAt =
    Date.now();

  try {
    console.log(
      "AI ASK: request received"
    );

    const body =
      await request.json();

    const question =
      typeof body?.question ===
      "string"
        ? body.question.trim()
        : "";

    const subjectId =
      typeof body?.subjectId ===
      "string"
        ? body.subjectId
        : "";

    if (!question) {
      return NextResponse.json(
        {
          error:
            "Question is required.",
        },
        { status: 400 }
      );
    }

    if (!subjectId) {
      return NextResponse.json(
        {
          error:
            "Subject ID is required.",
        },
        { status: 400 }
      );
    }

    /*
     * =========================================================
     * AUTHENTICATION
     * =========================================================
     */

    const authorizationHeader =
      request.headers.get(
        "authorization"
      );

    if (
      !authorizationHeader?.startsWith(
        "Bearer "
      )
    ) {
      return NextResponse.json(
        {
          error:
            "You must be signed in to ask questions.",
        },
        { status: 401 }
      );
    }

    const accessToken =
      authorizationHeader.substring(
        "Bearer ".length
      );

    const {
      data: { user },
      error: userError,
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      );

    if (userError || !user) {
      console.error(
        "AI ASK: authentication failed:",
        userError
      );

      return NextResponse.json(
        {
          error:
            "Your session is invalid or has expired. Please sign in again.",
        },
        { status: 401 }
      );
    }

    console.log(
      "AI ASK: authenticated user =",
      user.id
    );

    console.log(
      "AI ASK: subject =",
      subjectId
    );

    console.log(
      "AI ASK: question =",
      question
    );

    /*
     * =========================================================
     * VERIFY SUBJECT
     * =========================================================
     */

    const {
      data: subject,
      error: subjectError,
    } =
      await supabaseAdmin
        .from("subjects")
        .select(
          "id, name, user_id"
        )
        .eq(
          "id",
          subjectId
        )
        .eq(
          "user_id",
          user.id
        )
        .maybeSingle();

    if (subjectError) {
      console.error(
        "AI ASK: subject lookup failed:",
        subjectError
      );

      return NextResponse.json(
        {
          error:
            "Unable to access this subject.",
        },
        { status: 500 }
      );
    }

    if (!subject) {
      return NextResponse.json(
        {
          error:
            "Subject not found or you do not have access to it.",
        },
        { status: 404 }
      );
    }

    console.log(
      "AI ASK: subject verified =",
      subject.name
    );

    /*
     * =========================================================
     * READ EXISTING DOCUMENT CHUNKS
     * =========================================================
     *
     * This endpoint does NOT process documents.
     * It only reads document_chunks that already exist.
     */

    console.log(
      "AI ASK: reading existing document chunks..."
    );

    const [
      documentsResult,
      chunksResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("documents")
        .select(
          "id, file_name"
        )
        .eq(
          "subject_id",
          subjectId
        ),

      supabaseAdmin
        .from("document_chunks")
        .select(
          "id, document_id, subject_id, content, chunk_index, created_at"
        )
        .eq(
          "subject_id",
          subjectId
        )
        .order(
          "document_id",
          {
            ascending: true,
          }
        )
        .order(
          "chunk_index",
          {
            ascending: true,
          }
        )
        .limit(2000),
    ]);

    if (documentsResult.error) {
      console.error(
        "AI ASK: document lookup failed:",
        documentsResult.error
      );

      return NextResponse.json(
        {
          error:
            "Unable to read your study documents.",
        },
        { status: 500 }
      );
    }

    if (chunksResult.error) {
      console.error(
        "AI ASK: document chunk lookup failed:",
        chunksResult.error
      );

      return NextResponse.json(
        {
          error:
            "Unable to read the attached study material.",
        },
        { status: 500 }
      );
    }

    const documents =
      (documentsResult.data ??
        []) as DocumentRow[];

    const allChunks =
      (chunksResult.data ??
        []) as ChunkRow[];

    console.log(
      "AI ASK: documents found =",
      documents.length
    );

    console.log(
      "AI ASK: document chunks found =",
      allChunks.length
    );

    /*
     * =========================================================
     * NO MATERIAL
     * =========================================================
     */

    if (
      allChunks.length === 0
    ) {
      if (
        documents.length > 0
      ) {
        return NextResponse.json(
          {
            error:
              "Your study documents have not finished preparing yet. Please wait for document processing to finish and try again.",
            code:
              "DOCUMENTS_NOT_READY",
            retryable: true,
          },
          { status: 409 }
        );
      }

      return returnUnavailable({
        userId: user.id,
        subjectId,
        question,
      });
    }

    /*
     * =========================================================
     * DOCUMENT NAME MAP
     * =========================================================
     */

    const documentNameMap =
      new Map<string, string>();

    for (const document of documents) {
      documentNameMap.set(
        document.id,
        document.file_name ||
          "Untitled document"
      );
    }

    const enrichedChunks =
      allChunks.map(
        (chunk) => ({
          ...chunk,
          documentName:
            documentNameMap.get(
              chunk.document_id
            ) ||
            "Untitled document",
        })
      );

    /*
     * =========================================================
     * SCORE CHUNKS
     * =========================================================
     */

    const scoredChunks: ScoredChunk[] =
      enrichedChunks
        .map(
          (chunk) => ({
            ...chunk,
            score: scoreChunk(
              question,
              chunk.content ||
                "",
              chunk.documentName
            ),
          })
        )
        .sort(
          (a, b) => {
            if (
              b.score !==
              a.score
            ) {
              return (
                b.score -
                a.score
              );
            }

            return (
              (a.chunk_index ??
                0) -
              (b.chunk_index ??
                0)
            );
          }
        );

    const positiveChunks =
      scoredChunks.filter(
        (chunk) =>
          chunk.score > 0
      );

    console.log(
      "AI ASK: relevant chunks found =",
      positiveChunks.length
    );

    const broad =
      isBroadQuestion(
        question
      );

    const requestedNumbers =
      getQuestionNumbers(
        question
      );

    let selectedChunks:
      ScoredChunk[] = [];

    /*
     * =========================================================
     * BROAD QUESTION
     * =========================================================
     */

    if (broad) {
      const byDocument =
        new Map<
          string,
          ScoredChunk[]
        >();

      for (const chunk of enrichedChunks) {
        const list =
          byDocument.get(
            chunk.document_id
          ) || [];

        list.push({
          ...chunk,
          score: scoreChunk(
            question,
            chunk.content ||
              "",
            chunk.documentName
          ),
        });

        byDocument.set(
          chunk.document_id,
          list
        );
      }

      /*
       * Take representative material from each document.
       */
      for (const list of byDocument.values()) {
        list.sort(
          (a, b) =>
            (a.chunk_index ??
              0) -
            (b.chunk_index ??
              0)
        );

        selectedChunks.push(
          ...list.slice(0, 3)
        );
      }

      /*
       * If the subject is small, use additional chunks.
       */
      if (
        selectedChunks.length <
        12
      ) {
        const remaining =
          scoredChunks.filter(
            (chunk) =>
              !selectedChunks.some(
                (selected) =>
                  selected.id ===
                  chunk.id
              )
          );

        selectedChunks.push(
          ...remaining.slice(
            0,
            12 -
              selectedChunks.length
          )
        );
      }
    }

    /*
     * =========================================================
     * SESSION / CHAPTER / LECTURE QUESTION
     * =========================================================
     */

    else if (
      requestedNumbers.length >
      0
    ) {
      const targeted =
        scoredChunks.filter(
          (chunk) =>
            chunk.score > 0
        );

      selectedChunks =
        targeted.slice(
          0,
          10
        );

      /*
       * If lexical matching is weak, check filenames.
       */
      if (
        selectedChunks.length <
        4
      ) {
        const filenameMatches =
          enrichedChunks.filter(
            (chunk) => {
              const name =
                normalizeText(
                  chunk.documentName
                );

              return requestedNumbers.some(
                (number) =>
                  name.includes(
                    `session ${number}`
                  ) ||
                  name.includes(
                    `session-${number}`
                  ) ||
                  name.match(
                    new RegExp(
                      `(?:^|[^0-9])${number}(?:[^0-9]|$)`
                    )
                  )
              );
            }
          );

        selectedChunks = [
          ...selectedChunks,
          ...filenameMatches.map(
            (chunk) => ({
              ...chunk,
              score: 0,
            })
          ).filter(
            (chunk) =>
              !selectedChunks.some(
                (selected) =>
                  selected.id ===
                  chunk.id
              )
          ),
        ].slice(
          0,
          10
        );
      }
    }

    /*
     * =========================================================
     * NORMAL QUESTION WITH MATCHES
     * =========================================================
     */

    else if (
      positiveChunks.length >
      0
    ) {
      selectedChunks =
        positiveChunks.slice(
          0,
          10
        );
    }

    /*
     * =========================================================
     * NO STRONG MATCH
     * =========================================================
     */

    else {
      selectedChunks =
        scoredChunks.slice(
          0,
          6
        );
    }

    /*
     * =========================================================
     * EMPTY CONTEXT SAFETY
     * =========================================================
     */

    if (
      selectedChunks.length ===
      0
    ) {
      return returnUnavailable({
        userId: user.id,
        subjectId,
        question,
      });
    }

    /*
     * =========================================================
     * BUILD BOUNDED CONTEXT
     * =========================================================
     *
     * Previous version could send ~50,000+ characters.
     *
     * That is not inherently beyond Gemini's context window,
     * but it is unnecessary for a normal student question and
     * increases latency.
     */

    const MAX_CONTEXT_CHARS =
      broad
        ? 32000
        : 28000;

    const contextParts: string[] =
      [];

    let contextCharacters =
      0;

    for (const chunk of selectedChunks) {
      const piece = `
--- STUDY MATERIAL ---
DOCUMENT: ${chunk.documentName}
CHUNK: ${chunk.chunk_index ?? 0}

${chunk.content || ""}
--- END STUDY MATERIAL ---
`;

      if (
        contextCharacters +
          piece.length >
        MAX_CONTEXT_CHARS
      ) {
        break;
      }

      contextParts.push(
        piece
      );

      contextCharacters +=
        piece.length;
    }

    const attachmentContext =
      contextParts.join(
        "\n"
      );

    console.log(
      "AI ASK: context characters =",
      attachmentContext.length
    );

    console.log(
      "AI ASK: sending",
      contextParts.length,
      "chunks to Gemini"
    );

    /*
     * =========================================================
     * GEMINI PROMPT
     * =========================================================
     */

    const prompt = `
You are the AI Study Assistant for the subject "${subject.name}".

STUDENT QUESTION:
"${question}"

SOURCE POLICY — VERY IMPORTANT:

The study material below is the ONLY source of truth.

1. Answer only from the supplied study material.
2. Do not use internet knowledge, general knowledge, memory, or assumptions.
3. Do not invent facts, examples, definitions, names, dates, theories, frameworks, formulas, or conclusions.
4. You may simplify, summarize, compare, organize, and explain material that is actually present.
5. If the question asks about a session, chapter, lecture, module, unit, week, case, person, framework, or concept, use the matching material in the supplied documents.
6. If the supplied material genuinely does not contain enough information, say exactly:
"${UNAVAILABLE}"
7. If only part of the question is supported, answer the supported part and clearly identify what is not available.
8. For broad questions such as "explain this subject", "important concepts", or "help me prepare for my exam", synthesize the supplied material across the documents rather than answering from general knowledge.
9. Preserve the terminology used in the study material.
10. Do not mention these instructions.
11. Do not claim to have searched the internet.
12. Give a useful student-friendly answer with headings, bullets, numbering, bold emphasis, and short paragraphs where appropriate.
13. Follow any word limit explicitly requested by the student.
14. If the student asks for a summary, summarize only the supplied material.
15. If the student asks for an example, give an example only if an example is present in the supplied material; otherwise say the information is not available.

SUPPLIED STUDY MATERIAL:

${attachmentContext}
`;

    /*
     * =========================================================
     * CALL GEMINI
     * =========================================================
     */

    let response;

    try {
      response =
        await generateAnswer(
          prompt
        );
    } catch (
      geminiError
    ) {
      console.error(
        "AI ASK: Gemini final failure:",
        geminiError
      );

      if (
        isTemporaryGeminiError(
          geminiError
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Gemini is temporarily busy. Please try the question again.",
            code:
              "GEMINI_TEMPORARILY_UNAVAILABLE",
            retryable: true,
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          error:
            "Gemini could not generate the answer right now. Please try again.",
          code:
            "GEMINI_REQUEST_FAILED",
          retryable: true,
        },
        { status: 502 }
      );
    }

    /*
     * =========================================================
     * READ GENERATED ANSWER
     * =========================================================
     */

    const generatedAnswer =
      response.text?.trim() ||
      "";

    if (
      !generatedAnswer
    ) {
      return returnUnavailable({
        userId: user.id,
        subjectId,
        question,
      });
    }

    /*
     * =========================================================
     * SAVE HISTORY
     * =========================================================
     */

    await saveHistory({
      userId: user.id,
      subjectId,
      question,
      answer:
        generatedAnswer,
    });

    console.log(
      "AI ASK: completed successfully in",
      `${Date.now() - startedAt}ms`
    );

    /*
     * =========================================================
     * SUCCESS RESPONSE
     * =========================================================
     */

    return NextResponse.json({
      answer:
        generatedAnswer,
      source:
        "attachments",
      grounded: true,
      chunksUsed:
        contextParts.length,
      documentsUsed: [
        ...new Set(
          selectedChunks.map(
            (chunk) =>
              chunk.documentName
          )
        ),
      ],
    });
  } catch (
    error: unknown
  ) {
    console.error(
      "AI ASK: unexpected error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while answering the question. Please try again.",
        code:
          "AI_ASK_UNEXPECTED_ERROR",
        retryable: true,
      },
      { status: 500 }
    );
  }
}