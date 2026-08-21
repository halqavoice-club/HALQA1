import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActions, commonBulkActions } from '../ui/bulk-actions'

// Radix DropdownMenu renders into a portal — mock it to render inline.
jest.mock('@/components/ui/dropdown-menu', () => {
  const React = require('react')
  return {
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children, asChild }: any) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-content">{children}</div>,
    DropdownMenuItem: ({ children, onClick, className }: any) => (
      <div role="menuitem" onClick={onClick} className={className}>{children}</div>
    ),
  }
})

describe('BulkActions', () => {
  const mockItems = [
    { id: '1', name: 'Item 1' },
    { id: '2', name: 'Item 2' },
    { id: '3', name: 'Item 3' },
  ]

  it('renders all items with checkboxes', () => {
    render(<BulkActions items={mockItems} actions={[]} />)
    expect(screen.getByText('Item 1')).toBeInTheDocument()
    expect(screen.getByText('Item 2')).toBeInTheDocument()
    expect(screen.getByText('Item 3')).toBeInTheDocument()
  })

  it('selects all items when select all checkbox is clicked', () => {
    const onSelectionChange = jest.fn()
    render(
      <BulkActions
        items={mockItems}
        actions={[]}
        onSelectionChange={onSelectionChange}
      />
    )
    const selectAllCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(selectAllCheckbox)
    expect(onSelectionChange).toHaveBeenCalledWith(['1', '2', '3'])
  })

  it('selects individual item when checkbox is clicked', () => {
    const onSelectionChange = jest.fn()
    render(
      <BulkActions
        items={mockItems}
        actions={[]}
        onSelectionChange={onSelectionChange}
      />
    )
    const itemCheckboxes = screen.getAllByRole('checkbox')
    fireEvent.click(itemCheckboxes[1]) // First item checkbox
    expect(onSelectionChange).toHaveBeenCalledWith(['1'])
  })

  it('shows actions dropdown when items are selected', () => {
    render(
      <BulkActions
        items={mockItems}
        actions={[commonBulkActions.delete]}
      />
    )
    const selectAllCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(selectAllCheckbox)
    expect(screen.getByText('Actions')).toBeInTheDocument()
  })

  it('calls action handler when action is clicked', () => {
    const actionHandler = jest.fn()
    render(
      <BulkActions
        items={mockItems}
        actions={[
          {
            ...commonBulkActions.delete,
            handler: actionHandler,
          },
        ]}
      />
    )
    const selectAllCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(selectAllCheckbox)
    // With mocked DropdownMenu, the Delete item renders inline — click it directly
    fireEvent.click(screen.getByText('Delete'))
    expect(actionHandler).toHaveBeenCalledWith(['1', '2', '3'])
  })
})
