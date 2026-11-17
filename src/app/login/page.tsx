import type { Metadata } from "next";
import { Wordmark } from "@/components/app/wordmark";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in | TalentTrack" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Wordmark className="self-center" />
      <Card className="w-full max-w-sm shadow-panel">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">Sign in</h1>
          </CardTitle>
          <CardDescription>Accounts are created by your instructors. There is no self sign-up.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        For exams, please use a computer if you can. A phone works too.
      </p>
    </main>
  );
}
