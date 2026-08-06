/**
 * Supabase-backed implementation of the server ports.
 *
 * Uses the service-role key, so Row Level Security does not apply and every
 * query has to scope itself to an explicit user id. That is why each method
 * takes a userId rather than deriving one: there is no session here to derive
 * it from, and an unscoped query would read every account.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { CustomerRow } from '../src/domain/dashboard.ts'
import { buildCustomerRows } from '../src/domain/dashboard.ts'
import { settingsFromProfile } from '../src/domain/settings.ts'
import type { CommandEffect } from '../src/domain/messaging/command-executor.ts'
import {
  toActivity,
  toContactMethod,
  toCustomer,
  toFollowUp,
  toProfile,
  toVehicleInterest,
} from '../src/data/supabase/mappers.ts'
import type {
  AccountContext,
  ClaimRequest,
  SendOutcome,
  WebhookStore,
} from '../src/server/ports.ts'

export function createSupabaseStore(url: string, serviceRoleKey: string): WebhookStore {
  const client: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const rows = async (userId: string, now: Date): Promise<CustomerRow[]> => {
    const [customers, contactMethods, vehicleInterests, activities, followUps, profile] =
      await Promise.all([
        select(client, 'customers', userId),
        select(client, 'customer_contact_methods', userId),
        select(client, 'vehicle_interests', userId),
        select(client, 'activities', userId),
        select(client, 'follow_ups', userId),
        selectOne(client, 'profiles', userId),
      ])

    return buildCustomerRows({
      customers: customers.map(toCustomer),
      contactMethods: contactMethods.map(toContactMethod),
      vehicleInterests: vehicleInterests.map(toVehicleInterest),
      activities: activities.map(toActivity),
      followUps: followUps.map(toFollowUp),
      timeZone: profile === null ? 'UTC' : toProfile(profile).timeZone,
      now,
    })
  }

  return {
    async listAccounts(): Promise<AccountContext[]> {
      const { data } = await client.from('profiles').select('*')

      return (data ?? []).map((row) => {
        const profile = toProfile(row as Record<string, unknown>)

        return {
          userId: profile.id,
          settings: settingsFromProfile(profile),
          // A profile without an approved number is never messaged.
          approvedNumberE164: profile.whatsappEnabled ? profile.whatsappNumberE164 : null,
          remindersEnabled: profile.remindersEnabled && profile.whatsappEnabled,
        }
      })
    },

    loadRows: rows,

    async expireWaitingFollowUps(userId: string, now: Date): Promise<number> {
      // Reuses the Phase 2 SQL function rather than reimplementing the rule.
      const { data } = await client.rpc('expire_waiting_follow_ups', { p_now: now.toISOString() })
      void userId
      return typeof data === 'number' ? data : 0
    },

    async claimNotification(request: ClaimRequest): Promise<string | null> {
      // The atomic claim: a unique-key collision returns null rather than a row,
      // so a concurrent run skips instead of sending a duplicate.
      const { data } = await client.rpc('claim_notification', {
        p_user_id: request.userId,
        p_idempotency_key: request.idempotencyKey,
        p_kind: request.kind,
        p_reminder_stage: request.reminderStage,
        p_follow_up_id: request.followUpId,
        p_customer_id: request.customerId,
        p_to_number_e164: request.toNumberE164,
        p_payload_summary: request.payloadSummary,
        p_claimed_by: 'worker',
      })

      return typeof data === 'string' ? data : null
    },

    async recordSendResult(notificationId: string, outcome: SendOutcome): Promise<void> {
      await client.rpc('record_notification_result', {
        p_notification_id: notificationId,
        p_status: outcome.status,
        p_provider_message_id: outcome.providerMessageId ?? null,
        p_billable: outcome.billable ?? true,
        p_error: outcome.error ?? null,
        p_permanent: outcome.permanent ?? false,
        p_next_attempt_at: outcome.nextAttemptAt ?? null,
      })
    },

    async listRetryable(userId: string, now: Date, maxAttempts: number) {
      const { data } = await client
        .from('notification_log')
        .select('id, idempotency_key, payload_summary, to_number_e164, attempt_count')
        .eq('user_id', userId)
        .eq('status', 'failed')
        .eq('permanent_failure', false)
        .lt('attempt_count', maxAttempts)
        .lte('next_attempt_at', now.toISOString())
        .limit(20)

      return (data ?? []).map((row) => {
        const record = row as Record<string, unknown>
        return {
          id: String(record['id']),
          idempotencyKey: String(record['idempotency_key']),
          body: String(record['payload_summary'] ?? ''),
          toNumberE164: (record['to_number_e164'] as string | null) ?? null,
          attemptCount: Number(record['attempt_count'] ?? 0),
        }
      })
    },

    async recordUsage(userId, kind, quantity, costUsd): Promise<void> {
      await client
        .from('usage_events')
        .insert({ user_id: userId, kind, quantity, estimated_cost_usd: costUsd })
    },

    async registerInboundMessage(input): Promise<boolean> {
      // The unique index on (provider, provider_message_id) is what rejects a
      // retried webhook delivery; a conflict means we have seen it already.
      const { error } = await client.from('inbound_commands').insert({
        user_id: input.userId,
        channel: 'whatsapp_text',
        status: input.isApprovedSender ? 'received' : 'rejected',
        provider: 'whatsapp_cloud',
        provider_message_id: input.providerMessageId,
        from_number_e164: input.fromE164,
        is_approved_sender: input.isApprovedSender,
        raw_text: input.text,
      })

      return error === null
    },

    async updateDeliveryStatus(providerMessageId, status, error): Promise<void> {
      const mapped =
        status === 'delivered' ? 'delivered' : status === 'read' ? 'read' : status === 'failed' ? 'failed' : 'sent'

      await client
        .from('notification_log')
        .update({
          status: mapped,
          error: error ?? null,
          delivered_at: status === 'delivered' ? new Date().toISOString() : undefined,
          read_at: status === 'read' ? new Date().toISOString() : undefined,
        })
        .eq('provider_message_id', providerMessageId)
    },

    async readOpenClarification(userId, now) {
      const { data } = await client
        .from('clarification_sessions')
        .select('*')
        .eq('user_id', userId)
        .is('resolved_at', null)
        .gt('expires_at', now.toISOString())
        .maybeSingle()

      if (data === null) return null
      const record = data as Record<string, unknown>

      return {
        id: String(record['id']),
        options: Array.isArray(record['options'])
          ? (record['options'] as Array<{ label: string; value: string }>)
          : [],
        pendingPayload:
          typeof record['pending_payload'] === 'object' && record['pending_payload'] !== null
            ? (record['pending_payload'] as Record<string, unknown>)
            : {},
      }
    },

    async openClarification(input): Promise<void> {
      await client.from('clarification_sessions').insert({
        user_id: input.userId,
        kind: input.kind,
        prompt: input.prompt,
        options: input.options,
        pending_payload: input.pendingPayload,
        expires_at: input.expiresAt,
      })
    },

    async resolveClarification(sessionId, resolution): Promise<void> {
      await client
        .from('clarification_sessions')
        .update({ resolved_at: new Date().toISOString(), resolution })
        .eq('id', sessionId)
    },

    async applyCommandEffects(userId, customerId, effects, now): Promise<void> {
      for (const effect of effects) {
        await applyEffect(client, userId, customerId, effect, now)
      }
    },

    async writeAudit(userId, summary, metadata): Promise<void> {
      await client.from('audit_log').insert({
        user_id: userId,
        action: 'update',
        table_name: 'inbound_commands',
        summary: summary.slice(0, 500),
        metadata,
        source: 'whatsapp',
      })
    },

    async recentReminderCustomerIds(userId): Promise<string[]> {
      const { data } = await client
        .from('notification_log')
        .select('customer_id')
        .eq('user_id', userId)
        .not('customer_id', 'is', null)
        .not('reminder_stage', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5)

      return (data ?? [])
        .map((row) => (row as { customer_id: string | null }).customer_id)
        .filter((id): id is string => id !== null)
    },
  }
}

async function applyEffect(
  client: SupabaseClient,
  userId: string,
  customerId: string,
  effect: CommandEffect,
  now: Date,
): Promise<void> {
  switch (effect.type) {
    case 'log_activity':
      await client.from('activities').insert({
        user_id: userId,
        customer_id: customerId,
        type: effect.activityType,
        direction: effect.direction,
        method: effect.method,
        outcome: effect.outcome,
        summary: effect.summary,
        occurred_at: now.toISOString(),
        source: 'whatsapp',
        // A command is me saying I did it, so outbound counts as an attempt.
        performed_by_user: effect.direction === 'outbound',
      })
      await client.from('customers').update({ last_activity_at: now.toISOString() }).eq('id', customerId)
      break

    case 'complete_follow_up':
      await client.rpc('close_open_follow_up', {
        p_customer_id: customerId,
        p_resolution: 'complete',
        p_note: 'Completed from WhatsApp',
      })
      break

    case 'snooze':
      await client
        .from('follow_ups')
        .update({ status: 'snoozed', snoozed_until: effect.until, waiting_until: null })
        .eq('customer_id', customerId)
        .in('status', ['pending', 'overdue', 'waiting_on_customer'])
      break

    case 'schedule_follow_up':
      await client.rpc('schedule_follow_up', {
        p_customer_id: customerId,
        p_due_at: effect.dueAt,
        p_reason: effect.reason,
        p_recommended_method: null,
        p_priority: 'normal',
        p_waiting_until: null,
        p_is_appointment: effect.isAppointment,
        p_resolution: 'complete',
        p_resolution_note: 'Replaced from WhatsApp',
        p_source: 'whatsapp',
      })
      break

    case 'set_waiting':
      await client.rpc('schedule_follow_up', {
        p_customer_id: customerId,
        p_due_at: effect.waitingUntil,
        p_reason: effect.reason,
        p_recommended_method: null,
        p_priority: 'normal',
        p_waiting_until: effect.waitingUntil,
        p_is_appointment: false,
        p_resolution: 'complete',
        p_resolution_note: 'Replaced from WhatsApp',
        p_source: 'whatsapp',
      })
      break

    case 'set_status':
      await client
        .from('customers')
        .update({
          lead_status: effect.status,
          archived_at: effect.status === 'archived' ? now.toISOString() : null,
        })
        .eq('id', customerId)

      if (['sold', 'lost', 'do_not_contact', 'archived'].includes(effect.status)) {
        await client.rpc('close_open_follow_up', {
          p_customer_id: customerId,
          p_resolution: 'cancel',
          p_note: `Customer marked ${effect.status}`,
        })
      }
      break

    case 'add_note':
      await client.from('activities').insert({
        user_id: userId,
        customer_id: customerId,
        type: 'note',
        direction: 'internal',
        summary: effect.note,
        occurred_at: now.toISOString(),
        source: 'whatsapp',
        performed_by_user: false,
      })
      break
  }
}

async function select(
  client: SupabaseClient,
  table: string,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data } = await client.from(table).select('*').eq('user_id', userId).limit(5000)
  return (data ?? []) as Array<Record<string, unknown>>
}

async function selectOne(
  client: SupabaseClient,
  table: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await client.from(table).select('*').eq('id', userId).maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}
