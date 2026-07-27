import { Link } from '@tanstack/react-router'
import { ArrowLeftIcon, HomeIcon, SearchXIcon } from 'lucide-react'

import { SiteHeader } from '@/components/site-header'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="grid min-h-[calc(100vh-4rem)] place-items-center px-4 py-12">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <div className="mb-2 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <SearchXIcon aria-hidden="true" />
            </div>
            <p className="font-heading text-sm font-semibold tracking-widest text-muted-foreground uppercase">
              Error 404
            </p>
            <CardTitle>Page not found</CardTitle>
            <CardDescription>
              The page may have moved, been removed, or the address may be
              incorrect.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Check the URL or return to the home page to continue.
            </p>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Link
              to="/"
              className={cn(buttonVariants(), 'no-underline')}
            >
              <HomeIcon data-icon="inline-start" aria-hidden="true" />
              Go to home
            </Link>
            <Button variant="outline" onClick={() => window.history.back()}>
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              Go back
            </Button>
          </CardFooter>
        </Card>
      </main>
    </div>
  )
}
