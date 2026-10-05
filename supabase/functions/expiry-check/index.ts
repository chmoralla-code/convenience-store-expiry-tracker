// Supabase Edge Function: daily expiry check -> Telegram alert.
// Runs on a schedule (pg_cron) or manually from the dashboard.
// Needs secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WARNING_DAYS = 7;

function daysLeft(expiry: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = expiry.split('-').map(Number);
  const exp = new Date(y, m - 1, d);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

Deno.serve(async () => {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    if (!botToken || !chatId) {
      return Response.json(
        { ok: false, error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secrets.' },
        { status: 500 },
      );
    }

    const db = createClient(url, key);
    const { data, error } = await db
      .from('products')
      .select('name,quantity,expiry_date,category')
      .order('expiry_date', { ascending: true });
    if (error) throw error;

    const flagged = (data ?? []).filter((p) => daysLeft(p.expiry_date) <= WARNING_DAYS);
    if (flagged.length === 0) {
      return Response.json({ ok: true, sent: false, message: 'Nothing near expiry.' });
    }

    const lines = flagged.map((p) => {
      const left = daysLeft(p.expiry_date);
      const when = left < 0 ? `Expired ${Math.abs(left)}d ago` : left === 0 ? 'Expires today' : `${left}d left`;
      return `- ${p.name} x${p.quantity} — ${when} (${p.expiry_date})`;
    });

    const text = `⚠️ Expiry alert (${flagged.length} item${flagged.length > 1 ? 's' : ''})\n${lines.join('\n')}`;

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || 'Telegram refused the message');

    return Response.json({ ok: true, sent: true, count: flagged.length });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
});
