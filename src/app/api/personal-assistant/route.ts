import { NextRequest, NextResponse } from 'next/server';
import {
  createOutboundMessage,
  createPersonalContact,
  createPersonalEvent,
  createPersonalReminder,
  createPersonalTask,
  getDefaultUser,
  getPersonalAssistantOverview,
  importGoogleContactsCsv,
  postponePersonalEvent,
  postponePersonalReminder,
  postponePersonalTask,
  sendOutboundMessageNow,
  updatePersonalEvent,
  updatePersonalEventStatus,
  updatePersonalReminder,
  updatePersonalReminderStatus,
  updatePersonalTask,
  updatePersonalTaskStatus
} from '@/lib/personalAssistant';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET(request: NextRequest) {
  try {
    const user = await getDefaultUser();
    const { searchParams } = new URL(request.url);
    const daysAhead = Number(searchParams.get('daysAhead') || 45);
    const daysBack = Number(searchParams.get('daysBack') || 14);

    const overview = await getPersonalAssistantOverview(user.id, {
      daysAhead: Number.isFinite(daysAhead) ? daysAhead : 45,
      daysBack: Number.isFinite(daysBack) ? daysBack : 14
    });

    return json({ success: true, ...overview });
  } catch (error) {
    return json({ success: false, error: errorMessage(error) }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = asString(body.action);
    const payload = (body.payload || body) as Record<string, unknown>;
    const user = await getDefaultUser();

    switch (action) {
      case 'create_contact': {
        const contact = await createPersonalContact(user.id, payload, 'APP');
        return json({ success: true, contact });
      }
      case 'import_google_contacts_csv': {
        const result = await importGoogleContactsCsv(user.id, asString(payload.csvText), 'APP');
        return json({ success: true, result });
      }
      case 'create_reminder': {
        const reminder = await createPersonalReminder(user.id, payload, 'APP');
        return json({ success: true, reminder });
      }
      case 'create_task': {
        const task = await createPersonalTask(user.id, payload, 'APP');
        return json({ success: true, task });
      }
      case 'create_event': {
        const event = await createPersonalEvent(user.id, payload, 'APP');
        return json({ success: true, event });
      }
      case 'create_message': {
        const message = await createOutboundMessage(user.id, payload, 'APP');
        return json({ success: true, message });
      }
      case 'send_message_now': {
        const message = await sendOutboundMessageNow(user.id, payload, 'APP');
        return json({ success: true, message });
      }
      case 'update_task_status': {
        const task = await updatePersonalTaskStatus(user.id, payload, 'APP');
        return json({ success: true, task });
      }
      case 'update_task': {
        const task = await updatePersonalTask(user.id, payload, 'APP');
        return json({ success: true, task });
      }
      case 'postpone_task': {
        const task = await postponePersonalTask(user.id, payload, 'APP');
        return json({ success: true, task });
      }
      case 'update_reminder_status': {
        const reminder = await updatePersonalReminderStatus(user.id, payload, 'APP');
        return json({ success: true, reminder });
      }
      case 'update_reminder': {
        const reminder = await updatePersonalReminder(user.id, payload, 'APP');
        return json({ success: true, reminder });
      }
      case 'postpone_reminder': {
        const reminder = await postponePersonalReminder(user.id, payload, 'APP');
        return json({ success: true, reminder });
      }
      case 'update_event_status': {
        const event = await updatePersonalEventStatus(user.id, payload, 'APP');
        return json({ success: true, event });
      }
      case 'update_event': {
        const event = await updatePersonalEvent(user.id, payload, 'APP');
        return json({ success: true, event });
      }
      case 'postpone_event': {
        const event = await postponePersonalEvent(user.id, payload, 'APP');
        return json({ success: true, event });
      }
      default:
        return json({ success: false, error: 'Unsupported personal assistant action' }, 400);
    }
  } catch (error) {
    return json({ success: false, error: errorMessage(error) }, 500);
  }
}
