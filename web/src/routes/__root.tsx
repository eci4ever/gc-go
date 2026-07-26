import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_80%_0%,#e6f3e8_0,transparent_32rem),#f5f7f1] font-sans text-ink">
      <div className="mx-auto w-[calc(100%-3.5rem)] max-w-7xl">
        <header className="flex items-center justify-between border-b border-line py-7">
          <div className="flex items-center gap-3 text-sm font-bold tracking-wide text-[#2b3933]">
            <span className="grid size-[38px] place-items-center rounded-xl bg-ink font-black text-lime shadow-[0_5px_16px_#1e30271c]">GC</span>
            <span>go control</span>
          </div>
          <nav className="flex gap-7 text-sm font-semibold text-[#809087]">
            <Link to="/" activeProps={{ className: 'text-ink' }} className="transition-colors hover:text-ink">Home</Link>
            <Link to="/about" activeProps={{ className: 'text-ink' }} className="transition-colors hover:text-ink">About</Link>
          </nav>
        </header>
        <Outlet />
      </div>
    </div>
  )
}
