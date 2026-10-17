import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type PushSubscriptionRow = {
  endpoint: string;
  user_id: string;
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    expirationTime?: number | null;
  };
  timezone: string;
};

type TaskRecord = {
  data: { title?: string; status?: string };
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");
const reminderSecret = Deno.env.get("REMINDER_SECRET");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function inQuietHours(timezone: string): boolean {
  try {
    const hourText = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date());
    const hour = Number(hourText);
    return hour < 8 || hour >= 22;
  } catch (error) {
    console.error(`Invalid reminder timezone "${timezone}":`, error);
    return true;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!reminderSecret || request.headers.get("x-reminder-secret") !== reminderSecret) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("Reminder function is missing required Supabase or VAPID secrets.");
    return json({ error: "Reminder function is not configured" }, 500);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: subscriptions, error: subscriptionError } = await supabase
    .from("push_subscriptions")
    .select("endpoint,user_id,subscription,timezone");
  if (subscriptionError) {
    console.error("Could not load reminder subscriptions:", subscriptionError);
    return json({ error: "Could not load reminder subscriptions" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let removed = 0;
  const users = new Map<string, TaskRecord[]>();

  for (const row of (subscriptions || []) as PushSubscriptionRow[]) {
    if (inQuietHours(row.timezone)) {
      skipped++;
      continue;
    }

    let userTasks = users.get(row.user_id);
    if (!userTasks) {
      const { data, error } = await supabase
        .from("tasks")
        .select("data")
        .eq("user_id", row.user_id);
      if (error) {
        console.error(`Could not load tasks for reminder user ${row.user_id}:`, error);
        continue;
      }
      userTasks = (data || []) as TaskRecord[];
      users.set(row.user_id, userTasks);
    }
    const incomplete = userTasks.filter(task => task.data?.status !== "done");
    if (incomplete.length === 0) {
      skipped++;
      continue;
    }

    const count = incomplete.length;
    const payload = JSON.stringify({
      title: "GoalFlow · hourly check-in",
      body: count === 1
        ? `You still have "${incomplete[0].data.title || "an unfinished task"}" to complete.`
        : `You still have ${count} unfinished tasks. Take one small step now.`,
      url: "/",
    });
    try {
      await webpush.sendNotification(row.subscription, payload, { TTL: 3600 });
      sent++;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      console.error(`Push delivery failed for user ${row.user_id}:`, error);
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", row.endpoint);
        if (deleteError) console.error("Could not remove an expired push subscription:", deleteError);
        else removed++;
      }
    }
  }

  return json({ sent, skipped, removed });
});
