import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  BadgeCheckIcon,
  CircleAlertIcon,
  KeyRoundIcon,
  Loader2Icon,
  SaveIcon,
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
  sessionQueryOptions,
  updateProfile,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '@/lib/auth'

export const Route = createFileRoute('/_protected/account')({
  component: Account,
})

function Account() {
  const { user } = Route.useRouteContext()
  const [image, setImage] = useState(user.image ?? '')
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const queryClient = useQueryClient()
  const router = useRouter()
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
    onSuccess: () => {
      setPasswordDialogOpen(false)
      toast.success('Password changed successfully')
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
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  )
}
