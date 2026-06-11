import type { SupabaseClient } from '@supabase/supabase-js'
import { createLogger } from '@/lib/logger'

const log = createLogger('cancel-orphaned-entry')

/**
 * Compensation for the payment-flow CAS guard: a payment voucher was posted,
 * but the invoice row was settled by a concurrent request between our read
 * and write, so the voucher belongs to no payment. Cancel it and document
 * the voucher-number gap (BFNAR 2013:2 requires gaps to be explained).
 *
 * Mirrors the inline compensation the mark-paid route has always had; the
 * match routes previously returned MATCH_SI_NOT_OPEN and left the voucher
 * orphaned in the ledger.
 *
 * Best-effort by design: the CAS conflict response is already correct for
 * the caller, so failures here are logged loudly rather than thrown.
 */
export async function cancelOrphanedPaymentEntry(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  journalEntryId: string,
  explanation: string,
): Promise<void> {
  try {
    const { data: orphan, error: fetchError } = await supabase
      .from('journal_entries')
      .select('fiscal_period_id, voucher_series, voucher_number')
      .eq('id', journalEntryId)
      .eq('company_id', companyId)
      .single()

    if (fetchError) {
      log.error('failed to load orphaned payment voucher for cancellation', fetchError, {
        companyId,
        journalEntryId,
      })
    }

    // Recovery breadcrumb BEFORE mutating: the cancel and the gap insert are
    // separate statements, so a crash between them would leave a cancelled
    // voucher with no gap explanation (BFNAR 2013:2 requires one). This line
    // carries everything an operator needs to write it manually.
    if (orphan) {
      log.info('cancelling orphaned payment voucher', {
        companyId,
        journalEntryId,
        voucherSeries: orphan.voucher_series || 'A',
        voucherNumber: orphan.voucher_number,
        fiscalPeriodId: orphan.fiscal_period_id,
        explanation,
      })
    }

    const { error: cancelError } = await supabase
      .from('journal_entries')
      .update({ status: 'cancelled' })
      .eq('id', journalEntryId)
      .eq('company_id', companyId)

    if (cancelError) {
      log.error('failed to cancel orphaned payment voucher (manual cleanup needed)', cancelError, {
        companyId,
        journalEntryId,
      })
      return
    }

    if (orphan) {
      const { error: gapError } = await supabase.from('voucher_gap_explanations').insert({
        company_id: companyId,
        fiscal_period_id: orphan.fiscal_period_id,
        voucher_series: orphan.voucher_series || 'A',
        gap_number: orphan.voucher_number,
        explanation,
        created_by: userId,
      })
      if (gapError) {
        log.error('failed to record voucher gap explanation for cancelled orphan', gapError, {
          companyId,
          journalEntryId,
          voucherNumber: orphan.voucher_number,
        })
      }
    }
  } catch (err) {
    // Hard never-throw guarantee: the caller is about to return the correct
    // CAS-conflict response, and an unexpected rejection here (network blip,
    // driver error) must not replace it with a 500. The orphan stays posted
    // and visible; the breadcrumb above covers manual recovery.
    log.error('unexpected failure while cancelling orphaned payment voucher', err as Error, {
      companyId,
      journalEntryId,
    })
  }
}
