import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PoweredBy, Wordmark } from "@/components/app/wordmark";
import { linkClass } from "@/components/app/styles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Choose your password | Talent Track Platform",
  robots: { index: false, follow: false },
};

// Opening this page only shows the form. The one-time token is a hidden field and is verified
// (and used up) by the server action when the new password is submitted, never here: mail
// scanners open links before the student does.
async function SetPasswordCard({ searchParams }: { searchParams: PageProps<"/set-password">["searchParams"] }) {
  const params = await searchParams;
  const raw = params.token_hash;
  const tokenHash = typeof raw === "string" ? raw : "";
  return (
    <Card className="enter w-full max-w-sm shadow-panel">
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-semibold">Choose your password</h1>
        </CardTitle>
        <CardDescription>
          Pick a password for your Talent Track Platform account. You will sign in with your username and this password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tokenHash ? (
          <SetPasswordForm tokenHash={tokenHash} />
        ) : (
          <div className="flex flex-col gap-3" data-testid="set-password-invalid">
            <p role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-sm font-semibold text-destructive">
              This link is no longer valid. Ask your trainer to send you a new invite.
            </p>
            <Link href="/login" className={linkClass}>
              Go to sign in
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SetPasswordPage(props: PageProps<"/set-password">) {
  return (
    <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col items-center justify-center gap-5 bg-card px-4 py-8 outline-none sm:py-12">
      <Link href="/" className="rounded-md">
        <Wordmark />
      </Link>
      <Suspense fallback={null}>
        <SetPasswordCard searchParams={props.searchParams} />
      </Suspense>
      <PoweredBy className="text-xs" />
    </main>
  );
}
