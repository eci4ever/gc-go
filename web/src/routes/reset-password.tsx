import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
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
import { resetPassword } from '@/lib/auth'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const [showPassword, setShowPassword] = useState(false)
  const [passwordMismatch, setPasswordMismatch] = useState(false)
  const passwordReset = useMutation({
    mutationFn: resetPassword,
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const newPassword = String(form.get('newPassword') ?? '')
    const confirmPassword = String(form.get('confirmPassword') ?? '')
    if (newPassword !== confirmPassword) {
      setPasswordMismatch(true)
      return
    }
    setPasswordMismatch(false)
    passwordReset.mutate({ token, newPassword })
  }

  const missingToken = !token

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-12 sm:px-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <div className="mb-2 grid size-10 place-items-center bg-primary text-primary-foreground">
              {passwordReset.isSuccess ? (
                <CheckCircleIcon className="size-5" />
              ) : (
                <KeyRoundIcon className="size-5" />
              )}
            </div>
            <CardTitle>
              {passwordReset.isSuccess
                ? 'Password updated'
                : 'Choose a new password'}
            </CardTitle>
            <CardDescription>
              {passwordReset.isSuccess
                ? 'Your active sessions were signed out. Log in again with your new password.'
                : 'Use a strong password you have not used for this account.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {passwordReset.isSuccess ? (
              <Button className="w-full" render={<Link to="/login" />}>
                Continue to login
              </Button>
            ) : missingToken ? (
              <div className="space-y-4">
                <FieldError>This reset link is incomplete.</FieldError>
                <Button
                  className="w-full"
                  variant="outline"
                  render={<Link to="/forgot-password" />}
                >
                  Request a new link
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {passwordReset.error ? (
                    <FieldError>{passwordReset.error.message}</FieldError>
                  ) : null}
                  {passwordMismatch ? (
                    <FieldError>Passwords do not match.</FieldError>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor="new-password">
                      New password
                    </FieldLabel>
                    <div className="relative">
                      <Input
                        id="new-password"
                        name="newPassword"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={72}
                        className="pr-9"
                        required
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-0.5 top-0.5"
                        aria-label={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        onClick={() => setShowPassword((visible) => !visible)}
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </Button>
                    </div>
                    <FieldDescription>
                      Use between 8 and 72 characters.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">
                      Confirm password
                    </FieldLabel>
                    <Input
                      id="confirm-password"
                      name="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={72}
                      required
                    />
                  </Field>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={passwordReset.isPending}
                  >
                    {passwordReset.isPending ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <KeyRoundIcon />
                    )}
                    {passwordReset.isPending
                      ? 'Updating…'
                      : 'Update password'}
                  </Button>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
