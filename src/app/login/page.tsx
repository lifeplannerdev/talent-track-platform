import type { Metadata } from "next";
import Link from "next/link";
import { PoweredBy, Wordmark } from "@/components/app/wordmark";
import { Seal } from "@/components/landing/seal";
import { Reveal } from "@/components/landing/reveal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in | Talent Track Platform" };

export default function LoginPage() {
  return (
    <main id="main-content" tabIndex={-1} className="grid flex-1 outline-none lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="ruled hidden flex-col justify-between border-r bg-background p-10 lg:flex xl:p-14">
        <Link href="/" className="w-fit rounded-md">
          <Wordmark compact />
        </Link>
        <Reveal className="flex flex-col gap-6">
          <Seal className="size-20" />
          <p className="max-w-[14ch] font-heading text-5xl leading-[1] font-bold tracking-[-0.04em] text-balance text-foreground">
            Talent Track Platform
          </p>
          <p className="max-w-[36ch] text-base leading-relaxed text-muted-foreground">
            Exams in German, your percentage the moment you submit.
          </p>
        </Reveal>
        <PoweredBy />
      </aside>
      <div className="flex flex-col items-center justify-center gap-5 bg-card px-4 py-8 sm:py-12">
        <Link href="/" className="rounded-md lg:hidden">
          <Wordmark />
        </Link>
        <Card className="enter w-full max-w-sm shadow-panel">
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl font-semibold">Sign in</h1>
            </CardTitle>
            <CardDescription>
              Welcome to Talent Track Platform. Use the account your trainer created for you; there is no self sign-up.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
        <p className="max-w-sm text-center text-xs text-muted-foreground">
          For exams, please use a computer if you can. A phone works too.
        </p>
        <PoweredBy className="text-xs lg:hidden" />
      </div>
    </main>
  );
}
