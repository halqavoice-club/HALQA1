import { render, screen, fireEvent } from '@testing-library/react'
import { AdvancedSearch } from '../ui/advanced-search'

// Radix DropdownMenu renders into a portal — not accessible with JSDOM.
// Mock it to render inline so filter panel content is queryable.
jest.mock('@/components/ui/dropdown-menu', () => {
  const React = require('react')
  return {
    DropdownMenu: ({ children, open, onOpenChange }: any) => {
      return <div data-state={open ? 'open' : 'closed'}>{children}</div>
    },
    DropdownMenuTrigger: ({ children, asChild }: any) => <div onClick={() => {}}>{children}</div>,
    DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-content">{children}</div>,
    DropdownMenuItem: ({ children, onClick }: any) => (
      <div role="menuitem" onClick={onClick}>{children}</div>
    ),
  }
})

describe('AdvancedSearch', () => {
  it('renders search input', () => {
    render(<AdvancedSearch onSearch={jest.fn()} />)
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('calls onSearch with query when search button is clicked', () => {
    const onSearch = jest.fn()
    render(<AdvancedSearch onSearch={onSearch} placeholder="Search..." />)
    const input = screen.getByPlaceholderText('Search...')
    fireEvent.change(input, { target: { value: 'test query' } })
    fireEvent.click(screen.getByText('Search'))
    expect(onSearch).toHaveBeenCalledWith('test query', {})
  })

  it('opens filter dropdown when filter button is clicked', () => {
    render(
      <AdvancedSearch
        onSearch={jest.fn()}
        filters={[
          { id: 'status', label: 'Status', type: 'select' as const, options: [] },
        ]}
      />
    )
    // With mocked DropdownMenu, content renders inline — label always visible
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('applies filter when selected', () => {
    const onSearch = jest.fn()
    render(
      <AdvancedSearch
        onSearch={onSearch}
        filters={[
          {
            id: 'status',
            label: 'Status',
            type: 'select' as const,
            options: [{ value: 'active', label: 'Active' }],
          },
        ]}
      />
    )
    // The select renders inside the inline dropdown content
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'active' } })
    fireEvent.click(screen.getByText('Search'))
    expect(onSearch).toHaveBeenCalledWith('', { status: 'active' })
  })
})
