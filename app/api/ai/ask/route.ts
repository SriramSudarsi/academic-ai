import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/*
 * ============================================================
 * ACADEMIC AI — ASK QUESTION API
 * ============================================================
 *
 * This route:
 *
 * 1. Authenticates the student.
 * 2. Verifies subject ownership.
 * 3. Reads existing document_chunks.
 * 4. Retrieves relevant study material.
 * 5. Sends the material to Gemini.
 * 6. Automatically fails over between CURRENT Gemini models.
 * 7. Saves the answer to ai_history.
 *
 * IMPORTANT:
 *
 * This route NEVER processes documents.
 * Document processing remains:
 *
 * /api/document/process
 *
 * ============================================================
 */

export const runtime = "nodejs";
export const maxDuration = 60;


/*
 * ============================================================
 * GEMINI CONFIGURATION
 * ============================================================
 *
 * DO NOT use GEMINI_MODEL from .env.local.
 *
 * We intentionally control the model order here so an old
 * environment variable cannot silently force an obsolete model.
 *
 * Current production model priority:
 *
 * 1. Gemini 3.7 Flash
 * 2. Gemini 3.6 Flash
 * 3. Gemini 3.5 Flash
 * 4. Gemini 3.5 Flash-Lite
 * 5. Gemini Flash Latest alias
 *
 * We deliberately DO NOT use Gemini 2.5 here.
 *
 * If Google temporarily makes one model unavailable,
 * the next model is attempted automatically.
 *
 * ============================================================
 */

const GEMINI_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
] as const;

const GEMINI_TIMEOUT_MS = 12000;
const MAX_OUTPUT_TOKENS = 1800;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,

  httpOptions: {
    timeout: GEMINI_TIMEOUT_MS,

    /*
     * We handle model failover ourselves.
     * Do not let the SDK perform long hidden retries.
     */
    retryOptions: {
      attempts: 1,
    },
  },
});


/*
 * ============================================================
 * ENVIRONMENT VALIDATION
 * ============================================================
 */

if (!process.env.GEMINI_API_KEY) {
  throw new Error(
    "Missing GEMINI_API_KEY"
  );
}


/*
 * ============================================================
 * SUPABASE ADMIN CLIENT
 * ============================================================
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
 * ============================================================
 * TYPES
 * ============================================================
 */

type SubjectRow = {
  id: string;
  name: string;
  user_id: string;
};

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
 * ============================================================
 * CONSTANTS
 * ============================================================
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
  "did",
  "do",
  "does",
  "for",
  "from",
  "give",
  "had",
  "has",
  "have",
  "help",
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
  "our",
  "please",
  "prepare",
  "should",
  "simple",
  "subject",
  "summarize",
  "summarise",
  "tell",
  "terms",
  "that",
  "the",
  "their",
  "them",
  "this",
  "those",
  "to",
  "understand",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "about",
  "example",
  "explain",
  "material",
  "important",
  "concepts",
  "concept",
]);


/*
 * ============================================================
 * TEXT HELPERS
 * ============================================================
 */

function normalizeText(
  text: string
): string {
  return text
    .toLowerCase()
    .replace(
      /[\u2018\u2019\u201A\u201B]/g,
      "'"
    )
    .replace(
      /[\u201C\u201D\u201E\u201F]/g,
      '"'
    )
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /[^a-z0-9\s.-]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function tokenize(
  text: string
): string[] {
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


/*
 * ============================================================
 * QUESTION NUMBER DETECTION
 * ============================================================
 *
 * Supports:
 *
 * session 1
 * session 1 and 2
 * session 1 & 2
 * session 1-3
 * chapter 4
 * lecture 5
 * module 2
 * unit 3
 * week 6
 * part 2
 *
 * ============================================================
 */

function getRequestedNumbers(
  question: string
): string[] {
  const normalized =
    normalizeText(question);

  const numbers: string[] = [];

  const pattern =
    /\b(?:session|sess|class|lecture|chapter|module|unit|week|part)\s*([0-9]+(?:\s*(?:and|&|-)\s*[0-9]+)*)/gi;

  const matches =
    normalized.matchAll(pattern);

  for (const match of matches) {
    const found =
      match[1]?.match(/\d+/g) || [];

    for (const number of found) {
      if (!numbers.includes(number)) {
        numbers.push(number);
      }
    }
  }

  return numbers;
}


/*
 * ============================================================
 * BROAD QUESTION DETECTION
 * ============================================================
 */

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
      "prepare me for my exam"
    ) ||
    normalized.includes(
      "prepare for the exam"
    ) ||
    normalized.includes(
      "overview"
    ) ||
    normalized.includes(
      "summarize the subject"
    ) ||
    normalized.includes(
      "summarise the subject"
    ) ||
    normalized.includes(
      "what is this subject"
    ) ||
    normalized.includes(
      "what does this subject"
    )
  );
}


/*
 * ============================================================
 * CHUNK SCORING
 * ============================================================
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

  if (
    questionTokens.length === 0
  ) {
    return 0;
  }

  const normalizedContent =
    normalizeText(content);

  const normalizedDocument =
    normalizeText(documentName);

  let score = 0;

  for (const token of questionTokens) {
    const escaped =
      token.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const wordPattern =
      new RegExp(
        `(^|\\s)${escaped}(?=\\s|$)`,
        "i"
      );

    if (
      wordPattern.test(
        normalizedContent
      )
    ) {
      score +=
        token.length >= 6
          ? 3
          : 1;
    } else if (
      normalizedContent.includes(
        token
      )
    ) {
      score += 0.5;
    }

    if (
      normalizedDocument.includes(
        token
      )
    ) {
      score += 5;
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
    getRequestedNumbers(question);

  for (const number of requestedNumbers) {
    const patterns = [
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
      `part ${number}`,
    ];

    for (const pattern of patterns) {
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

  return score;
}


/*
 * ============================================================
 * UNIQUE CHUNKS
 * ============================================================
 */

function uniqueChunks(
  chunks: ScoredChunk[]
): ScoredChunk[] {
  const seen =
    new Set<string>();

  const result: ScoredChunk[] = [];

  for (const chunk of chunks) {
    if (seen.has(chunk.id)) {
      continue;
    }

    seen.add(chunk.id);
    result.push(chunk);
  }

  return result;
}


/*
 * ============================================================
 * CHUNK SELECTION
 * ============================================================
 */

function selectChunks(
  question: string,
  chunks: ScoredChunk[]
): ScoredChunk[] {
  if (chunks.length === 0) {
    return [];
  }

  const broad =
    isBroadQuestion(question);

  const requestedNumbers =
    getRequestedNumbers(question);

  const positiveChunks =
    chunks
      .filter(
        (chunk) =>
          chunk.score > 0
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  /*
   * ----------------------------------------------------------
   * BROAD QUESTION
   * ----------------------------------------------------------
   */

  if (broad) {
    const byDocument =
      new Map<
        string,
        ScoredChunk[]
      >();

    for (const chunk of chunks) {
      const existing =
        byDocument.get(
          chunk.document_id
        ) || [];

      existing.push(chunk);

      byDocument.set(
        chunk.document_id,
        existing
      );
    }

    const selected: ScoredChunk[] = [];

    for (const documentChunks of byDocument.values()) {
      documentChunks.sort(
        (a, b) =>
          (a.chunk_index ?? 0) -
          (b.chunk_index ?? 0)
      );

      selected.push(
        ...documentChunks.slice(
          0,
          4
        )
      );
    }

    /*
     * Small subjects:
     * use all available material.
     *
     * Larger subjects:
     * cap the context.
     */

    if (selected.length < 18) {
      const remaining =
        chunks.filter(
          (chunk) =>
            !selected.some(
              (item) =>
                item.id === chunk.id
            )
        );

      selected.push(
        ...remaining.slice(
          0,
          18 - selected.length
        )
      );
    }

    return uniqueChunks(
      selected
    ).slice(
      0,
      18
    );
  }


  /*
   * ----------------------------------------------------------
   * SESSION / CHAPTER / LECTURE QUESTION
   * ----------------------------------------------------------
   */

  if (
    requestedNumbers.length > 0
  ) {
    const targeted =
      positiveChunks.slice(
        0,
        12
      );

    /*
     * If lexical matching is weak,
     * search filenames for the requested number.
     */

    if (
      targeted.length < 4
    ) {
      const filenameMatches =
        chunks.filter(
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
                name.includes(
                  `chapter ${number}`
                ) ||
                name.includes(
                  `lecture ${number}`
                ) ||
                name.match(
                  new RegExp(
                    `(?:^|[^0-9])${number}(?:[^0-9]|$)`
                  )
                )
            );
          }
        );

      return uniqueChunks(
        [
          ...targeted,
          ...filenameMatches,
        ]
      ).slice(
        0,
        12
      );
    }

    return uniqueChunks(
      targeted
    );
  }


  /*
   * ----------------------------------------------------------
   * NORMAL QUESTION
   * ----------------------------------------------------------
   */

  if (
    positiveChunks.length > 0
  ) {
    return uniqueChunks(
      positiveChunks.slice(
        0,
        12
      )
    );
  }


  /*
   * ----------------------------------------------------------
   * NO LEXICAL MATCH
   * ----------------------------------------------------------
   *
   * Still give Gemini representative material.
   * Gemini itself decides whether the supplied material
   * supports the answer.
   */

  return uniqueChunks(
    chunks
      .sort(
        (a, b) =>
          (a.chunk_index ?? 0) -
          (b.chunk_index ?? 0)
      )
      .slice(
        0,
        8
      )
  );
}


/*
 * ============================================================
 * GEMINI ERROR HELPERS
 * ============================================================
 */

function getErrorStatus(
  error: unknown
): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error
  ) {
    const status =
      (
        error as {
          status?: unknown;
        }
      ).status;

    if (
      typeof status === "number"
    ) {
      return status;
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const match =
    message.match(
      /status["':=\s]+(\d{3})/i
    );

  if (match) {
    return Number(
      match[1]
    );
  }

  return null;
}


function isRetryableGeminiError(
  error: unknown
): boolean {
  const status =
    getErrorStatus(error);

  /*
   * Model unavailable / temporary capacity /
   * rate limit / gateway failures.
   *
   * These are exactly the situations where another
   * Gemini model should be attempted.
   */

  if (
    status === 404 ||
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes(
      "not found"
    ) ||
    message.includes(
      "no longer available"
    ) ||
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
    ) ||
    message.includes(
      "quota"
    )
  );
}


/*
 * ============================================================
 * GEMINI REQUEST
 * ============================================================
 */

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number
): Promise<T> {
  return Promise.race([
    promise,

    new Promise<T>(
      (_, reject) => {
        const timer =
          setTimeout(
            () => {
              reject(
                new Error(
                  "Gemini request timed out."
                )
              );
            },
            milliseconds
          );

        void timer;
      }
    ),
  ]);
}


async function generateWithModel(
  model: string,
  prompt: string
) {
  console.log(
    "AI ASK: trying Gemini model =",
    model
  );

  return withTimeout(
    ai.models.generateContent({
      model,
      contents: prompt,

      config: {
        maxOutputTokens:
          MAX_OUTPUT_TOKENS,
      },
    }),

    GEMINI_TIMEOUT_MS
  );
}


/*
 * ============================================================
 * AUTOMATIC GEMINI MODEL FAILOVER
 * ============================================================
 *
 * This is the important fix.
 *
 * Example:
 *
 * 3.7 → 503
 *       ↓
 * 3.6 → 503
 *       ↓
 * 3.5 → success
 *
 * The student does not need to press Try Again.
 *
 * ============================================================
 */

async function generateAnswer(
  prompt: string
) {
  let lastError:
    | unknown
    | null = null;

  for (
    const model of GEMINI_MODELS
  ) {
    try {
      const response =
        await generateWithModel(
          model,
          prompt
        );

      console.log(
        "AI ASK: Gemini response received from",
        model
      );

      return {
        response,
        model,
      };
    } catch (error) {
      lastError = error;

      console.error(
        `AI ASK: Gemini model ${model} failed:`,
        error
      );

      /*
       * If this is not a model/service availability
       * problem, stop immediately.
       *
       * Examples:
       * - invalid API key
       * - malformed request
       * - authentication issue
       */

      if (
        !isRetryableGeminiError(
          error
        )
      ) {
        throw error;
      }

      console.log(
        "AI ASK: moving to next Gemini model..."
      );
    }
  }

  throw (
    lastError ||
    new Error(
      "All configured Gemini models failed."
    )
  );
}


/*
 * ============================================================
 * SAVE HISTORY
 * ============================================================
 */

async function saveHistory(
  params: {
    userId: string;
    subjectId: string;
    question: string;
    answer: string;
  }
) {
  const {
    userId,
    subjectId,
    question,
    answer,
  } = params;

  const {
    error,
  } =
    await supabaseAdmin
      .from("ai_history")
      .insert({
        user_id: userId,
        subject_id: subjectId,
        question:
          question.trim(),
        answer,
      });

  if (error) {
    console.error(
      "AI ASK: history save failed:",
      error
    );
  }
}


/*
 * ============================================================
 * UNAVAILABLE RESPONSE
 * ============================================================
 */

async function returnUnavailable(
  params: {
    userId: string;
    subjectId: string;
    question: string;
  }
) {
  await saveHistory({
    userId: params.userId,
    subjectId:
      params.subjectId,
    question:
      params.question,
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
 * ============================================================
 * POST /api/ai/ask
 * ============================================================
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


    /*
     * ----------------------------------------------------------
     * REQUEST BODY
     * ----------------------------------------------------------
     */

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
        {
          status: 400,
        }
      );
    }


    if (!subjectId) {
      return NextResponse.json(
        {
          error:
            "Subject ID is required.",
        },
        {
          status: 400,
        }
      );
    }


    /*
     * ----------------------------------------------------------
     * AUTHENTICATION
     * ----------------------------------------------------------
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
        {
          status: 401,
        }
      );
    }

    const accessToken =
      authorizationHeader.substring(
        "Bearer ".length
      );


    const {
      data: {
        user,
      },
      error:
        userError,
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      );


    if (
      userError ||
      !user
    ) {
      console.error(
        "AI ASK: authentication failed:",
        userError
      );

      return NextResponse.json(
        {
          error:
            "Your session is invalid or has expired. Please sign in again.",
        },
        {
          status: 401,
        }
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
     * ----------------------------------------------------------
     * VERIFY SUBJECT
     * ----------------------------------------------------------
     */

    const {
      data: subject,
      error:
        subjectError,
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
        {
          status: 500,
        }
      );
    }


    if (!subject) {
      return NextResponse.json(
        {
          error:
            "Subject not found or you do not have access to it.",
        },
        {
          status: 404,
        }
      );
    }


    console.log(
      "AI ASK: subject verified =",
      subject.name
    );


    /*
     * ----------------------------------------------------------
     * READ EXISTING DOCUMENTS + CHUNKS
     * ----------------------------------------------------------
     */

    console.log(
      "AI ASK: reading existing document chunks..."
    );


    const [
      documentsResult,
      chunksResult,
    ] =
      await Promise.all([
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


    if (
      documentsResult.error
    ) {
      console.error(
        "AI ASK: documents lookup failed:",
        documentsResult.error
      );

      return NextResponse.json(
        {
          error:
            "Unable to read study documents.",
        },
        {
          status: 500,
        }
      );
    }


    if (
      chunksResult.error
    ) {
      console.error(
        "AI ASK: document chunks lookup failed:",
        chunksResult.error
      );

      return NextResponse.json(
        {
          error:
            "Unable to read study material.",
        },
        {
          status: 500,
        }
      );
    }


    const documents =
      (
        documentsResult.data ||
        []
      ) as DocumentRow[];


    const chunks =
      (
        chunksResult.data ||
        []
      ) as ChunkRow[];


    console.log(
      "AI ASK: documents found =",
      documents.length
    );

    console.log(
      "AI ASK: document chunks found =",
      chunks.length
    );


    /*
     * ----------------------------------------------------------
     * NO MATERIAL
     * ----------------------------------------------------------
     */

    if (
      chunks.length === 0
    ) {
      return returnUnavailable({
        userId: user.id,
        subjectId,
        question,
      });
    }


    /*
     * ----------------------------------------------------------
     * MAP DOCUMENT NAMES
     * ----------------------------------------------------------
     */

    const documentNames =
      new Map<
        string,
        string
      >();

    for (
      const document of documents
    ) {
      documentNames.set(
        document.id,
        document.file_name ||
          "Study Material"
      );
    }


    /*
     * ----------------------------------------------------------
     * SCORE ALL CHUNKS
     * ----------------------------------------------------------
     */

    const enrichedChunks =
      chunks.map(
        (chunk) => {
          const documentName =
            documentNames.get(
              chunk.document_id
            ) ||
            "Study Material";

          return {
            ...chunk,
            documentName,
            score:
              scoreChunk(
                question,
                chunk.content ||
                  "",
                documentName
              ),
          };
        }
      );


    const positiveChunks =
      enrichedChunks.filter(
        (chunk) =>
          chunk.score > 0
      );


    console.log(
      "AI ASK: relevant chunks found =",
      positiveChunks.length
    );


    /*
     * ----------------------------------------------------------
     * SELECT MATERIAL
     * ----------------------------------------------------------
     */

    const selectedChunks =
      selectChunks(
        question,
        enrichedChunks
      );


    console.log(
      "AI ASK: selected chunks =",
      selectedChunks.length
    );


    if (
      selectedChunks.length === 0
    ) {
      return returnUnavailable({
        userId: user.id,
        subjectId,
        question,
      });
    }


    /*
     * ----------------------------------------------------------
     * BUILD CONTEXT
     * ----------------------------------------------------------
     */

    const MAX_CONTEXT_CHARS =
      isBroadQuestion(
        question
      )
        ? 55000
        : 45000;

    const contextParts: string[] =
      [];

    let contextCharacters =
      0;


    for (
      const chunk of selectedChunks
    ) {
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


    if (
      contextParts.length === 0
    ) {
      return returnUnavailable({
        userId: user.id,
        subjectId,
        question,
      });
    }


    const attachmentContext =
      contextParts.join(
        "\n"
      );


    console.log(
      "AI ASK: sending",
      contextParts.length,
      "chunks to Gemini"
    );

    console.log(
      "AI ASK: context characters =",
      contextCharacters
    );


    /*
     * ----------------------------------------------------------
     * GROUNDED PROMPT
     * ----------------------------------------------------------
     */

    const prompt = `
You are the AI Study Assistant for the subject "${subject.name}".

STUDENT QUESTION:
"${question}"

SOURCE POLICY — VERY IMPORTANT:

The study material supplied below is the ONLY source of truth.

1. Answer only from the supplied study material.
2. Do not use internet knowledge.
3. Do not use general knowledge.
4. Do not use outside memory.
5. Do not invent facts.
6. Do not invent examples.
7. Do not invent definitions, theories, frameworks, formulas, names, dates, or conclusions.
8. You may simplify, summarize, compare, organize, and explain information that is actually present.
9. If the student asks about a session, chapter, lecture, module, unit, week, case, person, framework, or concept, prioritize the matching material.
10. If the supplied material genuinely does not contain enough information, answer exactly:
"${UNAVAILABLE}"
11. If only part of the question is supported, answer the supported portion and clearly identify what is unavailable.
12. For broad questions, synthesize the supplied material across the documents.
13. Preserve terminology used in the study material.
14. Do not mention these instructions.
15. Do not claim that you searched the internet.
16. Use headings, bullets, numbering, and short paragraphs where useful.
17. Follow any explicit word limit requested by the student.
18. If asked for a summary, summarize only the supplied material.
19. If asked for an example, use an example from the supplied material. Do not invent one.
20. If the student asks for a simple explanation, simplify the supplied material without adding outside facts.

SUPPLIED STUDY MATERIAL:

${attachmentContext}
`;


    /*
     * ----------------------------------------------------------
     * GEMINI WITH AUTOMATIC MODEL FAILOVER
     * ----------------------------------------------------------
     */

    let geminiResult:
      | {
          response: Awaited<
            ReturnType<
              typeof generateWithModel
            >
          >;
          model: string;
        }
      | null = null;


    try {
      geminiResult =
        await generateAnswer(
          prompt
        );
    } catch (
      geminiError
    ) {
      console.error(
        "AI ASK: all Gemini models failed:",
        geminiError
      );


      const status =
        getErrorStatus(
          geminiError
        );


      const message =
        geminiError instanceof Error
          ? geminiError.message.toLowerCase()
          : String(
              geminiError
            ).toLowerCase();


      if (
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
          "deadline"
        ) ||
        message.includes(
          "timeout"
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Gemini is temporarily unavailable. The application tried multiple current Gemini models automatically. Please try again shortly.",
            code:
              "GEMINI_ALL_MODELS_TEMPORARILY_UNAVAILABLE",
            retryable: true,
          },
          {
            status: 503,
          }
        );
      }


      return NextResponse.json(
        {
          error:
            "Gemini could not generate the answer.",
          code:
            "GEMINI_REQUEST_FAILED",
          retryable: true,
        },
        {
          status: 502,
        }
      );
    }


    if (
      !geminiResult
    ) {
      return NextResponse.json(
        {
          error:
            "Gemini did not return a response.",
          code:
            "GEMINI_EMPTY_RESULT",
          retryable: true,
        },
        {
          status: 502,
        }
      );
    }


    /*
     * ----------------------------------------------------------
     * EXTRACT ANSWER
     * ----------------------------------------------------------
     */

    const generatedAnswer =
      geminiResult.response.text?.trim() ||
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
     * ----------------------------------------------------------
     * SAVE HISTORY
     * ----------------------------------------------------------
     */

    await saveHistory({
      userId: user.id,
      subjectId,
      question,
      answer:
        generatedAnswer,
    });


    /*
     * ----------------------------------------------------------
     * SUCCESS
     * ----------------------------------------------------------
     */

    console.log(
      "AI ASK: Gemini final model =",
      geminiResult.model
    );

    console.log(
      "AI ASK: completed successfully in",
      `${Date.now() - startedAt}ms`
    );


    return NextResponse.json({
      answer:
        generatedAnswer,

      source:
        "attachments",

      grounded:
        true,

      model:
        geminiResult.model,

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
      {
        status: 500,
      }
    );
  }
}