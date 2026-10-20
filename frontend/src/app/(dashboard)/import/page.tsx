'use client'

import { useState, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { downloadFile, buildFilename } from '@/lib/download'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/ui/use-toast'
import {
  Upload, Download, FileSpreadsheet, CheckCircle,
  XCircle, AlertCircle, Loader2, Users, UserCheck,
  BookOpen, GraduationCap, BarChart3, ClipboardCheck
} from 'lucide-react'

export default function ImportPage() {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [importType, setImportType] = useState<'students' | 'teachers' | 'guardians' | 'classes'>('students')
  const [exportClassId, setExportClassId] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data)
  })

  // Import mutation
  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/import/${importType}`, form)
    },
    onSuccess: (res) => {
      setResult(res.data.data)
      toast({ title: res.data.message })
    },
    onError: (err: any) => {
      toast({ title: err.response?.data?.message || 'Import failed', variant: 'destructive' })
    }
  })

  const handleFile = (file: File) => {
    if (!file) return
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ]
    if (!allowed.includes(file.type)) {
      toast({ title: 'Only Excel (.xlsx) or CSV files are allowed', variant: 'destructive' })
      return
    }
    setResult(null)
    importMutation.mutate(file)
  }

  // Authenticated export
  const handleExport = async (type: string, params: Record<string, string> = {}) => {
    setDownloading(type)
    try {
      await downloadFile(`/import/${type}/export`, params, buildFilename(type, 'xlsx'))
      toast({ title: `${type} exported successfully` })
    } catch {
      toast({ title: 'Export failed — make sure you are logged in', variant: 'destructive' })
    } finally {
      setDownloading(null)
    }
  }

  // Authenticated template download
  const handleTemplate = async (type: string) => {
    setDownloading(`template-${type}`)
    try {
      await downloadFile(`/import/template/${type}`, {}, `${type}-import-template.xlsx`)
      toast({ title: `${type} template downloaded` })
    } catch {
      toast({ title: 'Download failed', variant: 'destructive' })
    } finally {
      setDownloading(null)
    }
  }

  const exportCards = [
    {
      key: 'students',
      label: 'Export Students',
      desc: 'All students with enrollment info',
      icon: GraduationCap,
      color: 'text-blue-600',
      params: exportClassId ? { classId: exportClassId } : {} as Record<string, string>
    },
    {
      key: 'teachers',
      label: 'Export Teachers',
      desc: 'All teachers with class assignments',
      icon: UserCheck,
      color: 'text-green-600',
      params: {} as Record<string, string>
    },
    {
      key: 'attendance',
      label: 'Export Attendance',
      desc: 'Attendance records for all classes',
      icon: ClipboardCheck,
      color: 'text-orange-600',
      params: exportClassId ? { classId: exportClassId } : {} as Record<string, string>
    },
    {
      key: 'grades',
      label: 'Export Grades',
      desc: 'All grade records',
      icon: BarChart3,
      color: 'text-purple-600',
      params: exportClassId ? { classId: exportClassId } : {} as Record<string, string>
    },
    {
      key: 'behavior',
      label: 'Export Behavior',
      desc: 'Behavior logs and points',
      icon: Users,
      color: 'text-pink-600',
      params: {} as Record<string, string>
    }
  ]

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import / Export</h1>
        <p className="text-gray-500 text-sm">Bulk import data and export reports to Excel</p>
      </div>

      {/* ── EXPORT SECTION ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Download className="w-4 h-4 text-halqa-700" /> Export Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Optional class filter */}
          <div className="flex items-center gap-3">
            <Label className="text-sm text-gray-600 whitespace-nowrap">Filter by class:</Label>
            <Select value={exportClassId || 'all'} onValueChange={v => setExportClassId(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-48 h-9">
                <SelectValue placeholder="All classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {(classes || []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {exportCards.map(card => {
              const Icon = card.icon
              const isLoading = downloading === card.key
              return (
                <button
                  key={card.key}
                  onClick={() => handleExport(card.key, card.params)}
                  disabled={!!downloading}
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-halqa-300 hover:bg-halqa-50 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className={`p-2 rounded-lg bg-gray-100 ${card.color}`}>
                    {isLoading
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <Icon className="w-5 h-5" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{card.label}</p>
                    <p className="text-xs text-gray-500">{card.desc}</p>
                  </div>
                  <FileSpreadsheet className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── TEMPLATES ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-halqa-700" /> Import Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-3">
            Download a template, fill it in, then upload below.
          </p>
          <div className="flex flex-wrap gap-2">
            {(['students', 'teachers', 'guardians', 'classes'] as const).map(type => (
              <Button
                key={type}
                variant="outline"
                size="sm"
                className="gap-2 capitalize"
                disabled={downloading === `template-${type}`}
                onClick={() => handleTemplate(type)}
              >
                {downloading === `template-${type}`
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Download className="w-4 h-4" />
                }
                {type.charAt(0).toUpperCase() + type.slice(1)} Template
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── IMPORT SECTION ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Upload className="w-4 h-4 text-halqa-700" /> Import Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Import type selector */}
          <div className="flex gap-2 flex-wrap">
            {([
              { id: 'students',  label: '👨‍🎓 Students'  },
              { id: 'teachers',  label: '👨‍🏫 Teachers'  },
              { id: 'guardians', label: '👪 Guardians' },
              { id: 'classes',   label: '📚 Classes'   },
            ] as const).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => { setImportType(id); setResult(null) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  importType === id
                    ? 'bg-halqa-700 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Info box */}
          <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
            <p className="font-semibold mb-1">
              {{
                students:  'Student Import',
                teachers:  'Teacher Import',
                guardians: 'Guardian Import',
                classes:   'Classes Import',
              }[importType]} — Required columns:
            </p>
            <p className="font-mono text-xs bg-blue-100 rounded px-2 py-1 inline-block">
              {{
                students:  'firstName, lastName, email, studentId',
                teachers:  'firstName, lastName, email',
                guardians: 'firstName, lastName, email',
                classes:   'name, gradeLevel',
              }[importType]}
            </p>
            <p className="mt-2 text-xs">
              Optional: {{
                students:  'phone, dateOfBirth, gender, classId',
                teachers:  'phone, department, specialization, employeeId',
                guardians: 'phone, relationship, studentEmail',
                classes:   'room, academicYear, capacity, description',
              }[importType]}
            </p>
            {importType !== 'classes' && (
              <p className="mt-1 text-xs">
                Max <strong>500 rows</strong> per import. Users receive a secure temporary password via email.
              </p>
            )}
            {importType === 'classes' && (
              <p className="mt-1 text-xs">Max <strong>200 rows</strong> per import.</p>
            )}
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files[0]
              if (file) handleFile(file)
            }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              dragOver
                ? 'border-halqa-500 bg-halqa-50'
                : 'border-gray-300 hover:border-halqa-400 hover:bg-gray-50'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            {importMutation.isPending ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-halqa-500 animate-spin" />
                <p className="text-sm font-medium text-gray-600">Processing file...</p>
                <p className="text-xs text-gray-400">This may take a moment for large files</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
                  <FileSpreadsheet className="w-7 h-7 text-gray-400" />
                </div>
                <p className="text-sm font-semibold text-gray-700">
                  Drop your Excel or CSV file here
                </p>
                <p className="text-xs text-gray-400">or click to browse files</p>
                <Badge variant="outline" className="text-xs mt-1">.xlsx · .xls · .csv</Badge>
              </div>
            )}
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-3 animate-fade-in">
              <Separator />
              <p className="text-sm font-semibold text-gray-700">Import Results</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
                  <CheckCircle className="w-6 h-6 text-green-500 mx-auto mb-1" />
                  <p className="text-3xl font-bold text-green-700">{result.created}</p>
                  <p className="text-xs text-green-600 font-medium">Created</p>
                </div>
                <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-4 text-center">
                  <AlertCircle className="w-6 h-6 text-yellow-500 mx-auto mb-1" />
                  <p className="text-3xl font-bold text-yellow-700">{result.skipped}</p>
                  <p className="text-xs text-yellow-600 font-medium">Skipped</p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-center">
                  <FileSpreadsheet className="w-6 h-6 text-gray-500 mx-auto mb-1" />
                  <p className="text-3xl font-bold text-gray-700">{result.created + result.skipped}</p>
                  <p className="text-xs text-gray-600 font-medium">Total Rows</p>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                  <p className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" /> {result.errors.length} row(s) had errors
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {result.errors.map((err: string, i: number) => (
                      <p key={i} className="text-xs text-red-600 font-mono bg-red-100 rounded px-2 py-1">
                        {err}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {result.created > 0 && (
                <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <p className="text-sm text-green-700">
                    <strong>{result.created}</strong> {importType} imported successfully.
                    {importType !== 'classes' && <> Temporary passwords have been emailed to each user.</>}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
