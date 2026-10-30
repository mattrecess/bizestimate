import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = { title: "Sign-in problem | SeeBITDA", robots: { index: false, follow: false } };

const REASONS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "The sign-in link expired. Please try again.",
  google: "Google didn't confirm the sign-in. Please try again.",
};

export default async function SignInError({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <>
      <main className="page">
        <h1>Couldn&apos;t sign you in</h1>
        <p>{REASONS[reason ?? ""] ?? "Something went wrong signing in."}</p>
        <p><a className="btn primary" href="/api/auth/google">Try again</a> <Link className="btn" href="/">Back to the map</Link></p>
      </main>
      <Footer />
    </>
  );
}
