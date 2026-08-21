import Link from "next/link";
import type { Metadata } from "next";
import { RegisterForm } from "./form";

export const metadata: Metadata = { title: "Create an organization" };

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Create an organization</h1>
        <p className="text-sm text-muted-foreground">
          You become its owner, and a test environment is ready immediately.
        </p>
      </div>

      <RegisterForm />

      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
