import { Check, Laptop, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const themes = [
  { value: 'system', label: 'System', icon: Laptop },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const activeTheme = themes.find((item) => item.value === theme) ?? themes[0]
  const ActiveIcon = activeTheme.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Theme: ${activeTheme.label}`}
          />
        }
      >
        <ActiveIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {themes.map((item) => {
          const Icon = item.icon

          return (
            <DropdownMenuItem
              key={item.value}
              onClick={() => setTheme(item.value)}
            >
              <Icon />
              <span>{item.label}</span>
              {theme === item.value ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
