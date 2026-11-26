import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="mb-3 text-2xl font-bold">Page not found / పేజీ దొరకలేదు</h1>
      <p className="mb-6 text-ink-soft">The page may have moved, or you may not have access to it. / పేజీ మారి ఉండవచ్చు, లేదా దానికి మీకు అనుమతి లేకపోవచ్చు.</p>
      <Link className="btn inline-flex w-fit items-center" href="/">Home / హోమ్</Link>
    </main>
  );
}
