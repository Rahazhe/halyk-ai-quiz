// supabase/functions/submit-quiz/index.ts
// Saves quiz session to database (new v2 schema)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Content-Type': 'application/json',
};

const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_WINDOW_MS = 60_000;

async function hashIP(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitize(str: string, maxLen = 100): string {
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message }), { status, headers: CORS_HEADERS });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Rate limiting
  const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  const ipHash = await hashIP(clientIP);
  const now = Date.now();
  const lastRequest = rateLimitMap.get(ipHash);
  if (lastRequest && now - lastRequest < RATE_LIMIT_WINDOW_MS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - lastRequest)) / 1000);
    return errorResponse(`Rate limit exceeded. Try again in ${retryAfter} seconds.`, 429);
  }
  rateLimitMap.set(ipHash, now);
  if (rateLimitMap.size > 10_000) {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    for (const [key, ts] of rateLimitMap) { if (ts < cutoff) rateLimitMap.delete(key); }
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  // Validate required fields
  const { business_type, industry, company_size, priority, digital_level } = body as Record<string, string>;
  if (!business_type || !industry || !company_size || !priority || !digital_level) {
    return errorResponse('Missing required quiz answers', 400);
  }
  if (!['b2b', 'b2c'].includes(business_type)) return errorResponse('Invalid business_type', 400);

  // Optional text fields
  const open_q6 = body.open_q6 ? sanitize(String(body.open_q6), 500) : null;
  const open_q7 = body.open_q7 ? sanitize(String(body.open_q7), 500) : null;
  const open_q8 = body.open_q8 ? sanitize(String(body.open_q8), 500) : null;
  const user_name = body.user_name ? sanitize(String(body.user_name), 100) : null;
  const department = body.department ? sanitize(String(body.department), 100) : null;
  const consent = body.consent === true;
  const device = body.device === 'mobile' ? 'mobile' : 'desktop';
  const duration_ms = typeof body.duration_ms === 'number' && body.duration_ms > 0 ? Math.round(body.duration_ms) : null;

  // Beta fields
  const beta_interest = body.beta_interest === true;
  const beta_phone = beta_interest && body.beta_phone ? sanitize(String(body.beta_phone), 30) : null;
  const beta_email = beta_interest && body.beta_email ? sanitize(String(body.beta_email), 100) : null;

  // AI recommendation data (passed from client, computed by get-recommendation)
  const top3_products = Array.isArray(body.top3_products) ? body.top3_products.slice(0, 3) : null;
  const ai_recommendation = body.ai_recommendation || null;
  const used_ai = body.used_ai === true;

  // Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) return errorResponse('Server configuration error', 500);
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error: insertError } = await supabase.from('quiz_sessions').insert({
    business_type,
    industry,
    company_size,
    priority,
    digital_level,
    open_q6,
    open_q7,
    open_q8,
    user_name,
    department,
    consent,
    device,
    duration_ms,
    ip_hash: ipHash,
    beta_interest,
    beta_phone,
    beta_email,
    top3_products,
    ai_recommendation,
    used_ai,
  });

  if (insertError) {
    console.error('Supabase insert error:', insertError);
    return errorResponse('Failed to save quiz results', 500);
  }

  const { count } = await supabase.from('quiz_sessions').select('*', { count: 'exact', head: true });

  return new Response(JSON.stringify({
    success: true,
    participant_number: count ?? 0,
  }), { status: 200, headers: CORS_HEADERS });
});
