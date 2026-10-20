"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SignInPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    // Login successful
    setLoading(false);
    router.replace("/workspace");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-4xl tracking-tight text-foreground">
            Welcome back
          </h1>

          <p className="mt-3 text-sm text-muted">
            Sign in to continue studying with Academic AI.
          </p>
        </div>

        <form
          onSubmit={handleSignIn}
          className="rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="space-y-5">

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Email
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* Sign in button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>

            {/* Error message */}
            {message && (
              <p className="text-center text-sm text-gray-600">
                {message}
              </p>
            )}

            {/* Create account */}
            <p className="text-center text-sm text-gray-600">
              Don't have an account?{" "}
              <a
                href="/sign-up"
                className="font-medium text-[#1f5a43] hover:underline"
              >
                Create an account
              </a>
            </p>

          </div>
        </form>
      </div>
    </main>
  );
}