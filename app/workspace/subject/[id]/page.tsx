"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import AskQuestionBot from "./AskQuestionBot";

type DocumentItem = {
  id: string;
  name: string;
  storagePath: string;
  fileType?: string;
  fileSize?: number;
  createdAt?: string;
};

type Subject = {
  id: string;
  name: string;
  description: string;
  documents: DocumentItem[];
  createdAt: string;
};

type StudyTool = "quiz" | "topics" | "flowchart";

export default function SubjectPage() {
  const router = useRouter();
  const params = useParams();

  const subjectId = params.id as string;

  const [subject, setSubject] = useState<Subject | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);

  // =========================================================
  // UPLOAD STATE
  // =========================================================

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareMessage, setPrepareMessage] = useState("");

  // =========================================================
  // DOCUMENT MENU STATE
  // =========================================================

  const [showDocumentMenu, setShowDocumentMenu] = useState<number | null>(
    null
  );

  // =========================================================
  // RENAME STATE
  // =========================================================

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [activeDocumentIndex, setActiveDocumentIndex] = useState<number | null>(
    null
  );
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // =========================================================
  // DELETE STATE
  // =========================================================

  const [showDeleteDocumentModal, setShowDeleteDocumentModal] =
    useState(false);

  const [documentToDelete, setDocumentToDelete] = useState<number | null>(
    null
  );

  const [deleting, setDeleting] = useState(false);

  // =========================================================
  // STUDY TOOL STATE
  // =========================================================

  const [activeStudyTool, setActiveStudyTool] =
    useState<StudyTool>("quiz");

  const [quizQuestionCount, setQuizQuestionCount] = useState(10);
  const [quizStarted, setQuizStarted] = useState(false);

  // =========================================================
  // DOCUMENT HELPERS
  // =========================================================

  function createDocumentId(
    document: string | Partial<DocumentItem>,
    index: number
  ): string {
    if (typeof document === "object" && document.id) {
      return document.id;
    }

    if (typeof document === "object" && document.storagePath) {
      return `document-${document.storagePath}`;
    }

    if (typeof document === "string") {
      return `legacy-document-${document}-${index}`;
    }

    return `document-${document.name ?? "unknown"}-${index}`;
  }

  function normalizeDocuments(
    documents: (string | Partial<DocumentItem>)[] | undefined
  ): DocumentItem[] {
    if (!Array.isArray(documents)) {
      return [];
    }

    return documents.map((document, index) => {
      if (typeof document === "string") {
        return {
          id: createDocumentId(document, index),
          name: document,
          storagePath: "",
        };
      }

      return {
        id: createDocumentId(document, index),
        name: document.name ?? "Untitled document",
        storagePath: document.storagePath ?? "",
        fileType: document.fileType,
        fileSize: document.fileSize,
        createdAt: document.createdAt,
      };
    });
  }

  function mapDatabaseDocuments(rows: any[]): DocumentItem[] {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.file_name ?? "Untitled document",
      storagePath: row.file_path ?? "",
      fileType: row.file_type,
      fileSize: row.file_size,
      createdAt: row.created_at,
    }));
  }

  // =========================================================
  // LOAD SUBJECT
  // =========================================================

  useEffect(() => {
    async function loadSubject() {
      try {
        setLoading(true);

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          console.error("Auth error:", authError);
        }

        if (!user) {
          router.replace("/sign-in");
          return;
        }

        setUserEmail(user.email ?? "");

        const storageKey = `academic-ai-subjects-${user.id}`;
        const savedSubjects = localStorage.getItem(storageKey);

        if (!savedSubjects) {
          router.replace("/workspace");
          return;
        }

        const parsedSubjects = JSON.parse(savedSubjects);

        if (!Array.isArray(parsedSubjects)) {
          router.replace("/workspace");
          return;
        }

        const foundSubject = parsedSubjects.find(
          (item: Subject) => item.id === subjectId
        );

        if (!foundSubject) {
          router.replace("/workspace");
          return;
        }

        const normalizedLocalDocuments = normalizeDocuments(
          foundSubject.documents
        );

        const {
          data: databaseDocuments,
          error: documentsError,
        } = await supabase
          .from("documents")
          .select(
            "id, subject_id, file_name, file_path, file_type, file_size, created_at"
          )
          .eq("subject_id", subjectId)
          .order("created_at", { ascending: false });

        if (documentsError) {
          console.error("Documents load error:", documentsError);

          const fallbackSubject: Subject = {
            ...foundSubject,
            documents: normalizedLocalDocuments,
          };

          setSubject(fallbackSubject);
          return;
        }

        const supabaseDocuments = mapDatabaseDocuments(
          databaseDocuments ?? []
        );

        const finalDocuments =
          supabaseDocuments.length > 0
            ? supabaseDocuments
            : normalizedLocalDocuments;

        const normalizedSubject: Subject = {
          ...foundSubject,
          documents: finalDocuments,
        };

        const normalizedSubjects = parsedSubjects.map(
          (item: Subject) => {
            if (item.id !== subjectId) {
              return item;
            }

            return normalizedSubject;
          }
        );

        localStorage.setItem(
          storageKey,
          JSON.stringify(normalizedSubjects)
        );

        setSubject(normalizedSubject);
      } catch (error) {
        console.error("Load subject error:", error);

        window.alert(
          "Unable to load your subject. Please check your saved workspace data."
        );

        router.replace("/workspace");
      } finally {
        setLoading(false);
      }
    }

    loadSubject();
  }, [router, subjectId]);

  // =========================================================
  // AUTH / NAVIGATION
  // =========================================================

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  function handleBackToWorkspace() {
    router.push("/workspace");
  }

  // =========================================================
  // FILE SELECTION
  // =========================================================

  function handleFileSelection(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    setSelectedFiles(files);
    setUploadMessage("");
  }

  // =========================================================
  // SAFE FILE NAME
  // =========================================================

  function createSafeFileName(fileName: string) {
    const extension = fileName.includes(".")
      ? "." + fileName.split(".").pop()
      : "";

    const nameWithoutExtension = fileName.replace(
      /\.[^/.]+$/,
      ""
    );

    const safeName = nameWithoutExtension
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    return `${safeName || "document"}${extension}`;
  }

  // =========================================================
  // PREPARE EXISTING DOCUMENTS FOR AI
  // Re-runs text extraction + chunking for every document in
  // this subject. Safe to repeat: old chunks are replaced.
  // =========================================================

  async function handlePrepareDocuments() {
    if (!subject || preparing) {
      return;
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const documentsToPrepare = subject.documents.filter(
      (document) => uuidPattern.test(document.id)
    );

    if (documentsToPrepare.length === 0) {
      setPrepareMessage("There are no uploaded documents to prepare.");
      return;
    }

    setPreparing(true);
    setPrepareMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace("/sign-in");
        return;
      }

      let preparedCount = 0;
      let totalChunks = 0;
      const failures: string[] = [];

      for (const [index, document] of documentsToPrepare.entries()) {
        setPrepareMessage(
          `Preparing ${index + 1} of ${documentsToPrepare.length}: ${document.name}…`
        );

        try {
          const response = await fetch("/api/document/process", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ documentId: document.id }),
          });

          const result = await response.json().catch(() => null);

          if (response.ok) {
            preparedCount += 1;
            totalChunks += result?.chunksCreated ?? 0;
          } else {
            failures.push(
              result?.error ??
                `${document.name}: failed (${response.status})`
            );
          }
        } catch {
          failures.push(`${document.name}: network error`);
        }
      }

      console.log("Prepare documents result:", {
        preparedCount,
        totalChunks,
        failures,
      });

      setPrepareMessage(
        `${preparedCount} of ${documentsToPrepare.length} documents ready for AI (${totalChunks} chunks).` +
          (failures.length > 0
            ? ` Problems: ${failures.join(" | ")}`
            : "")
      );
    } finally {
      setPreparing(false);
    }
  }

  // =========================================================
  // UPLOAD DOCUMENTS
  // =========================================================

  async function handleAddDocuments() {
    if (!subject || selectedFiles.length === 0) {
      setUploadMessage("Please select at least one document.");
      return;
    }

    setUploading(true);
    setUploadMessage("");

    const successfullyCreatedDocuments: DocumentItem[] = [];

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/sign-in");
        return;
      }

      for (const file of selectedFiles) {
        const safeFileName = createSafeFileName(file.name);

        const uniqueFileName = `${crypto.randomUUID()}-${safeFileName}`;

        const storagePath =
          `${user.id}/${subject.id}/${uniqueFileName}`;

        const {
          error: uploadError,
        } = await supabase.storage
          .from("study-materials")
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType:
              file.type || "application/octet-stream",
          });

        if (uploadError) {
          throw uploadError;
        }

        const {
          data: documentRow,
          error: documentInsertError,
        } = await supabase
          .from("documents")
          .insert({
            subject_id: subject.id,
            file_name: file.name,
            file_path: storagePath,
            file_type:
              file.type || "application/octet-stream",
            file_size: file.size,
          })
          .select(
            "id, subject_id, file_name, file_path, file_type, file_size, created_at"
          )
          .single();

        if (documentInsertError || !documentRow) {
          await supabase.storage
            .from("study-materials")
            .remove([storagePath]);

          throw (
            documentInsertError ??
            new Error("Document record was not created.")
          );
        }

        const createdDocument: DocumentItem = {
          id: documentRow.id,
          name: documentRow.file_name,
          storagePath: documentRow.file_path,
          fileType: documentRow.file_type,
          fileSize: documentRow.file_size,
          createdAt: documentRow.created_at,
        };

        successfullyCreatedDocuments.push(createdDocument);

        const {
          data: { session: processingSession },
        } = await supabase.auth.getSession();

        // Start processing in the background.
        void fetch("/api/document/process", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${
              processingSession?.access_token ?? ""
            }`,
          },
          body: JSON.stringify({
            documentId: documentRow.id,
          }),
        })
          .then(async (response) => {
            if (!response.ok) {
              let errorMessage =
                `Document processing failed (${response.status}).`;

              try {
                const result = await response.json();

                if (result?.error) {
                  errorMessage = result.error;
                }
              } catch {
                // Ignore non-JSON response.
              }

              console.error(
                "Document processing error:",
                errorMessage
              );

              return;
            }

            try {
              const result = await response.json();

              console.log(
                "Document processing started/completed:",
                result
              );
            } catch {
              console.log(
                "Document processing request completed."
              );
            }
          })
          .catch((processingError) => {
            console.error(
              "Unable to start document processing:",
              processingError
            );
          });
      }

      setSubject((currentSubject) => {
        if (!currentSubject) {
          return currentSubject;
        }

        return {
          ...currentSubject,
          documents: [
            ...successfullyCreatedDocuments,
            ...currentSubject.documents.filter(
              (document) =>
                !successfullyCreatedDocuments.some(
                  (newDocument) =>
                    newDocument.id === document.id
                )
            ),
          ],
        };
      });

      const storageKey = `academic-ai-subjects-${user.id}`;
      const savedSubjects = localStorage.getItem(storageKey);

      if (savedSubjects) {
        try {
          const parsedSubjects = JSON.parse(savedSubjects);

          if (Array.isArray(parsedSubjects)) {
            const updatedSubjects = parsedSubjects.map(
              (item: Subject) => {
                if (item.id !== subject.id) {
                  return item;
                }

                const existingDocuments =
                  normalizeDocuments(item.documents);

                const existingById = new Map(
                  existingDocuments.map((document) => [
                    document.id,
                    document,
                  ])
                );

                successfullyCreatedDocuments.forEach(
                  (document) => {
                    existingById.set(
                      document.id,
                      document
                    );
                  }
                );

                return {
                  ...item,
                  documents: Array.from(
                    existingById.values()
                  ),
                };
              }
            );

            localStorage.setItem(
              storageKey,
              JSON.stringify(updatedSubjects)
            );
          }
        } catch (localStorageError) {
          console.error(
            "LocalStorage synchronization error:",
            localStorageError
          );
        }
      }

      const numberAdded =
        successfullyCreatedDocuments.length;

      setSelectedFiles([]);

      setUploadMessage(
        `${numberAdded} document${
          numberAdded === 1 ? "" : "s"
        } uploaded successfully. Document processing has started.`
      );
    } catch (error) {
      console.error("========== UPLOAD ERROR ==========");
      console.error(error);
      console.error("=================================");

      if (successfullyCreatedDocuments.length > 0) {
        setSubject((currentSubject) => {
          if (!currentSubject) {
            return currentSubject;
          }

          return {
            ...currentSubject,
            documents: [
              ...successfullyCreatedDocuments,
              ...currentSubject.documents,
            ],
          };
        });

        setSelectedFiles([]);

        setUploadMessage(
          `${successfullyCreatedDocuments.length} document${
            successfullyCreatedDocuments.length === 1
              ? ""
              : "s"
          } uploaded successfully. Some files could not be uploaded.`
        );
      } else {
        setUploadMessage(
          "Something went wrong while uploading the documents. Check the browser console for the exact error."
        );
      }
    } finally {
      setUploading(false);
    }
  }

  // =========================================================
  // OPEN DOCUMENT
  // =========================================================

  async function handleOpenDocument(
    document: DocumentItem
  ) {
    if (!document.storagePath) {
      window.alert(
        "This is an older document entry. The actual file was not previously uploaded to Storage. Please upload the file again."
      );
      return;
    }

    const newWindow = window.open("", "_blank");

    if (!newWindow) {
      window.alert(
        "Your browser blocked the new tab. Please allow pop-ups for this site."
      );
      return;
    }

    newWindow.document.write(`
      <html>
        <head>
          <title>Opening document...</title>
        </head>
        <body style="font-family: sans-serif; padding: 40px;">
          Opening document...
        </body>
      </html>
    `);

    const {
      data,
      error,
    } = await supabase.storage
      .from("study-materials")
      .createSignedUrl(
        document.storagePath,
        60 * 60
      );

    if (error || !data?.signedUrl) {
      newWindow.close();

      console.error(
        "Open document error:",
        error
      );

      window.alert(
        "Unable to open this document. Please check the Storage configuration."
      );

      return;
    }

    newWindow.location.href = data.signedUrl;
  }

  // =========================================================
  // DOWNLOAD DOCUMENT
  // =========================================================

  async function handleDownloadDocument(
    document: DocumentItem
  ) {
    if (!document.storagePath) {
      window.alert(
        "This is an older document entry. The actual file was not previously uploaded to Storage. Please upload the file again."
      );
      return;
    }

    const {
      data,
      error,
    } = await supabase.storage
      .from("study-materials")
      .createSignedUrl(
        document.storagePath,
        60 * 60,
        {
          download: document.name,
        }
      );

    if (error || !data?.signedUrl) {
      console.error(
        "Download error:",
        error
      );

      window.alert(
        "Unable to download this document. Please check the Storage configuration."
      );

      return;
    }

    const downloadLink =
      window.document.createElement("a");

    downloadLink.href = data.signedUrl;
    downloadLink.download = document.name;

    window.document.body.appendChild(
      downloadLink
    );

    downloadLink.click();
    downloadLink.remove();
  }

  // =========================================================
  // DOCUMENT MENU
  // =========================================================

  function handleOpenDocumentMenu(index: number) {
    setShowDocumentMenu((currentIndex) =>
      currentIndex === index
        ? null
        : index
    );
  }

  // =========================================================
  // RENAME
  // =========================================================

  function handleStartRename(index: number) {
    if (!subject) {
      return;
    }

    const document =
      subject.documents[index];

    if (!document) {
      return;
    }

    setActiveDocumentIndex(index);
    setRenameValue(document.name);
    setShowDocumentMenu(null);
    setShowRenameModal(true);
  }

  async function handleRenameDocument() {
    if (
      !subject ||
      activeDocumentIndex === null
    ) {
      return;
    }

    const trimmedName =
      renameValue.trim();

    if (!trimmedName) {
      return;
    }

    const document =
      subject.documents[
        activeDocumentIndex
      ];

    if (!document) {
      return;
    }

    setRenaming(true);

    try {
      const looksLikeDatabaseId =
        document.id &&
        !document.id.startsWith("document-") &&
        !document.id.startsWith("legacy-document-");

      if (looksLikeDatabaseId) {
        const {
          error: updateError,
        } = await supabase
          .from("documents")
          .update({
            file_name: trimmedName,
          })
          .eq("id", document.id);

        if (updateError) {
          throw updateError;
        }
      }

      const updatedDocuments =
        subject.documents.map(
          (currentDocument, index) => {
            if (
              index !==
              activeDocumentIndex
            ) {
              return currentDocument;
            }

            return {
              ...currentDocument,
              name: trimmedName,
            };
          }
        );

      const updatedSubject: Subject = {
        ...subject,
        documents:
          updatedDocuments,
      };

      setSubject(updatedSubject);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const storageKey =
          `academic-ai-subjects-${user.id}`;

        const savedSubjects =
          localStorage.getItem(
            storageKey
          );

        if (savedSubjects) {
          const parsedSubjects =
            JSON.parse(
              savedSubjects
            );

          if (
            Array.isArray(
              parsedSubjects
            )
          ) {
            const updatedSubjects =
              parsedSubjects.map(
                (item: Subject) =>
                  item.id ===
                  subject.id
                    ? updatedSubject
                    : item
              );

            localStorage.setItem(
              storageKey,
              JSON.stringify(
                updatedSubjects
              )
            );
          }
        }
      }

      setShowRenameModal(false);
      setActiveDocumentIndex(null);
      setRenameValue("");
    } catch (error) {
      console.error(
        "Rename document error:",
        error
      );

      window.alert(
        "Something went wrong while renaming the document."
      );
    } finally {
      setRenaming(false);
    }
  }

  // =========================================================
  // DELETE
  // =========================================================

  function handleStartDeleteDocument(
    index: number
  ) {
    setDocumentToDelete(index);
    setShowDocumentMenu(null);
    setShowDeleteDocumentModal(true);
  }

  async function handleDeleteDocument() {
    if (
      !subject ||
      documentToDelete === null
    ) {
      return;
    }

    const document =
      subject.documents[
        documentToDelete
      ];

    if (!document) {
      return;
    }

    setDeleting(true);

    try {
      if (document.storagePath) {
        const {
          error: storageDeleteError,
        } = await supabase.storage
          .from("study-materials")
          .remove([
            document.storagePath,
          ]);

        if (storageDeleteError) {
          console.error(
            "Storage delete error:",
            storageDeleteError
          );

          window.alert(
            "The document could not be deleted from Storage."
          );

          return;
        }
      }

      const looksLikeDatabaseId =
        document.id &&
        !document.id.startsWith(
          "document-"
        ) &&
        !document.id.startsWith(
          "legacy-document-"
        );

      if (looksLikeDatabaseId) {
        const {
          error: databaseDeleteError,
        } = await supabase
          .from("documents")
          .delete()
          .eq("id", document.id);

        if (databaseDeleteError) {
          console.error(
            "Database delete error:",
            databaseDeleteError
          );

          window.alert(
            "The file was removed from Storage, but the document record could not be removed from the database. Please refresh and check the document list."
          );

          return;
        }
      }

      const updatedDocuments =
        subject.documents.filter(
          (_, index) =>
            index !==
            documentToDelete
        );

      const updatedSubject: Subject = {
        ...subject,
        documents:
          updatedDocuments,
      };

      setSubject(updatedSubject);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const storageKey =
          `academic-ai-subjects-${user.id}`;

        const savedSubjects =
          localStorage.getItem(
            storageKey
          );

        if (savedSubjects) {
          try {
            const parsedSubjects =
              JSON.parse(
                savedSubjects
              );

            if (
              Array.isArray(
                parsedSubjects
              )
            ) {
              const updatedSubjects =
                parsedSubjects.map(
                  (item: Subject) =>
                    item.id ===
                    subject.id
                      ? updatedSubject
                      : item
                );

              localStorage.setItem(
                storageKey,
                JSON.stringify(
                  updatedSubjects
                )
              );
            }
          } catch (
            localStorageError
          ) {
            console.error(
              "LocalStorage update error:",
              localStorageError
            );
          }
        }
      }

      setShowDeleteDocumentModal(
        false
      );

      setDocumentToDelete(null);
    } catch (error) {
      console.error(
        "Delete document error:",
        error
      );

      window.alert(
        "Something went wrong while deleting the document."
      );
    } finally {
      setDeleting(false);
    }
  }

  // =========================================================
  // CLOSE MODALS
  // =========================================================

  function closeUploadModal() {
    if (uploading) {
      return;
    }

    setShowUploadModal(false);
    setSelectedFiles([]);
    setUploadMessage("");
  }

  function closeRenameModal() {
    if (renaming) {
      return;
    }

    setShowRenameModal(false);
    setActiveDocumentIndex(null);
    setRenameValue("");
  }

  function closeDeleteDocumentModal() {
    if (deleting) {
      return;
    }

    setShowDeleteDocumentModal(false);
    setDocumentToDelete(null);
  }

  // =========================================================
  // STUDY TOOLS
  // =========================================================

  function handleStudyTool(
    tool: StudyTool
  ) {
    setActiveStudyTool(tool);

    if (tool !== "quiz") {
      setQuizStarted(false);
    }
  }

  function handleStartQuiz() {
    setQuizStarted(true);
  }

  // =========================================================
  // LOADING
  // =========================================================

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-xl text-white">
            ✦
          </div>

          <p className="font-serif text-xl">
            Loading your workspace
          </p>

          <p className="mt-2 text-sm text-muted">
            Preparing your study space...
          </p>
        </div>
      </main>
    );
  }

  if (!subject) {
    return null;
  }

  const selectedDeleteDocument =
    documentToDelete !== null
      ? subject.documents[
          documentToDelete
        ]
      : null;

  // =========================================================
  // PAGE
  // =========================================================

  return (
    <main className="min-h-screen bg-background text-foreground">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">

          <div className="flex items-center gap-3">

            <button
              onClick={
                handleBackToWorkspace
              }
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-lg transition hover:bg-card"
              aria-label="Back to workspace"
            >
              ←
            </button>

            <div>
              <p className="font-serif text-xl tracking-tight">
                Academic AI
              </p>

              <p className="text-xs text-muted">
                Subject workspace
              </p>
            </div>

          </div>

          <div className="flex items-center gap-5">

            <span className="hidden max-w-xs truncate text-sm text-muted md:block">
              {userEmail}
            </span>

            <button
              onClick={
                handleSignOut
              }
              className="rounded-full border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-card"
            >
              Sign out
            </button>

          </div>

        </div>
      </header>

      {/* =====================================================
          MAIN CONTENT
      ===================================================== */}

      <div className="mx-auto max-w-7xl px-6 py-12 md:py-14">

        {/* ===================================================
            SUBJECT HERO
        =================================================== */}

        <section className="relative mb-10 overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-sm md:p-10">

          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />

          <div className="relative">

            <button
              onClick={
                handleBackToWorkspace
              }
              className="mb-7 text-sm font-medium text-accent hover:underline"
            >
              ← Back to my subjects
            </button>

            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">

              <div className="max-w-3xl">

                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-xs font-medium tracking-wide text-accent">
                  <span>✦</span>
                  <span>
                    YOUR LEARNING SPACE
                  </span>
                </div>

                <h1 className="font-serif text-5xl tracking-tight md:text-6xl">
                  {subject.name}
                </h1>

                <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
                  {subject.description}
                </p>

              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">

                <div className="rounded-2xl border border-border bg-background px-5 py-4">
                  <p className="text-2xl font-semibold">
                    {subject.documents.length}
                  </p>

                  <p className="mt-1 text-xs text-muted">
                    Documents
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-background px-5 py-4">
                  <p className="text-2xl font-semibold">
                    AI
                  </p>

                  <p className="mt-1 text-xs text-muted">
                    Study assistant
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-background px-5 py-4">
                  <p className="text-2xl font-semibold">
                    ✦
                  </p>

                  <p className="mt-1 text-xs text-muted">
                    AI study tools
                  </p>
                </div>

              </div>

            </div>

          </div>
        </section>

        {/* ===================================================
            DOCUMENTS
        =================================================== */}

        <section className="rounded-3xl border border-border bg-card p-7 shadow-sm md:p-8">

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">

            <div>

              <p className="mb-2 text-sm font-medium tracking-wide text-accent">
                STUDY MATERIAL
              </p>

              <h2 className="font-serif text-4xl tracking-tight">
                Your documents
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Keep your course PDFs, lecture notes,
                presentations, case studies, and other
                study material together in one place.
              </p>

            </div>

            <div className="flex shrink-0 items-center gap-3 self-start">

              <span className="rounded-full bg-background px-4 py-2 text-sm text-muted">
                {subject.documents.length}{" "}
                {subject.documents.length === 1
                  ? "document"
                  : "documents"}
              </span>

              {subject.documents.length > 0 && (
                <button
                  type="button"
                  onClick={handlePrepareDocuments}
                  disabled={preparing}
                  className="rounded-full border border-border px-4 py-2 text-sm transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {preparing
                    ? "Preparing…"
                    : "Prepare for AI"}
                </button>
              )}

            </div>

          </div>

          {prepareMessage && (
            <p className="mt-4 rounded-2xl bg-background px-4 py-3 text-sm text-muted">
              {prepareMessage}
            </p>
          )}

          {/* Existing documents */}

          {subject.documents.length > 0 && (
            <div className="mt-8 space-y-3">

              {subject.documents.map(
                (document, index) => (
                  <div
                    key={
                      document.id ||
                      `${document.storagePath || document.name}-${index}`
                    }
                    onDoubleClick={() =>
                      handleOpenDocument(
                        document
                      )
                    }
                    className="relative flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-background px-5 py-4 transition hover:bg-card"
                    title={
                      document.storagePath
                        ? "Double-click to open"
                        : "File needs to be uploaded again"
                    }
                  >

                    <div
                      className="flex min-w-0 items-center gap-4"
                      onClick={() =>
                        document.storagePath &&
                        handleOpenDocument(
                          document
                        )
                      }
                    >

                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-xs font-semibold text-white">
                        DOC
                      </div>

                      <div className="min-w-0">

                        <p
                          className="truncate text-sm font-medium"
                          title={document.name}
                        >
                          {document.name}
                        </p>

                        <p className="mt-1 text-xs text-muted">
                          {document.storagePath
                            ? `Added to ${subject.name}`
                            : "Older document — upload again to open"}
                        </p>

                      </div>

                    </div>

                    <div className="ml-4 flex shrink-0 items-center gap-4">

                      <span className="hidden text-xs text-muted sm:block">
                        {document.storagePath
                          ? "Ready"
                          : "Unavailable"}
                      </span>

                      <div className="relative">

                        <button
                          onClick={(event) => {
                            event.stopPropagation();

                            handleOpenDocumentMenu(
                              index
                            );
                          }}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-lg leading-none transition hover:bg-card"
                          aria-label={`Actions for ${document.name}`}
                          aria-expanded={
                            showDocumentMenu ===
                            index
                          }
                        >
                          ⋮
                        </button>

                        {showDocumentMenu ===
                          index && (
                          <div className="absolute right-0 top-11 z-30 w-40 overflow-hidden rounded-xl border border-border bg-card shadow-lg">

                            <button
                              onClick={() => {
                                setShowDocumentMenu(null);

                                handleOpenDocument(
                                  document
                                );
                              }}
                              disabled={
                                !document.storagePath
                              }
                              className="w-full px-4 py-3 text-left text-sm transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Open
                            </button>

                            <button
                              onClick={() => {
                                setShowDocumentMenu(null);

                                handleDownloadDocument(
                                  document
                                );
                              }}
                              disabled={
                                !document.storagePath
                              }
                              className="w-full px-4 py-3 text-left text-sm transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Download
                            </button>

                            <button
                              onClick={() =>
                                handleStartRename(
                                  index
                                )
                              }
                              className="w-full px-4 py-3 text-left text-sm transition hover:bg-background"
                            >
                              Rename
                            </button>

                            <button
                              onClick={() =>
                                handleStartDeleteDocument(
                                  index
                                )
                              }
                              className="w-full px-4 py-3 text-left text-sm text-red-600 transition hover:bg-background"
                            >
                              Delete
                            </button>

                          </div>
                        )}

                      </div>

                    </div>

                  </div>
                )
              )}

            </div>
          )}

          {/* Empty state */}

          {subject.documents.length === 0 && (
            <div className="mt-8 rounded-2xl border border-dashed border-border bg-background p-10 text-center">

              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border text-xl">
                +
              </div>

              <h3 className="mt-5 font-serif text-2xl">
                Build your study library
              </h3>

              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
                Upload PDFs, notes, presentations,
                and other study material.
              </p>

              <button
                onClick={() =>
                  setShowUploadModal(true)
                }
                className="mt-6 rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                + Add documents
              </button>

            </div>
          )}

          {/* Add more documents */}

          {subject.documents.length > 0 && (
            <div className="mt-8 rounded-2xl border border-dashed border-border bg-background p-7 text-center">

              <h3 className="font-serif text-2xl">
                Add more study documents
              </h3>

              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
                Upload the material you actually
                want Academic AI to help you study
                from.
              </p>

              <button
                onClick={() =>
                  setShowUploadModal(true)
                }
                className="mt-6 rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                + Add documents
              </button>

            </div>
          )}

        </section>

        {/* ===================================================
            ASK AI
        =================================================== */}

        <section className="mt-10">
          <AskQuestionBot
            subjectName={subject.name}
          />
        </section>

        {/* ===================================================
            STUDY TOOLS — SECOND UI
        =================================================== */}

        <section className="mt-10">

          <div className="mb-6">

            <p className="mb-2 text-sm font-medium tracking-wide text-accent">
              STUDY TOOLS
            </p>

            <h2 className="font-serif text-4xl tracking-tight">
              Supercharge your learning
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Turn your study material into different
              ways of learning. Pick a mode and get
              started.
            </p>

          </div>

          {/* =================================================
              THREE STUDY TOOL CARDS
          ================================================= */}

          <div className="grid gap-5 md:grid-cols-3">

            {/* QUIZ CARD */}

            <button
              onClick={() =>
                handleStudyTool("quiz")
              }
              className={`group rounded-3xl border p-7 text-left transition-all ${
                activeStudyTool === "quiz"
                  ? "border-accent bg-card shadow-sm"
                  : "border-border bg-card hover:-translate-y-0.5 hover:shadow-sm"
              }`}
            >

              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-background text-2xl">
                🏆
              </div>

              <p className="font-serif text-2xl">
                Generate Quiz
              </p>

              <p className="mt-2 text-sm leading-6 text-muted">
                Create personalized quizzes from
                your documents.
              </p>

              <div className="mt-6 flex items-center text-sm font-medium text-accent">
                Start quiz
                <span className="ml-2 transition-transform group-hover:translate-x-1">
                  →
                </span>
              </div>

            </button>

            {/* KEY TOPICS CARD */}

            <button
              onClick={() =>
                handleStudyTool("topics")
              }
              className={`group rounded-3xl border p-7 text-left transition-all ${
                activeStudyTool === "topics"
                  ? "border-accent bg-card shadow-sm"
                  : "border-border bg-card hover:-translate-y-0.5 hover:shadow-sm"
              }`}
            >

              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-background text-2xl">
                ☷
              </div>

              <p className="font-serif text-2xl">
                Key Topics
              </p>

              <p className="mt-2 text-sm leading-6 text-muted">
                Extract and explore important topics
                from your material.
              </p>

              <div className="mt-6 flex items-center text-sm font-medium text-accent">
                Explore topics
                <span className="ml-2 transition-transform group-hover:translate-x-1">
                  →
                </span>
              </div>

            </button>

            {/* FLOWCHART CARD */}

            <button
              onClick={() =>
                handleStudyTool("flowchart")
              }
              className={`group rounded-3xl border p-7 text-left transition-all ${
                activeStudyTool === "flowchart"
                  ? "border-accent bg-card shadow-sm"
                  : "border-border bg-card hover:-translate-y-0.5 hover:shadow-sm"
              }`}
            >

              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-background text-2xl">
                ↗
              </div>

              <p className="font-serif text-2xl">
                Subject Flowchart
              </p>

              <p className="mt-2 text-sm leading-6 text-muted">
                Visual overview of how everything
                connects.
              </p>

              <div className="mt-6 flex items-center text-sm font-medium text-accent">
                Visualize
                <span className="ml-2 transition-transform group-hover:translate-x-1">
                  →
                </span>
              </div>

            </button>

          </div>

          {/* =================================================
              QUIZ PANEL
          ================================================= */}

          {activeStudyTool === "quiz" && (
            <div className="mt-6 rounded-3xl border border-border bg-card p-7 shadow-sm md:p-8">

              {!quizStarted ? (

                <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">

                  <div>

                    <div className="mb-5 inline-flex rounded-full bg-background px-4 py-2 text-xs font-medium text-accent">
                      QUICK CHALLENGE
                    </div>

                    <h3 className="font-serif text-3xl md:text-4xl">
                      Ready to test yourself?
                    </h3>

                    <p className="mt-3 max-w-xl text-sm leading-7 text-muted">
                      Choose how many questions you
                      want and turn your{" "}
                      {subject.name} material into a
                      focused practice session.
                    </p>

                    <div className="mt-7">

                      <p className="mb-3 text-sm font-medium">
                        Number of questions
                      </p>

                      <div className="grid grid-cols-4 gap-2">

                        {[10, 15, 20, 25].map(
                          (count) => (
                            <button
                              key={count}
                              onClick={() =>
                                setQuizQuestionCount(
                                  count
                                )
                              }
                              className={`rounded-xl border px-3 py-3 text-sm font-medium transition ${
                                quizQuestionCount ===
                                count
                                  ? "border-accent bg-accent text-white"
                                  : "border-border bg-background hover:bg-card"
                              }`}
                            >
                              {count}
                            </button>
                          )
                        )}

                      </div>

                    </div>

                    <button
                      onClick={
                        handleStartQuiz
                      }
                      disabled={
                        subject.documents.length ===
                        0
                      }
                      className="mt-7 rounded-full bg-accent px-7 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {subject.documents.length ===
                      0
                        ? "Add documents first"
                        : `Start ${quizQuestionCount}-question quiz →`}
                    </button>

                  </div>

                  <div className="rounded-3xl border border-border bg-background p-7">

                    <p className="text-sm font-medium text-accent">
                      YOUR QUIZ
                    </p>

                    <div className="mt-6 flex items-center justify-center">

                      <div className="flex h-36 w-36 flex-col items-center justify-center rounded-full border-8 border-border">

                        <span className="font-serif text-4xl">
                          {quizQuestionCount}
                        </span>

                        <span className="mt-1 text-xs text-muted">
                          questions
                        </span>

                      </div>

                    </div>

                    <div className="mt-7 space-y-3 text-sm">

                      <div className="flex justify-between rounded-xl bg-card px-4 py-3">

                        <span className="text-muted">
                          Subject
                        </span>

                        <span className="max-w-[55%] truncate font-medium">
                          {subject.name}
                        </span>

                      </div>

                      <div className="flex justify-between rounded-xl bg-card px-4 py-3">

                        <span className="text-muted">
                          Source
                        </span>

                        <span className="font-medium">
                          Your documents
                        </span>

                      </div>

                    </div>

                  </div>

                </div>

              ) : (

                <div className="rounded-2xl border border-border bg-background p-8 text-center">

                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-xl text-white">
                    ✓
                  </div>

                  <h3 className="mt-5 font-serif text-3xl">
                    Quiz setup complete
                  </h3>

                  <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-muted">
                    Your{" "}
                    {quizQuestionCount}
                    -question quiz for{" "}
                    {subject.name} is ready for
                    the AI question-generation
                    layer.
                  </p>

                  <p className="mt-4 text-xs text-muted">
                    AI question generation will
                    be connected in the next stage.
                  </p>

                  <button
                    onClick={() =>
                      setQuizStarted(false)
                    }
                    className="mt-6 rounded-full border border-border px-6 py-3 text-sm font-medium transition hover:bg-card"
                  >
                    Change quiz settings
                  </button>

                </div>

              )}

            </div>
          )}

          {/* =================================================
              KEY TOPICS PANEL
          ================================================= */}

          {activeStudyTool === "topics" && (
            <div className="mt-6 rounded-3xl border border-border bg-card p-7 shadow-sm md:p-8">

              <div className="mb-6">

                <div className="mb-3 inline-flex rounded-full bg-background px-4 py-2 text-xs font-medium text-accent">
                  KNOW WHAT MATTERS
                </div>

                <h3 className="font-serif text-3xl">
                  Key topics
                </h3>

                <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">
                  Your important concepts will be
                  generated from the actual contents
                  of your uploaded documents once the
                  AI analysis layer is connected.
                </p>

              </div>

              <div className="rounded-2xl border border-dashed border-border bg-background p-6 text-center">

                <p className="text-sm font-medium">
                  Personalized key topics will
                  appear here.
                </p>

                <p className="mt-2 text-xs text-muted">
                  The document processing pipeline
                  is being connected first.
                </p>

              </div>

            </div>
          )}

          {/* =================================================
              FLOWCHART PANEL
          ================================================= */}

          {activeStudyTool === "flowchart" && (
            <div className="mt-6 rounded-3xl border border-border bg-card p-7 shadow-sm md:p-8">

              <div className="mb-7">

                <div className="mb-3 inline-flex rounded-full bg-background px-4 py-2 text-xs font-medium text-accent">
                  VISUAL LEARNING
                </div>

                <h3 className="font-serif text-3xl">
                  Learning flow
                </h3>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                  A simple visual structure for
                  understanding how your{" "}
                  {subject.name} material can be
                  connected.
                </p>

              </div>

              <div className="overflow-x-auto pb-3">

                <div className="mx-auto flex min-w-[760px] items-center justify-center gap-3">

                  <div className="w-40 rounded-2xl border border-border bg-background p-5 text-center">

                    <div className="text-xl">
                      📚
                    </div>

                    <p className="mt-3 text-sm font-semibold">
                      Study material
                    </p>

                    <p className="mt-1 text-xs text-muted">
                      Your documents
                    </p>

                  </div>

                  <div className="text-xl text-muted">
                    →
                  </div>

                  <div className="w-40 rounded-2xl border border-border bg-background p-5 text-center">

                    <div className="text-xl">
                      ✦
                    </div>

                    <p className="mt-3 text-sm font-semibold">
                      Key concepts
                    </p>

                    <p className="mt-1 text-xs text-muted">
                      Important ideas
                    </p>

                  </div>

                  <div className="text-xl text-muted">
                    →
                  </div>

                  <div className="w-40 rounded-2xl border border-border bg-background p-5 text-center">

                    <div className="text-xl">
                      ◎
                    </div>

                    <p className="mt-3 text-sm font-semibold">
                      Connections
                    </p>

                    <p className="mt-1 text-xs text-muted">
                      How ideas relate
                    </p>

                  </div>

                  <div className="text-xl text-muted">
                    →
                  </div>

                  <div className="w-40 rounded-2xl border border-border bg-background p-5 text-center">

                    <div className="text-xl">
                      ✓
                    </div>

                    <p className="mt-3 text-sm font-semibold">
                      Mastery
                    </p>

                    <p className="mt-1 text-xs text-muted">
                      Test yourself
                    </p>

                  </div>

                </div>

              </div>

              <div className="mt-8 rounded-2xl border border-dashed border-border bg-background p-5 text-center">

                <p className="text-sm font-medium">
                  Your personalized flowchart will
                  appear here.
                </p>

                <p className="mt-1 text-xs text-muted">
                  It will be generated from the actual
                  contents of your uploaded documents
                  once the AI document-analysis layer
                  is connected.
                </p>

              </div>

            </div>
          )}

        </section>

      </div>

      {/* =====================================================
          UPLOAD MODAL
      ===================================================== */}

      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">

          <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-7 shadow-xl">

            <div className="mb-7">

              <p className="mb-2 text-sm font-medium tracking-wide text-accent">
                STUDY MATERIAL
              </p>

              <h2 className="font-serif text-3xl">
                Add documents
              </h2>

              <p className="mt-2 text-sm leading-6 text-muted">
                Select the documents you want to
                add to your{" "}
                <span className="font-medium text-foreground">
                  {subject.name}
                </span>{" "}
                subject workspace.
              </p>

            </div>

            <div className="space-y-5">

              <label
                htmlFor="documents"
                className="block cursor-pointer rounded-2xl border border-dashed border-border bg-background px-6 py-10 text-center transition hover:bg-card"
              >

                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border text-xl">
                  +
                </div>

                <p className="text-sm font-medium">
                  Choose documents
                </p>

                <p className="mt-1 text-xs text-muted">
                  PDFs, notes, presentations, and
                  other study material
                </p>

                <input
                  id="documents"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={
                    handleFileSelection
                  }
                />

              </label>

              {selectedFiles.length > 0 && (
                <div className="space-y-2">

                  <p className="text-sm font-medium">
                    Selected documents
                  </p>

                  {selectedFiles.map(
                    (file, index) => (
                      <div
                        key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                        className="rounded-xl border border-border bg-background px-4 py-3 text-sm"
                      >
                        {file.name}
                      </div>
                    )
                  )}

                </div>
              )}

              {uploadMessage && (
                <p className="rounded-xl bg-background px-4 py-3 text-center text-sm text-muted">
                  {uploadMessage}
                </p>
              )}

              <div className="flex gap-3 pt-2">

                <button
                  onClick={
                    closeUploadModal
                  }
                  disabled={uploading}
                  className="flex-1 rounded-full border border-border px-5 py-3 text-sm font-medium transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  onClick={
                    handleAddDocuments
                  }
                  disabled={
                    selectedFiles.length ===
                      0 ||
                    uploading
                  }
                  className="flex-1 rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading
                    ? "Uploading..."
                    : "Add documents"}
                </button>

              </div>

            </div>

          </div>

        </div>
      )}

      {/* =====================================================
          RENAME MODAL
      ===================================================== */}

      {showRenameModal &&
        activeDocumentIndex !== null && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-6">

            <div className="w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-xl">

              <div className="mb-7">

                <p className="mb-2 text-sm font-medium tracking-wide text-accent">
                  RENAME DOCUMENT
                </p>

                <h2 className="font-serif text-3xl">
                  Rename document
                </h2>

                <p className="mt-2 text-sm leading-6 text-muted">
                  Change the name of this document
                  in your subject workspace.
                </p>

              </div>

              <div className="space-y-5">

                <div>

                  <label
                    htmlFor="renameDocument"
                    className="mb-2 block text-sm font-medium"
                  >
                    Document name
                  </label>

                  <input
                    id="renameDocument"
                    type="text"
                    value={renameValue}
                    onChange={(event) =>
                      setRenameValue(
                        event.target.value
                      )
                    }
                    onKeyDown={(event) => {

                      if (
                        event.key ===
                        "Enter"
                      ) {
                        event.preventDefault();

                        if (!renaming) {
                          handleRenameDocument();
                        }
                      }

                      if (
                        event.key ===
                        "Escape"
                      ) {
                        closeRenameModal();
                      }

                    }}
                    autoFocus
                    disabled={renaming}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                  />

                </div>

                <div className="flex gap-3 pt-2">

                  <button
                    onClick={
                      closeRenameModal
                    }
                    disabled={renaming}
                    className="flex-1 rounded-full border border-border px-5 py-3 text-sm font-medium transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    onClick={
                      handleRenameDocument
                    }
                    disabled={
                      !renameValue.trim() ||
                      renaming
                    }
                    className="flex-1 rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {renaming
                      ? "Saving..."
                      : "Save changes"}
                  </button>

                </div>

              </div>

            </div>

          </div>
        )}

      {/* =====================================================
          DELETE MODAL
      ===================================================== */}

      {showDeleteDocumentModal &&
        selectedDeleteDocument && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-6">

            <div className="w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-2xl">

              <p className="mb-2 text-sm font-medium tracking-wide text-red-600">
                DELETE DOCUMENT
              </p>

              <h2 className="font-serif text-3xl">
                Are you sure?
              </h2>

              <p className="mt-4 text-sm leading-6 text-muted">
                You are about to remove this document
                from your subject:
              </p>

              <div className="mt-4 rounded-xl border border-border bg-background px-4 py-4">

                <p className="break-words font-medium">
                  {selectedDeleteDocument.name}
                </p>

              </div>

              <p className="mt-4 text-sm leading-6 text-muted">
                This will remove the document from
                this subject workspace and delete the
                actual uploaded file. This action cannot
                be undone.
              </p>

              <div className="mt-7 flex gap-3">

                <button
                  onClick={
                    closeDeleteDocumentModal
                  }
                  disabled={deleting}
                  className="flex-1 rounded-full border border-border px-5 py-3 text-sm font-medium transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  onClick={
                    handleDeleteDocument
                  }
                  disabled={deleting}
                  className="flex-1 rounded-full bg-red-600 px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleting
                    ? "Deleting..."
                    : "Yes, Delete"}
                </button>

              </div>

            </div>

          </div>
        )}

    </main>
  );
}