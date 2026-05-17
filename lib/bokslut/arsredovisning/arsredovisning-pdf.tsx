import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { ArsredovisningData } from './types'

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingHorizontal: 50,
    paddingBottom: 60,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    fontSize: 8,
    color: '#555',
    borderBottomWidth: 0.5,
    borderBottomColor: '#aaa',
    paddingBottom: 6,
  },
  pageFooter: {
    position: 'absolute',
    bottom: 30,
    left: 50,
    right: 50,
    fontSize: 8,
    color: '#888',
    textAlign: 'center',
  },
  title: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    marginTop: 40,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 12,
    color: '#444',
    marginBottom: 50,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    marginTop: 20,
    marginBottom: 10,
  },
  paragraph: {
    marginBottom: 8,
    lineHeight: 1.4,
  },
  noteBody: {
    marginBottom: 4,
    lineHeight: 1.4,
  },
  tableHeader: {
    flexDirection: 'row',
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: '#888',
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 2,
  },
  tableRowTotal: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderTopWidth: 0.5,
    borderTopColor: '#888',
    fontFamily: 'Helvetica-Bold',
  },
  colLabel: {
    flex: 1,
  },
  colLabelIndent: {
    flex: 1,
    paddingLeft: 12,
  },
  colAmount: {
    width: 100,
    textAlign: 'right',
  },
  signatureLine: {
    flexDirection: 'row',
    marginTop: 30,
    alignItems: 'flex-end',
  },
  signatureSlot: {
    flex: 1,
    marginRight: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    paddingBottom: 2,
  },
})

function fmt(amount: number): string {
  // sv-SE thousands grouping, no decimals — typical for K2 ÅR.
  return Math.round(amount).toLocaleString('sv-SE')
}

function PageChrome({
  data,
  pageLabel,
}: {
  data: ArsredovisningData
  pageLabel?: string
}) {
  return (
    <>
      <View style={styles.pageHeader} fixed>
        <Text>
          {data.company.name} · {data.company.org_number}
        </Text>
        <Text>Årsredovisning {data.fiscal_period.name}</Text>
      </View>
      <Text style={styles.pageFooter} fixed>
        {pageLabel ?? ''}
      </Text>
    </>
  )
}

export function ArsredovisningPDF({ data }: { data: ArsredovisningData }) {
  return (
    <Document>
      {/* Cover */}
      <Page size="A4" style={styles.page}>
        <PageChrome data={data} pageLabel="Försättssida" />
        <View>
          <Text style={styles.title}>Årsredovisning</Text>
          <Text style={styles.subtitle}>
            för räkenskapsåret {data.fiscal_period.period_start} — {data.fiscal_period.period_end}
          </Text>
          <Text style={styles.paragraph}>{data.company.name}</Text>
          <Text style={styles.paragraph}>Organisationsnummer: {data.company.org_number}</Text>
          {data.company.sate && (
            <Text style={styles.paragraph}>Säte: {data.company.sate}</Text>
          )}
        </View>
      </Page>

      {/* Förvaltningsberättelse */}
      <Page size="A4" style={styles.page}>
        <PageChrome data={data} pageLabel="Förvaltningsberättelse" />
        <Text style={styles.sectionTitle}>Förvaltningsberättelse</Text>

        <Text style={styles.sectionTitle}>Verksamhet</Text>
        <Text style={styles.paragraph}>{data.forvaltningsberattelse.description}</Text>

        <Text style={styles.sectionTitle}>Väsentliga händelser under räkenskapsåret</Text>
        <Text style={styles.paragraph}>{data.forvaltningsberattelse.important_events}</Text>

        {data.forvaltningsberattelse.kontrollbalans_required && (
          <>
            <Text style={styles.sectionTitle}>Kontrollbalansräkning</Text>
            <Text style={styles.paragraph}>
              Kontrollbalansräkning har upprättats under räkenskapsåret enligt ABL 25 kap.
            </Text>
          </>
        )}

        <Text style={styles.sectionTitle}>Flerårsöversikt (kr)</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.colLabel}>År</Text>
          <Text style={styles.colAmount}>Nettoomsättning</Text>
          <Text style={styles.colAmount}>Resultat e.fin.poster</Text>
          <Text style={styles.colAmount}>Soliditet (%)</Text>
        </View>
        {data.forvaltningsberattelse.flerarsoversikt.map((row) => (
          <View key={row.year} style={styles.tableRow}>
            <Text style={styles.colLabel}>{row.year}</Text>
            <Text style={styles.colAmount}>{fmt(row.net_revenue)}</Text>
            <Text style={styles.colAmount}>{fmt(row.result_after_financial)}</Text>
            <Text style={styles.colAmount}>
              {row.soliditet_pct === null ? '—' : row.soliditet_pct.toFixed(1)}
            </Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Förändring av eget kapital (kr)</Text>
        {data.forvaltningsberattelse.egen_kapital_changes.map((r) => (
          <View key={r.label} style={styles.tableRow}>
            <Text style={styles.colLabel}>{r.label}</Text>
            <Text style={styles.colAmount}>{fmt(r.amount)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Förslag till resultatdisposition</Text>
        <Text style={styles.paragraph}>{data.forvaltningsberattelse.resultatdisposition}</Text>
      </Page>

      {/* Resultaträkning */}
      <Page size="A4" style={styles.page}>
        <PageChrome data={data} pageLabel="Resultaträkning" />
        <Text style={styles.sectionTitle}>Resultaträkning (kr)</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.colLabel}>Post</Text>
          <Text style={styles.colAmount}>{data.fiscal_period.name}</Text>
        </View>
        {data.resultatrakning.map((line, i) => (
          <View key={i} style={line.is_total ? styles.tableRowTotal : styles.tableRow}>
            <Text style={styles.colLabel}>{line.label}</Text>
            <Text style={styles.colAmount}>{fmt(line.amount)}</Text>
          </View>
        ))}
      </Page>

      {/* Balansräkning */}
      <Page size="A4" style={styles.page}>
        <PageChrome data={data} pageLabel="Balansräkning" />
        <Text style={styles.sectionTitle}>Tillgångar (kr)</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.colLabel}>Post</Text>
          <Text style={styles.colAmount}>{data.fiscal_period.period_end}</Text>
        </View>
        {data.balansrakning.assets.map((line, i) => (
          <View key={i} style={line.is_total ? styles.tableRowTotal : styles.tableRow}>
            <Text style={line.indent ? styles.colLabelIndent : styles.colLabel}>
              {line.label}
            </Text>
            <Text style={styles.colAmount}>{fmt(line.amount)}</Text>
          </View>
        ))}
        <View style={styles.tableRowTotal}>
          <Text style={styles.colLabel}>Summa tillgångar</Text>
          <Text style={styles.colAmount}>{fmt(data.balansrakning.total_assets)}</Text>
        </View>

        <Text style={styles.sectionTitle}>Eget kapital och skulder (kr)</Text>
        {data.balansrakning.equity_liabilities.map((line, i) => (
          <View key={i} style={line.is_total ? styles.tableRowTotal : styles.tableRow}>
            <Text style={line.indent ? styles.colLabelIndent : styles.colLabel}>
              {line.label}
            </Text>
            <Text style={styles.colAmount}>{fmt(line.amount)}</Text>
          </View>
        ))}
        <View style={styles.tableRowTotal}>
          <Text style={styles.colLabel}>Summa eget kapital och skulder</Text>
          <Text style={styles.colAmount}>{fmt(data.balansrakning.total_equity_liabilities)}</Text>
        </View>
      </Page>

      {/* Noter */}
      <Page size="A4" style={styles.page}>
        <PageChrome data={data} pageLabel="Noter" />
        <Text style={styles.sectionTitle}>Noter</Text>
        {data.noter.map((note) => (
          <View key={note.number} style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>
              Not {note.number} — {note.title}
            </Text>
            <Text style={styles.noteBody}>{note.body}</Text>
          </View>
        ))}
      </Page>

      {/* Underskrifter */}
      <Page size="A4" style={styles.page}>
        <PageChrome data={data} pageLabel="Underskrifter" />
        <Text style={styles.sectionTitle}>Underskrifter</Text>
        <Text style={styles.paragraph}>
          {data.company.sate ? `${data.company.sate}, ` : ''}
          {data.fiscal_period.period_end}
        </Text>
        {(data.signatures.length > 0
          ? data.signatures
          : [
              { role: 'Styrelseledamot', name: '', signed_at: null },
              { role: 'Styrelseledamot', name: '', signed_at: null },
            ]
        ).map((sig, i) => (
          <View key={i} style={styles.signatureLine}>
            <View style={styles.signatureSlot}>
              <Text>{sig.name || ' '}</Text>
            </View>
            <Text style={{ width: 120 }}>{sig.role}</Text>
          </View>
        ))}
      </Page>
    </Document>
  )
}
