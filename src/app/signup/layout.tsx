import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Create account · Orbi",
  description: "Create an Orbi account to save passenger details and book faster.",
};

export default async function SignupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user) redirect("/");
  return <>{children}</>;
}
