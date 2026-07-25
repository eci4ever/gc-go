import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import './styles.css'

type Health = {
  status: string
  time: string
}

const rootRoute = createRootRoute({
  component: () => (
    <div className="shell">
      <header>
        <span className="mark">GC</span>
        <nav>
          <Link to="/" activeProps={{ className: 'active' }}>Home</Link>
          <Link to="/about" activeProps={{ className: 'active' }}>About</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
})

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: () => (
    <main>
      <p className="eyebrow">MONOREPO STARTER</p>
      <h1>React meets Go Fiber.</h1>
      <p className="lede">TanStack Router handles navigation and TanStack Query handles server state.</p>
    </main>
  ),
})

function Home() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<Health> => {
      const response = await fetch('/api/health')
      if (!response.ok) throw new Error('API request failed')
      return response.json()
    },
    refetchInterval: 30_000,
  })

  return (
    <main>
      <p className="eyebrow">SINGLE ORIGIN · HTTPS</p>
      <h1>Your stack is online.</h1>
      <p className="lede">Vite serves React while transparently proxying API requests to Fiber.</p>
      <section className="status">
        <span className={health.data?.status === 'ok' ? 'dot online' : 'dot'} />
        <div>
          <strong>{health.isPending ? 'Checking API…' : health.isError ? 'API unavailable' : 'Fiber API healthy'}</strong>
          {health.data && <small>Last response: {new Date(health.data.time).toLocaleString()}</small>}
        </div>
      </section>
    </main>
  )
}

const routeTree = rootRoute.addChildren([indexRoute, aboutRoute])
const router = createRouter({ routeTree })
const queryClient = new QueryClient()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
