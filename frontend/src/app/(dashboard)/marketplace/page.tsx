'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { MarketplaceCardSkeleton } from '@/components/skeletons/MarketplaceCardSkeleton'
import { ShoppingBag, Plus, Search, X } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

interface MarketplaceProduct {
  id: string
  title: string
  description: string | null
  price: number
  imageUrl: string | null
  category: string | null
  seller: {
    id: string
    firstName: string
    lastName: string
    avatarUrl: string | null
  }
  createdAt: string
}

function ProductCard({ product }: { product: MarketplaceProduct }) {
  const { toast } = useToast()

  const handleBuy = async () => {
    try {
      await api.post(`/marketplace/${product.id}/buy`)
      toast({ title: `Purchased "${product.title}"` })
    } catch (e: any) {
      toast({
        title: e?.response?.data?.message || 'Purchase failed',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-md transition-all">
      {/* Product image */}
      <div className="w-full aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <ShoppingBag className="w-12 h-12 text-gray-300" />
        )}
      </div>

      {/* Card body */}
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-semibold text-gray-900 line-clamp-1">{product.title}</p>
        {product.category && (
          <p className="text-xs text-gray-400 capitalize">{product.category}</p>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-bold text-indigo-600">
            {product.price.toLocaleString()} 🪙
          </span>
          <button
            onClick={handleBuy}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors"
          >
            Buy
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MarketplacePage() {
  const { toast } = useToast()
  const [search, setSearch] = useState('')

  const { data: products, isLoading } = useQuery<MarketplaceProduct[]>({
    queryKey: ['marketplace-products', search],
    queryFn: () =>
      api
        .get('/marketplace', { params: { ...(search && { q: search }), limit: 50 } })
        .then(r => r.data.data ?? []),
    staleTime: 30000,
  })

  const items = products ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-md">
            <ShoppingBag className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Marketplace</h1>
            <p className="text-xs text-gray-400">Buy and sell items</p>
          </div>
        </div>

        <button
          className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-md"
          onClick={() => toast({ title: 'Listing coming soon' })}
        >
          <Plus className="w-4 h-4" />
          List an Item
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products…"
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Product grid */}
      {isLoading ? (
        <MarketplaceCardSkeleton count={6} />
      ) : items.length === 0 ? (
        search ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="font-semibold text-gray-500">No products matching &quot;{search}&quot;</p>
          </div>
        ) : (
          <EmptyState
            icon={ShoppingBag}
            title="No products yet"
            description="Be the first to list an item"
            action={{ label: 'List an Item', onClick: () => toast({ title: 'Listing coming soon' }) }}
          />
        )
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
