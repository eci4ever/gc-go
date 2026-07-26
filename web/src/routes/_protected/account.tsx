import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  BadgeCheckIcon,
  CircleAlertIcon,
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  sessionQueryOptions,
  updateProfile,
  type UpdateProfileInput,
} from '@/lib/auth'

export const Route = createFileRoute('/_protected/account')({
  component: Account,
})

function Account() {
  const { user } = Route.useRouteContext()
  const [image, setImage] = useState(user.image ?? '')
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

  return (
    <div className="flex flex-1 flex-col p-4 pt-0">
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
    </div>
  )
}
