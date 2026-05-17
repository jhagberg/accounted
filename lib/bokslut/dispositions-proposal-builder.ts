import type { SupabaseClient } from '@supabase/supabase-js'
import { generateIncomeStatement } from '@/lib/reports/income-statement'
import { calculateBolagsskatt } from './tax-provision/bolagsskatt-calculator'
import { calculateSarskildLoneskatt } from './tax-provision/sarskild-loneskatt-calculator'
import {
  listExistingPeriodiseringsfonder,
  proposeAvsattning,
  proposeAteforing,
} from './reserves/periodiseringsfond-service'
import type { DispositionsProposal, ProposedDisposition } from './types'

const DEFAULT_SCHABLONINTAKT_RATE = 0.0355

/**
 * Shared core of the GET /bokslutsdispositioner endpoint, lifted out so the
 * MCP tool can call the same builder without duplicating the proposal logic.
 * The API route and the MCP tool both hand its output to the caller, who
 * picks which proposals to commit via the POST endpoint.
 */
export async function buildDispositionsProposal(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string,
): Promise<DispositionsProposal> {
  const { data: period, error: periodError } = await supabase
    .from('fiscal_periods')
    .select('id, name, period_start, period_end')
    .eq('id', fiscalPeriodId)
    .eq('company_id', companyId)
    .single()
  if (periodError || !period) {
    throw new Error('Fiscal period not found')
  }

  const { data: settings } = await supabase
    .from('company_settings')
    .select('entity_type')
    .eq('company_id', companyId)
    .maybeSingle()
  const entityType = (settings?.entity_type ?? 'aktiebolag') as DispositionsProposal['entityType']

  if (entityType !== 'aktiebolag') {
    const incomeStatement = await generateIncomeStatement(supabase, companyId, fiscalPeriodId)
    return {
      entityType,
      fiscalPeriod: period,
      netResultBefore: incomeStatement.net_result,
      proposals: [],
    }
  }

  const fiscalYear = parseInt(period.period_end.slice(0, 4), 10)
  const incomeStatement = await generateIncomeStatement(supabase, companyId, fiscalPeriodId)
  const resultBeforeTax = incomeStatement.net_result

  const proposals: ProposedDisposition[] = []

  const existingFonder = await listExistingPeriodiseringsfonder(supabase, companyId, period.period_end)
  const ateforing = proposeAteforing(existingFonder, {
    schablonintaktRate: DEFAULT_SCHABLONINTAKT_RATE,
  })
  proposals.push(...ateforing.proposals)

  const taxableBeforeAvsattning =
    resultBeforeTax +
    ateforing.proposals.reduce((sum, p) => sum + p.amount, 0) +
    ateforing.schablonintaktAmount
  const avsattning = proposeAvsattning({
    skattemassigtResultatBeforeAvsattning: taxableBeforeAvsattning,
    fiscalYear,
  })
  if (avsattning) proposals.push(avsattning)

  const slp = await calculateSarskildLoneskatt(supabase, companyId, fiscalPeriodId)
  if (slp) proposals.push(slp)

  const bolagsskatt = await calculateBolagsskatt(supabase, companyId, fiscalPeriodId, {
    manualAdjustments: {
      schablonintaktPeriodiseringsfond: ateforing.schablonintaktAmount,
    },
  })
  if (bolagsskatt) proposals.push(bolagsskatt)

  return {
    entityType,
    fiscalPeriod: period,
    netResultBefore: resultBeforeTax,
    proposals,
  }
}
