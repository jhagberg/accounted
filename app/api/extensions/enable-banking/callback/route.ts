import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createSession, getAccountBalance, type AccountInfo } from '@/extensions/general/enable-banking/lib/api-client'
import type { StoredAccount } from '@/extensions/general/enable-banking/types'

/**
 * GET /api/extensions/enable-banking/callback
 *
 * OAuth callback for Enable Banking PSD2 authorization.
 * Must be a real Next.js route (not extension handler) because
 * banks redirect to this URL directly.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const code = searchParams.get('code')
  const state = searchParams.get('state') // Cryptographic oauth_state token
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  if (error) {
    const errorMessage = errorDescription || error
    console.error('[enable-banking] Bank authorization denied', {
      error,
      error_description: errorDescription,
      has_state: !!state,
    })

    // Clean up the pending bank_connections row so it doesn't accumulate
    if (state) {
      try {
        const supabase = await createServiceClient()

        // Fetch connection details for logging before updating
        const { data: pendingConn } = await supabase
          .from('bank_connections')
          .select('id, user_id, bank_name')
          .eq('oauth_state', state)
          .eq('status', 'pending')
          .single()

        if (pendingConn) {
          console.error('[enable-banking] Authorization denied details', {
            connection_id: pendingConn.id,
            user_id: pendingConn.user_id,
            bank_name: pendingConn.bank_name,
            error_code: error,
            error_description: errorDescription,
          })

          await supabase
            .from('bank_connections')
            .update({ status: 'error', error_message: errorMessage, oauth_state: null })
            .eq('id', pendingConn.id)

          // Include bank name and error code in redirect so the UI can offer PSU type retry
          const params = new URLSearchParams({
            bank_error: errorMessage,
            ...(pendingConn.bank_name ? { bank_name: pendingConn.bank_name } : {}),
            ...(error === 'access_denied' ? { bank_error_code: error } : {}),
          })
          return NextResponse.redirect(`${baseUrl}/settings/banking?${params.toString()}`)
        }
      } catch (cleanupError) {
        console.error('[enable-banking] Failed to clean up pending bank connection:', cleanupError)
      }
    }

    return NextResponse.redirect(
      `${baseUrl}/settings/banking?bank_error=${encodeURIComponent(errorMessage)}`
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings/banking?bank_error=missing_parameters`)
  }

  // Validate authorization code format
  const codePattern = /^[a-zA-Z0-9._~+\/-]{8,2048}$/
  if (!codePattern.test(code)) {
    return NextResponse.redirect(`${baseUrl}/settings/banking?bank_error=invalid_code_format`)
  }

  const supabase = await createServiceClient()

  try {
    // Look up pending connection by oauth_state (CSRF-safe)
    const { data: pendingConnection, error: findError } = await supabase
      .from('bank_connections')
      .select('id, user_id, company_id')
      .eq('oauth_state', state)
      .eq('status', 'pending')
      .single()

    if (findError || !pendingConnection) {
      console.error('[enable-banking] No pending connection for oauth_state', {
        findError: findError ? { message: findError.message, code: findError.code, details: findError.details } : null,
        state,
        hasCode: !!code,
      })
      return NextResponse.redirect(
        `${baseUrl}/settings/banking?bank_error=${encodeURIComponent('invalid_state')}`
      )
    }

    const userId = pendingConnection.user_id
    const companyId = pendingConnection.company_id

    console.log('[enable-banking] Exchanging code for session', {
      connectionId: pendingConnection.id,
      userId,
      codeLength: code.length,
    })

    const sessionData = await createSession(code)
    const { session_id, accounts, access } = sessionData
    const consentExpiresAt = access.valid_until

    console.log('[enable-banking] Session created successfully', {
      connectionId: pendingConnection.id,
      sessionId: '[REDACTED]',
      accountCount: accounts.length,
      consentExpiresAt,
    })

    const accountsWithBalances: StoredAccount[] = await Promise.all(
      accounts.map(async (account: AccountInfo) => {
        try {
          const balance = await getAccountBalance(account.uid)
          return {
            uid: account.uid,
            iban: account.account_id?.iban,
            name: account.name || account.product,
            currency: account.currency,
            balance: balance.amount,
          }
        } catch (balanceError) {
          console.error(`Failed to get balance for account ${account.uid}:`, balanceError)
          return {
            uid: account.uid,
            iban: account.account_id?.iban,
            name: account.name || account.product,
            currency: account.currency,
            balance: undefined,
          }
        }
      })
    )

    // Do not set last_synced_at here. The session is created but no transactions
    // have been fetched yet; setting it now causes the cron's first-sync 90-day
    // backfill path to be skipped if the manual sync triggered by the redirect
    // never lands. The first successful sync (manual or cron) will set it.
    const { error: updateError } = await supabase
      .from('bank_connections')
      .update({
        session_id,
        status: 'active',
        accounts_data: accountsWithBalances,
        consent_expires: consentExpiresAt,
        oauth_state: null, // Clear to prevent replay
      })
      .eq('id', pendingConnection.id)

    if (updateError) {
      console.error('[enable-banking] Failed to update connection after session creation', {
        connectionId: pendingConnection.id,
        updateError: { message: updateError.message, code: updateError.code, details: updateError.details },
        sessionId: '[REDACTED]',
      })
      throw new Error(`Failed to update connection: ${updateError.message}`)
    }

    const connectionId = pendingConnection.id

    const { data: userSettings } = await supabase
      .from('company_settings')
      .select('onboarding_complete')
      .eq('company_id', companyId)
      .single()

    const redirectTarget = `/settings/banking?bank_connected=true&connection_id=${connectionId}`

    return NextResponse.redirect(`${baseUrl}${redirectTarget}`)
  } catch (error) {
    console.error('[enable-banking] Callback error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      state,
      hasCode: !!code,
    })

    try {
      await supabase
        .from('bank_connections')
        .update({ status: 'error', error_message: error instanceof Error ? error.message : 'Connection failed', oauth_state: null })
        .eq('oauth_state', state)
        .eq('status', 'pending')
    } catch (cleanupError) {
      console.error('[enable-banking] Callback cleanup failed', {
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      })
    }

    return NextResponse.redirect(
      `${baseUrl}/settings/banking?bank_error=${encodeURIComponent('Connection failed')}`
    )
  }
}
