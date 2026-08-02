'use client'

import { useState, useCallback } from 'react'
import { Search, X, Filter, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'

interface SearchFilter {
  id: string
  label: string
  type: 'text' | 'select' | 'date' | 'number'
  options?: { value: string; label: string }[]
  value?: any
}

interface AdvancedSearchProps {
  onSearch: (query: string, filters: Record<string, any>) => void
  filters?: SearchFilter[]
  placeholder?: string
  className?: string
}

export function AdvancedSearch({
  onSearch,
  filters = [],
  placeholder = 'Search...',
  className = '',
}: AdvancedSearchProps) {
  const [query, setQuery] = useState('')
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>({})
  const [showFilters, setShowFilters] = useState(false)

  const handleSearch = useCallback(() => {
    onSearch(query, activeFilters)
  }, [query, activeFilters, onSearch])

  const handleClear = useCallback(() => {
    setQuery('')
    setActiveFilters({})
    onSearch('', {})
  }, [onSearch])

  const handleFilterChange = useCallback((filterId: string, value: any) => {
    setActiveFilters((prev) => ({
      ...prev,
      [filterId]: value,
    }))
  }, [])

  const removeFilter = useCallback((filterId: string) => {
    setActiveFilters((prev) => {
      const newFilters = { ...prev }
      delete newFilters[filterId]
      return newFilters
    })
  }, [])

  const activeFilterCount = Object.keys(activeFilters).length

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="pl-10 pr-10"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={() => setQuery('')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {filters.length > 0 && (
          <DropdownMenu open={showFilters} onOpenChange={setShowFilters}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <Filter className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {filters.map((filter) => (
                <div key={filter.id} className="p-2">
                  <label className="text-sm font-medium mb-1 block">
                    {filter.label}
                  </label>
                  {filter.type === 'text' && (
                    <Input
                      type="text"
                      value={activeFilters[filter.id] || ''}
                      onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                      placeholder={`Filter by ${filter.label.toLowerCase()}`}
                    />
                  )}
                  {filter.type === 'select' && (
                    <select
                      value={activeFilters[filter.id] || ''}
                      onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                      className="w-full p-2 border rounded text-sm"
                    >
                      <option value="">All</option>
                      {filter.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {filter.type === 'date' && (
                    <Input
                      type="date"
                      value={activeFilters[filter.id] || ''}
                      onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                    />
                  )}
                  {filter.type === 'number' && (
                    <Input
                      type="number"
                      value={activeFilters[filter.id] || ''}
                      onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                      placeholder={`Filter by ${filter.label.toLowerCase()}`}
                    />
                  )}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button onClick={handleSearch}>Search</Button>
        {(query || activeFilterCount > 0) && (
          <Button variant="ghost" onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(activeFilters).map(([filterId, value]) => {
            const filter = filters.find((f) => f.id === filterId)
            if (!filter) return null

            const displayValue =
              filter.type === 'select'
                ? filter.options?.find((o) => o.value === value)?.label || value
                : value

            return (
              <Badge key={filterId} variant="secondary" className="gap-1">
                {filter.label}: {displayValue}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 ml-1"
                  onClick={() => removeFilter(filterId)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}
