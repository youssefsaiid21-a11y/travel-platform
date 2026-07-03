import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign in · Orbi",
  description: "Sign in to book flights and manage your bookings.",
};

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user) redirect("/");
  return <>{children}</>;
}
