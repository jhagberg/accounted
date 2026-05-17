'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileDown, Info } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { calculateEgenavgifter, type EgenavgiftCategory } from '@/lib/bokslut/enskild-firma/egenavgifter-calculator'
import { calculateRantefordelning } from '@/lib/bokslut/enskild-firma/rantefordelning-calculator'
import { proposeEfPfondAvsattning } from '@/lib/bokslut/enskild-firma/periodiseringsfond-ef'
import { calculateExpansionsfondChange } from '@/lib/bokslut/enskild-firma/expansionsfond-calculator'
import type { EfDeclarationItem } from '@/lib/bokslut/enskild-firma/types'

interface EfDeclarationSectionProps {
  fiscalPeriodId: string
  /** Bokfört resultat (income statement net_result) — used as the default
   *  surplus base for the calculators. */
  bookedSurplus: number
  /** Closing year of the fiscal period (for periodiseringsfond cohort). */
  fiscalYear: number
}

/**
 * Read-only EF declaration computation. All values are skattemässiga
 * justeringar that are filed in NE-bilaga / INK1 — never booked. The card
 * runs calculators in the browser as the user adjusts inputs and shows the
 * NE-bilaga ruta where each number lands.
 */
export function EfDeclarationSection({
  fiscalPeriodId,
  bookedSurplus,
  fiscalYear,
}: EfDeclarationSectionProps) {
  const [category, setCategory] = useState<EgenavgiftCategory>('full')
  const [priorSchablon, setPriorSchablon] = useState('')
  const [priorActual, setPriorActual] = useState('')
  const [kapitalunderlag, setKapitalunderlag] = useState('')
  const [pfondDesired, setPfondDesired] = useState('')
  const [expansionsfondBalance, setExpansionsfondBalance] = useState('')
  const [expansionsfondChange, setExpansionsfondChange] = useState('')

  const items: EfDeclarationItem[] = useMemo(() => {
    const list: EfDeclarationItem[] = []
    const eg = calculateEgenavgifter({
      surplusBeforeEgenavgifter: bookedSurplus,
      category,
      priorYearSchablonavdrag: parseFloat(priorSchablon) || 0,
      priorYearActualCharged: parseFloat(priorActual) || 0,
    })
    list.push(eg)

    const kap = parseFloat(kapitalunderlag) || 0
    const r = calculateRantefordelning({ kapitalunderlag: kap })
    if (r) list.push(r)

    const surplusAfterEg = bookedSurplus - eg.amount
    const pfond = proposeEfPfondAvsattning({
      surplus: surplusAfterEg,
      fiscalYear,
      desiredAmount: pfondDesired === '' ? undefined : parseFloat(pfondDesired),
    })
    if (pfond) list.push(pfond)

    const expChange = parseFloat(expansionsfondChange) || 0
    if (expChange !== 0) {
      const exp = calculateExpansionsfondChange({
        kapitalunderlag: kap,
        existingBalance: parseFloat(expansionsfondBalance) || 0,
        desiredChange: expChange,
      })
      if (exp) list.push(exp)
    }
    return list
  }, [
    bookedSurplus,
    category,
    priorSchablon,
    priorActual,
    kapitalunderlag,
    pfondDesired,
    expansionsfondBalance,
    expansionsfondChange,
    fiscalYear,
  ])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skattemässiga justeringar — NE-bilaga</CardTitle>
          <p className="text-sm text-muted-foreground">
            För enskild firma bokförs inte skatt, egenavgifter, fonder eller
            räntefördelning. Beräkningarna nedan visar vad du fyller i på NE-bilagan
            när du deklarerar.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Egenavgifter — kategori</Label>
              <select
                className="border border-border rounded-md h-9 text-sm px-2 w-full bg-background"
                value={category}
                onChange={(e) => setCategory(e.target.value as EgenavgiftCategory)}
              >
                <option value="full">Aktiv, full sats (28,97 %)</option>
                <option value="pensioner">Pensionär (10,21 %)</option>
                <option value="passive">Passiv (SLP 24,26 %)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kapitalunderlag (vid IB)</Label>
              <Input
                type="number"
                step="1"
                value={kapitalunderlag}
                onChange={(e) => setKapitalunderlag(e.target.value)}
                placeholder="0"
                className="tabular-nums h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Föregående års schablonavdrag (R40)</Label>
              <Input
                type="number"
                step="1"
                value={priorSchablon}
                onChange={(e) => setPriorSchablon(e.target.value)}
                placeholder="0"
                className="tabular-nums h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Föregående års faktiska egenavgifter (R41)</Label>
              <Input
                type="number"
                step="1"
                value={priorActual}
                onChange={(e) => setPriorActual(e.target.value)}
                placeholder="0"
                className="tabular-nums h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Önskad periodiseringsfond (max 30 %)</Label>
              <Input
                type="number"
                step="1"
                value={pfondDesired}
                onChange={(e) => setPfondDesired(e.target.value)}
                placeholder="0"
                className="tabular-nums h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tidigare expansionsfond — saldo</Label>
              <Input
                type="number"
                step="1"
                value={expansionsfondBalance}
                onChange={(e) => setExpansionsfondBalance(e.target.value)}
                placeholder="0"
                className="tabular-nums h-9"
              />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">
                Ändring av expansionsfond (+ avsättning, − återföring)
              </Label>
              <Input
                type="number"
                step="1"
                value={expansionsfondChange}
                onChange={(e) => setExpansionsfondChange(e.target.value)}
                placeholder="0"
                className="tabular-nums h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {items.map((item) => (
        <Card key={item.kind}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-base">{item.label}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                <Badge variant="outline" className="mt-2">
                  {item.ne_ruta}
                </Badge>
              </div>
              <p className="font-display text-2xl tabular-nums shrink-0">
                {formatCurrency(item.amount)}
              </p>
            </div>
          </CardHeader>
          {item.warnings.length > 0 && (
            <CardContent className="text-sm text-warning-foreground space-y-1">
              {item.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </CardContent>
          )}
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            NE-bilaga räkenskapsschema (R1–R11)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Räkenskapsschema-delen genereras automatiskt från bokföringen. Ladda ner
            SRU-filen och ladda upp den i Skatteverkets e-tjänst för Inkomstdeklaration 1.
          </p>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link
              href={`/api/reports/ne-bilaga?fiscal_period_id=${fiscalPeriodId}`}
              prefetch={false}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Förhandsgranska NE-bilaga
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
