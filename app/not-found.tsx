import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-[#111111]">
      <div>
        <h1 className="text-[24px] font-black">That Pipeline page does not exist.</h1>
        <Link href="/" className="mt-5 inline-flex h-10 items-center bg-[#111111] px-5 text-[11px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73]">
          Return home
        </Link>
      </div>
    </main>
  );
}
