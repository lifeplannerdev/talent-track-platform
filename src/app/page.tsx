import { redirect } from "next/navigation";

// The proxy sends signed-in users to their own area; everyone else lands here and goes to login.
export default function Home() {
  redirect("/login");
}
