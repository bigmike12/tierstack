import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Pick up where your billing left off.</p>
      </div>

      <LoginForm />

      <p className="text-sm text-muted-foreground">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-foreground underline underline-offset-4">
          Create an organization
        </Link>
      </p>
    </div>
  );
}
