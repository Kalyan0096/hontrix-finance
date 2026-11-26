"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="mb-3 text-2xl font-bold">Something went wrong / ఏదో తప్పు జరిగింది</h1>
      <p className="mb-6 text-ink-soft">Nothing was lost. Try again; if it keeps happening, tell your administrator. / ఏమీ పోలేదు. మళ్లీ ప్రయత్నించండి; మళ్లీ ఇలాగే అయితే అడ్మినిస్ట్రేటర్‌కు చెప్పండి.</p>
      <button className="btn" onClick={() => reset()}>Try again / మళ్లీ ప్రయత్నించండి</button>
    </main>
  );
}
