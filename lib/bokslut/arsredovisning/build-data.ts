import type { SupabaseClient } from '@supabase/supabase-js'
import { generateIncomeStatement } from '@/lib/reports/income-statement'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet'
import { generateTrialBalance } from '@/lib/reports/trial-balance'
import { listAssets } from '@/lib/bokslut/assets/asset-service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import type {
  ArsredovisningData,
  EgenKapitalRow,
  FlerarsoversiktRow,
  IncomeStatementLine,
  BalanceSheetLine,
  NoteEntry,
} from './types'
import type { BalanceSheetSection, IncomeStatementSection } from '@/types'

/**
 * Pre-populate the K2 årsredovisning data for a fiscal period. Loads:
 *   - Income statement + balance sheet for the current period
 *   - Up to 3 prior periods for the flerårsöversikt
 *   - Asset register so noter can list avskrivningstider per category
 *   - Active employees count for medelantal anställda
 *   - Equity-account movements for förändring av eget kapital
 *
 * Manually-authored fields (description, important_events,
 * resultatdisposition, ställda säkerheter, eventualförpliktelser) are
 * pre-filled with sensible boilerplate the user can replace. The narrative
 * editor in the UI persists overrides via /api/.../arsredovisning POST.
 */
export async function buildArsredovisningData(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string,
  overrides: Partial<ArsredovisningData['forvaltningsberattelse']> = {},
): Promise<ArsredovisningData> {
  const [periodResult, settingsResult, periodList, incomeStatement, balanceSheet] = await Promise.all([
    supabase
      .from('fiscal_periods')
      .select('id, name, period_start, period_end, previous_period_id, closing_entry_id')
      .eq('id', fiscalPeriodId)
      .eq('company_id', companyId)
      .single(),
    supabase
      .from('company_settings')
      .select('company_name, org_number, address')
      .eq('company_id', companyId)
      .maybeSingle(),
    fetchAllRows(({ from, to }) =>
      supabase
        .from('fiscal_periods')
        .select('id, name, period_start, period_end')
        .eq('company_id', companyId)
        .order('period_start', { ascending: false })
        .range(from, to),
    ),
    generateIncomeStatement(supabase, companyId, fiscalPeriodId),
    generateBalanceSheet(supabase, companyId, fiscalPeriodId),
  ])

  if (periodResult.error || !periodResult.data) {
    throw new Error('Fiscal period not found')
  }
  const period = periodResult.data
  const settings = settingsResult.data
  const companyName = settings?.company_name ?? 'Bolaget'
  const orgNumber = settings?.org_number ?? ''

  type AddressShape = { city?: string | null; postal_city?: string | null } | null
  const addressUnknown = (settings as { address?: AddressShape } | null)?.address ?? null
  const sate =
    (addressUnknown && (addressUnknown.city ?? addressUnknown.postal_city)) || null

  const flerarsoversikt = await buildFlerarsoversikt(
    supabase,
    companyId,
    fiscalPeriodId,
    (periodList ?? []) as Array<{ id: string; name: string; period_start: string; period_end: string }>,
  )

  const egen_kapital_changes = buildEquityChanges(balanceSheet.equity_liability_sections)

  const noter = await buildK2Noter(supabase, companyId)

  const resultatrakning = flattenIncomeStatement(incomeStatement)
  const balansrakning = flattenBalanceSheet(balanceSheet)

  return {
    company: {
      name: companyName,
      org_number: orgNumber,
      sate,
    },
    fiscal_period: {
      id: period.id,
      name: period.name,
      period_start: period.period_start,
      period_end: period.period_end,
    },
    forvaltningsberattelse: {
      description:
        overrides.description ??
        `${companyName} bedriver verksamhet enligt verksamhetsbeskrivningen i bolagsordningen.`,
      important_events:
        overrides.important_events ??
        'Inga väsentliga händelser utöver löpande verksamhet har inträffat under räkenskapsåret.',
      kontrollbalans_required: overrides.kontrollbalans_required ?? false,
      flerarsoversikt,
      egen_kapital_changes,
      resultatdisposition:
        overrides.resultatdisposition ??
        'Styrelsen föreslår att årets resultat balanseras i ny räkning.',
    },
    resultatrakning,
    balansrakning,
    noter,
    signatures: [], // populated by signature-flow service in a later phase step
  }
}

interface PeriodRow {
  id: string
  name: string
  period_start: string
  period_end: string
}

async function buildFlerarsoversikt(
  supabase: SupabaseClient,
  companyId: string,
  currentPeriodId: string,
  allPeriods: PeriodRow[],
): Promise<FlerarsoversiktRow[]> {
  // Take the current period + 3 prior (oldest first).
  const sorted = [...allPeriods].sort((a, b) => a.period_start.localeCompare(b.period_start))
  const currentIdx = sorted.findIndex((p) => p.id === currentPeriodId)
  if (currentIdx === -1) return []
  const slice = sorted.slice(Math.max(0, currentIdx - 3), currentIdx + 1)

  const rows: FlerarsoversiktRow[] = []
  for (const p of slice) {
    try {
      const [is, tb] = await Promise.all([
        generateIncomeStatement(supabase, companyId, p.id),
        generateTrialBalance(supabase, companyId, p.id),
      ])
      // Nettoomsättning = sum of revenue sections (revenue is normally credit).
      const netRevenue = is.total_revenue
      const resultAfterFinancial = is.total_revenue - is.total_expenses + is.total_financial
      const totalAssets = tb.rows
        .filter((r) => r.account_class === 1)
        .reduce((s, r) => s + (r.closing_debit - r.closing_credit), 0)
      const eqLiab = tb.rows
        .filter((r) => r.account_class === 2)
        .reduce((s, r) => s + (r.closing_credit - r.closing_debit), 0)
      // Soliditet: eget kapital uses 20xx ONLY. 21xx (periodiseringsfonder,
      // överavskrivningar) are obeskattade reserver — partially deferred tax,
      // not equity. K2 / ÅRL splits them out. Including 21xx here would
      // inflate soliditet for any AB that posts dispositions.
      const equity = tb.rows
        .filter((r) => r.account_number.startsWith('20'))
        .reduce((s, r) => s + (r.closing_credit - r.closing_debit), 0)
      const soliditet =
        totalAssets > 0 ? Math.round((equity / totalAssets) * 1000) / 10 : null
      // Avoid the unused-variable warning while leaving eqLiab computed for
      // future "Skulder" column expansion.
      void eqLiab
      rows.push({
        year: p.name,
        net_revenue: Math.round(netRevenue),
        result_after_financial: Math.round(resultAfterFinancial),
        soliditet_pct: soliditet,
      })
    } catch {
      // Prior periods may lack continuity if SIE import was partial. Skip
      // rather than blocking the whole årsredovisning.
      rows.push({
        year: p.name,
        net_revenue: 0,
        result_after_financial: 0,
        soliditet_pct: null,
      })
    }
  }
  return rows
}

function buildEquityChanges(sections: BalanceSheetSection[]): EgenKapitalRow[] {
  const equity: EgenKapitalRow[] = []
  for (const section of sections) {
    for (const row of section.rows) {
      if (
        row.account_number.startsWith('20') ||
        row.account_number.startsWith('21')
      ) {
        equity.push({
          label: `${row.account_number} ${row.account_name}`,
          amount: row.amount,
        })
      }
    }
  }
  return equity
}

async function buildK2Noter(
  supabase: SupabaseClient,
  companyId: string,
): Promise<NoteEntry[]> {
  const notes: NoteEntry[] = []
  notes.push({
    number: 1,
    title: 'Redovisnings- och värderingsprinciper',
    body:
      'Årsredovisningen är upprättad i enlighet med Årsredovisningslagen och Bokföringsnämndens allmänna råd BFNAR 2016:10 Årsredovisning i mindre företag (K2).',
  })

  // Avskrivningstider — derive from asset register
  const assets = await listAssets(supabase, companyId)
  if (assets.length > 0) {
    const byCategory = new Map<string, Set<number>>()
    for (const a of assets) {
      if (a.disposed_at) continue
      const years = Math.round(a.useful_life_months / 12)
      if (!byCategory.has(a.category)) byCategory.set(a.category, new Set())
      byCategory.get(a.category)!.add(years)
    }
    if (byCategory.size > 0) {
      const lines: string[] = ['Avskrivningar görs linjärt över bedömd nyttjandeperiod:']
      const categoryLabels: Record<string, string> = {
        immaterial: 'Immateriella anläggningstillgångar',
        building: 'Byggnader',
        land_improvement: 'Markanläggningar',
        machinery: 'Maskiner',
        equipment: 'Inventarier',
        vehicle: 'Fordon',
        computer: 'Datorer',
        other_tangible: 'Övriga materiella anläggningstillgångar',
      }
      for (const [cat, yearsSet] of byCategory.entries()) {
        const yrs = Array.from(yearsSet).sort((a, b) => a - b)
        const yrsLabel = yrs.length === 1 ? `${yrs[0]} år` : `${yrs[0]}–${yrs[yrs.length - 1]} år`
        lines.push(`• ${categoryLabels[cat] ?? cat}: ${yrsLabel}`)
      }
      notes.push({
        number: 2,
        title: 'Avskrivningar',
        body: lines.join('\n'),
      })
    }
  }

  // Medelantal anställda — count active employees as a proxy
  const { count: employeeCount } = await supabase
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_active', true)
  if ((employeeCount ?? 0) > 0) {
    notes.push({
      number: notes.length + 1,
      title: 'Medelantal anställda',
      body: `Under räkenskapsåret har medeltalet anställda uppgått till ${employeeCount}.`,
    })
  }

  notes.push({
    number: notes.length + 1,
    title: 'Ställda säkerheter och eventualförpliktelser',
    body: 'Inga.',
  })

  return notes
}

function flattenIncomeStatement(is: {
  revenue_sections: IncomeStatementSection[]
  total_revenue: number
  expense_sections: IncomeStatementSection[]
  total_expenses: number
  financial_sections: IncomeStatementSection[]
  total_financial: number
  net_result: number
}): IncomeStatementLine[] {
  const lines: IncomeStatementLine[] = []
  for (const s of is.revenue_sections) {
    for (const r of s.rows) {
      lines.push({ label: `${r.account_number} ${r.account_name}`, amount: r.amount })
    }
  }
  lines.push({ label: 'Summa rörelseintäkter', amount: is.total_revenue, is_total: true })
  for (const s of is.expense_sections) {
    for (const r of s.rows) {
      lines.push({ label: `${r.account_number} ${r.account_name}`, amount: -r.amount })
    }
  }
  lines.push({
    label: 'Rörelseresultat',
    amount: is.total_revenue - is.total_expenses,
    is_total: true,
  })

  // Split financial sections so the RR follows the K2 / ÅRL 3:2 structure:
  // financial items (80–87) → "Resultat efter finansiella poster" →
  // bokslutsdispositioner (88) → "Resultat före skatt" → skatt (89) →
  // "Årets resultat". Without the dispositioner + skatt rows the document
  // is non-compliant for any AB that posted bolagsskatt or
  // periodiseringsfond, and the RR doesn't reconcile to BS 2099.
  const finItems = is.financial_sections.filter(
    (s) => !/bokslutsdisposition|skatter och årets resultat/i.test(s.title),
  )
  const dispositionsSections = is.financial_sections.filter((s) =>
    /bokslutsdisposition/i.test(s.title),
  )
  const skattSections = is.financial_sections.filter((s) =>
    /skatter och årets resultat/i.test(s.title),
  )
  for (const s of finItems) {
    for (const r of s.rows) {
      lines.push({ label: `${r.account_number} ${r.account_name}`, amount: r.amount })
    }
  }
  const finSubtotal = finItems.reduce((sum, s) => sum + s.subtotal, 0)
  const resAfterFinancial = is.total_revenue - is.total_expenses + finSubtotal
  lines.push({
    label: 'Resultat efter finansiella poster',
    amount: Math.round(resAfterFinancial * 100) / 100,
    is_total: true,
  })

  if (dispositionsSections.length > 0) {
    for (const s of dispositionsSections) {
      for (const r of s.rows) {
        lines.push({ label: `${r.account_number} ${r.account_name}`, amount: r.amount })
      }
    }
    const dispositionsSubtotal = dispositionsSections.reduce((sum, s) => sum + s.subtotal, 0)
    lines.push({
      label: 'Resultat före skatt',
      amount: Math.round((resAfterFinancial + dispositionsSubtotal) * 100) / 100,
      is_total: true,
    })
  } else {
    // No dispositioner posted — keep the simpler "Resultat före skatt" row
    // immediately after the finansnetto totals so the RR still has the
    // pre-tax subtotal expected by ÅRL.
    lines.push({
      label: 'Resultat före skatt',
      amount: Math.round(resAfterFinancial * 100) / 100,
      is_total: true,
    })
  }

  if (skattSections.length > 0) {
    for (const s of skattSections) {
      for (const r of s.rows) {
        lines.push({ label: `${r.account_number} ${r.account_name}`, amount: r.amount })
      }
    }
  }

  lines.push({ label: 'Årets resultat', amount: is.net_result, is_total: true })
  return lines
}

function flattenBalanceSheet(bs: {
  asset_sections: BalanceSheetSection[]
  total_assets: number
  equity_liability_sections: BalanceSheetSection[]
  total_equity_liabilities: number
}): {
  assets: BalanceSheetLine[]
  total_assets: number
  equity_liabilities: BalanceSheetLine[]
  total_equity_liabilities: number
} {
  const assetLines: BalanceSheetLine[] = []
  for (const s of bs.asset_sections) {
    assetLines.push({ label: s.title, amount: s.subtotal, is_total: true, indent: 0 })
    for (const r of s.rows) {
      assetLines.push({
        label: `${r.account_number} ${r.account_name}`,
        amount: r.amount,
        indent: 1,
      })
    }
  }
  const eqLines: BalanceSheetLine[] = []
  for (const s of bs.equity_liability_sections) {
    eqLines.push({ label: s.title, amount: s.subtotal, is_total: true, indent: 0 })
    for (const r of s.rows) {
      eqLines.push({
        label: `${r.account_number} ${r.account_name}`,
        amount: r.amount,
        indent: 1,
      })
    }
  }
  return {
    assets: assetLines,
    total_assets: bs.total_assets,
    equity_liabilities: eqLines,
    total_equity_liabilities: bs.total_equity_liabilities,
  }
}
