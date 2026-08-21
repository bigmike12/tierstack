import { redirect } from "next/navigation";
import { apiFetchOrNull } from "@/lib/api";
import type { Session } from "@/lib/types";

export default async function Home() {
  const session = await apiFetchOrNull<Session>("/v1/auth/me");
  redirect(session ? "/overview" : "/login");
}
