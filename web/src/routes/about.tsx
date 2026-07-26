import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className="py-12 sm:py-16">
      <section className="max-w-3xl">
        <p className="text-[.68rem] font-extrabold tracking-[.18em] text-[#829a44]">ABOUT THE STACK</p>
        <h1 className="mt-4 max-w-2xl text-[clamp(2.7rem,5vw,4.8rem)] font-extrabold leading-[1.02] tracking-[-.04em] text-ink">Small surface. Serious signals.</h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">A focused control room for a React frontend, a Go API, and the PostgreSQL connection that keeps them moving.</p>
      </section>

      <section className="mt-12 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
        <div className="border-b border-line pb-5 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6">
          <p className="text-[.68rem] font-extrabold uppercase tracking-[.08em] text-[#829087]">01 · Frontend</p>
          <h2 className="mt-3 text-base font-bold text-ink">React + TanStack</h2>
          <p className="mt-2 text-[.8rem] leading-relaxed text-muted">File-based routes and cached server state keep the interface quick and predictable.</p>
        </div>
        <div className="border-b border-line pb-5 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6">
          <p className="text-[.68rem] font-extrabold uppercase tracking-[.08em] text-[#829087]">02 · Backend</p>
          <h2 className="mt-3 text-base font-bold text-ink">Go + Fiber</h2>
          <p className="mt-2 text-[.8rem] leading-relaxed text-muted">A small HTTP surface with explicit health signals and a simple deployment footprint.</p>
        </div>
        <div>
          <p className="text-[.68rem] font-extrabold uppercase tracking-[.08em] text-[#829087]">03 · Data</p>
          <h2 className="mt-3 text-base font-bold text-ink">PostgreSQL + sqlc</h2>
          <p className="mt-2 text-[.8rem] leading-relaxed text-muted">Type-safe queries and a measured connection path make database health visible.</p>
        </div>
      </section>

      <section className="mt-14 flex flex-col gap-3 rounded-2xl border border-line bg-[#eef4e9] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[.68rem] font-extrabold uppercase tracking-[.08em] text-[#829087]">Design principle</p>
          <p className="mt-2 text-sm font-semibold text-[#33463b]">Make the important state easy to see.</p>
        </div>
        <span className="text-xs text-[#829087]">Calm by default · useful on demand</span>
      </section>
    </main>
  )
}
