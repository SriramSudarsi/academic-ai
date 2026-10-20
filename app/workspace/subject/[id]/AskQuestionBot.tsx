"use client";

import {
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type AskQuestionBotProps = {
  subjectName: string;
  subjectId?: string;
};

type ApiResponse = {
  answer?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  grounded?: boolean;
  chunksUsed?: number;
  documentsUsed?: string[];
};

export default function AskQuestionBot({
  subjectName,
  subjectId,
}: AskQuestionBotProps) {
  const params = useParams<{ id: string }>();

  const routeSubjectId =
    typeof params?.id === "string"
      ? params.id
      : "";

  const resolvedSubjectId =
    subjectId || routeSubjectId;

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stopped, setStopped] = useState(false);

  const abortControllerRef =
    useRef<AbortController | null>(null);

  const requestIdRef = useRef(0);
  const lastQuestionRef = useRef("");
  const textareaRef =
    useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isThinking) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();

    const timer = window.setInterval(() => {
      setElapsedSeconds(
        Math.floor(
          (Date.now() - startedAt) / 1000
        )
      );
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isThinking]);

  const suggestedQuestions = [
    {
      label: "Explain this subject in simple terms",
      icon: "✦",
    },
    {
      label: "What are the most important concepts?",
      icon: "◈",
    },
    {
      label: "Help me prepare for my exam",
      icon: "✓",
    },
    {
      label: "Give me an example",
      icon: "◇",
    },
  ];

  function handleSuggestedQuestion(value: string) {
    if (isThinking) {
      return;
    }

    setQuestion(value);
    setAnswer("");
    setError("");
    setStopped(false);

    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }

  async function handleAskQuestion(
    questionOverride?: string
  ) {
    const trimmedQuestion = (
      questionOverride ?? question
    ).trim();

    if (!trimmedQuestion || isThinking) {
      return;
    }

    if (!resolvedSubjectId) {
      setError(
        "Subject ID is missing from this subject page."
      );
      return;
    }

    const requestId =
      ++requestIdRef.current;

    lastQuestionRef.current =
      trimmedQuestion;

    setQuestion(trimmedQuestion);
    setAnswer("");
    setError("");
    setStopped(false);
    setElapsedSeconds(0);
    setIsThinking(true);

    const controller =
      new AbortController();

    abortControllerRef.current =
      controller;

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(
          "Unable to verify your login session."
        );
      }

      if (!session?.access_token) {
        throw new Error(
          "You must be signed in to ask questions."
        );
      }

      console.log(
        "AI ASK CLIENT: subject ID =",
        resolvedSubjectId
      );

      console.log(
        "AI ASK CLIENT: question =",
        trimmedQuestion
      );

      const response = await fetch(
        "/api/ai/ask",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            question: trimmedQuestion,
            subjectId: resolvedSubjectId,
          }),
          signal: controller.signal,
        }
      );

      let data: ApiResponse | null =
        null;

      try {
        data =
          (await response.json()) as ApiResponse;
      } catch {
        data = null;
      }

      console.log(
        "AI ASK CLIENT: API response =",
        data
      );

      if (
        requestId !==
        requestIdRef.current
      ) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Something went wrong while answering the question."
        );
      }

      const returnedAnswer =
        typeof data?.answer === "string"
          ? data.answer.trim()
          : "";

      if (!returnedAnswer) {
        throw new Error(
          "The AI returned an empty answer."
        );
      }

      setAnswer(returnedAnswer);
      setError("");
      setStopped(false);
    } catch (requestError) {
      if (
        requestError instanceof DOMException &&
        requestError.name === "AbortError"
      ) {
        return;
      }

      if (
        requestId !==
        requestIdRef.current
      ) {
        return;
      }

      console.error(
        "AI ASK CLIENT ERROR:",
        requestError
      );

      const message =
        requestError instanceof Error
          ? requestError.message
          : "Something went wrong while answering the question.";

      const lower =
        message.toLowerCase();

      if (
        lower.includes("temporarily busy") ||
        lower.includes("high demand") ||
        lower.includes("gemini") &&
          lower.includes("unavailable")
      ) {
        setError(
          "The AI service is temporarily busy. Your question is saved — please try again."
        );
      } else if (
        lower.includes(
          "documents_not_ready"
        ) ||
        lower.includes(
          "documents have not finished"
        ) ||
        lower.includes(
          "not finished preparing"
        )
      ) {
        setError(
          "Your study material is still being prepared. Please wait for document processing to finish and try again."
        );
      } else {
        setError(message);
      }
    } finally {
      if (
        requestId ===
        requestIdRef.current
      ) {
        setIsThinking(false);
        abortControllerRef.current =
          null;
      }
    }
  }

  function handleStopAndEdit() {
    requestIdRef.current += 1;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    setIsThinking(false);
    setStopped(true);
    setError("");
    setAnswer("");

    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }

  function handleRetry() {
    const retryQuestion =
      lastQuestionRef.current ||
      question.trim();

    if (
      !retryQuestion ||
      isThinking
    ) {
      return;
    }

    void handleAskQuestion(
      retryQuestion
    );
  }

  function handleEditQuestion() {
    if (isThinking) {
      return;
    }

    setError("");
    setStopped(false);

    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }

  function handleAskAnotherQuestion() {
    if (isThinking) {
      return;
    }

    requestIdRef.current += 1;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    setQuestion("");
    setAnswer("");
    setError("");
    setStopped(false);
    lastQuestionRef.current = "";

    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      if (!isThinking) {
        void handleAskQuestion();
      }
    }
  }

  return (
    <section className="mt-8">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/5 blur-3xl" />

        <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-accent/5 blur-3xl" />

        <div className="relative p-7 md:p-9">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-lg text-white shadow-sm">
                  ✦
                </div>

                <div>
                  <p className="text-xs font-semibold tracking-[0.18em] text-accent">
                    ASK QUESTION
                  </p>

                  <p className="text-sm text-muted">
                    Your AI study companion
                  </p>
                </div>
              </div>

              <h2 className="font-serif text-4xl tracking-tight md:text-5xl">
                What do you want to understand?
              </h2>

              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted md:text-base">
                Ask questions about {subjectName},
                clarify difficult concepts, understand
                your study material, or get help preparing
                for your exams.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Study mode
            </div>
          </div>

          <div
            className={`mt-8 rounded-2xl border bg-background p-5 transition ${
              isThinking
                ? "border-accent/40 ring-2 ring-accent/10"
                : "border-border"
            }`}
          >
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(event) => {
                if (isThinking) {
                  return;
                }

                setQuestion(
                  event.target.value
                );

                setAnswer("");
                setError("");
                setStopped(false);
              }}
              onKeyDown={handleKeyDown}
              disabled={isThinking}
              placeholder={
                isThinking
                  ? "Your question is locked while the AI responds..."
                  : `Ask anything about your ${subjectName} study material...`
              }
              rows={6}
              className={`min-h-[170px] w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted/70 ${
                isThinking
                  ? "cursor-not-allowed opacity-70"
                  : ""
              }`}
            />

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="text-xs text-muted">
                {isThinking
                  ? `Finding your answer... ${elapsedSeconds}s`
                  : "Press Enter to ask · Shift + Enter for a new line"}
              </div>

              <div className="flex items-center gap-2 sm:ml-auto">
                {isThinking ? (
                  <button
                    type="button"
                    onClick={
                      handleStopAndEdit
                    }
                    className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-red-500/40 hover:bg-red-500/5"
                  >
                    <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                    Stop & edit
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      void handleAskQuestion()
                    }
                    disabled={
                      !question.trim()
                    }
                    className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-all hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Ask question
                    <span>→</span>
                  </button>
                )}
              </div>
            </div>

            {isThinking && (
              <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-accent/10 bg-accent/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />

                  <div>
                    <p className="text-sm font-medium">
                      Working on your answer
                    </p>

                    <p className="text-xs text-muted">
                      Searching your study material...
                    </p>
                  </div>
                </div>

                <span className="hidden text-xs text-muted sm:block">
                  {elapsedSeconds}s
                </span>
              </div>
            )}
          </div>

          <div className="mt-7">
            <div className="mb-3 flex items-center gap-3">
              <span className="text-xs font-semibold tracking-[0.18em] text-muted">
                TRY ASKING
              </span>

              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map(
                (item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() =>
                      handleSuggestedQuestion(
                        item.label
                      )
                    }
                    disabled={isThinking}
                    className="rounded-full border border-border bg-background px-4 py-2 text-xs text-muted transition hover:border-accent/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="mr-2 text-accent">
                      {item.icon}
                    </span>

                    {item.label}
                  </button>
                )
              )}
            </div>
          </div>

          {stopped && !answer && !error && (
            <div className="mt-6 rounded-2xl border border-border bg-background p-5">
              <p className="text-sm font-medium">
                Answer stopped
              </p>

              <p className="mt-1 text-sm leading-6 text-muted">
                Your question is still in the box. Edit it
                or press Ask question when ready.
              </p>
            </div>
          )}

          {answer && (
            <div className="mt-6 rounded-2xl border border-border bg-background p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
                  ✦
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">
                      AI Study Assistant
                    </p>

                    <span className="rounded-full bg-card px-2 py-0.5 text-[10px] text-muted">
                      Gemini
                    </span>
                  </div>

                  <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">
                    {answer}
                  </div>

                  <button
                    type="button"
                    onClick={
                      handleAskAnotherQuestion
                    }
                    className="mt-4 rounded-full border border-border bg-background px-4 py-2 text-xs font-medium text-muted transition hover:border-accent/40 hover:text-foreground"
                  >
                    Ask another question
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500 text-sm text-white">
                  !
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Something went wrong
                  </p>

                  <p className="mt-1 text-sm leading-6 text-muted">
                    {error}
                  </p>

                  {!isThinking && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={
                          handleEditQuestion
                        }
                        className="rounded-full border border-border bg-background px-4 py-2 text-xs font-medium text-foreground transition hover:border-accent/40"
                      >
                        Edit question
                      </button>

                      <button
                        type="button"
                        onClick={handleRetry}
                        className="rounded-full bg-accent px-4 py-2 text-xs font-medium text-white transition hover:opacity-90"
                      >
                        Try again
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}