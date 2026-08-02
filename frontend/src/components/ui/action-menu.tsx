'use client'

import { MoreVertical } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu'
import { cn } from '@/lib/utils'

export interface ActionMenuItem {
  label: string
  icon?: React.ElementType
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
  separator?: boolean
}

interface ActionMenuProps {
  items: ActionMenuItem[]
  align?: 'start' | 'end'
  triggerClassName?: string
}

export function ActionMenu({ items, align = 'end', triggerClassName }: ActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn('p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors', triggerClassName)}>
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        {items.map((item, i) => (
          <div key={i}>
            {item.separator && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={item.onClick}
              disabled={item.disabled}
              className={cn(
                'gap-2 cursor-pointer',
                item.variant === 'danger' && 'text-red-600 focus:text-red-600 focus:bg-red-50'
              )}
            >
              {item.icon && <item.icon className="w-4 h-4" />}
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
