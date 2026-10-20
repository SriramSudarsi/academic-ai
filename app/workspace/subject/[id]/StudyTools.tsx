"use client";

import { useState } from "react";

type StudyToolsProps = {
  subjectName: string;
};

export default function StudyTools({
  subjectName,
}: StudyToolsProps) {
  const [quizCount, setQuizCount] = useState(10);

  function handleGenerateQuiz() {
    alert(
      `Quiz generation for ${subjectName} with ${quizCount} questions will be connected to the AI next.`
    );
  }

  function handleViewTopics() {
    alert(
      `Key Topics for ${subjectName} will be generated from your study material next.`
    );
  }

  function handleViewFlowchart() {
    alert(
      `The ${subjectName} flowchart will be generated from your study material next.`
    );
  }

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-7 shadow-sm">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <span className="text-lg">ϟ</span>

          <p className="text-sm font-semibold tracking-wide text-accent">
            STUDY TOOLS
          </p>
        </div>

        <h2 className="mt-2 font-serif text-3xl tracking-tight">
          Supercharge your learning
        </h2>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {/* Generate Quiz */}
        <div className="rounded-2xl border border-border bg-background p-6 text-center transition hover:-translate-y-1 hover:shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-3xl">
            🏆
          </div>

          <h3 className="mt-5 font-serif text-2xl">
            Generate Quiz
          </h3>

          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted">
            Create personalized quizzes from your documents
          </p>

          <div className="mt-5 flex justify-center gap-2">
            {[10, 15, 20, 25].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setQuizCount(count)}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  quizCount === count
                    ? "bg-accent text-white"
                    : "border border-border bg-card text-muted hover:border-accent/40"
                }`}
              >
                {count}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleGenerateQuiz}
            className="mt-5 w-full rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:opacity-90"
          >
            Generate Quiz →
          </button>
        </div>

        {/* Key Topics */}
        <div className="rounded-2xl border border-border bg-background p-6 text-center transition hover:-translate-y-1 hover:shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-3xl">
            ☷
          </div>

          <h3 className="mt-5 font-serif text-2xl">
            Key Topics
          </h3>

          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted">
            Extract and explore important topics from your material
          </p>

          <button
            type="button"
            onClick={handleViewTopics}
            className="mt-8 w-full rounded-full border border-border bg-accent/10 px-5 py-3 text-sm font-medium text-accent transition hover:-translate-y-0.5 hover:bg-accent/15"
          >
            View Topics →
          </button>
        </div>

        {/* Subject Flowchart */}
        <div className="rounded-2xl border border-border bg-background p-6 text-center transition hover:-translate-y-1 hover:shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-3xl">
            ⑂
          </div>

          <h3 className="mt-5 font-serif text-2xl">
            Subject Flowchart
          </h3>

          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted">
            Visual overview of how everything connects
          </p>

          <button
            type="button"
            onClick={handleViewFlowchart}
            className="mt-8 w-full rounded-full border border-border bg-accent/10 px-5 py-3 text-sm font-medium text-accent transition hover:-translate-y-0.5 hover:bg-accent/15"
          >
            View Flowchart →
          </button>
        </div>
      </div>
    </section>
  );
}