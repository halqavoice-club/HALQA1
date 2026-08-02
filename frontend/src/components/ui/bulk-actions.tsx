'use client'

import { useState } from 'react'
import { Check, Trash2, Archive, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'

interface BulkAction {
  id: string
  label: string
  icon: React.ReactNode
  handler: (selectedIds: string[]) => Promise<void> | void
  destructive?: boolean
}

interface BulkActionsProps {
  items: Array<{ id: string; [key: string]: any }>
  actions: BulkAction[]
  onSelectionChange?: (selectedIds: string[]) => void
}

export function BulkActions({
  items,
  actions,
  onSelectionChange,
}: BulkActionsProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  const allSelected = items.length > 0 && selectedIds.size === items.length
  const someSelected = selectedIds.size > 0

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(items.map(item => item.id))
      setSelectedIds(allIds)
      onSelectionChange?.(Array.from(allIds))
    } else {
      setSelectedIds(new Set())
      onSelectionChange?.([])
    }
  }

  const handleSelectItem = (id: string, checked: boolean) => {
    const newSelection = new Set(selectedIds)
    if (checked) {
      newSelection.add(id)
    } else {
      newSelection.delete(id)
    }
    setSelectedIds(newSelection)
    onSelectionChange?.(Array.from(newSelection))
  }

  const handleAction = async (action: BulkAction) => {
    try {
      await action.handler(Array.from(selectedIds))
      setSelectedIds(new Set())
      onSelectionChange?.([])
      toast({
        title: action.label,
        description: `Successfully processed ${selectedIds.size} items`,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to process action',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allSelected}
            onCheckedChange={handleSelectAll}
            aria-label="Select all"
          />
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : `${items.length} items`}
          </span>
        </div>

        {someSelected && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreVertical className="h-4 w-4 mr-2" />
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  onClick={() => handleAction(action)}
                  className={action.destructive ? 'text-destructive' : ''}
                >
                  {action.icon}
                  <span className="ml-2">{action.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-3 border rounded hover:bg-accent transition-colors"
          >
            <Checkbox
              checked={selectedIds.has(item.id)}
              onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
              aria-label={`Select item ${item.id}`}
            />
            <div className="flex-1">
              {/* Render item content based on your data structure */}
              <span className="text-sm font-medium">{item.name || item.title || item.id}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export const commonBulkActions = {
  delete: {
    id: 'delete',
    label: 'Delete',
    icon: <Trash2 className="h-4 w-4" />,
    destructive: true,
    handler: (_ids: string[]) => {},
  },
  archive: {
    id: 'archive',
    label: 'Archive',
    icon: <Archive className="h-4 w-4" />,
    handler: (_ids: string[]) => {},
  },
  markAsRead: {
    id: 'markAsRead',
    label: 'Mark as Read',
    icon: <Check className="h-4 w-4" />,
    handler: (_ids: string[]) => {},
  },
}
