import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  Loader2Icon,
  MailIcon,
} from 'lucide-react'

import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { forgotPassword } from '@/lib/auth'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [submittedEmail, setSubmittedEmail] = useState('')
  const requestReset = useMutation({
    mutationFn: forgotPassword,
    onSuccess: (_, email) => setSubmittedEmail(email),
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    requestReset.mutate(String(form.get('email') ?? ''))
  }

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-12 sm:px-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <div className="mb-2 grid size-10 place-items-center bg-primary text-primary-foreground">
              {submittedEmail ? (
                <CheckCircleIcon className="size-5" />
              ) : (
                <MailIcon className="size-5" />
              )}
            </div>
            <CardTitle>
              {submittedEmail ? 'Check your inbox' : 'Forgot password?'}
            </CardTitle>
            <CardDescription>
              {submittedEmail
                ? `If an account exists for ${submittedEmail}, we sent a password reset link.`
                : 'Enter your account email and we will send you a secure reset link.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submittedEmail ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The link expires in 30 minutes. Check your spam folder if it
                  does not arrive.
                </p>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    setSubmittedEmail('')
                    requestReset.reset()
                  }}
                >
                  Try another email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {requestReset.error ? (
                    <FieldError>{requestReset.error.message}</FieldError>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor="reset-email">Email</FieldLabel>
                    <Input
                      id="reset-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      required
                      autoFocus
                    />
                    <FieldDescription>
                      Use the email associated with your account.
                    </FieldDescription>
                  </Field>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={requestReset.isPending}
                  >
                    {requestReset.isPending ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <MailIcon />
                    )}
                    {requestReset.isPending ? 'Sending…' : 'Send reset link'}
                  </Button>
                </FieldGroup>
              </form>
            )}
            <Button
              variant="ghost"
              className="mt-4 w-full"
              render={<Link to="/login" />}
            >
              <ArrowLeftIcon />
              Back to login
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
