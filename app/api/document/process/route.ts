import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import mammoth from "mammoth";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";

/*
 * ============================================================
 * ACADEMIC AI — DOCUMENT PROCESSING API
 * ============================================================
 *
 * Request:  POST { documentId }
 *           Header: Authorization: Bearer <supabase access token>
 *
 * This route:
 *
 * 1. Authenticates the student.
 * 2. Loads the document row and verifies the student owns
 *    the subject it belongs to.
 * 3. Downloads the file from the "study-materials" bucket.
 * 4. Extracts text (PDF, DOCX, PPTX, TXT/MD/CSV).
 * 5. Splits the text into chunks.
 * 6. Saves the chunks to document_chunks.
 *
 * It is safe to run again on the same document: new chunks
 * are inserted first, and only then are the old chunks for
 * that document removed. If anything fails, the old chunks
 * stay in place.
 *
 * This route NEVER calls Gemini. Question answering lives in
 * /api/ai/ask and only reads the chunks created here.
 * ============================================================
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const STORAGE_BUCKET = "study-materials";

// About 3,500 characters per chunk, with some overlap so a
// sentence cut at a boundary still appears whole in one chunk.
const CHUNK_SIZE = 3500;
const CHUNK_OVERLAP = 400;
const INSERT_BATCH_SIZE = 100;

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

type DocumentRow = {
  id: string;
  subject_id: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
};

class ProcessingError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ============================================================
// TEXT EXTRACTION
// ============================================================

function getExtension(fileName: string): string {
  const match = fileName
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);

  return match ? match[1] : "";
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
  });

  try {
    const result = await parser.getText();

    // Label each page so answers can point to where
    // the information came from.
    if (result.pages && result.pages.length > 0) {
      return result.pages
        .map((page) => {
          const pageText = cleanText(page.text || "");

          return pageText
            ? `[Page ${page.num}]\n${pageText}`
            : "";
        })
        .filter(Boolean)
        .join("\n\n");
    }

    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({
    buffer,
  });

  return result.value || "";
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    )
    .replace(/&amp;/g, "&");
}

function textFromSlideXml(xml: string): string {
  const paragraphs = xml.split(/<\/a:p>/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const runs = [
      ...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g),
    ].map((match) => decodeXmlEntities(match[1]));

    const line = runs.join("").trim();

    if (line) {
      lines.push(line);
    }
  }

  return lines.join("\n");
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name)
    )
    .sort(
      (a, b) =>
        Number(a.match(/\d+/)?.[0] ?? 0) -
        Number(b.match(/\d+/)?.[0] ?? 0)
    );

  const slides: string[] = [];

  for (const slideFile of slideFiles) {
    const slideNumber = Number(
      slideFile.match(/slide(\d+)\.xml$/)?.[1] ?? 0
    );

    const slideXml = await zip
      .file(slideFile)!
      .async("string");

    let slideText = textFromSlideXml(slideXml);

    // Speaker notes often hold the real explanation.
    const notesFile = zip.file(
      `ppt/notesSlides/notesSlide${slideNumber}.xml`
    );

    if (notesFile) {
      const notesText = textFromSlideXml(
        await notesFile.async("string")
      )
        // Notes pages repeat the slide number; drop it.
        .replace(new RegExp(`^${slideNumber}$`, "m"), "")
        .trim();

      if (notesText) {
        slideText += `\nNotes: ${notesText}`;
      }
    }

    if (slideText.trim()) {
      slides.push(`[Slide ${slideNumber}]\n${slideText}`);
    }
  }

  return slides.join("\n\n");
}

async function extractText(
  buffer: Buffer,
  fileName: string,
  fileType: string
): Promise<string> {
  const extension = getExtension(fileName);
  const type = fileType.toLowerCase();

  if (extension === "pdf" || type === "application/pdf") {
    return extractPdf(buffer);
  }

  if (
    extension === "docx" ||
    type.includes("wordprocessingml")
  ) {
    return extractDocx(buffer);
  }

  if (
    extension === "pptx" ||
    type.includes("presentationml")
  ) {
    return extractPptx(buffer);
  }

  if (
    ["txt", "md", "csv"].includes(extension) ||
    type.startsWith("text/")
  ) {
    return buffer.toString("utf8");
  }

  if (extension === "doc" || extension === "ppt") {
    throw new ProcessingError(
      `"${fileName}" is an old Office format (.${extension}). Please save it as .${extension}x or PDF and upload it again.`,
      415
    );
  }

  throw new ProcessingError(
    `"${fileName}" is not a supported file type. Supported: PDF, DOCX, PPTX, TXT, MD, CSV.`,
    415
  );
}

// ============================================================
// CHUNKING
// ============================================================

function splitLongPiece(piece: string): string[] {
  if (piece.length <= CHUNK_SIZE) {
    return [piece];
  }

  // Split an oversized paragraph at sentence ends,
  // and as a last resort at a fixed length.
  const sentences =
    piece.match(/[^.!?\n]+[.!?]*\s*/g) || [piece];

  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > CHUNK_SIZE) {
      if (current) {
        parts.push(current);
        current = "";
      }

      for (
        let start = 0;
        start < sentence.length;
        start += CHUNK_SIZE
      ) {
        parts.push(
          sentence.slice(start, start + CHUNK_SIZE)
        );
      }

      continue;
    }

    if (current.length + sentence.length > CHUNK_SIZE) {
      parts.push(current);
      current = "";
    }

    current += sentence;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function chunkText(text: string): string[] {
  const pieces = text
    .split(/\n{2,}/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .flatMap(splitLongPiece);

  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current
      ? `${current}\n\n${piece}`
      : piece;

    if (candidate.length <= CHUNK_SIZE) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current.trim());

      // Carry the end of the previous chunk forward.
      const overlap = current.slice(-CHUNK_OVERLAP);
      const overlapStart = overlap.search(/\s/);
      const tail =
        overlapStart >= 0
          ? overlap.slice(overlapStart).trim()
          : overlap;

      current =
        tail && tail.length + piece.length + 2 <= CHUNK_SIZE
          ? `${tail}\n\n${piece}`
          : piece;
    } else {
      current = piece;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

// ============================================================
// AUTH + DOCUMENT LOOKUP
// ============================================================

async function getUserId(request: Request): Promise<string> {
  const header = request.headers.get("authorization");

  if (!header?.startsWith("Bearer ")) {
    throw new ProcessingError(
      "You must be signed in to process documents.",
      401
    );
  }

  const accessToken = header.substring("Bearer ".length);

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    throw new ProcessingError(
      "Your session is invalid or has expired. Please sign in again.",
      401
    );
  }

  return user.id;
}

async function loadOwnedDocument(
  documentId: string,
  userId: string
): Promise<DocumentRow> {
  const { data: document, error } = await supabaseAdmin
    .from("documents")
    .select("id, subject_id, file_name, file_path, file_type")
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    console.error("DOC PROCESS: document lookup failed:", error);
    throw new ProcessingError(
      `Unable to read the document record: ${error.message}`,
      500
    );
  }

  if (!document) {
    throw new ProcessingError("Document not found.", 404);
  }

  const { data: subject, error: subjectError } =
    await supabaseAdmin
      .from("subjects")
      .select("id")
      .eq("id", document.subject_id)
      .eq("user_id", userId)
      .maybeSingle();

  if (subjectError) {
    console.error(
      "DOC PROCESS: subject lookup failed:",
      subjectError
    );
    throw new ProcessingError(
      "Unable to verify access to this subject.",
      500
    );
  }

  if (!subject) {
    throw new ProcessingError(
      "Document not found or you do not have access to it.",
      404
    );
  }

  return document as DocumentRow;
}

// ============================================================
// SAVE CHUNKS
// ============================================================

async function replaceChunks(
  document: DocumentRow,
  chunks: string[]
) {
  // 1. Remember which chunks exist now.
  const { data: oldChunks, error: oldError } =
    await supabaseAdmin
      .from("document_chunks")
      .select("id")
      .eq("document_id", document.id);

  if (oldError) {
    throw new ProcessingError(
      `Unable to read existing chunks: ${oldError.message}`,
      500
    );
  }

  const oldIds = (oldChunks ?? []).map(
    (chunk: { id: string }) => chunk.id
  );

  // 2. Insert the new chunks.
  const rows = chunks.map((content, index) => ({
    document_id: document.id,
    subject_id: document.subject_id,
    content,
    chunk_index: index,
  }));

  const insertedIds: string[] = [];

  for (
    let start = 0;
    start < rows.length;
    start += INSERT_BATCH_SIZE
  ) {
    const { data, error } = await supabaseAdmin
      .from("document_chunks")
      .insert(rows.slice(start, start + INSERT_BATCH_SIZE))
      .select("id");

    if (error) {
      console.error("DOC PROCESS: chunk insert failed:", error);

      // Undo the partial insert so we never leave duplicates.
      for (
        let undo = 0;
        undo < insertedIds.length;
        undo += INSERT_BATCH_SIZE
      ) {
        await supabaseAdmin
          .from("document_chunks")
          .delete()
          .in(
            "id",
            insertedIds.slice(undo, undo + INSERT_BATCH_SIZE)
          );
      }

      throw new ProcessingError(
        `Saving chunks failed: ${error.message}`,
        500
      );
    }

    insertedIds.push(
      ...(data ?? []).map((row: { id: string }) => row.id)
    );
  }

  // 3. Only now remove the old chunks.
  for (
    let start = 0;
    start < oldIds.length;
    start += INSERT_BATCH_SIZE
  ) {
    const { error } = await supabaseAdmin
      .from("document_chunks")
      .delete()
      .in("id", oldIds.slice(start, start + INSERT_BATCH_SIZE));

    if (error) {
      console.error(
        "DOC PROCESS: old chunk cleanup failed:",
        error
      );
    }
  }

  return { inserted: insertedIds.length, removed: oldIds.length };
}

// ============================================================
// ROUTE
// ============================================================

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = await request.json().catch(() => null);

    const documentId =
      typeof body?.documentId === "string"
        ? body.documentId.trim()
        : "";

    if (!documentId) {
      return NextResponse.json(
        { error: "Document ID is required." },
        { status: 400 }
      );
    }

    const userId = await getUserId(request);
    const document = await loadOwnedDocument(documentId, userId);

    const fileName = document.file_name || "document";

    console.log(
      "DOC PROCESS: start",
      fileName,
      `(${document.id})`
    );

    if (!document.file_path) {
      throw new ProcessingError(
        `"${fileName}" has no stored file path.`,
        422
      );
    }

    const { data: file, error: downloadError } =
      await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(document.file_path);

    if (downloadError || !file) {
      console.error(
        "DOC PROCESS: download failed:",
        downloadError
      );
      throw new ProcessingError(
        `Could not download "${fileName}" from storage.`,
        500
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let rawText: string;

    try {
      rawText = await extractText(
        buffer,
        fileName,
        document.file_type || ""
      );
    } catch (extractError) {
      if (extractError instanceof ProcessingError) {
        throw extractError;
      }

      console.error(
        "DOC PROCESS: extraction failed:",
        extractError
      );
      throw new ProcessingError(
        `Could not read text from "${fileName}". The file may be damaged or password-protected.`,
        422
      );
    }

    const text = cleanText(rawText);

    if (text.replace(/\[(Page|Slide) \d+\]/g, "").trim().length < 20) {
      throw new ProcessingError(
        `No readable text found in "${fileName}". If it is a scanned PDF or image-only slides, it needs a text version.`,
        422
      );
    }

    const chunks = chunkText(text);
    const result = await replaceChunks(document, chunks);

    console.log(
      "DOC PROCESS: done",
      fileName,
      `— ${result.inserted} chunks from ${text.length} characters`,
      `(replaced ${result.removed}) in ${Date.now() - startedAt}ms`
    );

    return NextResponse.json({
      success: true,
      documentId: document.id,
      fileName,
      characters: text.length,
      chunksCreated: result.inserted,
      chunksReplaced: result.removed,
    });
  } catch (error: unknown) {
    if (error instanceof ProcessingError) {
      console.error("DOC PROCESS:", error.message);

      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("DOC PROCESS: unexpected error:", error);

    return NextResponse.json(
      {
        error:
          "Something went wrong while processing the document.",
      },
      { status: 500 }
    );
  }
}