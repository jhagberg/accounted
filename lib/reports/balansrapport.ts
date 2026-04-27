import type { SupabaseClient } from '@supabase/supabase-js'
import { generateTrialBalance } from './trial-balance'
import type {
  BalansrapportReport,
  BalansrapportRow,
  BalansrapportGroup,
} from '@/types'

const CLASS_LABELS: Record<number, string> = {
  1: '1 Tillgångar',
  2: '2 Eget kapital, obeskattade reserver, avsättningar och skulder',
}

/**
 * Balansrapport — operational balance report.
 *
 * Lists every account in classes 1–2 with IB, period change, and UB.
 * Unlike Balansräkning (formal, ÅRL Bilaga 1), this keeps account numbers
 * and is meant for ongoing reconciliation, not for årsbokslut/årsredovisning.
 *
 * Sign convention: assets (class 1) shown debit-positive (debit - credit),
 * equity & liabilities (class 2) shown credit-positive (credit - debit).
 * That's the normal balance for each side and matches how Fortnox/Visma
 * present a Balansrapport.
 */
export async function generateBalansrapport(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string
): Promise<BalansrapportReport> {
  const { data: period } = await supabase
    .from('fiscal_periods')
    .select('period_start, period_end')
    .eq('id', fiscalPeriodId)
    .eq('company_id', companyId)
    .single()

  if (!period) {
    throw new Error('Fiscal period not found')
  }

  const trialBalance = await generateTrialBalance(supabase, companyId, fiscalPeriodId)
  const balanceRows = trialBalance.rows.filter((r) => r.account_class === 1 || r.account_class === 2)

  const groups: BalansrapportGroup[] = []
  for (const klass of [1, 2] as const) {
    const groupRows = balanceRows
      .filter((r) => r.account_class === klass)
      .sort((a, b) => a.account_number.localeCompare(b.account_number))

    const rows: BalansrapportRow[] = []
    let subtotalIb = 0
    let subtotalUb = 0
    for (const r of groupRows) {
      const ib = signedAmount(r.opening_debit, r.opening_credit, klass)
      const ub = signedAmount(r.closing_debit, r.closing_credit, klass)
      const change = round2(ub - ib)
      if (Math.abs(ib) < 0.005 && Math.abs(ub) < 0.005) continue
      rows.push({
        account_number: r.account_number,
        account_name: r.account_name,
        ib: round2(ib),
        ub: round2(ub),
        period_change: change,
      })
      subtotalIb += ib
      subtotalUb += ub
    }

    if (rows.length === 0) continue

    groups.push({
      class: klass,
      class_label: CLASS_LABELS[klass],
      rows,
      subtotal_ib: round2(subtotalIb),
      subtotal_ub: round2(subtotalUb),
    })
  }

  const totalAssetsUb = groups.find((g) => g.class === 1)?.subtotal_ub ?? 0
  const totalEquityLiabilitiesUb = groups.find((g) => g.class === 2)?.subtotal_ub ?? 0

  // Beräknat resultat (Fortnox/Visma convention): the residual on the balance
  // side. During a running year, current-year profit lives in P&L accounts
  // and 2099 still holds the prior year's accumulated result, so the residual
  // equals current-year P&L net result. After year-end closing posts result
  // into 2099, residual is 0 and total_assets == total_eq_liab.
  const beraknatResultat = round2(totalAssetsUb - totalEquityLiabilitiesUb)

  return {
    groups,
    total_assets_ub: totalAssetsUb,
    total_equity_liabilities_ub: totalEquityLiabilitiesUb,
    beraknat_resultat: beraknatResultat,
    is_balanced: trialBalance.isBalanced,
    period: { start: period.period_start, end: period.period_end },
  }
}

function signedAmount(debit: number, credit: number, klass: number): number {
  return klass === 1 ? debit - credit : credit - debit
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
