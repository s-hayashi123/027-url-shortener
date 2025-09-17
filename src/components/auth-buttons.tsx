"use client";
import { authClient } from "@/lib/auth-client";

export function AuthButtons() {
  return (
    <div className="flex gap-3">
      <button onClick={() => authClient.signIn.social({ provider: "github" })}>
        Sign in with GitHub
      </button>
      <button onClick={() => authClient.signOut()}>Sign Out</button>
    </div>
  );
}
