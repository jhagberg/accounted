'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Download, Loader2, CheckCircle2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { getErrorMessage } from '@/lib/errors/get-error-message'

type PaymentFormat = 'bg_lb' | 'pain001'

interface PaymentFilePanelProps {
  salaryRunId: string
  periodLabel: string
  paymentFileFormat: string | null
  paymentFileGeneratedAt: string | null
  defaultFormat: PaymentFormat
  readOnly?: boolean
  onDownloaded?: () => void
}

const FORMAT_LABEL: Record<PaymentFormat, string> = {
  bg_lb: 'Bankgirot LB-fil',
  pain001: 'SEPA pain.001 (XML)',
}

const FORMAT_DESCRIPTION: Record<PaymentFormat, string> = {
  bg_lb: 'Standard för Swedbank, SEB, Handelsbanken, Nordea m.fl. Kräver bankgironummer hos Bankgirot.',
  pain001: 'ISO 20022. För banker som inte är anslutna till Bankgirot, eller internationell SEPA.',
}

export function PaymentFilePanel({
  salaryRunId,
  periodLabel,
  paymentFileFormat,
  paymentFileGeneratedAt,
  defaultFormat,
  readOnly,
  onDownloaded,
}: PaymentFilePanelProps) {
  const { toast } = useToast()
  const [format, setFormat] = useState<PaymentFormat>(defaultFormat)
  const [downloading, setDownloading] = useState(false)

  const endpoint =
    format === 'bg_lb'
      ? `/api/salary/runs/${salaryRunId}/payment/bg-lb`
      : `/api/salary/runs/${salaryRunId}/payment/pain001`

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch(endpoint)
      if (!res.ok) {
        const result = await res.json().catch(() => ({ error: 'Kunde inte generera betalfil' }))
        toast({
          title: 'Betalfil kunde inte genereras',
          description: getErrorMessage(result, { context: 'salary', statusCode: res.status }),
          variant: 'destructive',
        })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = format === 'bg_lb' ? 'txt' : 'xml'
      a.download = `lon_${periodLabel}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({ title: 'Betalfil nedladdad' })
      onDownloaded?.()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Betalfil till bank</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {paymentFileFormat && paymentFileGeneratedAt && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <div>
              Senast genererad:{' '}
              <span className="text-foreground">
                {FORMAT_LABEL[paymentFileFormat as PaymentFormat] ?? paymentFileFormat}
              </span>{' '}
              ({new Date(paymentFileGeneratedAt).toLocaleString('sv-SE')})
            </div>
          </div>
        )}

        {!readOnly && (
          <>
            <div className="space-y-1">
              <label className="text-sm font-medium">Format</label>
              <Select value={format} onValueChange={(v) => setFormat(v as PaymentFormat)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bg_lb">{FORMAT_LABEL.bg_lb}</SelectItem>
                  <SelectItem value="pain001">{FORMAT_LABEL.pain001}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{FORMAT_DESCRIPTION[format]}</p>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleDownload} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Ladda ner betalfil
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
