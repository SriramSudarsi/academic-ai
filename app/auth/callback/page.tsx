"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    async function handleCallback() {
      const code = new URLSearchParams(window.location.search).get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          setMessage("Email verification failed. Please try again.");
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        router.replace("/workspace");
      } else {
        setMessage(
          "Email verified successfully. Please sign in to continue."
        );

        setTimeout(() => {
          router.replace("/sign-in");
        }, 1500);
      }
    }

    handleCallback();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center">
        <h1 className="font-serif text-3xl text-foreground">
          {message}
        </h1>
      </div>
    </main>
  );
}