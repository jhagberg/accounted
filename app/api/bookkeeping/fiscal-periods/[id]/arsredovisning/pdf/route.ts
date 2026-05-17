import { renderToBuffer } from '@react-pdf/renderer'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse, errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { buildArsredovisningData } from '@/lib/bokslut/arsredovisning/build-data'
import { ArsredovisningPDF } from '@/lib/bokslut/arsredovisning/arsredovisning-pdf'

export const GET = withRouteContext(
  'period.arsredovisning_pdf',
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, log, requestId } = ctx
    try {
      // Accept the editable narrative fields as query params so the
      // /bookkeeping/year-end/arsredovisning page's edits actually reach the
      // PDF. Persisting overrides to a table is a deferred enhancement;
      // for now the URL is the carrier so the "download" button reflects
      // whatever the user just typed. Length-capped to keep the URL from
      // ballooning past CDN / browser limits.
      const url = new URL(request.url)
      const cap = (s: string | null, n: number) => (s ? s.slice(0, n) : undefined)
      const overrides = {
        description: cap(url.searchParams.get('description'), 4_000),
        important_events: cap(url.searchParams.get('events'), 4_000),
        resultatdisposition: cap(url.searchParams.get('disposition'), 2_000),
      }
      const data = await buildArsredovisningData(supabase, companyId, id, overrides)
      const pdfBuffer = await renderToBuffer(ArsredovisningPDF({ data }))
      // "-utkast" suffix mirrors the existing PDF routes; the file becomes
      // "fastställd" only after the signature flow records all signatures.
      // Sanitize the dynamic segment so a stray quote / newline in the date
      // (defensive — unlikely to ever happen) can't break the header.
      const safePeriodEnd = data.fiscal_period.period_end.replace(/[^\w.-]/g, '_')
      const filename = `arsredovisning-${safePeriodEnd}-utkast.pdf`
      return new Response(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${filename}"`,
          // ÅR contains company financials + officer names — don't let any
          // intermediary cache the document.
          'Cache-Control': 'private, no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/not found/i.test(message)) {
        return errorResponseFromCode('PERIOD_NOT_FOUND', log, { requestId })
      }
      return errorResponse(err, log, { requestId })
    }
  },
)
