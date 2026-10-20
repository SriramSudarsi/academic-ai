const features = [
  {
    title: "Clear explanations",
    description:
      "Break down lectures, readings, and problem sets into language that actually sticks.",
  },
  {
    title: "Study from your notes",
    description:
      "Turn messy notes into summaries, flashcards, and focused review sessions.",
  },
  {
    title: "Exam-ready practice",
    description:
      "Generate quizzes and walk through answers step by step before the real test.",
  },
  {
    title: "Stay organized",
    description:
      "Keep courses, topics, and progress in one quiet workspace instead of scattered tabs.",
  },
];

const steps = [
  {
    number: "01",
    title: "Add your material",
    description: "Paste a question, drop in notes, or describe what you are studying.",
  },
  {
    number: "02",
    title: "Get a focused answer",
    description: "See explanations, examples, and next steps without the extra noise.",
  },
  {
    number: "03",
    title: "Review and remember",
    description: "Save what matters and come back when it is time to practice.",
  },
];

function Logo() {
  return (
    <a href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-semibold tracking-tight text-white">
        A
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Academic AI</span>
    </a>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">
              How it works
            </a>
          </nav>
          <div className="flex items-center gap-3">
          <a href="/sign-in" className="text-sm text-muted hover:text-foreground">
          Sign in
          </a>
            <a
              href="#features"
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Get started
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-6 pb-20 pt-16 sm:pb-28 sm:pt-24">
          <p className="mb-5 text-sm font-medium tracking-wide text-accent">
            Built for students
          </p>
          <h1 className="max-w-3xl font-serif text-4xl leading-[1.15] tracking-tight text-foreground sm:text-6xl">
            Study with a calm, focused{" "}
            <span className="italic text-accent">academic companion</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Academic AI helps you understand coursework, review notes, and prepare
            for exams — without turning your study session into another noisy chat
            window.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#how-it-works"
              className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Start studying
            </a>
            <a
              href="#features"
              className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-card px-6 text-sm font-medium text-foreground transition-colors hover:bg-background"
            >
              See features
            </a>
          </div>

          <div className="mt-14 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)] sm:p-5">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                Ask a question
              </span>
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                Preview
              </span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="min-h-12 flex-1 rounded-xl bg-background px-4 py-3 text-sm leading-6 text-muted">
                Explain photosynthesis like I am reviewing for tomorrow&apos;s biology
                quiz.
              </p>
              <span className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background">
                Ask
              </span>
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-border bg-card">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
            <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">
              Everything you need to study well
            </h2>
            <p className="mt-3 max-w-lg text-muted">
              A simple set of tools designed around how students actually learn.
            </p>
            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {features.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-2xl border border-border bg-background p-6"
                >
                  <h3 className="text-base font-semibold tracking-tight">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {feature.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
          <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">
            How it works
          </h2>
          <p className="mt-3 max-w-lg text-muted">
            Three quiet steps from a question to something you can actually use.
          </p>
          <ol className="mt-12 grid gap-8 sm:grid-cols-3">
            {steps.map((step) => (
              <li key={step.number}>
                <p className="font-mono text-xs tracking-[0.16em] text-accent">
                  {step.number}
                </p>
                <h3 className="mt-3 text-base font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted">{step.description}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>A focused study workspace. Coming together one screen at a time.</p>
        </div>
      </footer>
    </div>
  );
}
