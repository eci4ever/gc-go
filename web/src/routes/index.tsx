import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

type Health = {
  status: string
  api: string
  db: string
  db_latency_ms: number | null
  time: string
}

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
    <main className="py-12 sm:py-16">
      <section className="flex min-h-0 items-center justify-between gap-10 sm:min-h-[250px]">
        <div>
          <p className="text-[.68rem] font-extrabold tracking-[.18em] text-[#829a44]">SYSTEM OVERVIEW <span className="px-1 text-[#bed95b]">•</span> LIVE</p>
          <h1 className="mt-4 max-w-2xl text-[clamp(2.7rem,5vw,4.8rem)] font-extrabold leading-[1.02] tracking-[-.04em] text-ink">A clearer view of what’s running.</h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted">A quiet, real-time snapshot of the API and the database behind it.</p>
        </div>
        <div className="relative hidden size-[210px] shrink-0 md:block" aria-hidden="true">
          <div className="absolute inset-0 rounded-full border border-[#cbdcc9] rotate-[25deg] scale-y-[.45]" />
          <div className="absolute inset-0 rounded-full border border-[#cbdcc9] -rotate-[25deg] scale-y-[.45]" />
          <div className="absolute inset-[63px] grid place-items-center rounded-full bg-lime text-lg font-black text-ink shadow-[0_0_0_12px_#d8f36e44,0_18px_35px_#7e9d5533]">GC</div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="System status">
        <StatusCard
          label="API status"
          value={health.isPending ? 'Checking' : health.isError ? 'Offline' : health.data?.api === 'ok' ? 'Operational' : 'Degraded'}
          detail={health.isError ? 'Unable to reach the service' : 'Fiber is responding normally'}
          state={health.isError ? 'error' : health.data?.api === 'ok' ? 'online' : 'pending'}
          icon="↗"
        />
        <StatusCard
          label="Database"
          value={health.isPending ? 'Checking' : health.isError ? 'Unknown' : health.data?.db === 'ok' ? 'Connected' : 'Unavailable'}
          detail={health.isError ? 'Waiting for an API response' : health.data?.db === 'ok' ? 'PostgreSQL connection is healthy' : 'Connection needs attention'}
          state={health.data?.db === 'ok' ? 'online' : health.isError ? 'pending' : 'error'}
          icon="⌁"
        />
        <StatusCard
          label="DB latency"
          value={health.data?.db_latency_ms != null ? `${health.data.db_latency_ms.toFixed(1)} ms` : health.isPending ? 'Checking' : '—'}
          detail="Latest health query round trip"
          state={health.data?.db_latency_ms != null ? 'online' : 'pending'}
          icon="◷"
        />
      </section>

      <section className="mt-4 flex items-center gap-3 rounded-[18px] border border-line bg-[#eef4e9] px-5 py-[18px]">
        <span className={`size-2.5 shrink-0 rounded-full ${health.data?.status === 'ok' ? 'bg-[#92b337] shadow-[0_0_0_5px_#92b3371c]' : 'bg-[#df8b65] shadow-[0_0_0_5px_#df8b651c]'}`} />
        <div className="grid gap-0.5">
          <strong className="text-sm text-[#33463b]">{health.isPending ? 'Refreshing system status…' : health.isError ? 'System status unavailable' : health.data?.status === 'ok' ? 'All systems operational' : 'Some systems need attention'}</strong>
          {health.data && <small className="text-[#829087]">Last checked {new Date(health.data.time).toLocaleString()}</small>}
        </div>
        <span className="ml-auto text-xs text-[#829087] max-sm:hidden">Auto-refresh · 30s</span>
      </section>
    </main>
  )
}

type StatusCardProps = {
  label: string
  value: string
  detail: string
  state: 'online' | 'error' | 'pending'
  icon: string
}

function StatusCard({ label, value, detail, state, icon }: StatusCardProps) {
  const iconStyles = {
    online: 'bg-[#eef6c9] text-[#69813a]',
    error: 'bg-[#fff0e9] text-[#ad6b4a]',
    pending: 'bg-[#eef3ea] text-[#6b7e70]',
  }[state]
  const markStyles = {
    online: 'bg-[#92b337] shadow-[0_0_0_5px_#92b3371c]',
    error: 'bg-[#df8b65] shadow-[0_0_0_5px_#df8b651c]',
    pending: 'bg-[#c8d0ca]',
  }[state]

  return (
    <article className="min-h-[166px] rounded-[18px] border border-line bg-white/70 p-5 shadow-[0_12px_35px_#4e694d0b] transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[.68rem] font-extrabold uppercase tracking-[.08em] text-[#829087]">{label}</span>
        <span className={`grid size-8 place-items-center rounded-[9px] text-lg ${iconStyles}`} aria-hidden="true">{icon}</span>
      </div>
      <div className="mt-6 flex items-center gap-2.5 text-[1.2rem] font-bold tracking-tight text-ink"><span className={`size-2 rounded-full ${markStyles}`} />{value}</div>
      <p className="mt-2 text-[.78rem] leading-snug text-[#819087]">{detail}</p>
    </article>
  )
}
