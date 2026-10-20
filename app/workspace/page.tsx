"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Subject = {
  id: string;
  name: string;
  description: string;
  documents: string[];
  createdAt: string;
};

export default function WorkspacePage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateSubject, setShowCreateSubject] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [subjectDescription, setSubjectDescription] = useState("");

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "create" | "delete" | null
  >(null);
  const [subjectToDelete, setSubjectToDelete] =
    useState<Subject | null>(null);

  /*
   * Load the currently logged-in user
   * and their subjects from Supabase.
   */
  useEffect(() => {
    async function loadWorkspace() {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          console.error("Error getting user:", userError);
          router.replace("/sign-in");
          return;
        }

        if (!user) {
          router.replace("/sign-in");
          return;
        }

        setUserId(user.id);
        setUserEmail(user.email ?? "");

        /*
         * Supabase is the source of truth.
         */
        const { data, error } = await supabase
          .from("subjects")
          .select("id, name, description, documents, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error loading subjects:", error);
          setSubjects([]);
          return;
        }

        const formattedSubjects: Subject[] = (data ?? []).map(
          (subject) => ({
            id: subject.id,
            name: subject.name,
            description:
              subject.description ||
              "Your documents and study material for this subject.",
            documents: Array.isArray(subject.documents)
              ? subject.documents
              : [],
            createdAt: subject.created_at,
          })
        );

        setSubjects(formattedSubjects);

        /*
         * IMPORTANT:
         *
         * The subject workspace currently uses this localStorage
         * key when resolving the subject from the dynamic URL.
         *
         * Keep it synchronized with Supabase so that:
         *
         * /workspace
         *      ↓
         * /workspace/subject/[id]
         *
         * can resolve the selected subject correctly.
         *
         * Supabase remains the actual source of truth.
         */
        const storageKey = `academic-ai-subjects-${user.id}`;

        localStorage.setItem(
          storageKey,
          JSON.stringify(formattedSubjects)
        );
      } catch (error) {
        console.error("Unexpected workspace error:", error);
      } finally {
        setLoading(false);
      }
    }

    loadWorkspace();
  }, [router]);

  /*
   * Start creating a subject.
   */
  function handleCreateSubject() {
    const trimmedName = subjectName.trim();

    if (!trimmedName) {
      return;
    }

    const alreadyExists = subjects.some(
      (subject) =>
        subject.name.trim().toLowerCase() ===
        trimmedName.toLowerCase()
    );

    if (alreadyExists) {
      window.alert(
        "A subject with this name already exists. Please choose a different name."
      );
      return;
    }

    setConfirmAction("create");
    setShowConfirmModal(true);
  }

  /*
   * Actually create the subject in Supabase.
   */
  async function confirmCreateSubject() {
    const trimmedName = subjectName.trim();

    if (!trimmedName || !userId) {
      closeConfirmModal();
      return;
    }

    const description =
      subjectDescription.trim() ||
      "Your documents and study material for this subject.";

    try {
      const { data, error } = await supabase
        .from("subjects")
        .insert({
          user_id: userId,
          name: trimmedName,
          description,
          documents: [],
        })
        .select(
          "id, name, description, documents, created_at"
        )
        .single();

      if (error) {
        console.error("Error creating subject:", error);

        window.alert(
          `Unable to create the subject.\n\n${error.message}`
        );

        return;
      }

      if (!data) {
        window.alert("The subject could not be created.");
        return;
      }

      const newSubject: Subject = {
        id: data.id,
        name: data.name,
        description:
          data.description ||
          "Your documents and study material for this subject.",
        documents: Array.isArray(data.documents)
          ? data.documents
          : [],
        createdAt: data.created_at,
      };

      setSubjects((currentSubjects) => {
        const updatedSubjects = [
          newSubject,
          ...currentSubjects,
        ];

        /*
         * Keep localStorage synchronized with the
         * newly-created Supabase subject.
         */
        const storageKey =
          `academic-ai-subjects-${userId}`;

        localStorage.setItem(
          storageKey,
          JSON.stringify(updatedSubjects)
        );

        return updatedSubjects;
      });

      setSubjectName("");
      setSubjectDescription("");
      setShowCreateSubject(false);
      closeConfirmModal();
    } catch (error) {
      console.error(
        "Unexpected create subject error:",
        error
      );

      window.alert(
        "Something went wrong while creating the subject."
      );
    }
  }

  /*
   * Start deleting a subject.
   */
  function handleDeleteSubject(subject: Subject) {
    setSubjectToDelete(subject);
    setConfirmAction("delete");
    setShowConfirmModal(true);
  }

  /*
   * Actually delete the subject from Supabase.
   */
  async function confirmDeleteSubject() {
    if (!subjectToDelete || !userId) {
      closeConfirmModal();
      return;
    }

    try {
      const { error } = await supabase
        .from("subjects")
        .delete()
        .eq("id", subjectToDelete.id)
        .eq("user_id", userId);

      if (error) {
        console.error(
          "Error deleting subject:",
          error
        );

        window.alert(
          `Unable to delete the subject.\n\n${error.message}`
        );

        return;
      }

      setSubjects((currentSubjects) => {
        const updatedSubjects =
          currentSubjects.filter(
            (currentSubject) =>
              currentSubject.id !== subjectToDelete.id
          );

        /*
         * Keep localStorage synchronized after deletion.
         */
        const storageKey =
          `academic-ai-subjects-${userId}`;

        localStorage.setItem(
          storageKey,
          JSON.stringify(updatedSubjects)
        );

        return updatedSubjects;
      });

      setSubjectToDelete(null);
      closeConfirmModal();
    } catch (error) {
      console.error(
        "Unexpected delete subject error:",
        error
      );

      window.alert(
        "Something went wrong while deleting the subject."
      );
    }
  }

  /*
   * Handle the confirmation button.
   */
  function handleConfirmAction() {
    if (confirmAction === "create") {
      confirmCreateSubject();
      return;
    }

    if (confirmAction === "delete") {
      confirmDeleteSubject();
      return;
    }
  }

  /*
   * Close confirmation modal.
   */
  function closeConfirmModal() {
    setShowConfirmModal(false);
    setConfirmAction(null);
    setSubjectToDelete(null);
  }

  /*
   * Open a subject workspace.
   */
  function handleOpenSubject(subjectId: string) {
    /*
     * The route is correct:
     *
     * /workspace/subject/[id]
     */
    router.push(`/workspace/subject/${subjectId}`);
  }

  /*
   * Close the create subject modal.
   */
  function handleCloseCreateModal() {
    setShowCreateSubject(false);
    setSubjectName("");
    setSubjectDescription("");
  }

  /*
   * Sign out.
   */
  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted">
          Loading your workspace...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-white">
              A
            </div>

            <div>
              <p className="font-serif text-xl tracking-tight">
                Academic AI
              </p>

              <p className="text-xs text-muted">
                Your academic companion
              </p>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <span className="hidden text-sm text-muted md:block">
              {userEmail}
            </span>

            <button
              onClick={handleSignOut}
              className="rounded-full border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-card"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="mx-auto max-w-7xl px-6 py-14">
        {/* Hero */}
        <section className="mb-12">
          <p className="mb-3 text-sm font-medium tracking-wide text-accent">
            YOUR STUDY SPACE
          </p>

          <h1 className="max-w-3xl font-serif text-5xl tracking-tight md:text-6xl">
            Welcome back
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
            Organize your coursework into subject buckets and
            build focused study spaces for everything you are
            learning.
          </p>

          <p className="mt-3 text-sm text-muted">
            Signed in as{" "}
            <span className="font-medium text-foreground">
              {userEmail}
            </span>
          </p>
        </section>

        {/* Quick actions */}
        <section className="mb-14 grid gap-5 md:grid-cols-2">
          {/* Create Subject */}
          <button
            onClick={() => setShowCreateSubject(true)}
            className="group rounded-2xl border border-border bg-card p-7 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-2xl text-white">
              +
            </div>

            <h2 className="font-serif text-2xl">
              Create a Subject
            </h2>

            <p className="mt-2 max-w-md text-sm leading-6 text-muted">
              Create a dedicated bucket for a course or subject
              and keep all your study material together.
            </p>

            <p className="mt-5 text-sm font-medium text-accent">
              Create subject →
            </p>
          </button>

          {/* Explore Subjects */}
          <button
            onClick={() =>
              document
                .getElementById("my-subjects")
                ?.scrollIntoView({
                  behavior: "smooth",
                })
            }
            className="group rounded-2xl border border-border bg-card p-7 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-border text-xl">
              →
            </div>

            <h2 className="font-serif text-2xl">
              Explore My Subjects
            </h2>

            <p className="mt-2 max-w-md text-sm leading-6 text-muted">
              View the subject buckets you have already created
              and continue studying from where you left off.
            </p>

            <p className="mt-5 text-sm font-medium text-accent">
              Explore subjects →
            </p>
          </button>
        </section>

        {/* Subjects */}
        <section
          id="my-subjects"
          className="scroll-mt-8"
        >
          <div className="mb-7 flex items-end justify-between">
            <div>
              <p className="mb-2 text-sm font-medium tracking-wide text-accent">
                MY SUBJECTS
              </p>

              <h2 className="font-serif text-4xl tracking-tight">
                Your study buckets
              </h2>
            </div>

            <div className="hidden text-right sm:block">
              <p className="font-serif text-3xl">
                {subjects.length}
              </p>

              <p className="text-sm text-muted">
                {subjects.length === 1
                  ? "subject"
                  : "subjects"}
              </p>
            </div>
          </div>

          {subjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-border text-2xl">
                +
              </div>

              <h3 className="font-serif text-2xl">
                No subjects yet
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
                Create your first subject bucket. Later, you
                will be able to add your PDFs, notes,
                presentations, and other study material inside
                it.
              </p>

              <button
                onClick={() =>
                  setShowCreateSubject(true)
                }
                className="mt-6 rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Create your first subject
              </button>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((subject) => (
                <div
                  key={subject.id}
                  className="rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="mb-6 flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-white">
                      {subject.name
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">
                      {subject.documents.length}{" "}
                      {subject.documents.length === 1
                        ? "document"
                        : "documents"}
                    </span>
                  </div>

                  <h3 className="font-serif text-2xl">
                    {subject.name}
                  </h3>

                  <p className="mt-2 min-h-[48px] text-sm leading-6 text-muted">
                    {subject.description}
                  </p>

                  <div className="mt-6 border-t border-border pt-5">
                    <div className="flex items-center justify-between">
                      {/* Open subject */}
                      <button
                        onClick={() =>
                          handleOpenSubject(
                            subject.id
                          )
                        }
                        className="text-sm font-medium text-accent hover:underline"
                      >
                        Open subject →
                      </button>

                      {/* Delete subject */}
                      <button
                        onClick={() =>
                          handleDeleteSubject(
                            subject
                          )
                        }
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Next step */}
        <section className="mt-14 rounded-2xl border border-border bg-card p-7">
          <p className="mb-2 text-sm font-medium tracking-wide text-accent">
            NEXT STEP
          </p>

          <h2 className="font-serif text-2xl">
            Add your study documents
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Open a subject to enter its dedicated study
            workspace. From there, we will add PDF, notes,
            presentation, and other study-material uploads.
          </p>
        </section>
      </div>

      {/* Create Subject Modal */}
      {showCreateSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-xl">
            <div className="mb-7">
              <p className="mb-2 text-sm font-medium tracking-wide text-accent">
                NEW SUBJECT
              </p>

              <h2 className="font-serif text-3xl">
                Create a subject bucket
              </h2>

              <p className="mt-2 text-sm leading-6 text-muted">
                Give your study bucket a name. You can add
                documents to it after opening the subject.
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label
                  htmlFor="subjectName"
                  className="mb-2 block text-sm font-medium"
                >
                  Subject name
                </label>

                <input
                  id="subjectName"
                  type="text"
                  value={subjectName}
                  onChange={(event) =>
                    setSubjectName(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCreateSubject();
                    }
                  }}
                  placeholder="e.g. Financial Management"
                  autoFocus
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="subjectDescription"
                  className="mb-2 block text-sm font-medium"
                >
                  Description{" "}
                  <span className="font-normal text-muted">
                    (optional)
                  </span>
                </label>

                <textarea
                  id="subjectDescription"
                  value={subjectDescription}
                  onChange={(event) =>
                    setSubjectDescription(
                      event.target.value
                    )
                  }
                  placeholder="e.g. MBA Term 3 — Financial Management"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCloseCreateModal}
                  className="flex-1 rounded-full border border-border px-5 py-3 text-sm font-medium transition hover:bg-background"
                >
                  Cancel
                </button>

                <button
                  onClick={handleCreateSubject}
                  disabled={!subjectName.trim()}
                  className="flex-1 rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create Subject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-2xl">
            {confirmAction === "create" && (
              <>
                <p className="mb-2 text-sm font-medium tracking-wide text-accent">
                  CONFIRM SUBJECT
                </p>

                <h2 className="font-serif text-3xl">
                  Is this the correct name?
                </h2>

                <p className="mt-4 text-sm leading-6 text-muted">
                  You are about to create the following
                  subject:
                </p>

                <div className="mt-4 rounded-xl border border-border bg-background px-4 py-4">
                  <p className="font-serif text-xl">
                    {subjectName.trim()}
                  </p>

                  {subjectDescription.trim() && (
                    <p className="mt-1 text-sm text-muted">
                      {subjectDescription.trim()}
                    </p>
                  )}
                </div>

                <p className="mt-4 text-sm leading-6 text-muted">
                  Please make sure the subject name is
                  correct before continuing.
                </p>

                <div className="mt-7 flex gap-3">
                  <button
                    onClick={closeConfirmModal}
                    className="flex-1 rounded-full border border-border px-5 py-3 text-sm font-medium transition hover:bg-background"
                  >
                    Go Back
                  </button>

                  <button
                    onClick={handleConfirmAction}
                    className="flex-1 rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    Yes, Create
                  </button>
                </div>
              </>
            )}

            {confirmAction === "delete" &&
              subjectToDelete && (
                <>
                  <p className="mb-2 text-sm font-medium tracking-wide text-red-600">
                    DELETE SUBJECT
                  </p>

                  <h2 className="font-serif text-3xl">
                    Are you sure?
                  </h2>

                  <p className="mt-4 text-sm leading-6 text-muted">
                    You are about to delete:
                  </p>

                  <div className="mt-4 rounded-xl border border-border bg-background px-4 py-4">
                    <p className="font-serif text-xl">
                      {subjectToDelete.name}
                    </p>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-muted">
                    This will remove the subject bucket from
                    your workspace. This action cannot be
                    undone.
                  </p>

                  <div className="mt-7 flex gap-3">
                    <button
                      onClick={closeConfirmModal}
                      className="flex-1 rounded-full border border-border px-5 py-3 text-sm font-medium transition hover:bg-background"
                    >
                      Cancel
                    </button>

                    <button
                      onClick={handleConfirmAction}
                      className="flex-1 rounded-full bg-red-600 px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
                    >
                      Yes, Delete
                    </button>
                  </div>
                </>
              )}
          </div>
        </div>
      )}
    </main>
  );
}