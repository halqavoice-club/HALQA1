import { render, screen, fireEvent } from '@testing-library/react'
import { AdvancedSearch } from '../ui/advanced-search'

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
    const filterButton = screen.getAllByRole('button')[1]
    fireEvent.click(filterButton)
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
    const filterButton = screen.getAllByRole('button')[1]
    fireEvent.click(filterButton)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'active' } })
    expect(onSearch).toHaveBeenCalledWith('', { status: 'active' })
  })
})
