import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  BadgeCheckIcon,
  CircleAlertIcon,
  CopyIcon,
  KeyRoundIcon,
  Loader2Icon,
  MailCheckIcon,
  MonitorSmartphoneIcon,
  SaveIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  Trash2Icon,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  revokeOtherSessions,
  revokeSession,
  sendEmailVerification,
  sessionQueryOptions,
  setupTwoFactor,
  twoFactorStatusQueryOptions,
  updateProfile,
  userSessionsQueryOptions,
  type ChangePasswordInput,
  type ManagedSession,
  type TwoFactorSetup,
  type UpdateProfileInput,
} from '@/lib/auth'

export const Route = createFileRoute('/_protected/account')({
  component: Account,
})

function Account() {
  const { user } = Route.useRouteContext()
  const [image, setImage] = useState(user.image ?? '')
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<
    ManagedSession | 'others' | null
  >(null)
  const queryClient = useQueryClient()
  const router = useRouter()
  const sessionsQuery = useQuery(userSessionsQueryOptions)
  const emailVerificationMutation = useMutation({
    mutationFn: sendEmailVerification,
    onSuccess: () => toast.success('Verification email sent'),
    onError: (error) => toast.error(error.message),
  })
  const profileMutation = useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onSuccess: async (session) => {
      queryClient.setQueryData(sessionQueryOptions.queryKey, session)
      await router.invalidate()
      toast.success('Profile updated successfully')
    },
    onError: (error) => toast.error(error.message),
  })
  const passwordMutation = useMutation({
    mutationFn: (input: ChangePasswordInput) => changePassword(input),
    onSuccess: async () => {
      setPasswordDialogOpen(false)
      await queryClient.invalidateQueries({
        queryKey: userSessionsQueryOptions.queryKey,
      })
      toast.success('Password changed successfully')
    },
    onError: (error) => toast.error(error.message),
  })
  const revokeMutation = useMutation({
    mutationFn: (target: ManagedSession | 'others') =>
      target === 'others'
        ? revokeOtherSessions()
        : revokeSession(target.id),
    onSuccess: async (_, target) => {
      setRevokeTarget(null)
      await queryClient.invalidateQueries({
        queryKey: userSessionsQueryOptions.queryKey,
      })
      toast.success(
        target === 'others'
          ? 'Other sessions revoked'
          : 'Session revoked',
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    profileMutation.mutate({
      name: String(form.get('name') ?? ''),
      image: String(form.get('image') ?? ''),
    })
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const currentPassword = String(form.get('currentPassword') ?? '')
    const newPassword = String(form.get('newPassword') ?? '')
    const confirmPassword = String(form.get('confirmPassword') ?? '')
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    passwordMutation.mutate({ currentPassword, newPassword })
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              {image && <AvatarImage src={image} alt={user.name} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                Update the information shown across your account.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  defaultValue={user.name}
                  maxLength={100}
                  autoComplete="name"
                  required
                />
              </Field>

              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Badge
                    variant={user.emailVerified ? 'default' : 'secondary'}
                  >
                    {user.emailVerified ? (
                      <BadgeCheckIcon data-icon="inline-start" />
                    ) : (
                      <CircleAlertIcon data-icon="inline-start" />
                    )}
                    {user.emailVerified ? 'Verified' : 'Unverified'}
                  </Badge>
                </div>
                <Input
                  id="email"
                  type="email"
                  value={user.email}
                  disabled
                />
                <FieldDescription>
                  Email changes are currently disabled.
                </FieldDescription>
                {!user.emailVerified ? (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={emailVerificationMutation.isPending}
                      onClick={() => emailVerificationMutation.mutate()}
                    >
                      {emailVerificationMutation.isPending ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <MailCheckIcon />
                      )}
                      {emailVerificationMutation.isPending
                        ? 'Sending…'
                        : 'Resend verification email'}
                    </Button>
                  </div>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="image">Image URL</FieldLabel>
                <Input
                  id="image"
                  name="image"
                  type="url"
                  value={image}
                  placeholder="https://example.com/avatar.jpg"
                  onChange={(event) => {
                    setImage(event.target.value)
                    profileMutation.reset()
                  }}
                />
                <FieldDescription>
                  Use a public HTTP or HTTPS image URL, or leave this blank.
                </FieldDescription>
              </Field>

              <div>
                <Button type="submit" disabled={profileMutation.isPending}>
                  {profileMutation.isPending ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <SaveIcon />
                  )}
                  {profileMutation.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Keep your account secure with a strong, unique password.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Dialog
            open={passwordDialogOpen}
            onOpenChange={(open) => {
              setPasswordDialogOpen(open)
              if (!open) passwordMutation.reset()
            }}
          >
            <DialogTrigger render={<Button variant="outline" />}>
              <KeyRoundIcon />
              Change password
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handlePasswordSubmit}>
                <DialogHeader>
                  <DialogTitle>Change password</DialogTitle>
                  <DialogDescription>
                    Enter your current password, then choose a new password.
                    Other active sessions will be signed out.
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup className="my-6">
                  <Field>
                    <FieldLabel htmlFor="current-password">
                      Current password
                    </FieldLabel>
                    <Input
                      id="current-password"
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-password">
                      New password
                    </FieldLabel>
                    <Input
                      id="new-password"
                      name="newPassword"
                      type="password"
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      required
                    />
                    <FieldDescription>
                      Use between 8 and 72 characters.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">
                      Confirm new password
                    </FieldLabel>
                    <Input
                      id="confirm-password"
                      name="confirmPassword"
                      type="password"
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPasswordDialogOpen(false)}
                    disabled={passwordMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={passwordMutation.isPending}>
                    {passwordMutation.isPending ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <KeyRoundIcon />
                    )}
                    {passwordMutation.isPending
                      ? 'Changing…'
                      : 'Change password'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <TwoFactorManager />
        </CardContent>
      </Card>

      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Active sessions</CardTitle>
              <CardDescription>
                Review devices signed in to your account and revoke access.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !sessionsQuery.data?.sessions.some((session) => !session.current)
              }
              onClick={() => setRevokeTarget('others')}
            >
              <Trash2Icon />
              Revoke all others
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sessionsQuery.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading sessions…
            </div>
          )}
          {sessionsQuery.error && (
            <p className="text-sm text-destructive">
              {sessionsQuery.error.message}
            </p>
          )}
          {sessionsQuery.data && (
            <div className="divide-y">
              {sessionsQuery.data.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  onRevoke={() => setRevokeTarget(session)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revokeMutation.isPending) setRevokeTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {revokeTarget === 'others'
                ? 'Revoke all other sessions?'
                : 'Revoke this session?'}
            </DialogTitle>
            <DialogDescription>
              {revokeTarget === 'others'
                ? 'Every device except this one will be signed out immediately.'
                : 'This device will be signed out and will need to log in again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRevokeTarget(null)}
              disabled={revokeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMutation.isPending || revokeTarget === null}
              onClick={() => {
                if (revokeTarget) revokeMutation.mutate(revokeTarget)
              }}
            >
              {revokeMutation.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <Trash2Icon />
              )}
              {revokeMutation.isPending ? 'Revoking…' : 'Revoke'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SessionItem({
  session,
  onRevoke,
}: {
  session: ManagedSession
  onRevoke: () => void
}) {
  return (
    <div className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center bg-muted">
        <MonitorSmartphoneIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">
            {session.userAgent || 'Unknown device'}
          </p>
          {session.current && (
            <Badge>
              <ShieldCheckIcon />
              Current
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {session.ipAddress || 'Unknown IP'} · Signed in{' '}
          {formatSessionDate(session.createdAt)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Expires {formatSessionDate(session.expiresAt)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={
          session.current ? 'Current session is protected' : 'Revoke session'
        }
        title={
          session.current ? 'Current session is protected' : 'Revoke session'
        }
        disabled={session.current}
        onClick={onRevoke}
      >
        {session.current ? <ShieldCheckIcon /> : <Trash2Icon />}
      </Button>
    </div>
  )
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function TwoFactorManager() {
  const [open, setOpen] = useState(false)
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const queryClient = useQueryClient()
  const status = useQuery(twoFactorStatusQueryOptions)
  const setupMutation = useMutation({
    mutationFn: setupTwoFactor,
    onSuccess: setSetup,
    onError: (error) => toast.error(error.message),
  })
  const enableMutation = useMutation({
    mutationFn: enableTwoFactor,
    onSuccess: async (result) => {
      setRecoveryCodes(result.recoveryCodes)
      await queryClient.invalidateQueries({
        queryKey: twoFactorStatusQueryOptions.queryKey,
      })
      toast.success('Two-factor authentication enabled')
    },
    onError: (error) => toast.error(error.message),
  })
  const disableMutation = useMutation({
    mutationFn: ({ password, code }: { password: string; code: string }) =>
      disableTwoFactor(password, code),
    onSuccess: async () => {
      setOpen(false)
      await queryClient.invalidateQueries({
        queryKey: twoFactorStatusQueryOptions.queryKey,
      })
      toast.success('Two-factor authentication disabled')
    },
    onError: (error) => toast.error(error.message),
  })
  const enabled = status.data?.enabled ?? false

  function reset() {
    setSetup(null)
    setRecoveryCodes(null)
    setupMutation.reset()
    enableMutation.reset()
    disableMutation.reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        {enabled ? <ShieldOffIcon /> : <ShieldCheckIcon />}
        {status.isPending
          ? 'Checking 2FA…'
          : enabled
            ? 'Disable 2FA'
            : 'Enable 2FA'}
      </DialogTrigger>
      <DialogContent>
        {enabled ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              disableMutation.mutate({
                password: String(form.get('password') ?? ''),
                code: String(form.get('code') ?? ''),
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>Disable two-factor authentication</DialogTitle>
              <DialogDescription>
                Confirm your password and an authenticator or recovery code.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="my-6">
              <Field>
                <FieldLabel htmlFor="disable-2fa-password">
                  Current password
                </FieldLabel>
                <Input
                  id="disable-2fa-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="disable-2fa-code">
                  Verification code
                </FieldLabel>
                <Input
                  id="disable-2fa-code"
                  name="code"
                  autoComplete="one-time-code"
                  required
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={disableMutation.isPending}
              >
                {disableMutation.isPending ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <ShieldOffIcon />
                )}
                {disableMutation.isPending ? 'Disabling…' : 'Disable 2FA'}
              </Button>
            </DialogFooter>
          </form>
        ) : recoveryCodes ? (
          <>
            <DialogHeader>
              <DialogTitle>Save your recovery codes</DialogTitle>
              <DialogDescription>
                Each code works once. Store them somewhere safe; they will not
                be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 bg-muted p-4 font-mono text-xs">
              {recoveryCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(recoveryCodes.join('\n'))
                  toast.success('Recovery codes copied')
                }}
              >
                <CopyIcon />
                Copy codes
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : setup ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              enableMutation.mutate(String(form.get('code') ?? ''))
            }}
          >
            <DialogHeader>
              <DialogTitle>Scan authenticator code</DialogTitle>
              <DialogDescription>
                Scan this QR code, then enter the generated six-digit code.
              </DialogDescription>
            </DialogHeader>
            <div className="my-6 flex flex-col items-center gap-4">
              <img
                src={setup.qrCode}
                alt="Two-factor authenticator QR code"
                className="size-48"
              />
              <code className="break-all bg-muted px-3 py-2 text-xs">
                {setup.secret}
              </code>
              <Field>
                <FieldLabel htmlFor="enable-2fa-code">
                  Verification code
                </FieldLabel>
                <Input
                  id="enable-2fa-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  required
                  autoFocus
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={enableMutation.isPending}>
                {enableMutation.isPending && (
                  <Loader2Icon className="animate-spin" />
                )}
                Verify and enable
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              setupMutation.mutate(String(form.get('password') ?? ''))
            }}
          >
            <DialogHeader>
              <DialogTitle>Enable two-factor authentication</DialogTitle>
              <DialogDescription>
                Confirm your password before connecting an authenticator app.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="my-6">
              <Field>
                <FieldLabel htmlFor="enable-2fa-password">
                  Current password
                </FieldLabel>
                <Input
                  id="enable-2fa-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={setupMutation.isPending}>
                {setupMutation.isPending && (
                  <Loader2Icon className="animate-spin" />
                )}
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
