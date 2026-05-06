import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseJsonResponse,
  createMockRouteParams,
  createQueuedMockSupabase,
} from '@/tests/helpers'

const { supabase: mockSupabase, enqueue, reset } = createQueuedMockSupabase()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve(mockSupabase),
}))

vi.mock('@/lib/company/context', () => ({
  requireCompanyId: vi.fn().mockResolvedValue('company-1'),
  getActiveCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

vi.mock('@/lib/auth/require-write', () => ({
  requireWritePermission: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/init', () => ({
  ensureInitialized: vi.fn(),
}))

import { POST, DELETE } from '../route'

const mockUser = { id: 'user-1', email: 'test@test.se' }

beforeEach(() => {
  vi.clearAllMocks()
  reset()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
})

function makeReq(body: unknown, method: 'POST' | 'DELETE' = 'POST') {
  return new Request('http://localhost/api/transactions/tx-1/attach-document', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/transactions/[id]/attach-document', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeReq({ document_id: 'doc-1' }), createMockRouteParams({ id: 'tx-1' }))
    const { status, body } = await parseJsonResponse(res)
    expect(status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when document_id missing', async () => {
    const res = await POST(makeReq({}), createMockRouteParams({ id: 'tx-1' }))
    const { status } = await parseJsonResponse(res)
    expect(status).toBe(400)
  })

  it('returns 404 when transaction not in company', async () => {
    enqueue({ data: null, error: null }) // tx fetch
    const res = await POST(
      makeReq({ document_id: '11111111-1111-4111-8111-111111111111' }),
      createMockRouteParams({ id: 'tx-1' }),
    )
    const { status, body } = await parseJsonResponse(res)
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Transaction not found' })
  })

  it('returns 404 when document not in company', async () => {
    enqueue({ data: { id: 'tx-1' }, error: null }) // tx fetch
    enqueue({ data: null, error: null }) // doc fetch
    const res = await POST(
      makeReq({ document_id: '11111111-1111-4111-8111-111111111111' }),
      createMockRouteParams({ id: 'tx-1' }),
    )
    const { status, body } = await parseJsonResponse(res)
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Document not found' })
  })

  it('attaches when both rows exist', async () => {
    enqueue({ data: { id: 'tx-1' }, error: null }) // tx fetch
    enqueue({ data: { id: 'doc-1' }, error: null }) // doc fetch
    enqueue({ data: null, error: null }) // update
    const res = await POST(
      makeReq({ document_id: '11111111-1111-4111-8111-111111111111' }),
      createMockRouteParams({ id: 'tx-1' }),
    )
    const { status, body } = await parseJsonResponse<{ data: { transaction_id: string; document_id: string } }>(res)
    expect(status).toBe(200)
    expect(body.data.transaction_id).toBe('tx-1')
    expect(body.data.document_id).toBe('11111111-1111-4111-8111-111111111111')
  })
})

describe('DELETE /api/transactions/[id]/attach-document', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const res = await DELETE(makeReq(null, 'DELETE'), createMockRouteParams({ id: 'tx-1' }))
    const { status, body } = await parseJsonResponse(res)
    expect(status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when transaction not in company', async () => {
    enqueue({ data: null, error: null }) // tx fetch
    const res = await DELETE(makeReq(null, 'DELETE'), createMockRouteParams({ id: 'tx-1' }))
    const { status, body } = await parseJsonResponse(res)
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Transaction not found' })
  })

  it('returns 409 when document is already on a journal entry', async () => {
    enqueue({ data: { id: 'tx-1', document_id: 'doc-1' }, error: null }) // tx fetch
    enqueue({ data: { journal_entry_id: 'je-1' }, error: null }) // doc fetch
    const res = await DELETE(makeReq(null, 'DELETE'), createMockRouteParams({ id: 'tx-1' }))
    const { status, body } = await parseJsonResponse<{ error: string }>(res)
    expect(status).toBe(409)
    expect(body.error).toContain('verifikation')
  })

  it('clears document_id when no journal entry link', async () => {
    enqueue({ data: { id: 'tx-1', document_id: 'doc-1' }, error: null }) // tx fetch
    enqueue({ data: { journal_entry_id: null }, error: null }) // doc fetch
    enqueue({ data: null, error: null }) // update
    const res = await DELETE(makeReq(null, 'DELETE'), createMockRouteParams({ id: 'tx-1' }))
    const { status, body } = await parseJsonResponse<{ data: { document_id: string | null } }>(res)
    expect(status).toBe(200)
    expect(body.data.document_id).toBeNull()
  })

  it('clears document_id when no doc was attached', async () => {
    enqueue({ data: { id: 'tx-1', document_id: null }, error: null }) // tx fetch
    enqueue({ data: null, error: null }) // update
    const res = await DELETE(makeReq(null, 'DELETE'), createMockRouteParams({ id: 'tx-1' }))
    const { status } = await parseJsonResponse(res)
    expect(status).toBe(200)
  })
})
