'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { BookOpen, Plus, Search, User, Calendar, CheckCircle, XCircle, Clock, RotateCcw } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { format } from 'date-fns'

const CATEGORIES = ['Quran', 'Hadith', 'Fiqh', 'Seerah', 'Arabic', 'Tafsir', 'Islamic History', 'Children', 'Reference', 'Other']

export default function LibraryPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showAddBook, setShowAddBook] = useState(false)
  const [showIssue, setShowIssue] = useState<string | null>(null)
  const [bookForm, setBookForm] = useState({ title: '', author: '', isbn: '', category: 'Quran', totalCopies: '1', description: '' })
  const [issueForm, setIssueForm] = useState({ studentId: '', dueDate: '' })

  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user?.role || '')

  const { data: booksData, isLoading: loadingBooks, isError: booksError, refetch: refetchBooks } = useQuery({
    queryKey: ['library-books', search, categoryFilter],
    queryFn: () => api.get('/library/books', {
      params: { search: search || undefined, category: categoryFilter || undefined, limit: 50 }
    }).then(r => r.data)
  })

  const { data: issuesData, isLoading: loadingIssues } = useQuery({
    queryKey: ['library-issues'],
    queryFn: () => api.get('/library/issues', { params: { limit: 50 } }).then(r => r.data.data),
    enabled: isAdmin
  })

  const { data: students } = useQuery({
    queryKey: ['students-list'],
    queryFn: () => api.get('/students', { params: { limit: 200 } }).then(r => r.data.data),
    enabled: !!showIssue
  })

  const addBookMutation = useMutation({
    mutationFn: (d: any) => api.post('/library/books', d),
    onSuccess: () => {
      toast({ title: 'Book added to library' })
      queryClient.invalidateQueries({ queryKey: ['library-books'] })
      setShowAddBook(false)
      setBookForm({ title: '', author: '', isbn: '', category: 'Quran', totalCopies: '1', description: '' })
    },
    onError: (e: any) => toast({ title: e.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const issueMutation = useMutation({
    mutationFn: ({ bookId, data }: { bookId: string; data: any }) => api.post(`/library/books/${bookId}/issue`, data),
    onSuccess: () => {
      toast({ title: 'Book issued successfully' })
      queryClient.invalidateQueries({ queryKey: ['library-books', 'library-issues'] })
      setShowIssue(null)
      setIssueForm({ studentId: '', dueDate: '' })
    },
    onError: (e: any) => toast({ title: e.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const returnMutation = useMutation({
    mutationFn: (issueId: string) => api.put(`/library/issues/${issueId}/return`),
    onSuccess: () => {
      toast({ title: 'Book returned' })
      queryClient.invalidateQueries({ queryKey: ['library-books', 'library-issues'] })
    }
  })

  const books = booksData?.data || []
  const summary = booksData?.summary || {}
  const issues = issuesData || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-halqa-700" /> Library
          </h1>
          <p className="text-gray-500 text-sm">Manage books and borrowing records</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowAddBook(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
            <Plus className="w-4 h-4" /> Add Book
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Books', value: summary.totalBooks || 0, color: 'bg-blue-50 text-blue-700' },
          { label: 'Available', value: summary.available || 0, color: 'bg-green-50 text-green-700' },
          { label: 'Issued', value: summary.issued || 0, color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Overdue', value: summary.overdue || 0, color: 'bg-red-50 text-red-700' },
        ].map(item => (
          <Card key={item.label} className="border-0 shadow-sm">
            <CardContent className={`p-4 ${item.color} rounded-xl`}>
              <p className="text-xs font-medium opacity-70">{item.label}</p>
              <p className="text-2xl font-bold mt-1">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="books">
        <TabsList>
          <TabsTrigger value="books">Books</TabsTrigger>
          {isAdmin && <TabsTrigger value="issues">Issued Books</TabsTrigger>}
        </TabsList>

        {/* Books tab */}
        <TabsContent value="books" className="space-y-4 mt-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Search by title, author, ISBN..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={categoryFilter || 'all'} onValueChange={v => setCategoryFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Add book form */}
          {showAddBook && (
            <Card className="border-0 shadow-sm border-l-4 border-l-halqa-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Add New Book</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Title *</Label>
                  <Input className="mt-1" placeholder="Book title" value={bookForm.title} onChange={e => setBookForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <Label>Author</Label>
                  <Input className="mt-1" placeholder="Author name" value={bookForm.author} onChange={e => setBookForm(f => ({ ...f, author: e.target.value }))} />
                </div>
                <div>
                  <Label>ISBN</Label>
                  <Input className="mt-1" placeholder="ISBN number" value={bookForm.isbn} onChange={e => setBookForm(f => ({ ...f, isbn: e.target.value }))} />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={bookForm.category} onValueChange={v => setBookForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Total Copies</Label>
                  <Input className="mt-1" type="number" min="1" value={bookForm.totalCopies} onChange={e => setBookForm(f => ({ ...f, totalCopies: e.target.value }))} />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input className="mt-1" placeholder="Brief description" value={bookForm.description} onChange={e => setBookForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="md:col-span-3 flex gap-2">
                  <Button onClick={() => addBookMutation.mutate(bookForm)} disabled={!bookForm.title || addBookMutation.isPending} className="bg-halqa-700 hover:bg-halqa-800">
                    {addBookMutation.isPending ? 'Adding...' : 'Add Book'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowAddBook(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Issue book modal */}
          {showIssue && (
            <Card className="border-0 shadow-sm border-l-4 border-l-blue-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Issue Book to Student</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Student *</Label>
                  <Select value={issueForm.studentId || 'none'} onValueChange={v => setIssueForm(f => ({ ...f, studentId: v === 'none' ? '' : v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select student" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select student</SelectItem>
                      {(students || []).map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.user?.firstName} {s.user?.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Due Date *</Label>
                  <Input className="mt-1" type="date" value={issueForm.dueDate} onChange={e => setIssueForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={() => issueMutation.mutate({ bookId: showIssue, data: issueForm })}
                    disabled={!issueForm.studentId || !issueForm.dueDate || issueMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700">
                    {issueMutation.isPending ? 'Issuing...' : 'Issue Book'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowIssue(null)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Books grid */}
          {loadingBooks ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
            </div>
          ) : booksError ? (
            <ErrorState onRetry={refetchBooks} />
          ) : books.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p>No books found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {books.map((book: any) => (
                <Card key={book.id} className="border-0 shadow-sm hover:shadow-md transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="w-10 h-10 bg-halqa-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <BookOpen className="w-5 h-5 text-halqa-700" />
                      </div>
                      <Badge className={`text-xs ${book.availableCopies > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {book.availableCopies > 0 ? `${book.availableCopies} available` : 'All issued'}
                      </Badge>
                    </div>
                    <h3 className="font-semibold text-gray-900 mt-2 line-clamp-1">{book.title}</h3>
                    {book.author && <p className="text-xs text-gray-500 mt-0.5">{book.author}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">{book.category}</Badge>
                      <span className="text-xs text-gray-400">{book.totalCopies} cop{book.totalCopies !== 1 ? 'ies' : 'y'}</span>
                    </div>
                    {isAdmin && book.availableCopies > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setShowIssue(book.id)}
                        className="mt-3 w-full text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50">
                        <User className="w-3 h-3" /> Issue to Student
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Issued books tab */}
        {isAdmin && (
          <TabsContent value="issues" className="mt-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                {loadingIssues ? (
                  <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
                ) : issues.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <CheckCircle className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p>No books currently issued</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Book</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Student</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Issued</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Due</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                          <th className="w-24 px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {issues.map((issue: any) => {
                          const isOverdue = issue.status === 'ISSUED' && new Date(issue.dueDate) < new Date()
                          return (
                            <tr key={issue.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{issue.book?.title}</td>
                              <td className="px-4 py-3">{issue.student?.user?.firstName} {issue.student?.user?.lastName}</td>
                              <td className="px-4 py-3 text-gray-500">{format(new Date(issue.issuedAt), 'MMM d, yyyy')}</td>
                              <td className="px-4 py-3">
                                <span className={isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}>
                                  {format(new Date(issue.dueDate), 'MMM d, yyyy')}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <Badge className={`text-xs ${isOverdue ? 'bg-red-100 text-red-700' : issue.status === 'RETURNED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                  {isOverdue ? 'OVERDUE' : issue.status}
                                </Badge>
                              </td>
                              <td className="px-4 py-3">
                                {issue.status === 'ISSUED' && (
                                  <Button size="sm" variant="outline" onClick={() => returnMutation.mutate(issue.id)}
                                    disabled={returnMutation.isPending}
                                    className="text-xs gap-1 text-green-600 border-green-200 hover:bg-green-50">
                                    <RotateCcw className="w-3 h-3" /> Return
                                  </Button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
