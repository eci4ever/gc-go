import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  ArrowRight,
  Eye,
  EyeOff,
  LogIn,
  ShieldCheck,
  UserPlus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  login,
  sessionQueryOptions,
  signup,
  verifyTwoFactorLogin,
  type LoginInput,
  type SignupInput,
} from '@/lib/auth'

type AuthMode = 'login' | 'signup'

type AuthFormProps = {
  mode: AuthMode
}

export function AuthForm({ mode }: AuthFormProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const isLogin = mode === 'login'
  const authentication = useMutation({
    mutationFn: (input: LoginInput | SignupInput) =>
      isLogin ? login(input) : signup(input as SignupInput),
    onSuccess: async (result) => {
      if ('twoFactorRequired' in result) {
        setChallengeToken(result.challengeToken)
        return
      }
      queryClient.setQueryData(sessionQueryOptions.queryKey, result)
      await navigate({ to: '/dashboard' })
    },
  })
  const verification = useMutation({
    mutationFn: (code: string) =>
      verifyTwoFactorLogin(challengeToken ?? '', code),
    onSuccess: async (session) => {
      queryClient.setQueryData(sessionQueryOptions.queryKey, session)
      await navigate({ to: '/dashboard' })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    authentication.mutate({
      ...(isLogin ? {} : { name: String(form.get('name') ?? '') }),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    })
  }

  if (challengeToken) {
    return (
      <main className="grid min-h-[calc(100vh-4rem)] place-items-center py-10">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <span className="mb-2 grid size-10 place-items-center bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </span>
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>
              Enter the six-digit code from your authenticator app or use a
              recovery code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                verification.mutate(String(form.get('code') ?? ''))
              }}
            >
              <FieldGroup>
                {verification.error && (
                  <FieldError>{verification.error.message}</FieldError>
                )}
                <Field>
                  <FieldLabel htmlFor="two-factor-code">
                    Verification code
                  </FieldLabel>
                  <Input
                    id="two-factor-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    required
                    autoFocus
                  />
                </Field>
                <Button
                  type="submit"
                  size="lg"
                  disabled={verification.isPending}
                >
                  <ShieldCheck />
                  {verification.isPending ? 'Verifying…' : 'Verify and log in'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setChallengeToken(null)
                    authentication.reset()
                  }}
                >
                  Back to login
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="grid min-h-[calc(100vh-4rem)] place-items-center py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link
            to="/"
            aria-label="Go to home"
            className="mx-auto grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground transition-transform hover:-rotate-3"
          >
            <Activity className="size-5" />
          </Link>
          <h1 className="mt-4 font-heading text-2xl font-semibold tracking-tight">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLogin
              ? 'Enter your credentials to continue to Go Control.'
              : 'Get started with your Go Control workspace.'}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{isLogin ? 'Log in' : 'Sign up'}</CardTitle>
            <CardDescription>
              {isLogin
                ? 'Use the email associated with your account.'
                : 'Use your work email to create an account.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                {authentication.error && (
                  <FieldError>{authentication.error.message}</FieldError>
                )}
                {!isLogin && (
                  <Field>
                    <FieldLabel htmlFor="name">Name</FieldLabel>
                    <Input
                      id="name"
                      name="name"
                      autoComplete="name"
                      placeholder="Your name"
                      required
                    />
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </Field>

                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    {isLogin ? (
                      <Link
                        to="/forgot-password"
                        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Forgot password?
                      </Link>
                    ) : null}
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      placeholder="Enter your password"
                      minLength={8}
                      className="pr-9"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-0.5 top-0.5"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  {!isLogin && (
                    <FieldDescription>
                      Use at least 8 characters.
                    </FieldDescription>
                  )}
                </Field>

                {!isLogin && (
                  <Field orientation="horizontal">
                    <Checkbox id="terms" name="terms" required />
                    <FieldLabel htmlFor="terms">
                      I agree to the terms and privacy policy
                    </FieldLabel>
                  </Field>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={authentication.isPending}
                >
                  {isLogin ? (
                    <LogIn data-icon="inline-start" />
                  ) : (
                    <UserPlus data-icon="inline-start" />
                  )}
                  {authentication.isPending
                    ? isLogin
                      ? 'Logging in…'
                      : 'Creating account…'
                    : isLogin
                      ? 'Log in'
                      : 'Create account'}
                </Button>

                <FieldSeparator>or</FieldSeparator>

                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  render={<Link to={isLogin ? '/signup' : '/login'} />}
                >
                  {isLogin ? 'Create a new account' : 'I already have an account'}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

      </div>
    </main>
  )
}
